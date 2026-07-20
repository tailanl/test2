# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import inspect

import torch

from kimodo_sceneco.body_pose_guidance import (
    AUDITED_REFINER_INPUT_KEYS,
    JointWiseBodyPoseRefiner,
    action_completion_joint_weights,
    action_weighted_completion_loss,
    assert_refiner_causal_api,
    completion_rank_loss,
    differentiable_body_sdf_points,
    event_space_loss,
    soft_event_pool,
)


def _inputs() -> dict[str, torch.Tensor]:
    generator = torch.Generator().manual_seed(17)
    return {
        "base_event_tokens": torch.randn(2, 4, 32, generator=generator),
        "base_local_rotation_6d": torch.randn(2, 4, 22, 6, generator=generator),
        "base_pelvis_world_y": torch.randn(2, 4, 1, generator=generator),
        "proposal_event_features": torch.randn(2, 4, 17, generator=generator),
        "external_root_event": torch.randn(2, 4, 5, generator=generator),
        "scene_embeddings": torch.randn(2, 6, 32, generator=generator),
        "text_embeddings": torch.randn(2, 3, 32, generator=generator),
        "scene_valid_mask": torch.tensor(
            [[True, True, True, False, False, False], [True] * 6]
        ),
        "text_valid_mask": torch.tensor([[True, False, False], [True, True, True]]),
    }


def test_refiner_is_identity_at_initialization_and_preserves_public_api() -> None:
    model = JointWiseBodyPoseRefiner(
        proposal_dim=17,
        root_dim=5,
        hidden_size=32,
        num_layers=4,
        ff_multiplier=2,
        dropout=0.0,
    ).eval()
    inputs = _inputs()
    root_before = inputs["external_root_event"].clone()
    with torch.no_grad():
        outputs = model(**inputs)

    torch.testing.assert_close(
        outputs["refined_local_rotation_6d"],
        inputs["base_local_rotation_6d"],
        atol=0.0,
        rtol=0.0,
    )
    torch.testing.assert_close(
        outputs["refined_pelvis_world_y"],
        inputs["base_pelvis_world_y"],
        atol=0.0,
        rtol=0.0,
    )
    assert outputs["joint_tokens"].shape == (2, 4, 22, 32)
    assert outputs["confidence_gate"].shape == (2, 4, 22)
    assert torch.equal(inputs["external_root_event"], root_before)

    assert_refiner_causal_api()
    parameters = tuple(
        name
        for name in inspect.signature(JointWiseBodyPoseRefiner.forward).parameters
        if name != "self"
    )
    assert parameters == AUDITED_REFINER_INPUT_KEYS
    assert not any(
        fragment in name.lower()
        for name in parameters
        for fragment in ("target", "label", "donor", "oracle", "gt", "path")
    )


def test_trained_residual_heads_change_only_pose_outputs() -> None:
    model = JointWiseBodyPoseRefiner(
        proposal_dim=17,
        hidden_size=32,
        num_layers=4,
        dropout=0.0,
    ).eval()
    inputs = _inputs()
    with torch.no_grad():
        model.rotation_residual_head.bias.fill_(0.05)
        model.pelvis_world_y_residual_head.bias.fill_(0.10)
        outputs = model(**inputs)
    assert not torch.equal(
        outputs["refined_local_rotation_6d"], inputs["base_local_rotation_6d"]
    )
    assert not torch.equal(
        outputs["refined_pelvis_world_y"], inputs["base_pelvis_world_y"]
    )
    assert torch.equal(
        inputs["external_root_event"], _inputs()["external_root_event"]
    )


def test_soft_event_pool_uses_predicted_distribution() -> None:
    sequence = torch.arange(10, dtype=torch.float32).reshape(1, 5, 2)
    distribution = torch.zeros(1, 5, 2)
    distribution[:, 1, 0] = 1.0
    distribution[:, 4, 1] = 1.0
    pooled = soft_event_pool(sequence, distribution)
    torch.testing.assert_close(pooled[:, 0], sequence[:, 1])
    torch.testing.assert_close(pooled[:, 1], sequence[:, 4])


def test_completion_and_space_objectives_are_differentiable() -> None:
    generator = torch.Generator().manual_seed(23)
    target_joints = torch.randn(2, 4, 22, 3, generator=generator)
    predicted_joints = (target_joints + 0.08).detach().requires_grad_(True)
    base_joints = target_joints + 0.12
    identity = torch.eye(3).expand(2, 4, 22, 3, 3).clone()
    metadata = [{"action": "sit"}, {"action": "drink"}]

    completion = action_weighted_completion_loss(
        predicted_joints,
        target_joints,
        identity,
        identity,
        metadata,
    )
    ranking = completion_rank_loss(
        predicted_joints,
        base_joints,
        target_joints,
        metadata,
    )
    (completion["loss"] + ranking["loss"]).backward()
    assert predicted_joints.grad is not None
    assert bool(torch.isfinite(predicted_joints.grad).all())
    assert float(ranking["refined_gain_m"]) > 0.0

    weights = action_completion_joint_weights(metadata, predicted_joints[:, -1, :, 0])
    assert bool((weights[0, :12] >= 2.0).all())
    assert torch.equal(weights[1, 20:22], torch.tensor([3.0, 3.0]))

    parents = torch.tensor(
        [0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19]
    )
    body_points, floor_mask = differentiable_body_sdf_points(
        predicted_joints, parents
    )
    assert body_points.shape == (2, 4, 85, 3)
    assert floor_mask.shape == (2, 4, 85)
    signed_distance = body_points[..., 0] * 0.0 - 0.01
    valid = torch.ones_like(signed_distance, dtype=torch.bool)
    space = event_space_loss(signed_distance, valid)
    assert float(space["mean_penetration_m"]) > 0.0
    assert float(space["cvar_m"]) > 0.0
