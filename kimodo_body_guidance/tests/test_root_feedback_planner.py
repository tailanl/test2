#!/usr/bin/env python3
"""Contract and synthetic plumbing tests for the P80 feedback planner."""

from __future__ import annotations

import tempfile
from pathlib import Path
import unittest

import numpy as np

from kimodo_sceneco.root_feedback import planner


class SealedInputTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="p80_test_sealed_")
        self.root = Path(self.temporary.name)
        self.scene, self.bounds, self.start = planner._synthetic_scene("sit")
        self.scene_path = self.root / "scene.npy"
        np.save(self.scene_path, self.scene, allow_pickle=False)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def payload(self) -> dict[str, np.ndarray]:
        return planner.make_sealed_input_payload(
            sample_id="synthetic",
            raw_text="walk around the wall and sit down on the chair",
            num_frames=120,
            initial_root_xz=self.start,
            raw_scene_path=self.scene_path,
            scene_bounds=self.bounds,
        )

    def test_closed_schema_round_trip(self) -> None:
        path = self.root / "sealed.npz"
        np.savez_compressed(path, **self.payload())
        loaded = planner.load_sealed_planner_input(path)
        self.assertEqual(loaded.sample_id, "synthetic")
        self.assertEqual(loaded.raw_scene_sha256, planner._sha256(self.scene_path))
        self.assertEqual(set(self.payload()), planner.SEALED_INPUT_KEYS)

    def test_extra_gt_key_is_rejected(self) -> None:
        payload = self.payload()
        payload["gt_root_path"] = np.zeros((120, 2), dtype=np.float32)
        path = self.root / "leaky.npz"
        np.savez_compressed(path, **payload)
        with self.assertRaises(planner.PlannerContractError):
            planner.load_sealed_planner_input(path)

    def test_true_forbidden_flag_is_rejected(self) -> None:
        payload = self.payload()
        # The public sealer has no boolean leakage flags: adding one is itself
        # a closed-schema violation.
        payload["uses_gt_endpoint_condition"] = np.asarray(True)
        path = self.root / "bad_flag.npz"
        np.savez_compressed(path, **payload)
        with self.assertRaises(planner.PlannerContractError):
            planner.load_sealed_planner_input(path)

    def test_scene_hash_drift_is_rejected(self) -> None:
        path = self.root / "sealed_hash.npz"
        np.savez_compressed(path, **self.payload())
        changed = self.scene.copy()
        changed[0, 0, 0] = 1
        np.save(self.scene_path, changed, allow_pickle=False)
        with self.assertRaises(planner.PlannerContractError):
            planner.load_sealed_planner_input(path)


class RouteAndGeometryTests(unittest.TestCase):
    def test_raw_text_terminal_precedence_and_side(self) -> None:
        route = planner.parse_raw_text_route(
            "walk to the guitar and pick it up with the left hand"
        )
        self.assertEqual(route.action, "pick_up")
        self.assertEqual(route.side, "left")
        self.assertEqual(route.body_parts, ("left_hand",))
        stand = planner.parse_raw_text_route("stand up from sitting")
        self.assertFalse(stand.interaction_required)

    def test_dijkstra_predecessor_backtracks_around_wall(self) -> None:
        scene = np.zeros((30, 12, 30), dtype=np.uint8)
        bounds = np.asarray([[-1.5, 0.0, -1.5], [1.5, 1.2, 1.5]], dtype=np.float32)
        scene[14:16, 1:11, :22] = 1
        nav = planner.build_navigation_grid(scene, bounds, clearance_margin_m=0.04)
        start = np.asarray([-1.2, -1.2], dtype=np.float32)
        goal = np.asarray([1.2, 1.2], dtype=np.float32)
        result = planner.dijkstra_with_predecessor(nav, start)
        ix, iz, inside = planner.world_to_grid(goal, nav)
        self.assertTrue(inside)
        path = planner.backtrack_grid_path(result, (ix, iz))
        self.assertTrue(np.all(result.predecessor[path[1:, 0], path[1:, 1]] >= 0))
        self.assertGreater(len(path), 2)
        self.assertGreater(path[:, 1].max(), 21)

    def test_rdp_equidistant_waypoints_are_three_to_six(self) -> None:
        path = np.asarray(
            [[0.0, 0.0], [0.5, 0.0], [1.0, 0.0], [1.0, 0.5], [1.0, 1.0]],
            dtype=np.float32,
        )
        simplified, points, frames = planner.sparse_waypoints_from_path(
            path, 101, rdp_epsilon_m=0.05, desired_spacing_m=0.35
        )
        self.assertGreaterEqual(len(points), 3)
        self.assertLessEqual(len(points), 6)
        np.testing.assert_allclose(points[0], path[0])
        np.testing.assert_allclose(points[-1], path[-1])
        self.assertEqual(frames[0], 0)
        self.assertEqual(frames[-1], 100)
        self.assertTrue(np.all(np.diff(frames) > 0))
        self.assertGreaterEqual(len(simplified), 3)


