#!/usr/bin/env python3
"""Contract tests for executable P80 Root -> Plan feedback v2."""

from __future__ import annotations

import tempfile
from pathlib import Path
import unittest

import numpy as np

from kimodo_sceneco.root_feedback import planner as base
from kimodo_sceneco.root_feedback import replanner


class ReplannerFixture(unittest.TestCase):
    def make_sealed(self, action: str = "sit") -> base.SealedPlannerInput:
        temporary = tempfile.TemporaryDirectory(prefix="p80_replanner_v2_")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        scene, bounds, start = base._synthetic_scene(action)
        scene_path = root / "scene.npy"
        np.save(scene_path, scene, allow_pickle=False)
        sealed_path = root / "sealed.npz"
        text = {
            "sit": "walk to the chair and sit down",
            "pick_up": "walk to the guitar and pick it up with the left hand",
            "put_down": "put down the book on the table",
            "walk": "walk forward",
        }[action]
        np.savez_compressed(
            sealed_path,
            **base.make_sealed_input_payload(
                sample_id=f"synthetic_{action}",
                raw_text=text,
                num_frames=160,
                initial_root_xz=start,
                raw_scene_path=scene_path,
                scene_bounds=bounds,
            ),
        )
        return base.load_sealed_planner_input(sealed_path)

    def pool(self, action: str = "sit"):
        sealed = self.make_sealed(action)
        nav0 = base.build_navigation_grid(
            sealed.raw_scene, sealed.scene_bounds, clearance_margin_m=0.0
        )
        # A smaller synthetic patch deliberately exposes multiple geometric
        # regions so CHANGE_REGION can be tested as an actual plan mutation.
        config = replanner.ReplannerConfig(patch_cell_m=0.15)
        pool = replanner.build_fixed_candidate_pool(sealed, nav0, config)
        return sealed, nav0, config, pool


class FixedPoolMutationTests(ReplannerFixture):
    def test_pool_is_deterministic_and_scene_bound(self) -> None:
        sealed, nav0, config, first = self.pool("sit")
        second = replanner.build_fixed_candidate_pool(sealed, nav0, config)
        self.assertEqual(first.pool_sha256, second.pool_sha256)
        self.assertEqual(first.scene_sha256, sealed.raw_scene_sha256)
        self.assertGreater(len(first.regions), 1)
        self.assertTrue(first.to_receipt()["candidate_pool_fixed_before_attempt_zero"])

    def test_cursor_revisions_select_real_different_candidates(self) -> None:
        _, _, _, pool = self.pool("sit")
        initial = replanner.select_candidate(pool, base.FeedbackCursor())
        terminal = replanner.select_candidate(
            pool, base.FeedbackCursor(terminal_root_revision=1)
        )
        approach = replanner.select_candidate(
            pool, base.FeedbackCursor(approach_revision=1)
        )
        region = replanner.select_candidate(
            pool, base.FeedbackCursor(region_revision=1)
        )
        self.assertIsNotNone(initial)
        self.assertIsNotNone(terminal)
        self.assertIsNotNone(approach)
        self.assertIsNotNone(region)
        self.assertNotEqual(initial.terminal_index, terminal.terminal_index)
        self.assertFalse(np.array_equal(initial.root_xz_world, terminal.root_xz_world))
        self.assertNotEqual(initial.direction_index, approach.direction_index)
        self.assertNotEqual(initial.interaction_region_index, region.interaction_region_index)

    def test_path_revision_changes_clearance_and_compression(self) -> None:
        _, _, _, pool = self.pool("sit")
        first = pool.path_policies[0]
        second = pool.path_policies[1]
        self.assertGreater(second.clearance_m, first.clearance_m)
        self.assertLess(second.rdp_epsilon_m, first.rdp_epsilon_m)
        self.assertLess(second.waypoint_spacing_m, first.waypoint_spacing_m)
        self.assertGreater(second.maximum_waypoints, first.maximum_waypoints)

    def test_update_terminal_root_action_changes_endpoint_and_replans_path(self) -> None:
        _, _, _, pool = self.pool("sit")
        before_cursor = base.FeedbackCursor(path_revision=3)
        after_cursor = replanner.apply_executable_feedback_action(
            before_cursor, base.FeedbackAction.UPDATE_TERMINAL_ROOT
        )
        before = replanner.select_candidate(pool, before_cursor)
        after = replanner.select_candidate(pool, after_cursor)
        self.assertEqual(after_cursor.terminal_root_revision, 1)
        self.assertEqual(after_cursor.path_revision, 0)
        self.assertIsNotNone(before)
        self.assertIsNotNone(after)
        self.assertFalse(np.array_equal(before.root_xz_world, after.root_xz_world))
        self.assertNotEqual(before.terminal_index, after.terminal_index)


