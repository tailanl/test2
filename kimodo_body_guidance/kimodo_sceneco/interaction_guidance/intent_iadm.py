#!/usr/bin/env python3
"""Inference-legal IntentMotion-style contact field and IADM primitive.

This module deliberately has no dependency on CompletionKeyPose/C020.  Its
public model consumes only no-oracle information available before Body
sampling. The full proposed E226 Root may be summarized, so this is not online
temporal causality:

* scene surface tokens (the first three channels are bounds-normalized xyz and
  the next three are surface normal),
* a validity mask and metric scene bounds,
* an immutable, metric E226 root sequence,
* text embeddings and their mask, and
* the current diffusion timestep.

The learned proposer selects a scene-surface contact centre with a
straight-through categorical sample and predicts a bounded contact radius.
The resulting 4x4x4x7 field follows the released IntentMotion ContactSensor:
one-sided truncated occupancy, query xyz, and nearest surface normal.  The
IGCF algebra is inspired by the P60/released ordering: 448 -> D through two
Linear+SiLU stages, text reads contact, four latent SA+FF blocks, contact reads
intent, then the diffusion timestep is added to produce Cc.

Supervision is intentionally outside every ``nn.Module.forward`` method; see
``p78_causal_repair_loss``.  Label tensors can therefore never become model
conditions by accident.
"""

from __future__ import annotations

from dataclasses import dataclass
import inspect
import math
from typing import Dict, Mapping, Optional, Tuple

import torch
from torch import Tensor, nn
import torch.nn.functional as F


CONTACT_VOXEL_DIM = 4
CONTACT_FIELD_CHANNELS = 7
CONTACT_FIELD_FLAT_DIM = CONTACT_VOXEL_DIM ** 3 * CONTACT_FIELD_CHANNELS
OFFICIAL_LATENT_DEPTH = 4
OFFICIAL_CROSS_HEADS = 1
OFFICIAL_CROSS_DIM_HEAD = 64
OFFICIAL_LATENT_HEADS = 8
OFFICIAL_LATENT_DIM_HEAD = 64

FORWARD_CAUSAL_INPUTS: Tuple[str, ...] = (
    "scene_tokens",
    "scene_mask",
    "scene_bounds",
    "e226_root",
    "text_embeddings",
    "text_mask",
    "timesteps",
    "field_enabled",
)
FORBIDDEN_FORWARD_FRAGMENTS: Tuple[str, ...] = (
    "target",
    "gt",
    "label",
    "donor",
    "oracle",
    "future",
    "keypose",
    "path",
)


def _require_floating(name: str, value: Tensor) -> None:
    if not torch.is_floating_point(value):
        raise TypeError(f"{name} must be floating point")
    if not bool(torch.isfinite(value).all()):
        raise ValueError(f"{name} contains non-finite values")


def _sinusoidal_embedding(timesteps: Tensor, width: int, dtype: torch.dtype) -> Tensor:
    if timesteps.ndim != 1 or timesteps.dtype != torch.long:
        raise ValueError("timesteps must be int64 [B]")
    if bool((timesteps < 0).any()):
        raise ValueError("timesteps must be non-negative")
    half = width // 2
    exponent = -math.log(10_000.0) * torch.arange(
        half, device=timesteps.device, dtype=torch.float32
    ) / max(half - 1, 1)
    phase = timesteps.float()[:, None] * torch.exp(exponent)[None]
    embedding = torch.cat((phase.cos(), phase.sin()), dim=-1)
    if width % 2:
        embedding = F.pad(embedding, (0, 1))
    return embedding.to(dtype=dtype)


def _masked_mean(value: Tensor, valid: Tensor) -> Tensor:
    if value.ndim != 3 or valid.shape != value.shape[:2]:
        raise ValueError("masked mean expects [B,L,D] and [B,L]")
    valid = valid.to(device=value.device, dtype=torch.bool)
    if not bool(valid.any(dim=1).all()):
        raise ValueError("every sample requires at least one valid token")
    weight = valid[..., None].to(value.dtype)
    return (value * weight).sum(dim=1) / weight.sum(dim=1).clamp_min(1.0)


def _metric_scene_xyz(scene_tokens: Tensor, scene_bounds: Tensor) -> Tensor:
    """Undo P29's per-scene [-1,1] xyz normalization in metric world units."""

    normalized_xyz = scene_tokens[..., :3]
    extent = scene_bounds[:, 1] - scene_bounds[:, 0]
    return scene_bounds[:, 0, None] + 0.5 * (normalized_xyz + 1.0) * extent[:, None]


class _GEGLU(nn.Module):
    def forward(self, value: Tensor) -> Tensor:
        hidden, gate = value.chunk(2, dim=-1)
        return hidden * F.gelu(gate)


class _FeedForward(nn.Module):
    """Perceiver-style GEGLU feed-forward used by this reproduction."""

    def __init__(self, width: int, multiplier: int = 4) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(width, width * multiplier * 2),
            _GEGLU(),
            nn.Linear(width * multiplier, width),
        )

    def forward(self, value: Tensor) -> Tensor:
        return self.net(value)


