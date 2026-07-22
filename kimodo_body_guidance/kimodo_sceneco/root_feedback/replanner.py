#!/usr/bin/env python3
"""Executable strict-no-GT Root -> Plan feedback for P80.

Version 1 defined a sound sealed-input boundary and a feedback *router*, but
its loop only incremented :class:`FeedbackCursor` counters.  This module turns
those counters into deterministic planning mutations:

* ``region_revision`` selects a different geometric interaction region;
* ``approach_revision`` selects a different approach direction;
* ``terminal_root_revision`` selects a different standoff/root endpoint;
* ``path_revision`` raises path clearance and reduces RDP/waypoint spacing.

The candidate pool and rollout budget are fixed before attempt zero.  Every
failure is computed from the hash-bound occupancy scene, the proposed root
path, and the task geometry inferred from raw text.  GT endpoint/path/body,
contact labels, action metadata, donor motions and proposals are never loaded.

Every emitted Kimodo interface is native sparse ``Root2DConstraintSet`` data
in canonical start-zero coordinates.  ``target_path_xz`` and heading remain
``None``; this module does not post-hoc re-anchor a generated root.
"""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass, field
import hashlib
import heapq
import json
import math
import os
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np

from . import planner as base


SCHEMA = "p80_executable_feedback_replanner_v2"
POOL_SCHEMA = "p80_fixed_geometric_candidate_pool_v2"
ATTEMPT_SCHEMA = "p80_root_plan_attempt_v2"
REPORT_SCHEMA = "p80_root_plan_feedback_cpu_evaluation_v2"

FORBIDDEN_GENERATION_INPUTS = (
    "gt_endpoint",
    "gt_root_path",
    "gt_body",
    "gt_contact",
    "offline_action",
    "proposal",
    "donor",
)
VALIDATOR_SOURCE_FIELDS = (
    "sealed_raw_scene",
    "sealed_scene_bounds",
    "sealed_frame0_root_xz",
    "raw_text_route",
    "candidate_interaction_geometry",
    "candidate_root_path",
)


class ReplannerContractError(RuntimeError):
    """Raised when executable feedback drifts from the strict contract."""


def _jsonable(value: Any) -> Any:
    if isinstance(value, (base.FeedbackAction,)):
        return value.value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_jsonable(item) for item in value]
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    if isinstance(value, np.ndarray):
        return value.tolist()
    if hasattr(value, "to_receipt"):
        return _jsonable(value.to_receipt())
    return value


def _write_json(path: str | Path, payload: Mapping[str, Any]) -> None:
    output = Path(path).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(_jsonable(payload), indent=2, sort_keys=True, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, output)