class NativeRootContractTests(ReplannerFixture):
    def _first_materialized_plan(self):
        sealed, nav0, config, pool = self.pool("sit")
        for region in range(min(3, len(pool.regions))):
            for approach in range(min(4, len(pool.regions[region].directions))):
                for terminal in range(
                    min(5, len(pool.regions[region].directions[approach].endpoints))
                ):
                    cursor = base.FeedbackCursor(
                        region_revision=region,
                        approach_revision=approach,
                        terminal_root_revision=terminal,
                        path_revision=0,
                    )
                    plan, selection, policy, failure = replanner.construct_plan_for_cursor(
                        sealed, nav0, pool, cursor
                    )
                    if plan is not None:
                        return sealed, nav0, config, pool, cursor, plan, selection, policy
        self.fail("synthetic scene did not yield a materialized plan")

    def test_every_materialized_interface_is_native_sparse_only(self) -> None:
        _, _, _, _, _, plan, _, _ = self._first_materialized_plan()
        interface = plan.native_root
        interface.validate()
        self.assertIsNone(interface.target_path_xz)
        self.assertIsNone(interface.first_heading_angle)
        self.assertFalse(interface.endpoint_reanchor_applied)
        self.assertGreaterEqual(len(interface.frame_indices), 3)
        self.assertLessEqual(len(interface.frame_indices), 6)
        np.testing.assert_array_equal(interface.world_points_xz[0], interface.world_start_xz)

    def test_validator_uses_no_gt_source(self) -> None:
        sealed, nav0, config, pool, cursor, plan, selection, _ = self._first_materialized_plan()
        _, metrics = replanner.validate_root_plan_geometry(
            sealed, nav0, pool, cursor, plan, selection, config
        )
        self.assertEqual(
            tuple(metrics["validator_source_fields"]), replanner.VALIDATOR_SOURCE_FIELDS
        )
        joined = " ".join(metrics["validator_source_fields"])
        self.assertNotIn("gt_", joined)

    def test_walk_is_native_start_only(self) -> None:
        sealed = self.make_sealed("walk")
        result = replanner.run_sample_feedback(sealed)
        self.assertTrue(result.initial_success)
        self.assertTrue(result.final_success)
        plan = result.attempts[0].plan
        self.assertIsNotNone(plan)
        self.assertEqual(plan.native_root.initial_condition_method, "kimodo_constraint_lst_root2d_start")
        self.assertEqual(len(plan.native_root.frame_indices), 1)
        self.assertIsNone(plan.native_root.target_path_xz)


class ExecutableLoopTests(ReplannerFixture):
    def test_feedback_attempts_materially_follow_cursor(self) -> None:
        sealed = self.make_sealed("put_down")
        result = replanner.run_sample_feedback(
            sealed, replanner.ReplannerConfig(rollout_budget=8)
        )
        self.assertGreaterEqual(len(result.attempts), 1)
        for previous, following in zip(result.attempts[:-1], result.attempts[1:]):
            action = previous.feedback_action
            before, after = previous.cursor, following.cursor
            if action == base.FeedbackAction.UPDATE_PATH:
                self.assertEqual(after.path_revision, before.path_revision + 1)
                self.assertNotEqual(
                    previous.path_policy.to_receipt(), following.path_policy.to_receipt()
                )
            elif action == base.FeedbackAction.UPDATE_TERMINAL_ROOT:
                self.assertEqual(
                    after.terminal_root_revision, before.terminal_root_revision + 1
                )
                if previous.selection is not None and following.selection is not None:
                    self.assertFalse(
                        np.array_equal(
                            previous.selection.root_xz_world,
                            following.selection.root_xz_world,
                        )
                    )
            elif action == base.FeedbackAction.CHANGE_APPROACH:
                self.assertEqual(after.approach_revision, before.approach_revision + 1)
            elif action == base.FeedbackAction.CHANGE_REGION:
                self.assertEqual(after.region_revision, before.region_revision + 1)
            else:
                self.assertIn(action, (base.FeedbackAction.KEEP_BODY, base.FeedbackAction.STOP))

    def test_budget_is_hard_and_pool_hash_never_changes(self) -> None:
        sealed = self.make_sealed("pick_up")
        config = replanner.ReplannerConfig(rollout_budget=5)
        result = replanner.run_sample_feedback(sealed, config)
        self.assertLessEqual(len(result.attempts), 5)
        self.assertEqual(result.pool.pool_sha256, result.pool.to_receipt()["pool_sha256"])
        self.assertTrue(all(attempt.attempt_index < 5 for attempt in result.attempts))


if __name__ == "__main__":
    unittest.main(verbosity=2)
