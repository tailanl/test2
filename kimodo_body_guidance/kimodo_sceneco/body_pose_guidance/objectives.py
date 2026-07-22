# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
"""Terminal-pose and SDF-compatible reductions for body pose guidance."""

from __future__ import annotations

import math
from typing import Any, Dict, Mapping, Optional, Sequence, Tuple

import torch
from torch import Tensor
import torch.nn.functional as F


NUM_JOINTS = 22
DEFAULT_BONE_ALPHAS: Tuple[float, ...] = (0.25, 0.50, 0.75)
DEFAULT_FLOOR_BAND_JOINTS: Tuple[int, ...] = (7, 8, 10, 11)


def rotation_geodesic_distance(
    first: Tensor, second: Tensor, eps: float = 1.0e-7
) -> Tensor:
    """SO(3) geodesic angle with a finite identity gradient."""

    if first.shape != second.shape or first.shape[-2:] != (3, 3):
        raise ValueError("rotation tensors must have equal shapes ending in [3,3]")
    relative = first.transpose(-1, -2) @ second
    cosine = (
        (relative.diagonal(dim1=-2, dim2=-1).sum(dim=-1) - 1.0) * 0.5
    ).clamp(-1.0, 1.0)
    regular = torch.acos(cosine.clamp(-1.0 + eps, 1.0 - eps))
    near_zero = (
        torch.sqrt(2.0 * (1.0 - cosine).clamp_min(0.0) + eps)
        - math.sqrt(eps)
    )
    return torch.where(cosine > 1.0 - 1.0e-4, near_zero, regular)


def action_completion_joint_weights(
    metadata: Sequence[Mapping[str, Any]], reference: Tensor
) -> Tensor:
    """Return action-aware loss weights ``[B,22]`` for the completion pose.

    The action is derivable from the input text.  It is used only to weight the
    loss and is never converted into a pose target or passed to the refiner.
    """

    weights = torch.ones(
        (len(metadata), NUM_JOINTS),
        device=reference.device,
        dtype=reference.dtype,
    )
    lower = (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)
    torso = (0, 3, 6, 9, 12, 13, 14, 15, 16, 17)
    arms = (13, 14, 16, 17, 18, 19, 20, 21)
    hands = (20, 21)
    lower_actions = {
        "sit",
        "lie",
        "kneel",
        "squat",
        "get_up",
        "stand",
        "stand_up",
        "straighten",
    }
    upper_actions = {
        "pick_up",
        "put_down",
        "take_photo",
        "drink",
        "eat",
        "write",
        "read",
        "type",
        "turn_on",
        "wash",
        "brush",
        "blow_out",
        "play",
        "punch",
        "toss",
        "wave",
        "swing",
        "talk",
    }
    for row, item in enumerate(metadata):
        action = str(item.get("action", "")).strip().lower()
        if action in lower_actions:
            weights[row, list(lower)] = 2.0
            weights[row, list(torso)] = torch.maximum(
                weights[row, list(torso)],
                weights.new_full((len(torso),), 2.0),
            )
        elif action == "walk":
            weights[row, list(lower)] = 2.0
            weights[row, [7, 8, 10, 11]] = 3.0
        elif action in upper_actions:
            weights[row, list(arms)] = 2.0
            weights[row, list(hands)] = 3.0
    return weights


def _weighted_joint_mean(values: Tensor, weights: Tensor) -> Tensor:
    if values.ndim != 2 or weights.shape != values.shape:
        raise ValueError("joint values and weights must both be [B,22]")
    return (values * weights).sum(dim=-1) / weights.sum(dim=-1).clamp_min(1.0)


