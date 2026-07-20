# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
"""Audited joint-wise residual pose guidance used by the current body winner.

The module never predicts or replaces Kimodo's root.  It refines four semantic
SMPL-X-22 event poses from inference-time conditions only and is an exact
identity before training because both residual heads are zero initialized.
"""

from __future__ import annotations

import inspect
from typing import Dict, Tuple

import torch
from torch import Tensor, nn


NUM_EVENTS = 4
NUM_JOINTS = 22
NUM_HEADS = 8

AUDITED_REFINER_INPUT_KEYS: Tuple[str, ...] = (
    "base_event_tokens",
    "base_local_rotation_6d",
    "base_pelvis_world_y",
    "proposal_event_features",
    "external_root_event",
    "scene_embeddings",
    "text_embeddings",
    "scene_valid_mask",
    "text_valid_mask",
)


def soft_event_pool(sequence: Tensor, event_time_distribution: Tensor) -> Tensor:
    """Soft-sample a ``[B,T,...]`` sequence at ``E`` predicted event times."""

    if sequence.ndim < 3 or event_time_distribution.ndim != 3:
        raise ValueError("sequence must be [B,T,...] and distribution [B,T,E]")
    if sequence.shape[:2] != event_time_distribution.shape[:2]:
        raise ValueError("sequence and event distribution must share B,T")
    batch, frames = sequence.shape[:2]
    flattened = sequence.reshape(batch, frames, -1)
    pooled = event_time_distribution.transpose(1, 2) @ flattened
    return pooled.reshape(
        batch, event_time_distribution.shape[-1], *sequence.shape[2:]
    )


class _FusionBlock(nn.Module):
    """Joint/event self-attention followed by scene and text cross-attention."""

    def __init__(
        self, hidden_size: int, num_heads: int, ff_multiplier: int, dropout: float
    ) -> None:
        super().__init__()
        # Keep the historical names so audited pose_refiner checkpoints load
        # without a key-renaming migration.
        self.temporal_norm = nn.LayerNorm(hidden_size)
        self.temporal_attention = nn.MultiheadAttention(
            hidden_size, num_heads, dropout=dropout, batch_first=True
        )
        self.scene_norm = nn.LayerNorm(hidden_size)
        self.scene_attention = nn.MultiheadAttention(
            hidden_size, num_heads, dropout=dropout, batch_first=True
        )
        self.text_norm = nn.LayerNorm(hidden_size)
        self.text_attention = nn.MultiheadAttention(
            hidden_size, num_heads, dropout=dropout, batch_first=True
        )
        self.ff_norm = nn.LayerNorm(hidden_size)
        self.feed_forward = nn.Sequential(
            nn.Linear(hidden_size, ff_multiplier * hidden_size),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(ff_multiplier * hidden_size, hidden_size),
        )
        self.dropout = nn.Dropout(dropout)

    def forward(
        self,
        tokens: Tensor,
        scene: Tensor,
        text: Tensor,
        token_padding_mask: Tensor,
        scene_padding_mask: Tensor,
        text_padding_mask: Tensor,
    ) -> Tensor:
        query = self.temporal_norm(tokens)
        attended, _ = self.temporal_attention(
            query,
            query,
            query,
            key_padding_mask=token_padding_mask,
            need_weights=False,
        )
        tokens = tokens + self.dropout(attended)

        query = self.scene_norm(tokens)
        attended, _ = self.scene_attention(
            query,
            scene,
            scene,
            key_padding_mask=scene_padding_mask,
            need_weights=False,
        )
        tokens = tokens + self.dropout(attended)

        query = self.text_norm(tokens)
        attended, _ = self.text_attention(
            query,
            text,
            text,
            key_padding_mask=text_padding_mask,
            need_weights=False,
        )
        tokens = tokens + self.dropout(attended)
        tokens = tokens + self.dropout(self.feed_forward(self.ff_norm(tokens)))
        return tokens.masked_fill(token_padding_mask[..., None], 0.0)


