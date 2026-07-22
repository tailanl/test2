from __future__ import annotations

import torch

from kimodo_sceneco.interaction_guidance import ReMoGenMIMBlock


def _inputs() -> tuple[torch.Tensor, ...]:
    torch.manual_seed(17)
    pose = torch.randn(2, 5, 16)
    pose_valid = torch.tensor(
        [[True, True, True, False, False], [True, True, True, True, True]]
    )
    memory = torch.randn(2, 3, 16)
    memory_valid = torch.tensor([[True, True, False], [True, True, True]])
    return pose, pose_valid, memory, memory_valid


def test_fresh_block_is_exact_identity_and_gate_receives_gradient() -> None:
    block = ReMoGenMIMBlock(latent_dim=16, num_heads=4, ff_dim=32).eval()
    pose, pose_valid, memory, memory_valid = _inputs()
    output = block(pose, pose_valid, memory, memory_valid)
    torch.testing.assert_close(output, pose, atol=0.0, rtol=0.0)
    output.square().mean().backward()
    assert block.residual_gate.grad is not None
    assert torch.isfinite(block.residual_gate.grad)


def test_open_gate_changes_only_valid_tokens() -> None:
    block = ReMoGenMIMBlock(latent_dim=16, num_heads=4, ff_dim=32).eval()
    with torch.no_grad():
        block.residual_gate.fill_(0.5)
    pose, pose_valid, memory, memory_valid = _inputs()
    output = block(pose, pose_valid, memory, memory_valid)
    assert not torch.equal(output[pose_valid], pose[pose_valid])
    torch.testing.assert_close(output[~pose_valid], pose[~pose_valid], atol=0.0, rtol=0.0)


def test_memory_off_is_identity_and_scene_shuffle_is_observable() -> None:
    block = ReMoGenMIMBlock(latent_dim=16, num_heads=4, ff_dim=32).eval()
    with torch.no_grad():
        block.residual_gate.fill_(0.5)
    pose, pose_valid, memory, memory_valid = _inputs()
    off = block(pose, pose_valid, memory, torch.zeros_like(memory_valid))
    torch.testing.assert_close(off, pose, atol=0.0, rtol=0.0)
    original = block(pose, pose_valid, memory, memory_valid)
    shuffled = block(pose, pose_valid, memory.flip(0), memory_valid.flip(0))
    assert not torch.equal(original[pose_valid], shuffled[pose_valid])