class _Attention(nn.Module):
    """P60-style Perceiver attention with explicit valid masks."""

    def __init__(
        self,
        query_dim: int,
        *,
        context_dim: Optional[int] = None,
        heads: int,
        dim_head: int,
        dropout: float,
    ) -> None:
        super().__init__()
        context_width = query_dim if context_dim is None else int(context_dim)
        self.heads = int(heads)
        self.dim_head = int(dim_head)
        inner = self.heads * self.dim_head
        self.scale = self.dim_head ** -0.5
        self.to_q = nn.Linear(query_dim, inner, bias=False)
        self.to_kv = nn.Linear(context_width, inner * 2, bias=False)
        self.to_out = nn.Linear(inner, query_dim)
        self.dropout = nn.Dropout(float(dropout))

    def forward(
        self,
        query: Tensor,
        *,
        context: Optional[Tensor] = None,
        context_valid_mask: Optional[Tensor] = None,
    ) -> Tensor:
        if query.ndim != 3:
            raise ValueError("attention query must be [B,L,D]")
        context = query if context is None else context
        if context.ndim != 3 or context.shape[0] != query.shape[0]:
            raise ValueError("attention context must be batch-matched [B,K,D]")
        batch, query_count = query.shape[:2]
        key_count = context.shape[1]
        q = self.to_q(query).view(
            batch, query_count, self.heads, self.dim_head
        ).transpose(1, 2)
        k, v = self.to_kv(context).chunk(2, dim=-1)
        k = k.view(batch, key_count, self.heads, self.dim_head).transpose(1, 2)
        v = v.view(batch, key_count, self.heads, self.dim_head).transpose(1, 2)
        similarity = torch.matmul(q, k.transpose(-1, -2)) * self.scale
        if context_valid_mask is not None:
            if context_valid_mask.shape != (batch, key_count):
                raise ValueError("attention context mask shape mismatch")
            valid = context_valid_mask.to(device=query.device, dtype=torch.bool)
            if not bool(valid.any(dim=1).all()):
                raise ValueError("every sample requires valid attention context")
            similarity = similarity.masked_fill(
                ~valid[:, None, None, :], -torch.finfo(similarity.dtype).max
            )
        attention = self.dropout(similarity.softmax(dim=-1))
        output = torch.matmul(attention, v)
        output = output.transpose(1, 2).reshape(batch, query_count, -1)
        return self.to_out(output)


class _PreNormCrossAttention(nn.Module):
    def __init__(
        self,
        width: int,
        *,
        heads: int,
        dim_head: int,
        dropout: float,
    ) -> None:
        super().__init__()
        self.query_norm = nn.LayerNorm(width)
        self.context_norm = nn.LayerNorm(width)
        self.attention = _Attention(
            width,
            context_dim=width,
            heads=heads,
            dim_head=dim_head,
            dropout=dropout,
        )

    def forward(self, query: Tensor, context: Tensor, context_valid: Tensor) -> Tensor:
        return self.attention(
            self.query_norm(query),
            context=self.context_norm(context),
            context_valid_mask=context_valid,
        )


class _LatentIntentBlock(nn.Module):
    def __init__(self, width: int, *, heads: int, dim_head: int, dropout: float) -> None:
        super().__init__()
        self.attention_norm = nn.LayerNorm(width)
        self.attention = _Attention(
            width, heads=heads, dim_head=dim_head, dropout=dropout
        )
        self.ff_norm = nn.LayerNorm(width)
        self.ff = _FeedForward(width)

    def forward(self, value: Tensor, valid: Tensor) -> Tensor:
        normalized = self.attention_norm(value)
        value = value + self.attention(
            normalized, context=normalized, context_valid_mask=valid
        )
        value = value + self.ff(self.ff_norm(value))
        return value.masked_fill(~valid[..., None], 0.0)


@dataclass(frozen=True)
class SurfaceContactProposal:
    center: Tensor
    radius: Tensor
    surface_logits: Tensor
    surface_weights: Tensor
    selected_surface_index: Tensor
    selected_surface_normal: Tensor