class JointWiseBodyPoseRefiner(nn.Module):
    """Refine four SMPL-X-22 event poses while preserving root0:5 exactly.

    Each event/joint pair owns one token, giving 88 tokens.  The callable API
    deliberately contains no target pose, target event, donor, oracle, full
    route, contact label, or SDF label.  Scene and text must already be
    projected to ``hidden_size`` by the host model.
    """

    def __init__(
        self,
        *,
        proposal_dim: int = 273,
        root_dim: int = 5,
        hidden_size: int = 1024,
        num_layers: int = 4,
        ff_multiplier: int = 4,
        dropout: float = 0.1,
        num_events: int = NUM_EVENTS,
        num_joints: int = NUM_JOINTS,
        max_pelvis_world_y_residual: float = 0.6,
    ) -> None:
        super().__init__()
        if int(num_events) != NUM_EVENTS:
            raise ValueError("JointWiseBodyPoseRefiner requires E=4 events")
        if int(num_joints) != NUM_JOINTS:
            raise ValueError("JointWiseBodyPoseRefiner requires J=22 joints")
        if not 4 <= int(num_layers) <= 8:
            raise ValueError("num_layers must lie in [4,8]")
        if int(hidden_size) % NUM_HEADS:
            raise ValueError("hidden_size must be divisible by 8")
        if float(max_pelvis_world_y_residual) <= 0.0:
            raise ValueError("max_pelvis_world_y_residual must be positive")

        self.proposal_dim = int(proposal_dim)
        self.root_dim = int(root_dim)
        self.hidden_size = int(hidden_size)
        self.num_layers = int(num_layers)
        self.num_events = int(num_events)
        self.num_joints = int(num_joints)
        self.max_pelvis_world_y_residual = float(max_pelvis_world_y_residual)

        self.base_event_norm = nn.LayerNorm(hidden_size)
        self.base_rotation_projection = nn.Linear(6, hidden_size)
        self.base_pelvis_y_projection = nn.Linear(1, hidden_size)
        self.proposal_event_projection = nn.Linear(proposal_dim, hidden_size)
        self.external_root_projection = nn.Linear(root_dim, hidden_size, bias=False)
        self.event_embedding = nn.Parameter(
            torch.empty(1, self.num_events, 1, hidden_size)
        )
        self.joint_embedding = nn.Parameter(
            torch.empty(1, 1, self.num_joints, hidden_size)
        )
        self.input_norm = nn.LayerNorm(hidden_size)
        self.blocks = nn.ModuleList(
            _FusionBlock(hidden_size, NUM_HEADS, ff_multiplier, dropout)
            for _ in range(self.num_layers)
        )
        self.output_norm = nn.LayerNorm(hidden_size)
        self.rotation_residual_head = nn.Linear(hidden_size, 6)
        self.pelvis_world_y_residual_head = nn.Linear(hidden_size, 1)
        self.confidence_gate_head = nn.Linear(hidden_size, 1)

        nn.init.normal_(self.event_embedding, std=hidden_size**-0.5)
        nn.init.normal_(self.joint_embedding, std=hidden_size**-0.5)
        nn.init.zeros_(self.rotation_residual_head.weight)
        nn.init.zeros_(self.rotation_residual_head.bias)
        nn.init.zeros_(self.pelvis_world_y_residual_head.weight)
        nn.init.zeros_(self.pelvis_world_y_residual_head.bias)
        nn.init.zeros_(self.confidence_gate_head.weight)
        nn.init.zeros_(self.confidence_gate_head.bias)

    @staticmethod
    def _validate_context(
        embeddings: Tensor,
        valid_mask: Tensor,
        *,
        batch: int,
        hidden_size: int,
        name: str,
    ) -> Tensor:
        if embeddings.ndim != 3 or embeddings.shape[0] != batch:
            raise ValueError(f"{name}_embeddings must be [B,L,H]")
        if embeddings.shape[-1] != hidden_size:
            raise ValueError(f"{name}_embeddings must have width {hidden_size}")
        if valid_mask.shape != embeddings.shape[:2]:
            raise ValueError(f"{name}_valid_mask must match [B,L]")
        valid = valid_mask.to(device=embeddings.device, dtype=torch.bool)
        if not bool(valid.any(dim=1).all()):
            raise ValueError(f"every sample needs a valid {name} embedding")
        return valid

    def forward(
        self,
        base_event_tokens: Tensor,
        base_local_rotation_6d: Tensor,
        base_pelvis_world_y: Tensor,
        proposal_event_features: Tensor,
        external_root_event: Tensor,
        scene_embeddings: Tensor,
        text_embeddings: Tensor,
        scene_valid_mask: Tensor,
        text_valid_mask: Tensor,
    ) -> Dict[str, Tensor]:
        batch = base_event_tokens.shape[0]
        event_shape = (batch, self.num_events)
        if base_event_tokens.shape != (*event_shape, self.hidden_size):
            raise ValueError("base_event_tokens must be [B,4,H]")
        if base_local_rotation_6d.shape != (*event_shape, self.num_joints, 6):
            raise ValueError("base_local_rotation_6d must be [B,4,22,6]")
        if base_pelvis_world_y.shape != (*event_shape, 1):
            raise ValueError("base_pelvis_world_y must be [B,4,1]")
        if proposal_event_features.shape != (*event_shape, self.proposal_dim):
            raise ValueError(
                f"proposal_event_features must be [B,4,{self.proposal_dim}]"
            )
        if external_root_event.shape != (*event_shape, self.root_dim):
            raise ValueError(f"external_root_event must be [B,4,{self.root_dim}]")
        scene_valid = self._validate_context(
            scene_embeddings,
            scene_valid_mask,
            batch=batch,
            hidden_size=self.hidden_size,
            name="scene",
        )
        text_valid = self._validate_context(
            text_embeddings,
            text_valid_mask,
            batch=batch,
            hidden_size=self.hidden_size,
            name="text",
        )

        event = self.base_event_norm(base_event_tokens)[:, :, None]
        rotation = self.base_rotation_projection(base_local_rotation_6d)
        pelvis_y = self.base_pelvis_y_projection(base_pelvis_world_y)[:, :, None]
        proposal = self.proposal_event_projection(proposal_event_features)[:, :, None]
        root = self.external_root_projection(external_root_event)[:, :, None]
        joint_tokens = self.input_norm(
            event
            + rotation
            + pelvis_y
            + proposal
            + root
            + self.event_embedding
            + self.joint_embedding
        ).reshape(batch, self.num_events * self.num_joints, self.hidden_size)
        token_padding = torch.zeros(
            (batch, self.num_events * self.num_joints),
            device=joint_tokens.device,
            dtype=torch.bool,
        )
        for block in self.blocks:
            joint_tokens = block(
                joint_tokens,
                scene_embeddings,
                text_embeddings,
                token_padding,
                ~scene_valid,
                ~text_valid,
            )
        joint_tokens = self.output_norm(joint_tokens).reshape(
            batch, self.num_events, self.num_joints, self.hidden_size
        )

        rotation_residual = self.rotation_residual_head(joint_tokens)
        confidence = (
            1.0 - torch.tanh(self.confidence_gate_head(joint_tokens))
        ).clamp(0.0, 1.0)
        pelvis_residual = self.max_pelvis_world_y_residual * torch.tanh(
            self.pelvis_world_y_residual_head(joint_tokens[:, :, 0])
        )
        refined_rotation = base_local_rotation_6d + confidence * rotation_residual
        refined_pelvis_y = (
            base_pelvis_world_y + confidence[:, :, 0] * pelvis_residual
        )
        return {
            "joint_tokens": joint_tokens,
            "local_rotation_residual_6d": rotation_residual,
            "pelvis_world_y_residual": pelvis_residual,
            "confidence_gate": confidence.squeeze(-1),
            "refined_local_rotation_6d": refined_rotation,
            "refined_pelvis_world_y": refined_pelvis_y,
        }


def assert_refiner_causal_api() -> None:
    """Fail closed if an oracle-like argument is added to the public API."""

    parameters = tuple(
        name
        for name in inspect.signature(JointWiseBodyPoseRefiner.forward).parameters
        if name != "self"
    )
    if parameters != AUDITED_REFINER_INPUT_KEYS:
        raise AssertionError(
            f"refiner inputs differ from the audited allowlist: {parameters!r}"
        )
    forbidden = ("target", "label", "offline", "donor", "oracle", "gt", "path")
    leaked = [
        name
        for name in parameters
        if any(fragment in name.lower() for fragment in forbidden)
    ]
    if leaked:
        raise AssertionError(f"forbidden refiner inputs exposed: {leaked}")


assert_refiner_causal_api()


__all__ = [
    "AUDITED_REFINER_INPUT_KEYS",
    "JointWiseBodyPoseRefiner",
    "assert_refiner_causal_api",
    "soft_event_pool",
]
