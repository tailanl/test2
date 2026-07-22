#!/usr/bin/env python3
"""CPU contracts for the P78 causal IntentMotion repair and IADM core."""

from __future__ import annotations

import ast
import inspect
from pathlib import Path
import unittest

import torch
from torch import nn

from kimodo_sceneco.interaction_guidance import intent_iadm as p78


class P78CausalIntentMotionCPUContracts(unittest.TestCase):
    def setUp(self) -> None:
        torch.manual_seed(20260721)
        self.batch = 2
        self.points = 24
        self.frames = 7
        self.words = 5
        self.scene_dim = 8
        self.text_dim = 16
        self.width = 64

        world = torch.randn(self.batch, self.points, 3) * 0.35
        world[1] += torch.tensor([3.5, -2.0, 1.25])
        low = torch.tensor([[-2.0, -1.5, -0.75], [1.0, -4.5, -1.5]])
        high = torch.tensor([[2.5, 2.0, 2.75], [7.5, 1.5, 5.0]])
        self.bounds = torch.stack((low, high), dim=1)
        normalized_xyz = 2.0 * (world - low[:, None]) / (high - low)[:, None] - 1.0
        normal = torch.zeros(self.batch, self.points, 3)
        normal[..., 2] = 1.0
        extra = torch.randn(self.batch, self.points, self.scene_dim - 6)
        self.scene = torch.cat((normalized_xyz, normal, extra), dim=-1)
        self.world_xyz = world
        self.scene_mask = torch.ones(self.batch, self.points, dtype=torch.bool)
        self.scene_mask[0, -3:] = False
        # Invalid padding is deliberately extreme; masks must exclude it.
        self.scene[0, -3:, :3] = 9.0
        self.world_xyz[0, -3:] = 1000.0

        alpha = torch.linspace(0.0, 1.0, self.frames)[None, :, None]
        root_start = torch.tensor([[[-0.5, 0.0, 0.0]], [[3.0, -2.0, 1.0]]])
        root_end = torch.tensor([[[0.5, 0.2, 0.0]], [[4.0, -1.8, 1.0]]])
        root_xyz = root_start + alpha * (root_end - root_start)
        self.root = torch.cat(
            (root_xyz, torch.randn(self.batch, self.frames, 2) * 0.01), dim=-1
        )
        self.text = torch.randn(self.batch, self.words, self.text_dim)
        self.text_mask = torch.ones(self.batch, self.words, dtype=torch.bool)
        self.text_mask[0, -1] = False
        self.timesteps = torch.tensor([17, 833], dtype=torch.long)
        self.model = p78.P78CausalIntentMotion(
            scene_token_dim=self.scene_dim,
            text_dim=self.text_dim,
            width=self.width,
            dropout=0.0,
        ).cpu().eval()

    def _forward(self, **changes):
        values = {
            "scene_tokens": self.scene,
            "scene_mask": self.scene_mask,
            "scene_bounds": self.bounds,
            "e226_root": self.root,
            "text_embeddings": self.text,
            "text_mask": self.text_mask,
            "timesteps": self.timesteps,
            "field_enabled": True,
        }
        values.update(changes)
        return self.model(**values)

    def test_public_forward_is_causal_and_has_no_c020_import(self) -> None:
        p78.assert_causal_forward_contract()
        signature = inspect.signature(p78.P78CausalIntentMotion.forward)
        actual = tuple(name for name in signature.parameters if name != "self")
        self.assertEqual(actual, p78.FORWARD_CAUSAL_INPUTS)
        with self.assertRaises(TypeError):
            self.model(
                self.scene,
                self.scene_mask,
                self.bounds,
                self.root,
                self.text,
                self.text_mask,
                self.timesteps,
                target=torch.zeros(1),
            )
        source = Path(inspect.getsourcefile(p78)).read_text(encoding="utf-8")
        tree = ast.parse(source)
        imported = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.extend(alias.name.lower() for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                imported.append((node.module or "").lower())
        self.assertFalse(any("c020" in name for name in imported))
        self.assertFalse(any("completion_keypose" in name for name in imported))

    def test_surface_proposal_and_exact_contact_field_layout(self) -> None:
        output = self._forward()
        self.assertEqual(output.cc.shape, (self.batch, 1, self.width))
        self.assertEqual(output.cc_valid.shape, (self.batch, 1))
        self.assertTrue(bool(output.cc_valid.all()))
        self.assertEqual(
            output.contact_field.shape,
            (self.batch, 4, 4, 4, 7),
        )
        selected = output.proposal.selected_surface_index
        batch = torch.arange(self.batch)
        expected_center = self.world_xyz[batch, selected]
        torch.testing.assert_close(output.proposal.center, expected_center, atol=1e-6, rtol=0)
        self.assertTrue(bool(self.scene_mask[batch, selected].all()))
        self.assertTrue(bool((output.proposal.radius >= 0.05).all()))
        diagonal = torch.linalg.vector_norm(self.bounds[:, 1] - self.bounds[:, 0], dim=-1)
        self.assertTrue(bool((output.proposal.radius <= diagonal * 0.25 + 1e-6).all()))
        self.assertTrue(bool((output.occupancy >= 0.0).all()))
        self.assertTrue(bool((output.occupancy <= 1.0).all()))
        torch.testing.assert_close(
            output.contact_field[..., 0].reshape(self.batch, -1),
            output.occupancy,
        )
        nearest_normal = output.contact_field[..., 4:7].reshape(self.batch, -1, 3)
        torch.testing.assert_close(
            torch.linalg.vector_norm(nearest_normal, dim=-1),
            torch.ones(self.batch, 64),
            atol=1e-6,
            rtol=1e-6,
        )
        self.assertTrue(bool((output.nearest_surface_index >= 0).all()))
        nearest_valid = self.scene_mask[
            torch.arange(self.batch)[:, None], output.nearest_surface_index
        ]
        self.assertTrue(bool(nearest_valid.all()))
        # Non-unit, shifted bounds make it impossible for a test to pass by
        # accidentally treating normalized xyz as metric xyz.
        self.assertFalse(
            torch.allclose(
                self.bounds[:, 1] - self.bounds[:, 0],
                torch.full_like(self.bounds[:, 0], 2.0),
            )
        )
        self.assertGreater(float(output.proposal.center[1, 0]), 2.0)

    def test_exact_448_fuse_and_four_latent_blocks(self) -> None:
        fuse = self.model.igcf.field_fuse.net
        self.assertEqual(len(fuse), 4)
        self.assertIsInstance(fuse[0], nn.Linear)
        self.assertEqual(fuse[0].in_features, 448)
        self.assertEqual(fuse[0].out_features, self.width)
        self.assertIsInstance(fuse[1], nn.SiLU)
        self.assertIsInstance(fuse[2], nn.Linear)
        self.assertEqual(fuse[2].in_features, self.width)
        self.assertEqual(fuse[2].out_features, self.width)
        self.assertIsInstance(fuse[3], nn.SiLU)
        self.assertEqual(len(self.model.igcf.latent_blocks), 4)
        config = self.model.configuration()
        self.assertEqual(config["output"], "Cc[B,1,D]")
        self.assertFalse(config["external_contact_condition"])

    def test_scene_shuffle_and_field_off_sensitivity_contract(self) -> None:
        metrics = p78.run_sensitivity_contract(
            self.model,
            scene_tokens=self.scene,
            scene_mask=self.scene_mask,
            scene_bounds=self.bounds,
            e226_root=self.root,
            text_embeddings=self.text,
            text_mask=self.text_mask,
            timesteps=self.timesteps,
            scene_permutation=torch.tensor([1, 0]),
        )
        self.assertTrue(metrics["passed"], metrics)
        self.assertGreater(metrics["scene_shuffle_center_l2_mean"], 1.0)
        self.assertGreater(metrics["scene_shuffle_field_l1_mean"], 1e-6)
        self.assertGreater(metrics["scene_shuffle_cc_l2_mean"], 1e-6)
        self.assertEqual(metrics["field_off_cc_abs_max"], 0.0)
        self.assertTrue(metrics["field_off_cc_all_invalid"])
        off = self._forward(field_enabled=False)
        self.assertTrue(torch.equal(off.cc, torch.zeros_like(off.cc)))
        self.assertTrue(torch.equal(off.contact_field, torch.zeros_like(off.contact_field)))
        self.assertTrue(bool((off.nearest_surface_index == -1).all()))

    def test_scene_token_permutation_is_geometrically_invariant(self) -> None:
        permutation = torch.randperm(self.points)
        original = self._forward()
        permuted = self._forward(
            scene_tokens=self.scene[:, permutation],
            scene_mask=self.scene_mask[:, permutation],
        )
        torch.testing.assert_close(
            original.proposal.center, permuted.proposal.center, atol=1e-6, rtol=1e-6
        )
        torch.testing.assert_close(
            original.proposal.radius, permuted.proposal.radius, atol=1e-6, rtol=1e-6
        )
        torch.testing.assert_close(
            original.contact_field, permuted.contact_field, atol=1e-5, rtol=1e-5
        )
        torch.testing.assert_close(original.cc, permuted.cc, atol=1e-5, rtol=1e-5)

    def test_separate_label_loss_backpropagates_without_becoming_condition(self) -> None:
        model = self.model.train()
        output = self._forward()
        valid_counts = self.scene_mask.sum(dim=1)
        alternate_index = (output.proposal.selected_surface_index + 1) % valid_counts
        surface_labels = torch.zeros_like(output.proposal.surface_weights)
        surface_labels.scatter_(1, alternate_index[:, None], 1.0)
        center_labels = output.proposal.center.detach() + torch.tensor([0.04, -0.03, 0.02])
        radius_labels = output.proposal.radius.detach() + 0.03
        occupancy_labels = (0.9 * output.occupancy.detach()).clamp(0.0, 1.0)
        losses = p78.p78_causal_repair_loss(
            output,
            surface_weight_labels=surface_labels,
            center_labels=center_labels,
            radius_labels=radius_labels,
            occupancy_labels=occupancy_labels,
        )
        objective = losses["total"] + 0.01 * output.cc.square().mean()
        objective.backward()
        proposer_grad = sum(
            float(parameter.grad.abs().sum())
            for parameter in model.proposer.parameters()
            if parameter.grad is not None
        )
        fusion_grad = sum(
            float(parameter.grad.abs().sum())
            for parameter in model.igcf.parameters()
            if parameter.grad is not None
        )
        self.assertGreater(float(losses["total"]), 0.0)
        self.assertGreater(proposer_grad, 0.0)
        self.assertGreater(fusion_grad, 0.0)

    def test_iadm_hidden_queries_cc_and_off_is_exact_identity(self) -> None:
        output = self._forward()
        decoder = p78.IADMContactDecoder(self.width, heads=8, dropout=0.0).cpu().eval()
        hidden = torch.randn(self.batch, 11, self.width, requires_grad=True)
        motion_valid = torch.ones(self.batch, 11, dtype=torch.bool)
        motion_valid[0, -2:] = False
        guided = decoder(hidden, output.cc, output.cc_valid, motion_valid, enabled=True)
        self.assertEqual(guided.shape, hidden.shape)
        self.assertGreater(float((guided[:, :-2] - hidden[:, :-2]).abs().mean()), 1e-6)
        torch.testing.assert_close(guided[0, -2:], hidden[0, -2:])
        disabled = decoder(hidden, output.cc, output.cc_valid, motion_valid, enabled=False)
        torch.testing.assert_close(disabled, hidden)
        invalid = decoder(
            hidden,
            torch.zeros_like(output.cc),
            torch.zeros_like(output.cc_valid),
            motion_valid,
            enabled=True,
        )
        torch.testing.assert_close(invalid, hidden)
        guided.square().mean().backward()
        self.assertIsNotNone(hidden.grad)
        decoder_grad = sum(
            float(parameter.grad.abs().sum())
            for parameter in decoder.parameters()
            if parameter.grad is not None
        )
        self.assertGreater(decoder_grad, 0.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
