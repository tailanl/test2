# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
"""A small ReMoGen-style MIM primitive with a zero-init residual gate.

This module intentionally contains no Kimodo hook. A host may place independent
instances at selected Body layers and remains responsible for masks, layer
selection, schedules and Root ownership.
"""

from __future__ import annotations

import math

import torch
from torch import Tensor, nn
import torch.nn.functional as F


class _GEGLU(nn.Module):
    def forward(self, value: Tensor) -> Tensor:
        hidden, gate = value.chunk(2, dim=-1)
        return hidden * F.gelu(gate)


class ReMoGenRelationBias(nn.Module):
    """Learned attention bias from sinusoidal relative control positions."""

    def __init__(self, heads: int, hidden: int = 48) -> None:
        super().__init__()
        self.mlp = nn.Sequential(
            nn.Linear(2, int(hidden)),
            nn.GELU(),
            nn.Linear(int(hidden), int(heads)),
        )

    def forward(self, queries: int, controls: int, reference: Tensor) -> Tensor:
        query = torch.arange(queries, device=reference.device, dtype=torch.float32)
        control = torch.arange(controls, device=reference.device, dtype=torch.float32)
        relative = query[:, None] - control[None]
        feature = torch.stack(
            (torch.sin(relative / 4.0), torch.cos(relative / 4.0)), dim=-1
        )
        return self.mlp(feature).permute(2, 0, 1).unsqueeze(0).to(reference)


class ReMoGenMIMBlock(nn.Module):
    """Self-attention, relation cross-attention, FiLM and GEGLU refinement.

    The scalar ReZero gate is initialized to zero. A fresh block therefore
    leaves the frozen host representation bit-exact. Memory-off batches remain
    exact identities even after the gate has been trained.
    """

    def __init__(
        self,
        *,
        latent_dim: int,
        num_heads: int,
        ff_dim: int,
        dropout: float = 0.0,
    ) -> None:
        super().__init__()
        if latent_dim <= 0 or num_heads <= 0 or latent_dim % num_heads:
            raise ValueError("latent_dim must be positive and divisible by num_heads")
        if ff_dim <= 0:
            raise ValueError("ff_dim must be positive")
        self.latent_dim = int(latent_dim)
        self.num_heads = int(num_heads)
        self.head_dim = self.latent_dim // self.num_heads
        self.norm1 = nn.LayerNorm(self.latent_dim)
        self.self_attention = nn.MultiheadAttention(
            self.latent_dim,
            self.num_heads,
            dropout=float(dropout),
            batch_first=True,
        )
        self.norm2 = nn.LayerNorm(self.latent_dim)
        self.query = nn.Linear(self.latent_dim, self.latent_dim)
        self.key = nn.Linear(self.latent_dim, self.latent_dim)
        self.value = nn.Linear(self.latent_dim, self.latent_dim)
        self.output = nn.Linear(self.latent_dim, self.latent_dim)
        self.relation_bias = ReMoGenRelationBias(self.num_heads)
        self.film = nn.Linear(self.latent_dim, 2 * self.latent_dim)
        self.norm3 = nn.LayerNorm(self.latent_dim)
        self.feed_forward = nn.Sequential(
            nn.Linear(self.latent_dim, 2 * int(ff_dim)),
            _GEGLU(),
            nn.Dropout(float(dropout)),
            nn.Linear(int(ff_dim), self.latent_dim),
        )
        self.dropout = nn.Dropout(float(dropout))
        self.residual_gate = nn.Parameter(torch.zeros(()))

    @staticmethod
    def _validate(
        pose_tokens: Tensor,
        pose_valid_mask: Tensor,
        memory: Tensor,
        memory_valid_mask: Tensor,
    ) -> None:
        if pose_tokens.ndim != 3 or memory.ndim != 3:
            raise ValueError("pose_tokens and memory must be [B,N,D]")
        if pose_tokens.shape[0] != memory.shape[0] or pose_tokens.shape[2] != memory.shape[2]:
            raise ValueError("pose_tokens and memory must share batch and width")
        if pose_valid_mask.shape != pose_tokens.shape[:2]:
            raise ValueError("pose_valid_mask shape mismatch")
        if memory_valid_mask.shape != memory.shape[:2]:
            raise ValueError("memory_valid_mask shape mismatch")
        if pose_tokens.shape[1] == 0 or memory.shape[1] == 0:
            raise ValueError("pose and memory sequences must be non-empty")

    def forward(
        self,
        pose_tokens: Tensor,
        pose_valid_mask: Tensor,
        memory: Tensor,
        memory_valid_mask: Tensor,
    ) -> Tensor:
        self._validate(pose_tokens, pose_valid_mask, memory, memory_valid_mask)
        pose_valid = pose_valid_mask.to(device=pose_tokens.device, dtype=torch.bool)
        memory_valid = memory_valid_mask.to(device=memory.device, dtype=torch.bool)
        active_batch = memory_valid.any(dim=-1)
        if not bool(active_batch.any()):
            return pose_tokens

        safe_pose_valid = pose_valid.clone()
        safe_pose_valid[~safe_pose_valid.any(dim=-1), 0] = True
        safe_memory_valid = memory_valid.clone()
        safe_memory_valid[~active_batch, 0] = True
        safe_memory = memory.masked_fill(~memory_valid[..., None], 0.0)

        normalized = self.norm1(pose_tokens)
        self_delta, _ = self.self_attention(
            normalized,
            normalized,
            normalized,
            key_padding_mask=~safe_pose_valid,
            need_weights=False,
        )
        hidden = pose_tokens + self_delta.masked_fill(~pose_valid[..., None], 0.0)
        normalized = self.norm2(hidden)
        batch, query_count = normalized.shape[:2]
        control_count = safe_memory.shape[1]

        query = self.query(normalized).reshape(
            batch, query_count, self.num_heads, self.head_dim
        ).transpose(1, 2)
        key = self.key(safe_memory).reshape(
            batch, control_count, self.num_heads, self.head_dim
        ).transpose(1, 2)
        value = self.value(safe_memory).reshape(
            batch, control_count, self.num_heads, self.head_dim
        ).transpose(1, 2)
        logits = torch.matmul(query, key.transpose(-1, -2)) / math.sqrt(self.head_dim)
        logits = logits + self.relation_bias(query_count, control_count, logits)
        logits = logits.masked_fill(
            ~safe_memory_valid[:, None, None, :], torch.finfo(logits.dtype).min
        )
        attention = self.dropout(logits.float().softmax(dim=-1).to(logits.dtype))
        cross = torch.matmul(attention, value).transpose(1, 2).reshape(
            batch, query_count, self.latent_dim
        )
        cross = self.output(cross)
        gamma, beta = self.film(cross).chunk(2, dim=-1)
        modulated = (1.0 + torch.tanh(gamma)) * hidden + torch.tanh(beta)
        refined = modulated + self.feed_forward(self.norm3(modulated))

        delta = refined - pose_tokens
        active = pose_valid & active_batch[:, None]
        delta = delta.masked_fill(~active[..., None], 0.0)
        return pose_tokens + torch.tanh(self.residual_gate).to(delta) * delta


__all__ = ["ReMoGenMIMBlock", "ReMoGenRelationBias"]