class PlanAndRootInterfaceTests(unittest.TestCase):
    def _plan(self, action: str, text: str) -> planner.DiscretePlan:
        temporary = tempfile.TemporaryDirectory(prefix="p80_test_plan_")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        scene, bounds, start = planner._synthetic_scene(action)
        scene_path = root / "scene.npy"
        np.save(scene_path, scene, allow_pickle=False)
        sealed_path = root / "sealed.npz"
        np.savez_compressed(
            sealed_path,
            **planner.make_sealed_input_payload(
                sample_id=f"synthetic_{action}",
                raw_text=text,
                num_frames=160,
                initial_root_xz=start,
                raw_scene_path=scene_path,
                scene_bounds=bounds,
            ),
        )
        return planner.build_initial_discrete_plan(
            planner.load_sealed_planner_input(sealed_path)
        )

    def test_interaction_and_approach_are_distinct(self) -> None:
        plan = self._plan("sit", "sit down on the chair")
        self.assertIsNotNone(plan.interaction)
        self.assertIsNotNone(plan.approach_root)
        distance = np.linalg.norm(
            plan.interaction.point_world[[0, 2]] - plan.approach_root.root_xz_world
        )
        self.assertGreater(distance, 0.20)
        expected = plan.interaction.point_world[[0, 2]] - plan.approach_root.root_xz_world
        expected /= np.linalg.norm(expected)
        np.testing.assert_allclose(
            plan.approach_root.heading_to_interaction, expected, atol=1.0e-6
        )
        self.assertGreaterEqual(len(plan.sparse_waypoint_frames), 3)
        self.assertLessEqual(len(plan.sparse_waypoint_frames), 6)

    def test_native_interface_has_no_target_path_heading_or_reanchor(self) -> None:
        plan = self._plan("put_down", "put down the book on the table")
        interface = plan.native_root
        interface.validate()
        kwargs = interface.to_model_kwargs(["constraint"])
        self.assertIsNone(kwargs["target_path_xz"])
        self.assertIsNone(kwargs["first_heading_angle"])
        self.assertFalse(interface.endpoint_reanchor_applied)
        np.testing.assert_allclose(interface.canonical_points_xz[0], 0.0, atol=1e-7)
        np.testing.assert_allclose(
            interface.canonical_points_xz,
            interface.world_points_xz - interface.world_start_xz[None],
            atol=1e-6,
        )

    def test_materialized_constraint_contains_only_sparse_root2d_points(self) -> None:
        import torch

        interface = planner.make_native_sparse_root_interface(
            "materialize",
            [1.0, 2.0],
            [0, 5, 9],
            np.asarray([[1.0, 2.0], [1.5, 2.2], [2.0, 3.0]], dtype=np.float32),
        )

        class FakeRoot2DConstraintSet:
            name = "root2d"

            def __init__(
                self,
                *,
                skeleton: object,
                frame_indices: torch.Tensor,
                smooth_root_2d: torch.Tensor,
                global_root_heading: object,
            ) -> None:
                self.skeleton = skeleton
                self.frame_indices = frame_indices
                self.smooth_root_2d = smooth_root_2d
                self.global_root_heading = global_root_heading

        fake_model = type("FakeModel", (), {"skeleton": object()})()
        constraints = interface.materialize_constraint(
            fake_model,
            torch.device("cpu"),
            constraint_class=FakeRoot2DConstraintSet,
        )
        self.assertEqual(len(constraints), 1)
        constraint = constraints[0]
        self.assertEqual(constraint.name, "root2d")
        self.assertEqual(constraint.frame_indices.tolist(), [0, 5, 9])
        np.testing.assert_allclose(
            constraint.smooth_root_2d.cpu().numpy(),
            interface.canonical_points_xz,
            atol=0.0,
            rtol=0.0,
        )
        self.assertIsNone(constraint.global_root_heading)
        kwargs = interface.to_model_kwargs(constraints)
        self.assertIsNone(kwargs["target_path_xz"])
        self.assertIsNone(kwargs["first_heading_angle"])

    def test_no_interaction_text_stays_native_start_only(self) -> None:
        plan = self._plan("walk", "walk forward")
        self.assertIsNone(plan.interaction)
        self.assertEqual(plan.native_root.initial_condition_method, "kimodo_constraint_lst_root2d_start")
        self.assertEqual(plan.native_root.frame_indices.tolist(), [0])
        self.assertIsNone(plan.native_root.target_path_xz)