def _hash_payload(payload: Any) -> str:
    encoded = json.dumps(
        _jsonable(payload), sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class PathPolicy:
    revision: int
    clearance_m: float
    rdp_epsilon_m: float
    waypoint_spacing_m: float
    maximum_waypoints: int

    def to_receipt(self) -> dict[str, Any]:
        return {
            "revision": self.revision,
            "clearance_m": self.clearance_m,
            "rdp_epsilon_m": self.rdp_epsilon_m,
            "waypoint_spacing_m": self.waypoint_spacing_m,
            "maximum_waypoints": self.maximum_waypoints,
        }


DEFAULT_PATH_POLICIES = (
    PathPolicy(0, 0.06, 0.28, 1.25, 3),
    PathPolicy(1, 0.12, 0.16, 0.80, 4),
    PathPolicy(2, 0.18, 0.08, 0.55, 5),
    PathPolicy(3, 0.22, 0.04, 0.38, 6),
)


@dataclass(frozen=True)
class EndpointOption:
    direction_index: int
    terminal_index: int
    direction_xz: np.ndarray
    root_xz_world: np.ndarray
    standoff_m: float
    endpoint_sdf_m: float
    inside_scene: bool
    nominally_reachable: bool
    root_path_reachable_at_base_clearance: bool

    def to_receipt(self) -> dict[str, Any]:
        return {
            "direction_index": self.direction_index,
            "terminal_index": self.terminal_index,
            "direction_xz": self.direction_xz,
            "root_xz_world": self.root_xz_world,
            "standoff_m": self.standoff_m,
            "endpoint_sdf_m": self.endpoint_sdf_m,
            "inside_scene": self.inside_scene,
            "nominally_reachable": self.nominally_reachable,
            "root_path_reachable_at_base_clearance": self.root_path_reachable_at_base_clearance,
        }


@dataclass(frozen=True)
class DirectionOptions:
    direction_index: int
    direction_xz: np.ndarray
    endpoints: tuple[EndpointOption, ...]

    def to_receipt(self) -> dict[str, Any]:
        return {
            "direction_index": self.direction_index,
            "direction_xz": self.direction_xz,
            "endpoints": self.endpoints,
        }


@dataclass(frozen=True)
class RegionOptions:
    region_slot: int
    interaction: base.InteractionPoint
    directions: tuple[DirectionOptions, ...]

    def to_receipt(self) -> dict[str, Any]:
        return {
            "region_slot": self.region_slot,
            "interaction": self.interaction,
            "directions": self.directions,
        }


@dataclass(frozen=True)
class FixedCandidatePool:
    sample_id: str
    route: base.RawTextRoute
    regions: tuple[RegionOptions, ...]
    path_policies: tuple[PathPolicy, ...]
    scene_sha256: str
    pool_sha256: str

    def to_receipt(self) -> dict[str, Any]:
        return {
            "schema": POOL_SCHEMA,
            "sample_id": self.sample_id,
            "route": {
                "action": self.route.action,
                "task_kind": self.route.task_kind,
                "side": self.route.side,
                "body_parts": self.route.body_parts,
                "interaction_required": self.route.interaction_required,
            },
            "region_count": len(self.regions),
            "direction_count_per_region": [len(item.directions) for item in self.regions],
            "terminal_count_per_direction": [
                [len(direction.endpoints) for direction in region.directions]
                for region in self.regions
            ],
            "path_policies": self.path_policies,
            "scene_sha256": self.scene_sha256,
            "pool_sha256": self.pool_sha256,
            "candidate_pool_fixed_before_attempt_zero": True,
            "gt_used": False,
        }


@dataclass(frozen=True)
class CandidateSelection:
    region_slot: int
    interaction_region_index: int
    approach_slot: int
    direction_index: int
    terminal_slot: int
    terminal_index: int
    path_revision: int
    root_xz_world: np.ndarray
    direction_xz: np.ndarray
    standoff_m: float

    def to_receipt(self) -> dict[str, Any]:
        return {
            "region_slot": self.region_slot,
            "interaction_region_index": self.interaction_region_index,
            "approach_slot": self.approach_slot,
            "direction_index": self.direction_index,
            "terminal_slot": self.terminal_slot,
            "terminal_index": self.terminal_index,
            "path_revision": self.path_revision,
            "root_xz_world": self.root_xz_world,
            "direction_xz": self.direction_xz,
            "standoff_m": self.standoff_m,
        }


@dataclass(frozen=True)
class ReplannerConfig:
    rollout_budget: int = 8
    maximum_regions: int = 32
    direction_count: int = 12
    maximum_approaches_per_region: int = 4
    patch_cell_m: float = 0.22
    validation_clearance_m: float = 0.14
    endpoint_clearance_m: float = 0.14
    path_sample_step_m: float = 0.025
    path_policies: tuple[PathPolicy, ...] = DEFAULT_PATH_POLICIES

    def validate(self) -> None:
        if self.rollout_budget < 1:
            raise ReplannerContractError("rollout_budget must be positive")
        if not self.path_policies:
            raise ReplannerContractError("path policy schedule is empty")
        if not (1 <= self.maximum_approaches_per_region <= self.direction_count + 2):
            raise ReplannerContractError("invalid fixed approach budget per region")
        revisions = [item.revision for item in self.path_policies]
        if revisions != list(range(len(revisions))):
            raise ReplannerContractError("path policy revisions must be contiguous")
        if any(not (3 <= item.maximum_waypoints <= 6) for item in self.path_policies):
            raise ReplannerContractError("native sparse waypoint count must remain 3--6")
        if any(item.clearance_m < 0 for item in self.path_policies):
            raise ReplannerContractError("path clearance cannot be negative")


def _nav_at_clearance(nav0: base.NavigationGrid, clearance_m: float) -> base.NavigationGrid:
    return base.NavigationGrid(
        occupied=nav0.occupied,
        free=np.asarray(nav0.sdf_m >= float(clearance_m), dtype=bool),
        sdf_m=nav0.sdf_m,
        bounds=nav0.bounds,
        resolution_xz=nav0.resolution_xz,
        clearance_margin_m=float(clearance_m),
    )


def dijkstra_corner_safe(
    nav: base.NavigationGrid, start_xz: Sequence[float]
) -> base.DijkstraResult:
    """Four-neighbour predecessor map that cannot cut occupied corners."""

    ix, iz, inside = base.world_to_grid(start_xz, nav)
    if not inside:
        raise base.NoFeasiblePlan("initial root is outside the raw scene")
    free = np.asarray(nav.free, dtype=bool).copy()
    start_originally_free = bool(free[ix, iz])
    free[ix, iz] = True
    nx, nz = free.shape
    distances = np.full((nx, nz), np.inf, dtype=np.float64)
    predecessor = np.full((nx, nz, 2), -1, dtype=np.int32)
    distances[ix, iz] = 0.0
    predecessor[ix, iz] = (ix, iz)
    dx, dz = nav.resolution_xz
    neighbours = ((-1, 0, dx), (1, 0, dx), (0, -1, dz), (0, 1, dz))
    queue: list[tuple[float, int, int]] = [(0.0, ix, iz)]
    while queue:
        distance, x_index, z_index = heapq.heappop(queue)
        if distance > float(distances[x_index, z_index]) + 1.0e-10:
            continue
        for di, dj, cost in neighbours:
            ni, nj = x_index + di, z_index + dj
            if not (0 <= ni < nx and 0 <= nj < nz) or not bool(free[ni, nj]):
                continue
            proposed = distance + float(cost)
            if proposed + 1.0e-10 < float(distances[ni, nj]):
                distances[ni, nj] = proposed
                predecessor[ni, nj] = (x_index, z_index)
                heapq.heappush(queue, (proposed, ni, nj))
    return base.DijkstraResult(
        distances_m=distances,
        predecessor=predecessor,
        start_index=(ix, iz),
        start_originally_free=start_originally_free,
    )


def _standoff_priority(action: str) -> tuple[float, ...]:
    values = tuple(float(value) for value in base._action_standoffs(action))
    nominal = {"sit": 0.50, "lie": 0.58}.get(action, 0.56)
    return tuple(sorted(values, key=lambda value: (abs(value - nominal), value)))


def _endpoint_geometry(
    nav0: base.NavigationGrid,
    route: base.RawTextRoute,
    interaction: base.InteractionPoint,
    direction: np.ndarray,
    direction_index: int,
    base_connectivity: base.DijkstraResult,
) -> tuple[EndpointOption, ...]:
    raw: list[EndpointOption] = []
    for original_index, standoff in enumerate(_standoff_priority(route.action)):
        root = (
            interaction.point_world[[0, 2]]
            + np.asarray(direction, dtype=np.float32) * float(standoff)
        ).astype(np.float32)
        ix, iz, inside = base.world_to_grid(root, nav0)
        sdf = float(nav0.sdf_m[ix, iz]) if inside else float("-inf")
        connected = bool(
            inside and math.isfinite(float(base_connectivity.distances_m[ix, iz]))
        )
        raw.append(
            EndpointOption(
                direction_index=int(direction_index),
                terminal_index=int(original_index),
                direction_xz=np.asarray(direction, dtype=np.float32),
                root_xz_world=root,
                standoff_m=float(standoff),
                endpoint_sdf_m=sdf,
                inside_scene=bool(inside),
                nominally_reachable=bool(
                    inside
                    and base._nominal_interaction_reachable(route, interaction, root)
                ),
                root_path_reachable_at_base_clearance=connected,
            )
        )
    # Causal geometry orders the fixed pool; feedback never adds a candidate.
    raw.sort(
        key=lambda item: (
            not item.inside_scene,
            not item.nominally_reachable,
            not item.root_path_reachable_at_base_clearance,
            -item.endpoint_sdf_m,
            abs(item.standoff_m - ({"sit": 0.50, "lie": 0.58}.get(route.action, 0.56))),
            item.terminal_index,
        )
    )
    return tuple(raw)


def build_fixed_candidate_pool(
    sealed: base.SealedPlannerInput,
    nav0: base.NavigationGrid,
    config: ReplannerConfig,
) -> FixedCandidatePool:
    """Freeze all region/direction/standoff/path candidates before rollout."""

    config.validate()
    route = base.parse_raw_text_route(sealed.raw_text)
    interactions = base.propose_interaction_points(
        sealed,
        route,
        patch_cell_m=config.patch_cell_m,
        maximum_regions=config.maximum_regions,
    )
    base_connectivity = dijkstra_corner_safe(
        _nav_at_clearance(nav0, config.path_policies[0].clearance_m),
        sealed.initial_root_xz,
    )
    region_values: list[RegionOptions] = []
    for interaction in interactions:
        directions = base._approach_directions(
            interaction.normal_world, config.direction_count
        )
        direction_values: list[DirectionOptions] = []
        for direction_index, direction in enumerate(directions):
            endpoints = _endpoint_geometry(
                nav0,
                route,
                interaction,
                direction,
                direction_index,
                base_connectivity,
            )
            direction_values.append(
                DirectionOptions(
                    direction_index=int(direction_index),
                    direction_xz=np.asarray(direction, dtype=np.float32),
                    endpoints=endpoints,
                )
            )
        # Prefer directions with a high-clearance reachable endpoint, but keep
        # the complete direction pool and stable original indices.
        direction_values.sort(
            key=lambda item: (
                not any(endpoint.nominally_reachable for endpoint in item.endpoints),
                not any(
                    endpoint.root_path_reachable_at_base_clearance
                    for endpoint in item.endpoints
                ),
                -max((endpoint.endpoint_sdf_m for endpoint in item.endpoints), default=-math.inf),
                item.direction_index,
            )
        )
        direction_values = direction_values[: config.maximum_approaches_per_region]
        region_values.append(
            RegionOptions(
                region_slot=len(region_values),
                interaction=interaction,
                directions=tuple(direction_values),
            )
        )

    prehash = {
        "schema": POOL_SCHEMA,
        "sample_id": sealed.sample_id,
        "scene_sha256": sealed.raw_scene_sha256,
        "route": route.action,
        "regions": region_values,
        "path_policies": config.path_policies,
    }
    digest = _hash_payload(prehash)
    return FixedCandidatePool(
        sample_id=sealed.sample_id,
        route=route,
        regions=tuple(region_values),
        path_policies=tuple(config.path_policies),
        scene_sha256=sealed.raw_scene_sha256,
        pool_sha256=digest,
    )


def select_candidate(
    pool: FixedCandidatePool, cursor: base.FeedbackCursor
) -> CandidateSelection | None:
    if not pool.route.interaction_required:
        return None
    if cursor.region_revision >= len(pool.regions):
        return None
    region = pool.regions[cursor.region_revision]
    if cursor.approach_revision >= len(region.directions):
        return None
    direction = region.directions[cursor.approach_revision]
    if cursor.terminal_root_revision >= len(direction.endpoints):
        return None
    if cursor.path_revision >= len(pool.path_policies):
        return None
    endpoint = direction.endpoints[cursor.terminal_root_revision]
    return CandidateSelection(
        region_slot=cursor.region_revision,
        interaction_region_index=region.interaction.region_index,
        approach_slot=cursor.approach_revision,
        direction_index=direction.direction_index,
        terminal_slot=cursor.terminal_root_revision,
        terminal_index=endpoint.terminal_index,
        path_revision=cursor.path_revision,
        root_xz_world=endpoint.root_xz_world,
        direction_xz=direction.direction_xz,
        standoff_m=endpoint.standoff_m,
    )


def _has_next_terminal(pool: FixedCandidatePool, cursor: base.FeedbackCursor) -> bool:
    if cursor.region_revision >= len(pool.regions):
        return False
    region = pool.regions[cursor.region_revision]
    if cursor.approach_revision >= len(region.directions):
        return False
    return cursor.terminal_root_revision + 1 < len(
        region.directions[cursor.approach_revision].endpoints
    )


def _has_next_approach(pool: FixedCandidatePool, cursor: base.FeedbackCursor) -> bool:
    if cursor.region_revision >= len(pool.regions):
        return False
    return cursor.approach_revision + 1 < len(
        pool.regions[cursor.region_revision].directions
    )


def _has_next_region(pool: FixedCandidatePool, cursor: base.FeedbackCursor) -> bool:
    return cursor.region_revision + 1 < len(pool.regions)


def _advance_endpoint_failure(
    pool: FixedCandidatePool,
    cursor: base.FeedbackCursor,
    detail: str,
) -> base.FailureAbstraction:
    details = (detail, "validator_source=scene_geometry_only")
    if _has_next_terminal(pool, cursor):
        return base.FailureAbstraction(terminal_root_invalid=True, details=details)
    if _has_next_approach(pool, cursor):
        return base.FailureAbstraction(approach_invalid=True, details=details)
    if _has_next_region(pool, cursor):
        return base.FailureAbstraction(region_invalid=True, details=details)
    return base.FailureAbstraction(unrecoverable=True, details=details)


def _advance_direction_failure(
    pool: FixedCandidatePool,
    cursor: base.FeedbackCursor,
    detail: str,
) -> base.FailureAbstraction:
    """Escalate a disconnected ray without wasting budget on its standoffs.

    Endpoints inside one direction are ordered by causal endpoint clearance.
    If the best-clearance endpoint of that ray is disconnected, shortening the
    same ray does not repair the separating obstacle; the executable edit is a
    new approach direction, then a new region.
    """

    details = (detail, "best_clearance_endpoint_on_direction_disconnected")
    if _has_next_approach(pool, cursor):
        return base.FailureAbstraction(approach_invalid=True, details=details)
    if _has_next_region(pool, cursor):
        return base.FailureAbstraction(region_invalid=True, details=details)
    return base.FailureAbstraction(unrecoverable=True, details=details)


def _advance_path_failure(
    pool: FixedCandidatePool,
    cursor: base.FeedbackCursor,
    detail: str,
) -> base.FailureAbstraction:
    if cursor.path_revision + 1 < len(pool.path_policies):
        return base.FailureAbstraction(
            path_invalid=True,
            details=(detail, "next_path_revision_changes_clearance_and_compression"),
        )
    return _advance_endpoint_failure(pool, cursor, detail + "; path_policy_exhausted")


def _interaction_for_selection(
    pool: FixedCandidatePool, selection: CandidateSelection
) -> base.InteractionPoint:
    return pool.regions[selection.region_slot].interaction


def _endpoint_for_selection(
    pool: FixedCandidatePool, selection: CandidateSelection
) -> EndpointOption:
    return pool.regions[selection.region_slot].directions[
        selection.approach_slot
    ].endpoints[selection.terminal_slot]


def _build_start_only_plan(sealed: base.SealedPlannerInput, route: base.RawTextRoute) -> base.DiscretePlan:
    start = sealed.initial_root_xz.astype(np.float32)
    interface = base.make_native_sparse_root_interface(
        sealed.sample_id, start, np.asarray([0], dtype=np.int64), start[None]
    )
    return base.DiscretePlan(
        sample_id=sealed.sample_id,
        route=route,
        interaction=None,
        approach_root=None,
        dense_path_world_xz=start[None],
        rdp_path_world_xz=start[None],
        sparse_waypoints_world_xz=start[None],
        sparse_waypoint_frames=np.asarray([0], dtype=np.int64),
        native_root=interface,
        candidate_region_count=0,
        feasible_approach_count=0,
        minimum_path_clearance_m=float("nan"),
    )


def _segment_minimum_sdf(
    start: np.ndarray,
    end: np.ndarray,
    nav0: base.NavigationGrid,
    *,
    step_m: float,
) -> tuple[float, bool]:
    distance = float(np.linalg.norm(end - start))
    count = max(1, int(math.ceil(distance / max(step_m, 1.0e-4))))
    minimum = math.inf
    for amount in np.linspace(0.0, 1.0, count + 1, dtype=np.float32):
        point = start * (1.0 - amount) + end * amount
        ix, iz, inside = base.world_to_grid(point, nav0)
        if not inside:
            return float("-inf"), False
        minimum = min(minimum, float(nav0.sdf_m[ix, iz]))
    return minimum, True


def _segment_satisfies_clearance(
    start: np.ndarray,
    end: np.ndarray,
    nav0: base.NavigationGrid,
    *,
    route_start: np.ndarray,
    required_clearance_m: float,
    step_m: float,
    start_exemption_radius_m: float = 0.25,
) -> bool:
    """Validate a shortcut while preserving the immutable measured root0.

    Root0 may already be closer to geometry than the requested margin.  Only
    its first 25 cm of escape is exempted, and that prefix may not go deeper
    than the measured frame-zero clearance.
    """

    ix0, iz0, inside0 = base.world_to_grid(route_start, nav0)
    if not inside0:
        return False
    start_sdf = float(nav0.sdf_m[ix0, iz0])
    distance = float(np.linalg.norm(end - start))
    count = max(1, int(math.ceil(distance / max(step_m, 1.0e-4))))
    for amount in np.linspace(0.0, 1.0, count + 1, dtype=np.float32):
        point = start * (1.0 - amount) + end * amount
        ix, iz, inside = base.world_to_grid(point, nav0)
        if not inside:
            return False
        threshold = float(required_clearance_m)
        if float(np.linalg.norm(point - route_start)) <= float(start_exemption_radius_m):
            threshold = min(threshold, start_sdf)
        if float(nav0.sdf_m[ix, iz]) + 1.0e-7 < threshold:
            return False
    return True


def clearance_preserving_sparse_waypoints(
    dense_path: np.ndarray,
    nav0: base.NavigationGrid,
    *,
    num_frames: int,
    required_clearance_m: float,
    maximum_points: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Greedily shortcut a grid route without crossing the clearance set.

    RDP/equidistant compression can reconnect two safe vertices with a chord
    through an obstacle.  Later UPDATE_PATH revisions therefore use this
    scene-aware compression.  It is still a sparse 3--6 point native root
    condition, not a full target path passed to Kimodo.
    """

    dense = np.asarray(dense_path, dtype=np.float32)
    if dense.ndim != 2 or dense.shape[1] != 2 or len(dense) < 2:
        raise ReplannerContractError("dense route must contain two XZ points")
    step = 0.45 * min(nav0.resolution_xz)
    chosen = [0]
    current = 0
    while current < len(dense) - 1:
        selected = None
        for future in range(len(dense) - 1, current, -1):
            if _segment_satisfies_clearance(
                dense[current],
                dense[future],
                nav0,
                route_start=dense[0],
                required_clearance_m=required_clearance_m,
                step_m=step,
            ):
                selected = future
                break
        if selected is None or selected <= current:
            raise ReplannerContractError("clearance-preserving shortcut stalled")
        chosen.append(selected)
        current = selected
        if len(chosen) > int(maximum_points):
            raise ReplannerContractError(
                "clearance-preserving route exceeds native sparse waypoint budget"
            )
    sparse = dense[np.asarray(chosen, dtype=np.int64)]
    if len(sparse) < 3:
        sparse = base.equidistant_resample(dense, 3)
        metrics = _polyline_scene_metrics(sparse, nav0, step)
        if (
            metrics["out_of_bounds_count"] > 0
            or metrics["minimum_sdf_after_start_exemption_m"] + 1.0e-7
            < float(required_clearance_m)
        ):
            raise ReplannerContractError("three-point sparse route violates clearance")
    segment = np.linalg.norm(np.diff(sparse, axis=0), axis=1)
    cumulative = np.concatenate((np.zeros(1, dtype=np.float32), np.cumsum(segment)))
    if float(cumulative[-1]) <= 1.0e-8:
        frames = np.rint(
            np.linspace(0, int(num_frames) - 1, len(sparse))
        ).astype(np.int64)
    else:
        frames = np.rint(
            cumulative / cumulative[-1] * (int(num_frames) - 1)
        ).astype(np.int64)
        frames[0], frames[-1] = 0, int(num_frames) - 1
    if len(np.unique(frames)) != len(frames) or not np.all(np.diff(frames) > 0):
        frames = np.rint(
            np.linspace(0, int(num_frames) - 1, len(sparse))
        ).astype(np.int64)
    return sparse.astype(np.float32), frames


def construct_plan_for_cursor(
    sealed: base.SealedPlannerInput,
    nav0: base.NavigationGrid,
    pool: FixedCandidatePool,
    cursor: base.FeedbackCursor,
) -> tuple[base.DiscretePlan | None, CandidateSelection | None, PathPolicy | None, base.FailureAbstraction | None]:
    """Materialize the cursor into a genuinely revised native root plan."""

    if not pool.route.interaction_required:
        return _build_start_only_plan(sealed, pool.route), None, None, None
    if not pool.regions:
        return (
            None,
            None,
            None,
            base.FailureAbstraction(
                unrecoverable=True,
                region_invalid=True,
                details=("no geometric interaction region in fixed pool",),
            ),
        )
    selection = select_candidate(pool, cursor)
    if selection is None:
        return (
            None,
            None,
            None,
            base.FailureAbstraction(
                unrecoverable=True,
                details=("feedback cursor exhausted fixed candidate pool",),
            ),
        )
    policy = pool.path_policies[selection.path_revision]
    endpoint = _endpoint_for_selection(pool, selection)
    if not endpoint.inside_scene or not endpoint.nominally_reachable:
        return (
            None,
            selection,
            policy,
            _advance_direction_failure(
                pool, cursor, "selected terminal root is outside or nominally unreachable"
            ),
        )

    nav = _nav_at_clearance(nav0, policy.clearance_m)
    ix, iz, inside = base.world_to_grid(endpoint.root_xz_world, nav)
    if not inside or not bool(nav.free[ix, iz]):
        return (
            None,
            selection,
            policy,
            _advance_direction_failure(
                pool,
                cursor,
                f"terminal root clearance {endpoint.endpoint_sdf_m:.4f} below {policy.clearance_m:.4f}",
            ),
        )
    try:
        dijkstra = dijkstra_corner_safe(nav, sealed.initial_root_xz)
        if not math.isfinite(float(dijkstra.distances_m[ix, iz])):
            raise base.NoFeasiblePlan("terminal root is disconnected")
        grid_path = base.backtrack_grid_path(dijkstra, (ix, iz))
    except base.NoFeasiblePlan as error:
        return None, selection, policy, _advance_direction_failure(pool, cursor, str(error))

    dense = np.stack([base.grid_to_world(index, nav) for index in grid_path]).astype(np.float32)
    dense[0] = sealed.initial_root_xz
    dense[-1] = endpoint.root_xz_world
    try:
        rdp = base.rdp_simplify(dense, policy.rdp_epsilon_m)
        if policy.revision >= 2:
            sparse, frames = clearance_preserving_sparse_waypoints(
                dense,
                nav0,
                num_frames=sealed.num_frames,
                required_clearance_m=policy.clearance_m,
                maximum_points=policy.maximum_waypoints,
            )
        else:
            _, sparse, frames = base.sparse_waypoints_from_path(
                dense,
                sealed.num_frames,
                rdp_epsilon_m=policy.rdp_epsilon_m,
                desired_spacing_m=policy.waypoint_spacing_m,
                minimum_points=3,
                maximum_points=policy.maximum_waypoints,
            )
    except (base.PlannerContractError, ReplannerContractError) as error:
        return None, selection, policy, _advance_path_failure(pool, cursor, str(error))

    interaction = _interaction_for_selection(pool, selection)
    heading = interaction.point_world[[0, 2]] - endpoint.root_xz_world
    heading_norm = float(np.linalg.norm(heading))
    if heading_norm <= 1.0e-8:
        return None, selection, policy, _advance_endpoint_failure(
            pool, cursor, "interaction and terminal root collapsed"
        )
    heading = (heading / heading_norm).astype(np.float32)
    path_length = float(np.linalg.norm(np.diff(dense, axis=0), axis=1).sum())
    direct = float(np.linalg.norm(endpoint.root_xz_world - sealed.initial_root_xz))
    clearance = float(np.min(nav0.sdf_m[grid_path[:, 0], grid_path[:, 1]]))
    approach = base.ApproachRoot(
        region_index=interaction.region_index,
        approach_index=selection.direction_index,
        root_xz_world=endpoint.root_xz_world,
        heading_to_interaction=heading,
        standoff_m=endpoint.standoff_m,
        endpoint_clearance_m=endpoint.endpoint_sdf_m,
        path_length_m=path_length,
        path_excess_ratio=path_length / max(direct, 1.0e-6),
    )
    interface = base.make_native_sparse_root_interface(
        sealed.sample_id, sealed.initial_root_xz, frames, sparse
    )
    plan = base.DiscretePlan(
        sample_id=sealed.sample_id,
        route=pool.route,
        interaction=interaction,
        approach_root=approach,
        dense_path_world_xz=dense,
        rdp_path_world_xz=rdp,
        sparse_waypoints_world_xz=sparse,
        sparse_waypoint_frames=frames,
        native_root=interface,
        candidate_region_count=len(pool.regions),
        feasible_approach_count=sum(
            len(direction.endpoints)
            for region in pool.regions
            for direction in region.directions
        ),
        minimum_path_clearance_m=clearance,
    )
    return plan, selection, policy, None


def _sample_polyline(points: np.ndarray, step_m: float) -> np.ndarray:
    values = np.asarray(points, dtype=np.float32)
    if values.ndim != 2 or values.shape[1] != 2 or len(values) < 1:
        raise ReplannerContractError("root polyline must have shape [N,2]")
    output = [values[0]]
    for start, end in zip(values[:-1], values[1:]):
        distance = float(np.linalg.norm(end - start))
        count = max(1, int(math.ceil(distance / max(step_m, 1.0e-4))))
        for amount in np.linspace(0.0, 1.0, count + 1, dtype=np.float32)[1:]:
            output.append(start * (1.0 - amount) + end * amount)
    return np.asarray(output, dtype=np.float32)


def _polyline_scene_metrics(
    points: np.ndarray,
    nav0: base.NavigationGrid,
    step_m: float,
    *,
    start_exemption_radius_m: float = 0.25,
) -> dict[str, Any]:
    sampled = _sample_polyline(points, step_m)
    sdf_values: list[float] = []
    post_exemption_values: list[float] = []
    out_of_bounds = 0
    for point in sampled:
        ix, iz, inside = base.world_to_grid(point, nav0)
        if not inside:
            out_of_bounds += 1
            continue
        value = float(nav0.sdf_m[ix, iz])
        sdf_values.append(value)
        if float(np.linalg.norm(point - sampled[0])) > float(start_exemption_radius_m):
            post_exemption_values.append(value)
    minimum = min(sdf_values) if sdf_values else float("-inf")
    post_minimum = min(post_exemption_values) if post_exemption_values else minimum
    return {
        "sample_count": len(sampled),
        "out_of_bounds_count": out_of_bounds,
        "minimum_sdf_m": minimum,
        "minimum_sdf_after_start_exemption_m": post_minimum,
        "start_exemption_radius_m": float(start_exemption_radius_m),
    }


def validate_root_plan_geometry(
    sealed: base.SealedPlannerInput,
    nav0: base.NavigationGrid,
    pool: FixedCandidatePool,
    cursor: base.FeedbackCursor,
    plan: base.DiscretePlan,
    selection: CandidateSelection | None,
    config: ReplannerConfig,
) -> tuple[base.FailureAbstraction, dict[str, Any]]:
    """Validate only scene/root/task geometry; no offline target is accepted."""

    plan.native_root.validate()
    root_receipt = plan.native_root.to_receipt()
    if root_receipt["target_path_passed_to_model"]:
        raise ReplannerContractError("target path leaked into native root interface")
    if root_receipt["first_heading_angle"] is not None:
        raise ReplannerContractError("heading leaked into native root interface")
    start_error = float(
        np.linalg.norm(plan.native_root.world_points_xz[0] - sealed.initial_root_xz)
    )
    if start_error > 1.0e-7:
        raise ReplannerContractError("native root frame0 drifted")
    if not pool.route.interaction_required:
        return base.FailureAbstraction(), {
            "start_error_m": start_error,
            "native_sparse_point_count": 1,
            "validator_source_fields": VALIDATOR_SOURCE_FIELDS,
            "no_task_start_only": True,
        }

    if selection is None or plan.interaction is None or plan.approach_root is None:
        raise ReplannerContractError("interaction plan is missing selected geometry")
    dense_metrics = _polyline_scene_metrics(
        plan.dense_path_world_xz, nav0, config.path_sample_step_m
    )
    sparse_metrics = _polyline_scene_metrics(
        plan.sparse_waypoints_world_xz, nav0, config.path_sample_step_m
    )
    endpoint = _endpoint_for_selection(pool, selection)
    region = _interaction_for_selection(pool, selection)
    region_inside = bool(
        np.all(region.point_world >= sealed.scene_bounds[0] - 1.0e-6)
        and np.all(region.point_world <= sealed.scene_bounds[1] + 1.0e-6)
        and region.radius_m > 0.0
        and region.support_area_m2 > 0.0
    )
    relation_error = abs(
        float(np.linalg.norm(region.point_world[[0, 2]] - endpoint.root_xz_world))
        - endpoint.standoff_m
    )
    heading_norm_error = abs(float(np.linalg.norm(plan.approach_root.heading_to_interaction)) - 1.0)
    endpoint_valid = bool(
        endpoint.inside_scene
        and endpoint.nominally_reachable
        and endpoint.endpoint_sdf_m >= config.endpoint_clearance_m
    )
    path_valid = bool(
        dense_metrics["out_of_bounds_count"] == 0
        and sparse_metrics["out_of_bounds_count"] == 0
        and dense_metrics["minimum_sdf_after_start_exemption_m"]
        >= config.validation_clearance_m
        and sparse_metrics["minimum_sdf_after_start_exemption_m"]
        >= config.validation_clearance_m
    )
    approach_valid = bool(relation_error <= 2.0e-4 and heading_norm_error <= 2.0e-4)
    metrics = {
        "start_error_m": start_error,
        "native_sparse_point_count": len(plan.native_root.frame_indices),
        "dense_path_minimum_sdf_m": dense_metrics["minimum_sdf_m"],
        "dense_path_minimum_sdf_after_start_exemption_m": dense_metrics[
            "minimum_sdf_after_start_exemption_m"
        ],
        "dense_path_oob_count": dense_metrics["out_of_bounds_count"],
        "sparse_linear_path_minimum_sdf_m": sparse_metrics["minimum_sdf_m"],
        "sparse_linear_path_minimum_sdf_after_start_exemption_m": sparse_metrics[
            "minimum_sdf_after_start_exemption_m"
        ],
        "sparse_linear_path_oob_count": sparse_metrics["out_of_bounds_count"],
        "endpoint_sdf_m": endpoint.endpoint_sdf_m,
        "interaction_endpoint_relation_error_m": relation_error,
        "approach_heading_norm_error": heading_norm_error,
        "region_valid": region_inside,
        "endpoint_valid": endpoint_valid,
        "path_valid": path_valid,
        "approach_valid": approach_valid,
        "validator_source_fields": VALIDATOR_SOURCE_FIELDS,
        "no_task_start_only": False,
    }
    if not region_inside:
        if _has_next_region(pool, cursor):
            return base.FailureAbstraction(
                region_invalid=True, details=("interaction region geometry invalid",)
            ), metrics
        return base.FailureAbstraction(
            unrecoverable=True, region_invalid=True, details=("all regions invalid",)
        ), metrics
    if not approach_valid:
        return _advance_direction_failure(pool, cursor, "approach geometry invalid"), metrics
    if not endpoint_valid:
        return _advance_direction_failure(pool, cursor, "terminal root validation failed"), metrics
    if not path_valid:
        return _advance_path_failure(pool, cursor, "root path scene validation failed"), metrics
    return base.FailureAbstraction(), metrics


@dataclass(frozen=True)
class AttemptReceipt:
    attempt_index: int
    cursor: base.FeedbackCursor
    selection: CandidateSelection | None
    path_policy: PathPolicy | None
    plan: base.DiscretePlan | None
    failure: base.FailureAbstraction
    feedback_action: base.FeedbackAction
    feedback_reason: str
    metrics: Mapping[str, Any]

    def to_receipt(self) -> dict[str, Any]:
        root = self.plan.native_root.to_receipt() if self.plan is not None else None
        return {
            "schema": ATTEMPT_SCHEMA,
            "attempt_index": self.attempt_index,
            "cursor": {
                "region_revision": self.cursor.region_revision,
                "approach_revision": self.cursor.approach_revision,
                "path_revision": self.cursor.path_revision,
                "terminal_root_revision": self.cursor.terminal_root_revision,
                "body_revision": self.cursor.body_revision,
            },
            "selection": self.selection,
            "path_policy": self.path_policy,
            "plan_built": self.plan is not None,
            "failure": self.failure,
            "feedback_action": self.feedback_action,
            "feedback_reason": self.feedback_reason,
            "metrics": self.metrics,
            "native_root_interface": root,
            "target_path_passed_to_model": False if root is None else root["target_path_passed_to_model"],
            "first_heading_angle": None,
            "gt_used": False,
        }


@dataclass(frozen=True)
class SampleFeedbackResult:
    sample_id: str
    pool: FixedCandidatePool
    attempts: tuple[AttemptReceipt, ...]
    initial_success: bool
    final_success: bool
    recovered_success: bool
    still_failed: bool

    def to_receipt(self) -> dict[str, Any]:
        return {
            "sample_id": self.sample_id,
            "pool": self.pool,
            "attempt_count": len(self.attempts),
            "initial_success": self.initial_success,
            "final_success": self.final_success,
            "recovered_success": self.recovered_success,
            "still_failed": self.still_failed,
            "final_action": self.attempts[-1].feedback_action,
            "attempts": self.attempts,
            "strict_generation_inputs": base.ALLOWED_GENERATION_INPUTS,
            "forbidden_generation_inputs": FORBIDDEN_GENERATION_INPUTS,
            "gt_used": False,
        }


def run_sample_feedback(
    sealed: base.SealedPlannerInput,
    config: ReplannerConfig = ReplannerConfig(),
) -> SampleFeedbackResult:
    config.validate()
    # clearance=0 computes the same raw SDF once; feedback only thresholds it.
    nav0 = base.build_navigation_grid(
        sealed.raw_scene, sealed.scene_bounds, clearance_margin_m=0.0
    )
    pool = build_fixed_candidate_pool(sealed, nav0, config)
    cursor = base.FeedbackCursor()
    router = base.FeedbackRouter()
    attempts: list[AttemptReceipt] = []
    for attempt_index in range(config.rollout_budget):
        plan, selection, policy, construction_failure = construct_plan_for_cursor(
            sealed, nav0, pool, cursor
        )
        if construction_failure is not None:
            failure = construction_failure
            metrics: Mapping[str, Any] = {
                "validator_source_fields": VALIDATOR_SOURCE_FIELDS,
                "construction_failed": True,
            }
        elif plan is None:
            raise AssertionError("constructor returned neither plan nor failure")
        else:
            failure, metrics = validate_root_plan_geometry(
                sealed, nav0, pool, cursor, plan, selection, config
            )
        decision = router.route(
            failure,
            attempt_index=attempt_index,
            rollout_budget=config.rollout_budget,
        )
        attempts.append(
            AttemptReceipt(
                attempt_index=attempt_index,
                cursor=cursor,
                selection=selection,
                path_policy=policy,
                plan=plan,
                failure=failure,
                feedback_action=decision.action,
                feedback_reason=decision.reason,
                metrics=metrics,
            )
        )
        if decision.action in (base.FeedbackAction.KEEP_BODY, base.FeedbackAction.STOP):
            break
        next_cursor = apply_executable_feedback_action(cursor, decision.action)
        if next_cursor == cursor:
            raise ReplannerContractError("non-terminal feedback did not mutate cursor")
        cursor = next_cursor
    if not attempts:
        raise AssertionError("feedback loop did not execute")
    initial = attempts[0].failure.success
    final = attempts[-1].failure.success
    return SampleFeedbackResult(
        sample_id=sealed.sample_id,
        pool=pool,
        attempts=tuple(attempts),
        initial_success=initial,
        final_success=final,
        recovered_success=bool(not initial and final),
        still_failed=not final,
    )


def apply_executable_feedback_action(
    cursor: base.FeedbackCursor, action: base.FeedbackAction
) -> base.FeedbackCursor:
    """Apply v1 hierarchy semantics plus a fresh path for a new endpoint.

    A terminal-root edit changes the endpoint of Dijkstra itself; retaining a
    previously exhausted high-clearance path policy would not be a genuine
    replan.  Therefore the endpoint revision increments while path revision
    returns to zero.  Other hierarchy resets match v1.
    """

    if action == base.FeedbackAction.UPDATE_TERMINAL_ROOT:
        from dataclasses import replace

        return replace(
            cursor,
            terminal_root_revision=cursor.terminal_root_revision + 1,
            path_revision=0,
            body_revision=0,
        )
    return base.apply_feedback_action(cursor, action)


def _load_seal_paths(seal_manifest: str | Path) -> tuple[Path, list[Path], dict[str, Any]]:
    manifest_path = Path(seal_manifest).expanduser().resolve()
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if payload.get("schema") != "p80_strict_causal_input_cohort_seal_v1":
        raise ReplannerContractError("wrong strict seal manifest schema")
    records = payload.get("records")
    if not isinstance(records, list) or not records:
        raise ReplannerContractError("seal manifest has no records")
    paths = []
    for row in records:
        relative = Path(str(row["input_relative_path"]))
        if relative.is_absolute() or ".." in relative.parts:
            raise ReplannerContractError("seal input path escaped cohort")
        path = (manifest_path.parent / relative).resolve()
        if not path.is_file() or base._sha256(path) != str(row["input_sha256"]):
            raise ReplannerContractError(f"sealed input hash mismatch: {path}")
        paths.append(path)
    expected_ids = [str(row["sample_id"]) for row in records]
    if expected_ids != [path.stem for path in paths]:
        raise ReplannerContractError("seal order/sample id drift")
    return manifest_path, paths, payload


def evaluate_sealed_cohort(
    seal_manifest: str | Path,
    *,
    config: ReplannerConfig = ReplannerConfig(),
) -> dict[str, Any]:
    manifest_path, paths, manifest = _load_seal_paths(seal_manifest)
    results = [
        run_sample_feedback(base.load_sealed_planner_input(path), config)
        for path in paths
    ]
    actions = Counter(
        attempt.feedback_action.value
        for result in results
        for attempt in result.attempts
    )
    initial_count = sum(result.initial_success for result in results)
    final_count = sum(result.final_success for result in results)
    recovered_count = sum(result.recovered_success for result in results)
    initially_failed = len(results) - initial_count
    still_failed = [result.sample_id for result in results if result.still_failed]
    all_interfaces = [
        attempt.plan.native_root
        for result in results
        for attempt in result.attempts
        if attempt.plan is not None
    ]
    for interface in all_interfaces:
        interface.validate()
        if interface.target_path_xz is not None or interface.first_heading_angle is not None:
            raise ReplannerContractError("native root interface contract drift")
    return {
        "schema": REPORT_SCHEMA,
        "status": "complete",
        "implementation": SCHEMA,
        "seal_manifest": str(manifest_path),
        "seal_manifest_sha256": base._sha256(manifest_path),
        "sample_id_order_sha256": manifest.get("sample_id_order_sha256"),
        "sample_count": len(results),
        "rollout_budget": config.rollout_budget,
        "candidate_pool_fixed_before_attempt_zero": True,
        "initial_success_count": initial_count,
        "initial_success_rate": initial_count / len(results),
        "initial_failure_count": initially_failed,
        "recovered_success_count": recovered_count,
        "recovered_success_rate_over_initial_failures": (
            recovered_count / initially_failed if initially_failed else 0.0
        ),
        "final_success_count": final_count,
        "final_success_rate": final_count / len(results),
        "still_failed_count": len(still_failed),
        "still_failed_sample_ids": still_failed,
        "action_counts": dict(sorted(actions.items())),
        "native_root_interface_count": len(all_interfaces),
        "native_root_contract": {
            "constraint": "Root2DConstraintSet sparse points",
            "coordinate_frame": "kimodo_canonical_start_zero",
            "target_path_xz": None,
            "first_heading_angle": None,
            "endpoint_reanchor_applied": False,
        },
        "generation_input_contract": base.ALLOWED_GENERATION_INPUTS,
        "validator_source_fields": VALIDATOR_SOURCE_FIELDS,
        "forbidden_generation_inputs": FORBIDDEN_GENERATION_INPUTS,
        "gt_used": False,
        "records": results,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    evaluate = subparsers.add_parser("evaluate")
    evaluate.add_argument("--seal-manifest", required=True)
    evaluate.add_argument("--output-json", required=True)
    evaluate.add_argument("--rollout-budget", type=int, default=8)
    evaluate.add_argument("--validation-clearance-m", type=float, default=0.14)
    evaluate.add_argument("--endpoint-clearance-m", type=float, default=0.14)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command != "evaluate":
        raise AssertionError(args.command)
    config = ReplannerConfig(
        rollout_budget=args.rollout_budget,
        validation_clearance_m=args.validation_clearance_m,
        endpoint_clearance_m=args.endpoint_clearance_m,
    )
    report = evaluate_sealed_cohort(args.seal_manifest, config=config)
    _write_json(args.output_json, report)
    print(
        json.dumps(
            {
                key: report[key]
                for key in (
                    "status",
                    "sample_count",
                    "initial_success_count",
                    "recovered_success_count",
                    "final_success_count",
                    "still_failed_count",
                    "action_counts",
                )
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