class CausalSurfaceContactProposer(nn.Module):
    """Select a surface point and radius from scene, E226 root, and text only."""

    def __init__(
        self,
        *,
        scene_token_dim: int,
        text_dim: int,
        width: int,
        min_radius_m: float = 0.05,
        max_radius_scene_fraction: float = 0.25,
    ) -> None:
        super().__init__()
        if int(scene_token_dim) < 6:
            raise ValueError(
                "scene tokens require normalized_xyz3+normal3 in their first six channels"
            )
        if min_radius_m <= 0.0 or not 0.0 < max_radius_scene_fraction <= 0.5:
            raise ValueError("invalid contact radius bounds")
        self.scene_token_dim = int(scene_token_dim)
        self.text_dim = int(text_dim)
        self.width = int(width)
        self.min_radius_m = float(min_radius_m)
        self.max_radius_scene_fraction = float(max_radius_scene_fraction)
        self.scene_projector = nn.Sequential(
            nn.Linear(self.scene_token_dim, self.width),
            nn.SiLU(),
            nn.Linear(self.width, self.width),
        )
        self.text_projector = nn.Sequential(
            nn.Linear(self.text_dim, self.width), nn.SiLU(), nn.Linear(self.width, self.width)
        )
        # start xyz, end xyz, mean xyz, displacement xyz
        self.root_projector = nn.Sequential(
            nn.Linear(12, self.width), nn.SiLU(), nn.Linear(self.width, self.width)
        )
        # bounds-normalized xyz, distance to nearest root, distance to final root
        self.geometry_projector = nn.Sequential(
            nn.Linear(5, self.width), nn.SiLU(), nn.Linear(self.width, self.width)
        )
        self.query_projector = nn.Sequential(
            nn.LayerNorm(self.width), nn.Linear(self.width, self.width)
        )
        self.radius_head = nn.Sequential(
            nn.Linear(3 * self.width, self.width),
            nn.SiLU(),
            nn.Linear(self.width, 1),
        )

    @staticmethod
    def _validate_inputs(
        scene_tokens: Tensor,
        scene_mask: Tensor,
        scene_bounds: Tensor,
        e226_root: Tensor,
        text_embeddings: Tensor,
        text_mask: Tensor,
    ) -> None:
        if scene_tokens.ndim != 3 or scene_tokens.shape[-1] < 6:
            raise ValueError("scene_tokens must be [B,N,C>=6]")
        if scene_mask.shape != scene_tokens.shape[:2]:
            raise ValueError("scene_mask must be [B,N]")
        if scene_bounds.shape != (scene_tokens.shape[0], 2, 3):
            raise ValueError("scene_bounds must be [B,2,3]")
        if e226_root.ndim != 3 or e226_root.shape[0] != scene_tokens.shape[0]:
            raise ValueError("e226_root must be [B,T,R]")
        if e226_root.shape[1] < 1 or e226_root.shape[-1] < 3:
            raise ValueError("e226_root requires at least one frame and xyz channels")
        if text_embeddings.ndim != 3 or text_embeddings.shape[0] != scene_tokens.shape[0]:
            raise ValueError("text_embeddings must be [B,L,C]")
        if text_mask.shape != text_embeddings.shape[:2]:
            raise ValueError("text_mask must be [B,L]")
        for name, value in (
            ("scene_tokens", scene_tokens),
            ("scene_bounds", scene_bounds),
            ("e226_root", e226_root),
            ("text_embeddings", text_embeddings),
        ):
            _require_floating(name, value)
        scene_valid = scene_mask.to(dtype=torch.bool)
        text_valid = text_mask.to(dtype=torch.bool)
        if not bool(scene_valid.any(dim=1).all()):
            raise ValueError("every sample requires a valid scene surface token")
        if not bool(text_valid.any(dim=1).all()):
            raise ValueError("every sample requires a valid text token")
        valid_normalized_xyz = scene_tokens[..., :3][scene_valid]
        if bool(((valid_normalized_xyz < -1.0001) | (valid_normalized_xyz > 1.0001)).any()):
            raise ValueError("valid scene xyz channels must follow P29's [-1,1] contract")
        valid_normal_norm = torch.linalg.vector_norm(
            scene_tokens[..., 3:6][scene_valid], dim=-1
        )
        if bool((valid_normal_norm <= 1.0e-6).any()):
            raise ValueError("valid scene surface normals must be non-zero")
        extent = scene_bounds[:, 1] - scene_bounds[:, 0]
        if bool((extent <= 0.0).any()):
            raise ValueError("scene_bounds require strictly positive extent")

    def forward(
        self,
        scene_tokens: Tensor,
        scene_mask: Tensor,
        scene_bounds: Tensor,
        e226_root: Tensor,
        text_embeddings: Tensor,
        text_mask: Tensor,
    ) -> SurfaceContactProposal:
        self._validate_inputs(
            scene_tokens, scene_mask, scene_bounds, e226_root, text_embeddings, text_mask
        )
        if scene_tokens.shape[-1] != self.scene_token_dim:
            raise ValueError(
                f"scene token width mismatch: expected {self.scene_token_dim}, "
                f"got {scene_tokens.shape[-1]}"
            )
        if text_embeddings.shape[-1] != self.text_dim:
            raise ValueError(
                f"text width mismatch: expected {self.text_dim}, got {text_embeddings.shape[-1]}"
            )
        scene_valid = scene_mask.to(device=scene_tokens.device, dtype=torch.bool)
        text_valid = text_mask.to(device=text_embeddings.device, dtype=torch.bool)
        normalized_xyz = scene_tokens[..., :3]
        # Formal P29 contract: all geometric reasoning is done only after
        # reversing the per-scene coordinate normalization.
        xyz = _metric_scene_xyz(scene_tokens, scene_bounds)
        normal = F.normalize(scene_tokens[..., 3:6], dim=-1, eps=1.0e-6)
        root_xyz = e226_root[..., :3]
        root_summary = torch.cat(
            (
                root_xyz[:, 0],
                root_xyz[:, -1],
                root_xyz.mean(dim=1),
                root_xyz[:, -1] - root_xyz[:, 0],
            ),
            dim=-1,
        )
        projected_text = self.text_projector(text_embeddings)
        text_global = _masked_mean(projected_text, text_valid)
        root_global = self.root_projector(root_summary)

        root_distance = torch.cdist(xyz.float(), root_xyz.float()).to(xyz.dtype)
        nearest_root_distance = root_distance.amin(dim=-1, keepdim=True)
        final_root_distance = torch.linalg.vector_norm(
            xyz - root_xyz[:, -1, None], dim=-1, keepdim=True
        )
        geometry = torch.cat(
            (normalized_xyz, nearest_root_distance, final_root_distance), dim=-1
        )
        scene_latent = self.scene_projector(scene_tokens) + self.geometry_projector(geometry)
        query = self.query_projector(text_global + root_global)
        logits = torch.einsum("bnd,bd->bn", scene_latent, query) / math.sqrt(self.width)
        logits = logits - 0.1 * nearest_root_distance.squeeze(-1)
        logits = logits.masked_fill(~scene_valid, -torch.finfo(logits.dtype).max)
        probabilities = logits.softmax(dim=-1)
        selected_index = probabilities.argmax(dim=-1)
        hard = F.one_hot(selected_index, num_classes=scene_tokens.shape[1]).to(probabilities)
        straight_through = hard + probabilities - probabilities.detach()
        center = torch.einsum("bn,bnc->bc", straight_through, xyz)
        selected_normal = torch.einsum("bn,bnc->bc", hard, normal)

        selected_scene = torch.einsum("bn,bnd->bd", straight_through, scene_latent)
        radius_input = torch.cat((selected_scene, text_global, root_global), dim=-1)
        radius_fraction = torch.sigmoid(self.radius_head(radius_input).squeeze(-1))
        scene_diagonal = torch.linalg.vector_norm(
            scene_bounds[:, 1] - scene_bounds[:, 0], dim=-1
        )
        maximum = torch.maximum(
            scene_diagonal * self.max_radius_scene_fraction,
            scene_diagonal.new_full(scene_diagonal.shape, self.min_radius_m + 1.0e-4),
        )
        radius = self.min_radius_m + radius_fraction * (maximum - self.min_radius_m)
        return SurfaceContactProposal(
            center=center,
            radius=radius,
            surface_logits=logits,
            surface_weights=probabilities,
            selected_surface_index=selected_index,
            selected_surface_normal=selected_normal,
        )