def action_weighted_completion_loss(
    predicted_joints: Tensor,
    target_joints: Tensor,
    predicted_local_rotations: Tensor,
    target_local_rotations: Tensor,
    metadata: Sequence[Mapping[str, Any]],
    *,
    completion_event: int = -1,
    fk_beta_m: float = 0.03,
    geodesic_weight: float = 0.25,
    event_valid: Optional[Tensor] = None,
) -> Dict[str, Tensor]:
    """Supervise whether the final key pose actually completes the action."""

    if predicted_joints.shape != target_joints.shape:
        raise ValueError("predicted/target joints must have equal shapes")
    if predicted_joints.ndim != 4 or predicted_joints.shape[-2:] != (22, 3):
        raise ValueError("joints must be [B,E,22,3]")
    if predicted_local_rotations.shape != target_local_rotations.shape:
        raise ValueError("predicted/target rotations must have equal shapes")
    if predicted_local_rotations.shape[:3] != predicted_joints.shape[:3]:
        raise ValueError("rotation and joint batch/event/joint axes must match")
    if predicted_local_rotations.shape[-2:] != (3, 3):
        raise ValueError("local rotations must end in [3,3]")

    event = int(completion_event) % predicted_joints.shape[1]
    distance = (
        predicted_joints[:, event] - target_joints[:, event].to(predicted_joints)
    ).norm(dim=-1)
    weights = action_completion_joint_weights(metadata, distance)
    fk_values = F.smooth_l1_loss(
        distance,
        torch.zeros_like(distance),
        beta=float(fk_beta_m),
        reduction="none",
    )
    fk_per_sample = _weighted_joint_mean(fk_values, weights)
    geodesic = rotation_geodesic_distance(
        predicted_local_rotations[:, event],
        target_local_rotations[:, event].to(predicted_local_rotations),
    )
    geodesic_per_sample = _weighted_joint_mean(geodesic, weights)
    metric_fk = _weighted_joint_mean(distance, weights)
    valid = (
        torch.ones_like(fk_per_sample)
        if event_valid is None
        else event_valid[:, event].to(fk_per_sample)
    )
    denominator = valid.sum().clamp_min(1.0)
    loss = (
        (fk_per_sample + float(geodesic_weight) * geodesic_per_sample) * valid
    ).sum() / denominator
    return {
        "loss": loss,
        "completion_fk_m": (metric_fk * valid).sum() / denominator,
        "completion_geodesic_rad": (geodesic_per_sample * valid).sum()
        / denominator,
    }


def completion_rank_loss(
    refined_joints: Tensor,
    frozen_base_joints: Tensor,
    target_joints: Tensor,
    metadata: Sequence[Mapping[str, Any]],
    *,
    completion_event: int = -1,
    margin_m: float = 0.005,
    event_valid: Optional[Tensor] = None,
) -> Dict[str, Tensor]:
    """Require the refined completion pose to beat its frozen base."""

    if (
        refined_joints.shape != frozen_base_joints.shape
        or refined_joints.shape != target_joints.shape
    ):
        raise ValueError("refined/base/target joints must have equal shapes")
    if float(margin_m) < 0.0:
        raise ValueError("margin_m must be non-negative")
    event = int(completion_event) % refined_joints.shape[1]
    refined_distance = (
        refined_joints[:, event] - target_joints[:, event].to(refined_joints)
    ).norm(dim=-1)
    base_distance = (
        frozen_base_joints[:, event].detach()
        - target_joints[:, event].to(frozen_base_joints)
    ).norm(dim=-1)
    weights = action_completion_joint_weights(metadata, refined_distance)
    refined_fk = _weighted_joint_mean(refined_distance, weights)
    base_fk = _weighted_joint_mean(base_distance, weights)
    valid = (
        torch.ones_like(refined_fk)
        if event_valid is None
        else event_valid[:, event].to(refined_fk)
    )
    denominator = valid.sum().clamp_min(1.0)
    loss = (
        F.relu(refined_fk - base_fk.detach() + float(margin_m)) * valid
    ).sum() / denominator
    refined_mean = (refined_fk * valid).sum() / denominator
    base_mean = (base_fk * valid).sum() / denominator
    return {
        "loss": loss,
        "refined_fk_m": refined_mean,
        "frozen_base_fk_m": base_mean,
        "refined_gain_m": base_mean - refined_mean,
    }