class FeedbackTests(unittest.TestCase):
    def test_router_covers_every_registered_action(self) -> None:
        router = planner.FeedbackRouter()
        cases = (
            (planner.FailureAbstraction(), planner.FeedbackAction.KEEP_BODY),
            (planner.FailureAbstraction(body_invalid=True), planner.FeedbackAction.REGENERATE_BODY),
            (planner.FailureAbstraction(body_unreachable=True), planner.FeedbackAction.UPDATE_TERMINAL_ROOT),
            (planner.FailureAbstraction(path_invalid=True), planner.FeedbackAction.UPDATE_PATH),
            (planner.FailureAbstraction(approach_invalid=True), planner.FeedbackAction.CHANGE_APPROACH),
            (planner.FailureAbstraction(region_invalid=True), planner.FeedbackAction.CHANGE_REGION),
            (planner.FailureAbstraction(unrecoverable=True), planner.FeedbackAction.STOP),
        )
        observed = set()
        for failure, expected in cases:
            decision = router.route(failure, attempt_index=0, rollout_budget=3)
            self.assertEqual(decision.action, expected)
            observed.add(decision.action)
        self.assertEqual(observed, set(planner.FeedbackAction))

    def test_fixed_budget_forces_stop_without_extra_rollout(self) -> None:
        def evaluator(cursor: planner.FeedbackCursor, attempt: int) -> planner.FailureAbstraction:
            del cursor, attempt
            return planner.FailureAbstraction(path_invalid=True)

        result = planner.run_fixed_budget_feedback(evaluator, rollout_budget=3)
        self.assertEqual(len(result.history), 3)
        self.assertEqual(result.history[0].action, planner.FeedbackAction.UPDATE_PATH)
        self.assertEqual(result.history[1].action, planner.FeedbackAction.UPDATE_PATH)
        self.assertEqual(result.history[2].action, planner.FeedbackAction.STOP)
        self.assertEqual(result.final_cursor.path_revision, 2)

    def test_success_stops_with_keep_body(self) -> None:
        def evaluator(cursor: planner.FeedbackCursor, attempt: int) -> planner.FailureAbstraction:
            del cursor
            return (
                planner.FailureAbstraction(body_invalid=True)
                if attempt == 0
                else planner.FailureAbstraction()
            )

        result = planner.run_fixed_budget_feedback(evaluator, rollout_budget=4)
        self.assertEqual(
            [item.action for item in result.history],
            [planner.FeedbackAction.REGENERATE_BODY, planner.FeedbackAction.KEEP_BODY],
        )
        self.assertEqual(result.final_cursor.body_revision, 1)


class FourSamplePlumbingSmokeTests(unittest.TestCase):
    def test_four_sample_strict_no_gt_smoke(self) -> None:
        records = planner.run_synthetic_four_sample_smoke()
        self.assertEqual(len(records), 4)
        self.assertEqual(
            [record["route_action"] for record in records],
            ["walk", "sit", "pick_up", "put_down"],
        )
        self.assertTrue(all(not record["target_path_passed_to_model"] for record in records))
        self.assertEqual(records[0]["sparse_point_count"], 1)
        self.assertTrue(all(record["sparse_point_count"] >= 3 for record in records[1:]))

    def test_cohort_keeps_no_plan_as_change_region_feedback(self) -> None:
        with tempfile.TemporaryDirectory(prefix="p80_test_cohort_") as directory:
            root = Path(directory)
            paths = []
            for sample_id, action, text in (
                ("feasible", "sit", "sit down on the chair"),
                ("no_region", "sit", "sit down on the chair"),
            ):
                scene, bounds, start = planner._synthetic_scene(action)
                if sample_id == "no_region":
                    scene[:] = 0
                scene_path = root / f"{sample_id}_scene.npy"
                np.save(scene_path, scene, allow_pickle=False)
                sealed_path = root / f"{sample_id}.npz"
                np.savez_compressed(
                    sealed_path,
                    **planner.make_sealed_input_payload(
                        sample_id=sample_id,
                        raw_text=text,
                        num_frames=120,
                        initial_root_xz=start,
                        raw_scene_path=scene_path,
                        scene_bounds=bounds,
                    ),
                )
                paths.append(sealed_path)
            result = planner.plan_sealed_input_cohort(paths)
        self.assertEqual(result["sample_count"], 2)
        self.assertEqual(result["planned_count"], 1)
        self.assertEqual(result["planning_failure_count"], 1)
        self.assertEqual(result["records"][1]["feedback_action"], planner.FeedbackAction.CHANGE_REGION)


if __name__ == "__main__":
    unittest.main(verbosity=2)