@dataclass(frozen=True)
class ContactField:
    features: Tensor
    query_xyz: Tensor
    nearest_surface_index: Tensor
    occupancy: Tensor


class IntentMotionContactFieldBuilder(nn.Module):
    """Differentiable 4x4x4x7 builder matching released ContactSensor math."""

    def __init__(self) -> None:
        super().__init__()
        axis = torch.linspace(-1.0, 1.0, CONTACT_VOXEL_DIM)
        grid = torch.stack(torch.meshgrid(axis, axis, axis, indexing="ij"), dim=-1)
        self.register_buffer("unit_grid", grid.reshape(-1, 3), persistent=True)

    def forward(
        self,
        scene_xyz: Tensor,
        scene_normal: Tensor,
        scene_valid: Tensor,
        center: Tensor,
        radius: Tensor,
    ) -> ContactField:
        if scene_xyz.ndim != 3 or scene_xyz.shape[-1] != 3:
            raise ValueError("scene_xyz must be [B,N,3]")
        if scene_normal.shape != scene_xyz.shape or scene_valid.shape != scene_xyz.shape[:2]:
            raise ValueError("scene normal/mask shape mismatch")
        if center.shape != (scene_xyz.shape[0], 3) or radius.shape != (scene_xyz.shape[0],):
            raise ValueError("contact center/radius shape mismatch")
        valid = scene_valid.to(device=scene_xyz.device, dtype=torch.bool)
        if not bool(valid.any(dim=1).all()):
            raise ValueError("every contact field requires a scene surface")
        if bool((radius <= 0.0).any()):
            raise ValueError("contact radius must be positive")
        normal = F.normalize(scene_normal, dim=-1, eps=1.0e-6)
        query = center[:, None] + radius[:, None, None] * self.unit_grid.to(scene_xyz)
        distance = torch.cdist(query.float(), scene_xyz.float()).to(scene_xyz.dtype)
        distance = distance.masked_fill(~valid[:, None], torch.finfo(distance.dtype).max)
        nearest_distance, nearest_index = distance.min(dim=-1)
        batch = torch.arange(scene_xyz.shape[0], device=scene_xyz.device)[:, None]
        nearest_xyz = scene_xyz[batch, nearest_index]
        nearest_normal = normal[batch, nearest_index]
        sign = torch.where(
            (nearest_normal * (query - nearest_xyz)).sum(dim=-1) > 0.0,
            nearest_distance.new_ones(()),
            -nearest_distance.new_ones(()),
        )
        positive_sdf = (nearest_distance * sign).clamp_min(0.0)
        # Released code: voxel_size=2r/4 and positive distance is truncated at
        # half a voxel, hence half_voxel=r/4.
        half_voxel = (radius / CONTACT_VOXEL_DIM).clamp_min(1.0e-6)
        occupancy = 1.0 - torch.minimum(
            positive_sdf, half_voxel[:, None]
        ) / half_voxel[:, None]
        flat = torch.cat((occupancy[..., None], query, nearest_normal), dim=-1)
        features = flat.reshape(
            scene_xyz.shape[0],
            CONTACT_VOXEL_DIM,
            CONTACT_VOXEL_DIM,
            CONTACT_VOXEL_DIM,
            CONTACT_FIELD_CHANNELS,
        )
        return ContactField(
            features=features,
            query_xyz=query,
            nearest_surface_index=nearest_index,
            occupancy=occupancy,
        )