def differentiable_body_sdf_points(
    joints: Tensor,
    parents: Tensor,
    *,
    bone_alphas: Sequence[float] = DEFAULT_BONE_ALPHAS,
    floor_band_joints: Sequence[int] = DEFAULT_FLOOR_BAND_JOINTS,
) -> Tuple[Tensor, Tensor]:
    """Densify SMPL-X-22 joints to an 85-point differentiable body proxy."""

    if joints.ndim < 2 or joints.shape[-2:] != (22, 3):
        raise ValueError("joints must end in [22,3]")
    parent_index = torch.as_tensor(parents, device=joints.device, dtype=torch.long)
    if parent_index.shape != (22,):
        raise ValueError("parents must contain 22 indices")
    if bool(((parent_index[1:] < 0) | (parent_index[1:] >= 22)).any()):
        raise ValueError("non-root parent indices must lie in [0,21]")
    alphas = tuple(float(alpha) for alpha in bone_alphas)
    if not alphas or any(not 0.0 < alpha < 1.0 for alpha in alphas):
        raise ValueError("bone_alphas must be nonempty and inside (0,1)")

    child = joints[..., 1:, :]
    parent = joints.index_select(-2, parent_index[1:])
    interior = torch.stack(
        tuple((1.0 - alpha) * parent + alpha * child for alpha in alphas),
        dim=-2,
    ).reshape(*joints.shape[:-2], 21 * len(alphas), 3)
    points = torch.cat((joints, interior), dim=-2)
    floor_band = torch.zeros(
        points.shape[:-1], device=points.device, dtype=torch.bool
    )
    floor_indices = torch.as_tensor(
        tuple(int(index) for index in floor_band_joints),
        device=points.device,
        dtype=torch.long,
    )
    if floor_indices.numel() and bool(
        ((floor_indices < 0) | (floor_indices >= 22)).any()
    ):
        raise ValueError("floor-band indices must refer to original joints")
    if floor_indices.numel():
        floor_band.index_fill_(-1, floor_indices, True)
    return points, floor_band


def penetration_cvar_loss(
    signed_distance: Tensor,
    valid_mask: Optional[Tensor] = None,
    *,
    tail_fraction: float = 0.02,
    min_points: int = 8,
) -> Tensor:
    """Mean per-sample CVaR of host-supplied SDF penetration in metres."""

    if signed_distance.ndim < 2:
        raise ValueError("signed_distance must have a batch dimension")
    if not 0.0 < float(tail_fraction) <= 1.0:
        raise ValueError("tail_fraction must lie in (0,1]")
    if int(min_points) < 1:
        raise ValueError("min_points must be positive")
    if not bool(torch.isfinite(signed_distance).all()):
        raise ValueError("signed_distance must be finite")
    if valid_mask is None:
        valid = torch.ones_like(signed_distance, dtype=torch.bool)
    else:
        try:
            valid = torch.broadcast_to(
                valid_mask.to(device=signed_distance.device, dtype=torch.bool),
                signed_distance.shape,
            )
        except RuntimeError as exc:
            raise ValueError(
                "valid_mask cannot broadcast to signed_distance"
            ) from exc
    penetration = F.relu(-signed_distance)
    flat_penetration = penetration.reshape(penetration.shape[0], -1)
    flat_valid = valid.reshape(valid.shape[0], -1)
    per_sample = []
    for row in range(flat_penetration.shape[0]):
        values = flat_penetration[row][flat_valid[row]]
        if values.numel() == 0:
            per_sample.append(flat_penetration[row].sum() * 0.0)
            continue
        count = max(
            int(min_points), int(math.ceil(float(tail_fraction) * values.numel()))
        )
        count = min(count, values.numel())
        per_sample.append(values.topk(count, sorted=False).values.mean())
    return torch.stack(per_sample).mean()


def event_space_loss(
    signed_distance: Tensor,
    valid_mask: Tensor,
    *,
    tail_fraction: float = 0.02,
    min_points: int = 8,
) -> Dict[str, Tensor]:
    """Combine mean penetration and tail risk over all semantic key poses.

    ``signed_distance`` must use the positive-free-space convention.  It is a
    training/evaluation tensor produced after model inference; it must never be
    passed into :class:`JointWiseBodyPoseRefiner`.
    """

    valid = torch.broadcast_to(
        valid_mask.to(device=signed_distance.device, dtype=torch.bool),
        signed_distance.shape,
    )
    penetration = F.relu(-signed_distance).masked_fill(~valid, 0.0)
    mean = penetration.sum() / valid.sum().clamp_min(1)
    cvar = penetration_cvar_loss(
        signed_distance,
        valid,
        tail_fraction=tail_fraction,
        min_points=min_points,
    )
    return {"loss": mean + cvar, "mean_penetration_m": mean, "cvar_m": cvar}


__all__ = [
    "action_completion_joint_weights",
    "action_weighted_completion_loss",
    "completion_rank_loss",
    "differentiable_body_sdf_points",
    "event_space_loss",
    "penetration_cvar_loss",
    "rotation_geodesic_distance",
]