class ContactFieldFuse(nn.Module):
    """Released two-stage ``448 -> D -> D`` Linear+SiLU contact fuse."""

    def __init__(self, width: int) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(CONTACT_FIELD_FLAT_DIM, width),
            nn.SiLU(),
            nn.Linear(width, width),
            nn.SiLU(),
        )

    def forward(self, field: Tensor) -> Tensor:
        expected = (
            field.shape[0],
            CONTACT_VOXEL_DIM,
            CONTACT_VOXEL_DIM,
            CONTACT_VOXEL_DIM,
            CONTACT_FIELD_CHANNELS,
        )
        if tuple(field.shape) != expected:
            raise ValueError(f"contact field must be [B,4,4,4,7], got {tuple(field.shape)}")
        return self.net(field.reshape(field.shape[0], CONTACT_FIELD_FLAT_DIM)).unsqueeze(1)


class IntentGuidedContactFusion(nn.Module):
    """P60-style fusion order producing one timestep-conditioned Cc token."""

    def __init__(
        self,
        *,
        text_dim: int,
        width: int,
        cross_heads: int = OFFICIAL_CROSS_HEADS,
        cross_dim_head: int = OFFICIAL_CROSS_DIM_HEAD,
        latent_heads: int = OFFICIAL_LATENT_HEADS,
        latent_dim_head: int = OFFICIAL_LATENT_DIM_HEAD,
        latent_depth: int = OFFICIAL_LATENT_DEPTH,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        if int(latent_depth) != OFFICIAL_LATENT_DEPTH:
            raise ValueError("configured IGCF requires exactly four latent blocks")
        self.width = int(width)
        self.field_fuse = ContactFieldFuse(self.width)
        self.text_projector = nn.Linear(int(text_dim), self.width)
        self.text_reads_contact = _PreNormCrossAttention(
            self.width,
            heads=int(cross_heads),
            dim_head=int(cross_dim_head),
            dropout=float(dropout),
        )
        self.text_ff_norm = nn.LayerNorm(self.width)
        self.text_ff = _FeedForward(self.width)
        self.latent_blocks = nn.ModuleList(
            [
                _LatentIntentBlock(
                    self.width,
                    heads=int(latent_heads),
                    dim_head=int(latent_dim_head),
                    dropout=float(dropout),
                )
                for _ in range(OFFICIAL_LATENT_DEPTH)
            ]
        )
        self.contact_reads_intent = _PreNormCrossAttention(
            self.width,
            heads=int(cross_heads),
            dim_head=int(cross_dim_head),
            dropout=0.0,
        )
        self.time_mlp = nn.Sequential(
            nn.Linear(self.width, self.width),
            nn.SiLU(),
            nn.Linear(self.width, self.width),
        )
        self.output_norm = nn.LayerNorm(self.width)

    def forward(
        self,
        field: Tensor,
        text_embeddings: Tensor,
        text_mask: Tensor,
        timesteps: Tensor,
    ) -> Tensor:
        if text_embeddings.ndim != 3 or text_mask.shape != text_embeddings.shape[:2]:
            raise ValueError("text embeddings/mask shape mismatch")
        if timesteps.shape != (text_embeddings.shape[0],):
            raise ValueError("timesteps must be [B]")
        contact = self.field_fuse(field)
        projected_text = self.text_projector(text_embeddings)
        text_valid = text_mask.to(device=text_embeddings.device, dtype=torch.bool)
        intent = _masked_mean(projected_text, text_valid).unsqueeze(1)
        one_valid = torch.ones(
            (field.shape[0], 1), dtype=torch.bool, device=field.device
        )
        intent = intent + self.text_reads_contact(intent, contact, one_valid)
        intent = intent + self.text_ff(self.text_ff_norm(intent))
        for block in self.latent_blocks:
            intent = block(intent, one_valid)
        decoded_intent = self.contact_reads_intent(contact, intent, one_valid)
        time = self.time_mlp(
            _sinusoidal_embedding(timesteps, self.width, contact.dtype)
        ).unsqueeze(1)
        return self.output_norm(contact + decoded_intent + time)


@dataclass(frozen=True)
class P78CausalOutput:
    cc: Tensor
    cc_valid: Tensor
    proposal: SurfaceContactProposal
    contact_field: Tensor
    occupancy: Tensor
    nearest_surface_index: Tensor
    field_enabled: bool


class P78CausalIntentMotion(nn.Module):
    """No-oracle front end producing IntentMotion-style contact memory Cc."""

    def __init__(
        self,
        *,
        scene_token_dim: int,
        text_dim: int,
        width: int = 1024,
        min_radius_m: float = 0.05,
        max_radius_scene_fraction: float = 0.25,
        dropout: float = 0.1,
        cross_heads: int = OFFICIAL_CROSS_HEADS,
        cross_dim_head: int = OFFICIAL_CROSS_DIM_HEAD,
        latent_heads: int = OFFICIAL_LATENT_HEADS,
        latent_dim_head: int = OFFICIAL_LATENT_DIM_HEAD,
    ) -> None:
        super().__init__()
        self.width = int(width)
        self.proposer = CausalSurfaceContactProposer(
            scene_token_dim=scene_token_dim,
            text_dim=text_dim,
            width=self.width,
            min_radius_m=min_radius_m,
            max_radius_scene_fraction=max_radius_scene_fraction,
        )
        self.field_builder = IntentMotionContactFieldBuilder()
        self.igcf = IntentGuidedContactFusion(
            text_dim=text_dim,
            width=self.width,
            cross_heads=cross_heads,
            cross_dim_head=cross_dim_head,
            latent_heads=latent_heads,
            latent_dim_head=latent_dim_head,
            latent_depth=OFFICIAL_LATENT_DEPTH,
            dropout=dropout,
        )

    def forward(
        self,
        scene_tokens: Tensor,
        scene_mask: Tensor,
        scene_bounds: Tensor,
        e226_root: Tensor,
        text_embeddings: Tensor,
        text_mask: Tensor,
        timesteps: Tensor,
        field_enabled: bool = True,
    ) -> P78CausalOutput:
        if timesteps.shape != (scene_tokens.shape[0],) or timesteps.dtype != torch.long:
            raise ValueError("timesteps must be int64 [B]")
        proposal = self.proposer(
            scene_tokens,
            scene_mask,
            scene_bounds,
            e226_root,
            text_embeddings,
            text_mask,
        )
        batch = scene_tokens.shape[0]
        if not bool(field_enabled):
            zero_field = scene_tokens.new_zeros(
                batch,
                CONTACT_VOXEL_DIM,
                CONTACT_VOXEL_DIM,
                CONTACT_VOXEL_DIM,
                CONTACT_FIELD_CHANNELS,
            )
            return P78CausalOutput(
                cc=scene_tokens.new_zeros(batch, 1, self.width),
                cc_valid=torch.zeros(batch, 1, dtype=torch.bool, device=scene_tokens.device),
                proposal=proposal,
                contact_field=zero_field,
                occupancy=scene_tokens.new_zeros(batch, CONTACT_VOXEL_DIM ** 3),
                nearest_surface_index=torch.full(
                    (batch, CONTACT_VOXEL_DIM ** 3),
                    -1,
                    dtype=torch.long,
                    device=scene_tokens.device,
                ),
                field_enabled=False,
            )
        field = self.field_builder(
            _metric_scene_xyz(scene_tokens, scene_bounds),
            scene_tokens[..., 3:6],
            scene_mask,
            proposal.center,
            proposal.radius,
        )
        cc = self.igcf(field.features, text_embeddings, text_mask, timesteps)
        return P78CausalOutput(
            cc=cc,
            cc_valid=torch.ones(batch, 1, dtype=torch.bool, device=cc.device),
            proposal=proposal,
            contact_field=field.features,
            occupancy=field.occupancy,
            nearest_surface_index=field.nearest_surface_index,
            field_enabled=True,
        )

    def configuration(self) -> Dict[str, object]:
        return {
            "schema": "p78_true_intentmotion_causal_repair_iadm_v1",
            "public_inputs": list(FORWARD_CAUSAL_INPUTS),
            "scene_token_geometry": (
                "channels[0:3]=bounds_normalized_xyz_in_minus1_plus1; "
                "channels[3:6]=surface_normal"
            ),
            "metric_xyz_conversion": "lower+0.5*(normalized_xyz+1)*(upper-lower)",
            "root_condition": "immutable_metric_e226_root_xyz",
            "contact_center": "straight_through_scene_surface_selection",
            "contact_radius": "learned_bounded_by_scene_diagonal",
            "contact_field_shape": [4, 4, 4, 7],
            "contact_field_layout": ["one_sided_occupancy", "query_xyz", "nearest_normal"],
            "contact_fuse": "Linear448D_SiLU_LinearDD_SiLU",
            "fusion_order": [
                "text_queries_contact",
                "text_residual_feed_forward",
                "four_latent_self_attention_feed_forward_blocks",
                "contact_queries_intent",
                "add_diffusion_timestep",
            ],
            "output": "Cc[B,1,D]",
            "causal_repair": True,
            "causal_scope": "inference_legal_full_root_not_online_temporal",
            "external_contact_condition": False,
            "latent_depth": OFFICIAL_LATENT_DEPTH,
        }


class IADMContactDecoder(nn.Module):
    """One Body hidden-Q / Cc-KV adaptive-decoder cross-attention core.

    Instantiate six independent copies and place them after the chosen Kimodo
    Body self-attention layers. A disabled/invalid Cc is an exact identity;
    valid freshly initialized Cc requires a host-side ReZero/zero-output gate
    if the frozen motion prior must start bit-exact.
    """

    def __init__(self, width: int, *, heads: int = 8, dropout: float = 0.1) -> None:
        super().__init__()
        if width % heads:
            raise ValueError("IADM width must be divisible by heads")
        self.query_norm = nn.LayerNorm(width)
        self.memory_norm = nn.LayerNorm(width)
        self.cross_attention = nn.MultiheadAttention(
            width, heads, dropout=dropout, batch_first=True
        )
        self.ff_norm = nn.LayerNorm(width)
        self.ff = _FeedForward(width)

    def forward(
        self,
        motion_hidden: Tensor,
        cc: Tensor,
        cc_valid: Tensor,
        motion_valid: Optional[Tensor] = None,
        enabled: bool = True,
    ) -> Tensor:
        if motion_hidden.ndim != 3 or cc.ndim != 3:
            raise ValueError("IADM hidden and Cc must be [B,L,D]")
        if cc.shape[0] != motion_hidden.shape[0] or cc.shape[-1] != motion_hidden.shape[-1]:
            raise ValueError("IADM hidden/Cc shape mismatch")
        if cc_valid.shape != cc.shape[:2]:
            raise ValueError("IADM Cc mask shape mismatch")
        if motion_valid is not None and motion_valid.shape != motion_hidden.shape[:2]:
            raise ValueError("IADM motion mask shape mismatch")
        active = cc_valid.to(device=cc.device, dtype=torch.bool).any(dim=1)
        if not bool(enabled) or not bool(active.any()):
            return motion_hidden
        indices = active.nonzero(as_tuple=False).squeeze(-1)
        query = self.query_norm(motion_hidden.index_select(0, indices))
        memory = self.memory_norm(cc.index_select(0, indices))
        memory_mask = ~cc_valid.index_select(0, indices).to(dtype=torch.bool)
        delta, _ = self.cross_attention(
            query, memory, memory, key_padding_mask=memory_mask, need_weights=False
        )
        if motion_valid is not None:
            valid = motion_valid.index_select(0, indices).to(dtype=torch.bool)
            delta = delta.masked_fill(~valid[..., None], 0.0)
        active_hidden = motion_hidden.index_select(0, indices) + delta
        ff_delta = self.ff(self.ff_norm(active_hidden))
        if motion_valid is not None:
            ff_delta = ff_delta.masked_fill(~valid[..., None], 0.0)
        active_hidden = active_hidden + ff_delta
        result = motion_hidden.clone()
        result.index_copy_(0, indices, active_hidden)
        return result


@dataclass(frozen=True)
class P78LossWeights:
    surface: float = 1.0
    center: float = 1.0
    radius: float = 1.0
    occupancy: float = 1.0


def p78_causal_repair_loss(
    prediction: P78CausalOutput,
    *,
    surface_weight_labels: Optional[Tensor] = None,
    center_labels: Optional[Tensor] = None,
    radius_labels: Optional[Tensor] = None,
    occupancy_labels: Optional[Tensor] = None,
    weights: P78LossWeights = P78LossWeights(),
) -> Mapping[str, Tensor]:
    """Separate training-only supervision; no label is accepted by model forward."""

    if not prediction.field_enabled or not bool(prediction.cc_valid.all()):
        raise ValueError("causal repair supervision requires field_enabled=True")
    provided = (
        surface_weight_labels,
        center_labels,
        radius_labels,
        occupancy_labels,
    )
    if all(value is None for value in provided):
        raise ValueError("at least one supervision tensor is required")
    zero = prediction.cc.sum() * 0.0
    losses: Dict[str, Tensor] = {
        "surface": zero,
        "center": zero,
        "radius": zero,
        "occupancy": zero,
    }
    if surface_weight_labels is not None:
        label = surface_weight_labels.detach().to(prediction.proposal.surface_logits)
        if label.shape != prediction.proposal.surface_logits.shape:
            raise ValueError("surface weight label shape mismatch")
        if bool((label < 0.0).any()) or not bool((label.sum(dim=-1) > 0.0).all()):
            raise ValueError("surface weights must be non-negative with positive mass")
        valid_surface = prediction.proposal.surface_logits > (
            -0.5 * torch.finfo(prediction.proposal.surface_logits.dtype).max
        )
        if bool((label.masked_select(~valid_surface) > 1.0e-7).any()):
            raise ValueError("surface labels assign mass to padded scene tokens")
        label = label / label.sum(dim=-1, keepdim=True)
        losses["surface"] = -(
            label * F.log_softmax(prediction.proposal.surface_logits, dim=-1)
        ).sum(dim=-1).mean()
    if center_labels is not None:
        label = center_labels.detach().to(prediction.proposal.center)
        if label.shape != prediction.proposal.center.shape:
            raise ValueError("center label shape mismatch")
        losses["center"] = F.smooth_l1_loss(prediction.proposal.center, label)
    if radius_labels is not None:
        label = radius_labels.detach().to(prediction.proposal.radius)
        if label.shape != prediction.proposal.radius.shape or bool((label <= 0.0).any()):
            raise ValueError("radius labels must be positive [B]")
        losses["radius"] = F.smooth_l1_loss(prediction.proposal.radius, label)
    if occupancy_labels is not None:
        label = occupancy_labels.detach().to(prediction.occupancy)
        if label.shape != prediction.occupancy.shape:
            raise ValueError("occupancy label shape mismatch")
        if bool(((label < 0.0) | (label > 1.0)).any()):
            raise ValueError("occupancy labels must lie in [0,1]")
        losses["occupancy"] = F.binary_cross_entropy(
            prediction.occupancy.clamp(1.0e-6, 1.0 - 1.0e-6), label
        )
    total = (
        float(weights.surface) * losses["surface"]
        + float(weights.center) * losses["center"]
        + float(weights.radius) * losses["radius"]
        + float(weights.occupancy) * losses["occupancy"]
    )
    return {"total": total, **losses}


@torch.no_grad()
def run_sensitivity_contract(
    model: P78CausalIntentMotion,
    *,
    scene_tokens: Tensor,
    scene_mask: Tensor,
    scene_bounds: Tensor,
    e226_root: Tensor,
    text_embeddings: Tensor,
    text_mask: Tensor,
    timesteps: Tensor,
    scene_permutation: Tensor,
    minimum_delta: float = 1.0e-6,
) -> Dict[str, object]:
    """Measure the mandatory scene-shuffle and exact field-off contracts."""

    batch = scene_tokens.shape[0]
    identity = torch.arange(batch, device=scene_tokens.device)
    permutation = scene_permutation.to(device=scene_tokens.device, dtype=torch.long)
    if permutation.shape != (batch,) or not torch.equal(permutation.sort().values, identity):
        raise ValueError("scene_permutation must be a batch permutation")
    if torch.equal(permutation, identity):
        raise ValueError("scene_permutation must change at least one sample")
    was_training = model.training
    model.eval()
    try:
        common = dict(
            e226_root=e226_root,
            text_embeddings=text_embeddings,
            text_mask=text_mask,
            timesteps=timesteps,
        )
        full = model(
            scene_tokens, scene_mask, scene_bounds, field_enabled=True, **common
        )
        shuffled = model(
            scene_tokens.index_select(0, permutation),
            scene_mask.index_select(0, permutation),
            scene_bounds.index_select(0, permutation),
            field_enabled=True,
            **common,
        )
        off = model(
            scene_tokens, scene_mask, scene_bounds, field_enabled=False, **common
        )
    finally:
        model.train(was_training)
    center_delta = float((full.proposal.center - shuffled.proposal.center).norm(dim=-1).mean())
    field_delta = float((full.contact_field - shuffled.contact_field).abs().mean())
    cc_delta = float((full.cc - shuffled.cc).norm(dim=-1).mean())
    off_max = float(off.cc.abs().max())
    off_invalid = bool((~off.cc_valid).all())
    passed = (
        center_delta > minimum_delta
        and field_delta > minimum_delta
        and cc_delta > minimum_delta
        and off_max == 0.0
        and off_invalid
    )
    return {
        "scene_shuffle_center_l2_mean": center_delta,
        "scene_shuffle_field_l1_mean": field_delta,
        "scene_shuffle_cc_l2_mean": cc_delta,
        "field_off_cc_abs_max": off_max,
        "field_off_cc_all_invalid": off_invalid,
        "minimum_required_delta": float(minimum_delta),
        "passed": bool(passed),
    }


def assert_causal_forward_contract() -> None:
    signature = inspect.signature(P78CausalIntentMotion.forward)
    actual = tuple(name for name in signature.parameters if name != "self")
    if actual != FORWARD_CAUSAL_INPUTS:
        raise AssertionError(f"P78 public forward signature drift: {actual}")
    leaked = [
        name
        for name in actual
        if any(fragment in name.lower() for fragment in FORBIDDEN_FORWARD_FRAGMENTS)
    ]
    if leaked:
        raise AssertionError(f"forbidden P78 model inputs: {leaked}")


assert_causal_forward_contract()


__all__ = [
    "CONTACT_FIELD_FLAT_DIM",
    "CONTACT_VOXEL_DIM",
    "CausalSurfaceContactProposer",
    "IADMContactDecoder",
    "IntentGuidedContactFusion",
    "IntentMotionContactFieldBuilder",
    "P78CausalIntentMotion",
    "P78CausalOutput",
    "P78LossWeights",
    "assert_causal_forward_contract",
    "p78_causal_repair_loss",
    "run_sensitivity_contract",
]
