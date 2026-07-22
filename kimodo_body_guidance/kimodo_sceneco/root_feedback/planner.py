#!/usr/bin/env python3
"""P80 strict-no-GT discrete planner and hierarchical feedback contracts.

This module deliberately stops at the native Kimodo root interface.  It reads
one closed, sealed input archive containing only frame-0 root XZ, requested
duration, raw text and a hash-bound raw occupancy scene.  It then:

1. routes the task from raw text only;
2. derives geometric interaction-region candidates from the current scene;
3. keeps the interaction point separate from the collision-free approach root;
4. computes a clearance-aware Dijkstra map with explicit predecessors;
5. backtracks a dense route and compresses it to 3--6 RDP/equidistant points;
6. exposes canonical start-zero sparse Root2D points for native Kimodo.

The returned model contract always has ``target_path_xz=None`` and
``first_heading_angle=None``.  No classifier, SceneCo wrapper, GT endpoint,
GT path, GT body/contact, donor or endpoint re-anchor is used here.

The feedback controller is also intentionally model-agnostic.  Validators
produce a :class:`FailureAbstraction`; :class:`FeedbackRouter` maps that
failure to exactly one hierarchy action under a fixed rollout budget.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field, replace
from enum import Enum
import hashlib
import heapq
import json
import math
from pathlib import Path
import re
import tempfile
from typing import Any, Callable, Iterable, Mapping, Sequence

import numpy as np


SEALED_INPUT_SCHEMA = "p80_strict_no_gt_planner_input_v1"
PLAN_SCHEMA = "p80_discrete_feedback_plan_v1"
ROOT_INTERFACE_SCHEMA = "p80_native_sparse_root2d_interface_v1"

ALLOWED_GENERATION_INPUTS = (
    "frame0_root_xz",
    "duration",
    "raw_text",
    "raw_scene",
)
ALLOWED_GENERATION_INPUTS_JSON = json.dumps(
    list(ALLOWED_GENERATION_INPUTS), separators=(",", ":")
)
SEALED_INPUT_KEYS = frozenset(
    {
        "schema",
        "sample_id",
        "raw_text",
        "num_frames",
        "initial_root_xz",
        "raw_scene_path",
        "raw_scene_sha256",
        "scene_bounds",
        "allowed_generation_inputs_json",
        "source_field_access",
        "uses_gt_endpoint_condition",
        "uses_full_gt_path_guidance",
        "body_gt_used",
        "contact_gt_used",
        "donor_used",
    }
)

SOURCE_FIELD_ACCESS = (
    "sealed_frame0_root_xz+duration+raw_text+raw_scene_path_sha256_only"
)
FORBIDDEN_FALSE_FLAGS = (
    "uses_gt_endpoint_condition",
    "uses_full_gt_path_guidance",
    "body_gt_used",
    "contact_gt_used",
    "donor_used",
)

PART_NAMES = (
    "pelvis",
    "back",
    "left_shoulder",
    "right_shoulder",
    "head",
    "left_hand",
    "right_hand",
    "left_foot",
    "right_foot",
)


class PlannerContractError(RuntimeError):
    """Raised when a sealed causal input or planner output drifts."""


class NoFeasiblePlan(RuntimeError):
    """Raised when the current region/approach pool has no reachable plan."""


def _scalar(value: Any) -> Any:
    array = np.asarray(value)
    if array.shape != ():
        raise PlannerContractError(f"expected scalar, got shape {array.shape}")
    return array.item()


def _sha256(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _jsonable(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, Path):
        return str(value)
    if hasattr(value, "to_receipt"):
        return _jsonable(value.to_receipt())
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


@dataclass(frozen=True)
class RawTextRoute:
    """Task route inferred from raw text, never manifest action metadata."""

    action: str
    task_kind: str
    side: str
    body_parts: tuple[str, ...]
    interaction_required: bool


def _contains(text: str, patterns: Sequence[str]) -> bool:
    return any(re.search(pattern, text) is not None for pattern in patterns)


def parse_raw_text_route(raw_text: str) -> RawTextRoute:
    """Route terminal intent from raw text with compound-action precedence."""

    text = " ".join(str(raw_text).lower().replace("-", " ").split())
    side = "both"
    if _contains(text, (r"\bleft hand\b", r"\bwith (?:the )?left\b")):
        side = "left"
    elif _contains(text, (r"\bright hand\b", r"\bwith (?:the )?right\b")):
        side = "right"

    # Terminal interaction has priority over an earlier walking clause.
    if _contains(text, (r"\bput down\b", r"\bplace(?:s|d|ing)?\b", r"\bset down\b")):
        parts = (f"{side}_hand",) if side != "both" else ("left_hand", "right_hand")
        return RawTextRoute(
            "put_down", "hand_support_contact", side, parts, True
        )
    if _contains(text, (r"\bpick up\b", r"\bpick(?:s|ed|ing)?\b", r"\bgrasp(?:s|ed|ing)?\b")):
        parts = (f"{side}_hand",) if side != "both" else ("left_hand", "right_hand")
        return RawTextRoute("pick_up", "hand_grasp_contact", side, parts, True)
    if _contains(
        text,
        (
            r"\bturn on\b",
            r"\bturn off\b",
            r"\bopen\b",
            r"\bclose\b",
            r"\btype\b",
            r"\bpress\b",
            r"\btouch\b",
        ),
    ):
        parts = (f"{side}_hand",) if side != "both" else ("left_hand", "right_hand")
        return RawTextRoute("hand_interact", "hand_object_contact", side, parts, True)
    if _contains(text, (r"\bsit down\b", r"\bsit(?:s|ting)?\b", r"\bseated\b")) and not _contains(
        text, (r"\bget up\b", r"\bstand up\b")
    ):
        return RawTextRoute("sit", "seat_support_contact", side, ("pelvis",), True)
    if _contains(text, (r"\blie\b", r"\blying\b", r"\blay down\b")) and not _contains(
        text, (r"\bget up\b", r"\bstand up\b")
    ):
        return RawTextRoute(
            "lie",
            "body_support_contact",
            side,
            ("pelvis", "back", "left_shoulder", "right_shoulder"),
            True,
        )
    if _contains(text, (r"\bwalk\b", r"\bmove\b", r"\bgo\b")):
        return RawTextRoute("walk", "no_task_interaction", side, (), False)
    return RawTextRoute("none", "no_task_interaction", side, (), False)


@dataclass(frozen=True)
class SealedPlannerInput:
    sample_id: str
    raw_text: str
    num_frames: int
    initial_root_xz: np.ndarray
    raw_scene_path: Path
    raw_scene_sha256: str
    scene_bounds: np.ndarray
    raw_scene: np.ndarray

    def to_receipt(self) -> dict[str, Any]:
        return {
            "schema": SEALED_INPUT_SCHEMA,
            "sample_id": self.sample_id,
            "raw_text": self.raw_text,
            "num_frames": self.num_frames,
            "initial_root_xz": self.initial_root_xz,
            "raw_scene_path": self.raw_scene_path,
            "raw_scene_sha256": self.raw_scene_sha256,
            "scene_bounds": self.scene_bounds,
            "allowed_generation_inputs": ALLOWED_GENERATION_INPUTS,
            "source_field_access": SOURCE_FIELD_ACCESS,
            "uses_gt_endpoint_condition": False,
            "uses_full_gt_path_guidance": False,
            "body_gt_used": False,
            "contact_gt_used": False,
            "donor_used": False,
        }


def make_sealed_input_payload(
    *,
    sample_id: str,
    raw_text: str,
    num_frames: int,
    initial_root_xz: Sequence[float],
    raw_scene_path: str | Path,
    scene_bounds: np.ndarray,
) -> dict[str, np.ndarray]:
    """Create the exact closed archive payload from already permitted values."""

    scene_path = Path(raw_scene_path).expanduser().resolve()
    if not scene_path.is_file():
        raise FileNotFoundError(scene_path)
    initial = np.asarray(initial_root_xz, dtype=np.float32)
    if initial.shape != (2,) or not np.isfinite(initial).all():
        raise PlannerContractError("initial_root_xz must be finite [2]")
    if int(num_frames) < 3:
        raise PlannerContractError("num_frames must be >=3")
    supplied_bounds = np.asarray(scene_bounds, dtype=np.float32)
    if (
        supplied_bounds.shape != (2, 3)
        or not np.isfinite(supplied_bounds).all()
        or not np.all(supplied_bounds[1] > supplied_bounds[0])
    ):
        raise PlannerContractError("scene_bounds must be finite increasing [2,3]")
    payload: dict[str, Any] = {
        "schema": SEALED_INPUT_SCHEMA,
        "sample_id": str(sample_id),
        "raw_text": str(raw_text),
        "num_frames": np.int64(num_frames),
        "initial_root_xz": initial,
        "raw_scene_path": str(scene_path),
        "raw_scene_sha256": _sha256(scene_path),
        "scene_bounds": supplied_bounds,
        "allowed_generation_inputs_json": ALLOWED_GENERATION_INPUTS_JSON,
        "source_field_access": SOURCE_FIELD_ACCESS,
        "uses_gt_endpoint_condition": np.bool_(False),
        "uses_full_gt_path_guidance": np.bool_(False),
        "body_gt_used": np.bool_(False),
        "contact_gt_used": np.bool_(False),
        "donor_used": np.bool_(False),
    }
    arrays = {key: np.asarray(value) for key, value in payload.items()}
    if set(arrays) != SEALED_INPUT_KEYS:
        raise AssertionError("internal sealed input schema drift")
    return arrays


def load_sealed_planner_input(path: str | Path) -> SealedPlannerInput:
    """Load and preflight a strict no-GT planner archive before scene access."""

    archive_path = Path(path).expanduser().resolve()
    with np.load(archive_path, allow_pickle=False) as payload:
        actual = set(payload.files)
        if actual != SEALED_INPUT_KEYS:
            raise PlannerContractError(
                "sealed input schema mismatch; "
                f"missing={sorted(SEALED_INPUT_KEYS-actual)} "
                f"extra={sorted(actual-SEALED_INPUT_KEYS)}"
            )
        if str(_scalar(payload["schema"])) != SEALED_INPUT_SCHEMA:
            raise PlannerContractError("wrong sealed planner schema")
        if str(_scalar(payload["allowed_generation_inputs_json"])) != ALLOWED_GENERATION_INPUTS_JSON:
            raise PlannerContractError("allowed generation input contract drifted")
        if str(_scalar(payload["source_field_access"])) != SOURCE_FIELD_ACCESS:
            raise PlannerContractError("source field access contract drifted")
        for key in FORBIDDEN_FALSE_FLAGS:
            if bool(_scalar(payload[key])):
                raise PlannerContractError(f"forbidden generation flag true: {key}")
        sample_id = str(_scalar(payload["sample_id"]))
        raw_text = str(_scalar(payload["raw_text"]))
        num_frames = int(_scalar(payload["num_frames"]))
        initial = np.asarray(payload["initial_root_xz"], dtype=np.float32).copy()
        raw_scene_value = str(_scalar(payload["raw_scene_path"]))
        scene_hash = str(_scalar(payload["raw_scene_sha256"]))
        bounds = np.asarray(payload["scene_bounds"], dtype=np.float32).copy()

    if not sample_id or not raw_text:
        raise PlannerContractError("sample_id and raw_text must be non-empty")
    if num_frames < 3:
        raise PlannerContractError("sealed duration must be >=3")
    if initial.shape != (2,) or not np.isfinite(initial).all():
        raise PlannerContractError("sealed frame0 root must be finite [2]")
    if (
        bounds.shape != (2, 3)
        or not np.isfinite(bounds).all()
        or not np.all(bounds[1] > bounds[0])
    ):
        raise PlannerContractError("sealed scene bounds are invalid")
    raw_scene_path = Path(raw_scene_value).expanduser()
    if not raw_scene_path.is_absolute():
        raw_scene_path = (archive_path.parent / raw_scene_path).resolve()
    else:
        raw_scene_path = raw_scene_path.resolve()
    if not raw_scene_path.is_file():
        raise PlannerContractError(f"raw scene missing: {raw_scene_path}")
    measured_hash = _sha256(raw_scene_path)
    if len(scene_hash) != 64 or measured_hash != scene_hash:
        raise PlannerContractError("raw scene SHA256 mismatch")
    raw_scene = np.load(raw_scene_path, allow_pickle=False)
    if raw_scene.ndim != 3 or raw_scene.size == 0 or not np.isfinite(raw_scene).all():
        raise PlannerContractError(f"raw scene must be a finite 3D occupancy, got {raw_scene.shape}")
    raw_scene = np.asarray(raw_scene > 0.5, dtype=bool)
    return SealedPlannerInput(
        sample_id=sample_id,
        raw_text=raw_text,
        num_frames=num_frames,
        initial_root_xz=initial,
        raw_scene_path=raw_scene_path,
        raw_scene_sha256=scene_hash,
        scene_bounds=bounds,
        raw_scene=raw_scene,
    )


def infer_scene_metric_bounds(shape: Sequence[int]) -> np.ndarray:
    """Match the existing LINGO/Agent0 raw-scene metric convention."""

    values = tuple(int(value) for value in shape)
    if len(values) != 3 or min(values) <= 0:
        raise PlannerContractError(f"invalid raw-scene shape: {values}")
    nx, ny, nz = values
    if values == (300, 100, 400):
        return np.asarray([[-3.0, 0.0, -4.0], [3.0, 2.0, 4.0]], dtype=np.float32)
    if values == (400, 100, 600):
        return np.asarray([[-4.0, 0.0, -6.0], [4.0, 2.0, 6.0]], dtype=np.float32)
    voxel_size_m = 0.02
    return np.asarray(
        [
            [-nx * voxel_size_m / 2.0, 0.0, -nz * voxel_size_m / 2.0],
            [nx * voxel_size_m / 2.0, ny * voxel_size_m, nz * voxel_size_m / 2.0],
        ],
        dtype=np.float32,
    )


@dataclass(frozen=True)
class NavigationGrid:
    occupied: np.ndarray
    free: np.ndarray
    sdf_m: np.ndarray
    bounds: np.ndarray
    resolution_xz: tuple[float, float]
    clearance_margin_m: float


def build_navigation_grid(
    raw_scene: np.ndarray,
    scene_bounds: np.ndarray,
    *,
    clearance_margin_m: float = 0.12,
    floor_ignore_height_m: float = 0.08,
    maximum_body_height_m: float = 1.8,
) -> NavigationGrid:
    """Collapse causal occupancy into a metric XZ free-space/SDF grid."""

    from scipy.ndimage import distance_transform_edt

    scene = np.asarray(raw_scene, dtype=bool)
    bounds = np.asarray(scene_bounds, dtype=np.float32)
    if scene.ndim != 3 or bounds.shape != (2, 3):
        raise PlannerContractError("navigation input shape mismatch")
    nx, ny, nz = scene.shape
    extent = bounds[1] - bounds[0]
    resolution = extent / np.asarray([nx, ny, nz], dtype=np.float32)
    y_centers = bounds[0, 1] + (np.arange(ny, dtype=np.float32) + 0.5) * resolution[1]
    y_mask = (y_centers >= float(floor_ignore_height_m)) & (
        y_centers <= min(float(maximum_body_height_m), float(bounds[1, 1]))
    )
    if not bool(y_mask.any()):
        raise PlannerContractError("navigation height slice is empty")
    occupied = scene[:, y_mask, :].any(axis=1)
    sampling = (float(resolution[0]), float(resolution[2]))
    free_distance = distance_transform_edt(~occupied, sampling=sampling).astype(np.float32)
    inside_distance = distance_transform_edt(occupied, sampling=sampling).astype(np.float32)
    sdf = free_distance - inside_distance
    free = np.isfinite(sdf) & (sdf >= float(clearance_margin_m))
    return NavigationGrid(
        occupied=occupied,
        free=free,
        sdf_m=sdf.astype(np.float32),
        bounds=bounds,
        resolution_xz=sampling,
        clearance_margin_m=float(clearance_margin_m),
    )


def world_to_grid(xz: Sequence[float], nav: NavigationGrid) -> tuple[int, int, bool]:
    x, z = map(float, np.asarray(xz, dtype=np.float32).reshape(2))
    nx, nz = nav.free.shape
    x0, z0 = float(nav.bounds[0, 0]), float(nav.bounds[0, 2])
    x1, z1 = float(nav.bounds[1, 0]), float(nav.bounds[1, 2])
    ix = int(math.floor((x - x0) / max(x1 - x0, 1.0e-8) * nx))
    iz = int(math.floor((z - z0) / max(z1 - z0, 1.0e-8) * nz))
    return ix, iz, bool(0 <= ix < nx and 0 <= iz < nz)


def grid_to_world(index: Sequence[int], nav: NavigationGrid) -> np.ndarray:
    ix, iz = map(int, index)
    dx, dz = nav.resolution_xz
    return np.asarray(
        [
            float(nav.bounds[0, 0]) + (ix + 0.5) * dx,
            float(nav.bounds[0, 2]) + (iz + 0.5) * dz,
        ],
        dtype=np.float32,
    )


@dataclass(frozen=True)
class DijkstraResult:
    distances_m: np.ndarray
    predecessor: np.ndarray
    start_index: tuple[int, int]
    start_originally_free: bool


def dijkstra_with_predecessor(
    nav: NavigationGrid,
    start_xz: Sequence[float],
) -> DijkstraResult:
    """Compute 8-neighbour metric distances and retain every predecessor."""

    ix, iz, inside = world_to_grid(start_xz, nav)
    if not inside:
        raise NoFeasiblePlan("initial root is outside the raw scene")
    free = np.asarray(nav.free, dtype=bool).copy()
    start_originally_free = bool(free[ix, iz])
    # Keep the measured start fixed.  Only its own cell is opened so a root on
    # a discretization boundary can leave; no neighbouring obstacle is erased.
    free[ix, iz] = True
    nx, nz = free.shape
    distances = np.full((nx, nz), np.inf, dtype=np.float64)
    predecessor = np.full((nx, nz, 2), -1, dtype=np.int32)
    distances[ix, iz] = 0.0
    predecessor[ix, iz] = (ix, iz)
    dx, dz = nav.resolution_xz
    neighbours = (
        (-1, 0, dx),
        (1, 0, dx),
        (0, -1, dz),
        (0, 1, dz),
        (-1, -1, math.hypot(dx, dz)),
        (-1, 1, math.hypot(dx, dz)),
        (1, -1, math.hypot(dx, dz)),
        (1, 1, math.hypot(dx, dz)),
    )
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
    return DijkstraResult(
        distances_m=distances,
        predecessor=predecessor,
        start_index=(ix, iz),
        start_originally_free=start_originally_free,
    )


def backtrack_grid_path(
    result: DijkstraResult,
    goal_index: Sequence[int],
) -> np.ndarray:
    """Backtrack a finite Dijkstra goal to the exact start grid index."""

    goal = tuple(map(int, goal_index))
    nx, nz = result.distances_m.shape
    if not (0 <= goal[0] < nx and 0 <= goal[1] < nz):
        raise NoFeasiblePlan("goal grid index is out of bounds")
    if not math.isfinite(float(result.distances_m[goal])):
        raise NoFeasiblePlan("goal has no clearance path")
    current = goal
    reversed_path = [current]
    maximum = nx * nz + 1
    for _ in range(maximum):
        if current == result.start_index:
            break
        previous = tuple(map(int, result.predecessor[current]))
        if previous[0] < 0 or previous[1] < 0 or previous == current:
            raise PlannerContractError("broken Dijkstra predecessor chain")
        reversed_path.append(previous)
        current = previous
    else:
        raise PlannerContractError("Dijkstra predecessor cycle detected")
    reversed_path.reverse()
    path = np.asarray(reversed_path, dtype=np.int32)
    if tuple(path[0]) != result.start_index or tuple(path[-1]) != goal:
        raise PlannerContractError("backtracked path endpoints drifted")
    return path


def _point_segment_distance(point: np.ndarray, start: np.ndarray, end: np.ndarray) -> float:
    delta = end - start
    norm2 = float(np.dot(delta, delta))
    if norm2 <= 1.0e-12:
        return float(np.linalg.norm(point - start))
    amount = float(np.clip(np.dot(point - start, delta) / norm2, 0.0, 1.0))
    return float(np.linalg.norm(point - (start + amount * delta)))


def rdp_simplify(points: np.ndarray, epsilon_m: float) -> np.ndarray:
    """Ramer-Douglas-Peucker simplification with endpoint preservation."""

    path = np.asarray(points, dtype=np.float32)
    if path.ndim != 2 or path.shape[1] != 2 or len(path) == 0:
        raise PlannerContractError("RDP path must be non-empty [N,2]")
    if len(path) <= 2:
        return path.copy()
    distances = np.asarray(
        [_point_segment_distance(point, path[0], path[-1]) for point in path[1:-1]],
        dtype=np.float32,
    )
    local_index = int(np.argmax(distances))
    maximum = float(distances[local_index])
    if maximum <= float(epsilon_m):
        return np.stack((path[0], path[-1])).astype(np.float32)
    split = local_index + 1
    left = rdp_simplify(path[: split + 1], epsilon_m)
    right = rdp_simplify(path[split:], epsilon_m)
    return np.concatenate((left[:-1], right), axis=0).astype(np.float32)


def equidistant_resample(points: np.ndarray, count: int) -> np.ndarray:
    path = np.asarray(points, dtype=np.float32)
    if path.ndim != 2 or path.shape[1] != 2 or len(path) == 0:
        raise PlannerContractError("resample path must be non-empty [N,2]")
    if int(count) < 1:
        raise PlannerContractError("resample count must be positive")
    if len(path) == 1:
        return np.repeat(path, int(count), axis=0)
    segment = np.linalg.norm(np.diff(path, axis=0), axis=1)
    cumulative = np.concatenate((np.zeros(1, dtype=np.float32), np.cumsum(segment)))
    total = float(cumulative[-1])
    if total <= 1.0e-8:
        return np.repeat(path[:1], int(count), axis=0)
    query = np.linspace(0.0, total, int(count), dtype=np.float32)
    output = np.zeros((int(count), 2), dtype=np.float32)
    output[:, 0] = np.interp(query, cumulative, path[:, 0])
    output[:, 1] = np.interp(query, cumulative, path[:, 1])
    output[0] = path[0]
    output[-1] = path[-1]
    return output


def sparse_waypoints_from_path(
    dense_path_world_xz: np.ndarray,
    num_frames: int,
    *,
    rdp_epsilon_m: float = 0.10,
    desired_spacing_m: float = 0.75,
    minimum_points: int = 3,
    maximum_points: int = 6,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return RDP path, 3--6 equidistant waypoints and causal frame indices."""

    if not (3 <= int(minimum_points) <= int(maximum_points) <= 6):
        raise PlannerContractError("waypoint bounds must satisfy 3<=min<=max<=6")
    if int(num_frames) < int(minimum_points):
        raise PlannerContractError("duration is too short for sparse waypoints")
    dense = np.asarray(dense_path_world_xz, dtype=np.float32)
    simplified = rdp_simplify(dense, float(rdp_epsilon_m))
    total = float(np.linalg.norm(np.diff(simplified, axis=0), axis=1).sum()) if len(simplified) > 1 else 0.0
    count = int(math.ceil(total / max(float(desired_spacing_m), 1.0e-6))) + 1
    count = max(int(minimum_points), min(int(maximum_points), count))
    waypoints = equidistant_resample(simplified, count)
    frames = np.rint(np.linspace(0, int(num_frames) - 1, count)).astype(np.int64)
    if len(np.unique(frames)) != count:
        raise PlannerContractError("duration cannot represent unique waypoint frames")
    frames[0] = 0
    frames[-1] = int(num_frames) - 1
    return simplified, waypoints, frames


@dataclass(frozen=True)
class InteractionPoint:
    region_index: int
    point_world: np.ndarray
    normal_world: np.ndarray
    radius_m: float
    support_area_m2: float
    geometric_score: float
    body_parts: tuple[str, ...]

    def to_receipt(self) -> dict[str, Any]:
        return {
            "region_index": self.region_index,
            "point_world": self.point_world,
            "normal_world": self.normal_world,
            "radius_m": self.radius_m,
            "support_area_m2": self.support_area_m2,
            "geometric_score": self.geometric_score,
            "body_parts": self.body_parts,
        }


@dataclass(frozen=True)
class ApproachRoot:
    region_index: int
    approach_index: int
    root_xz_world: np.ndarray
    heading_to_interaction: np.ndarray
    standoff_m: float
    endpoint_clearance_m: float
    path_length_m: float
    path_excess_ratio: float

    def to_receipt(self) -> dict[str, Any]:
        return {
            "region_index": self.region_index,
            "approach_index": self.approach_index,
            "root_xz_world": self.root_xz_world,
            "heading_to_interaction": self.heading_to_interaction,
            "standoff_m": self.standoff_m,
            "endpoint_clearance_m": self.endpoint_clearance_m,
            "path_length_m": self.path_length_m,
            "path_excess_ratio": self.path_excess_ratio,
        }


@dataclass(frozen=True)
class NativeSparseRootInterface:
    """Auditable sparse Root2D specification for the native Kimodo model."""

    sample_id: str
    frame_indices: np.ndarray
    world_points_xz: np.ndarray
    canonical_points_xz: np.ndarray
    world_start_xz: np.ndarray
    target_path_xz: None = None
    first_heading_angle: None = None
    model_source: str = "native_kimodo_load_model"
    constraint_type: str = "Root2DConstraintSet"
    coordinate_frame: str = "kimodo_canonical_start_zero"
    condition_start_heading_applied: bool = False
    condition_initial_pose_applied: bool = False
    endpoint_reanchor_applied: bool = False

    @property
    def initial_condition_method(self) -> str:
        if len(self.frame_indices) == 1:
            return "kimodo_constraint_lst_root2d_start"
        return "kimodo_constraint_lst_root2d_sparse_planner_waypoints"

    def validate(self) -> None:
        frames = np.asarray(self.frame_indices)
        world = np.asarray(self.world_points_xz)
        canonical = np.asarray(self.canonical_points_xz)
        start = np.asarray(self.world_start_xz)
        if frames.ndim != 1 or len(frames) == 0 or not np.issubdtype(frames.dtype, np.integer):
            raise PlannerContractError("root frame indices must be non-empty integers")
        if not np.all(np.diff(frames) > 0) or int(frames[0]) != 0:
            raise PlannerContractError("root frame indices must be strictly increasing from zero")
        if world.shape != (len(frames), 2) or canonical.shape != world.shape:
            raise PlannerContractError("root point shapes do not match frame indices")
        if start.shape != (2,) or not np.isfinite(world).all() or not np.isfinite(canonical).all():
            raise PlannerContractError("root points must be finite")
        np.testing.assert_allclose(canonical, world - start[None], atol=1.0e-6, rtol=0.0)
        np.testing.assert_allclose(canonical[0], np.zeros(2), atol=1.0e-6, rtol=0.0)
        if self.target_path_xz is not None or self.first_heading_angle is not None:
            raise PlannerContractError("native sparse root interface cannot pass path/heading")
        if self.condition_start_heading_applied or self.condition_initial_pose_applied:
            raise PlannerContractError("native sparse root interface leaked heading/body pose")
        if self.endpoint_reanchor_applied:
            raise PlannerContractError("native sparse root interface cannot re-anchor output")

    def to_model_kwargs(self, constraint_lst: Sequence[Any]) -> dict[str, Any]:
        """Return only the model kwargs whose absence/presence defines the boundary."""

        self.validate()
        return {
            "constraint_lst": list(constraint_lst),
            "target_path_xz": None,
            "first_heading_angle": None,
        }

    def materialize_constraint(
        self,
        model: Any,
        device: Any,
        constraint_class: Optional[type[Any]] = None,
    ) -> list[Any]:
        """Lazily instantiate Kimodo's native ``Root2DConstraintSet``.

        ``constraint_class`` is injectable so the causal interface can be
        tested without assuming a machine-specific sibling Kimodo checkout.
        Production callers normally leave it unset and install Kimodo as a
        regular Python package.
        """

        self.validate()
        import torch

        if constraint_class is None:
            try:
                from kimodo.constraints import Root2DConstraintSet
            except ModuleNotFoundError as exc:
                raise PlannerContractError(
                    "Kimodo is not importable; install the package or pass "
                    "constraint_class explicitly"
                ) from exc
            constraint_class = Root2DConstraintSet

        constraint = constraint_class(
            skeleton=model.skeleton,
            frame_indices=torch.from_numpy(self.frame_indices.astype(np.int64)).long().to(device),
            smooth_root_2d=torch.from_numpy(self.canonical_points_xz.astype(np.float32)).float().to(device),
            global_root_heading=None,
        )
        return [constraint]

    def to_receipt(self) -> dict[str, Any]:
        self.validate()
        return {
            "schema": ROOT_INTERFACE_SCHEMA,
            "sample_id": self.sample_id,
            "model_source": self.model_source,
            "constraint_type": self.constraint_type,
            "initial_condition_method": self.initial_condition_method,
            "frame_indices": self.frame_indices,
            "world_points_xz": self.world_points_xz,
            "canonical_points_xz": self.canonical_points_xz,
            "world_start_xz": self.world_start_xz,
            "target_path_xz": None,
            "target_path_passed_to_model": False,
            "first_heading_angle": None,
            "coordinate_frame": self.coordinate_frame,
            "world_coordinate_translation_required": True,
            "condition_start_heading_applied": self.condition_start_heading_applied,
            "condition_initial_pose_applied": self.condition_initial_pose_applied,
            "endpoint_reanchor_applied": self.endpoint_reanchor_applied,
        }


def make_native_sparse_root_interface(
    sample_id: str,
    world_start_xz: Sequence[float],
    waypoint_frames: Sequence[int],
    waypoint_world_xz: np.ndarray,
) -> NativeSparseRootInterface:
    start = np.asarray(world_start_xz, dtype=np.float32).reshape(2)
    frames = np.asarray(waypoint_frames, dtype=np.int64)
    world = np.asarray(waypoint_world_xz, dtype=np.float32)
    interface = NativeSparseRootInterface(
        sample_id=str(sample_id),
        frame_indices=frames,
        world_points_xz=world,
        canonical_points_xz=(world - start[None]).astype(np.float32),
        world_start_xz=start,
    )
    interface.validate()
    return interface


@dataclass(frozen=True)
class DiscretePlan:
    sample_id: str
    route: RawTextRoute
    interaction: InteractionPoint | None
    approach_root: ApproachRoot | None
    dense_path_world_xz: np.ndarray
    rdp_path_world_xz: np.ndarray
    sparse_waypoints_world_xz: np.ndarray
    sparse_waypoint_frames: np.ndarray
    native_root: NativeSparseRootInterface
    candidate_region_count: int
    feasible_approach_count: int
    minimum_path_clearance_m: float

    def to_receipt(self) -> dict[str, Any]:
        interaction_approach_separated = True
        if self.interaction is not None and self.approach_root is not None:
            interaction_approach_separated = bool(
                np.linalg.norm(
                    self.interaction.point_world[[0, 2]]
                    - self.approach_root.root_xz_world
                )
                > 1.0e-4
            )
        return {
            "schema": PLAN_SCHEMA,
            "sample_id": self.sample_id,
            "route": {
                "action": self.route.action,
                "task_kind": self.route.task_kind,
                "side": self.route.side,
                "body_parts": self.route.body_parts,
                "interaction_required": self.route.interaction_required,
            },
            "interaction_point": self.interaction,
            "approach_root": self.approach_root,
            "interaction_point_and_approach_root_separated": interaction_approach_separated,
            "dense_path_world_xz": self.dense_path_world_xz,
            "rdp_path_world_xz": self.rdp_path_world_xz,
            "sparse_waypoints_world_xz": self.sparse_waypoints_world_xz,
            "sparse_waypoint_frames": self.sparse_waypoint_frames,
            "candidate_region_count": self.candidate_region_count,
            "feasible_approach_count": self.feasible_approach_count,
            "minimum_path_clearance_m": self.minimum_path_clearance_m,
            "native_root_interface": self.native_root,
            "generation_input_contract": ALLOWED_GENERATION_INPUTS,
            "gt_used_in_generation": False,
            "donor_used": False,
        }


def _voxel_centers(indices: np.ndarray, shape: tuple[int, int, int], bounds: np.ndarray) -> np.ndarray:
    resolution = (bounds[1] - bounds[0]) / np.asarray(shape, dtype=np.float32)
    return bounds[0][None] + (indices.astype(np.float32) + 0.5) * resolution[None]


def _surface_mask_and_normals(scene: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return occupied boundary mask and outward six-neighbour normals."""

    occ = np.asarray(scene, dtype=bool)
    normals = np.zeros((*occ.shape, 3), dtype=np.float32)

    plus_x_empty = np.ones_like(occ)
    plus_x_empty[:-1] = ~occ[1:]
    minus_x_empty = np.ones_like(occ)
    minus_x_empty[1:] = ~occ[:-1]
    plus_y_empty = np.ones_like(occ)
    plus_y_empty[:, :-1] = ~occ[:, 1:]
    minus_y_empty = np.ones_like(occ)
    minus_y_empty[:, 1:] = ~occ[:, :-1]
    plus_z_empty = np.ones_like(occ)
    plus_z_empty[:, :, :-1] = ~occ[:, :, 1:]
    minus_z_empty = np.ones_like(occ)
    minus_z_empty[:, :, 1:] = ~occ[:, :, :-1]

    normals[..., 0] = plus_x_empty.astype(np.float32) - minus_x_empty.astype(np.float32)
    normals[..., 1] = plus_y_empty.astype(np.float32) - minus_y_empty.astype(np.float32)
    normals[..., 2] = plus_z_empty.astype(np.float32) - minus_z_empty.astype(np.float32)
    boundary = occ & (
        plus_x_empty
        | minus_x_empty
        | plus_y_empty
        | minus_y_empty
        | plus_z_empty
        | minus_z_empty
    )
    norm = np.linalg.norm(normals, axis=-1)
    boundary &= norm > 1.0e-6
    normals[boundary] /= norm[boundary, None]
    return boundary, normals


def _top_surface_mask(scene: np.ndarray) -> np.ndarray:
    occ = np.asarray(scene, dtype=bool)
    above_empty = np.ones_like(occ)
    above_empty[:, :-1] = ~occ[:, 1:]
    return occ & above_empty


def propose_interaction_points(
    sealed: SealedPlannerInput,
    route: RawTextRoute,
    *,
    patch_cell_m: float = 0.22,
    maximum_surface_points: int = 12000,
    maximum_regions: int = 64,
) -> list[InteractionPoint]:
    """Derive deterministic geometric-affordance regions from raw occupancy."""

    if not route.interaction_required:
        return []
    scene = sealed.raw_scene
    bounds = sealed.scene_bounds
    boundary, normal_grid = _surface_mask_and_normals(scene)
    top = _top_surface_mask(scene)
    indices_all = np.argwhere(boundary)
    if len(indices_all) == 0:
        return []
    points_all = _voxel_centers(indices_all, scene.shape, bounds)
    normals_all = normal_grid[tuple(indices_all.T)]
    top_all = top[tuple(indices_all.T)]

    height = points_all[:, 1]
    if route.action == "sit":
        valid = top_all & (height >= 0.24) & (height <= 0.82)
    elif route.action == "lie":
        valid = top_all & (height >= 0.20) & (height <= 0.72)
    elif route.action == "put_down":
        valid = top_all & (height >= 0.30) & (height <= 1.45)
    else:  # pick-up and generic hand interaction may use side or top surfaces.
        valid = (height >= 0.18) & (height <= 1.65)
    points = points_all[valid]
    normals = normals_all[valid]
    if len(points) == 0:
        return []
    if len(points) > int(maximum_surface_points):
        stride = int(math.ceil(len(points) / float(maximum_surface_points)))
        points = points[::stride]
        normals = normals[::stride]

    cell = max(float(patch_cell_m), 1.0e-3)
    keys = np.floor((points - bounds[0][None]) / cell).astype(np.int32)
    groups: dict[tuple[int, int, int], list[int]] = {}
    for index, key in enumerate(keys):
        groups.setdefault(tuple(map(int, key)), []).append(index)
    resolution = (bounds[1] - bounds[0]) / np.asarray(scene.shape, dtype=np.float32)
    face_area = float(max(resolution[0] * resolution[2], 1.0e-6))
    candidates: list[tuple[float, np.ndarray, np.ndarray, float, float]] = []
    for member_indices in groups.values():
        member = np.asarray(member_indices, dtype=np.int64)
        member_points = points[member]
        member_normals = normals[member]
        center = member_points.mean(axis=0).astype(np.float32)
        normal = member_normals.mean(axis=0).astype(np.float32)
        magnitude = float(np.linalg.norm(normal))
        if magnitude <= 1.0e-6:
            continue
        normal /= magnitude
        radius = float(np.linalg.norm(member_points - center[None], axis=-1).max(initial=0.0))
        radius = max(radius, 0.5 * float(max(resolution[0], resolution[2])))
        area = float(len(member) * face_area)
        distance = float(np.linalg.norm(center[[0, 2]] - sealed.initial_root_xz))
        height_bonus = 0.15 * float(np.clip(center[1] / 1.5, 0.0, 1.0))
        geometric_score = math.log1p(len(member)) + height_bonus - 0.03 * distance
        candidates.append((geometric_score, center, normal, radius, area))
    candidates.sort(
        key=lambda item: (
            -float(item[0]),
            float(np.linalg.norm(item[1][[0, 2]] - sealed.initial_root_xz)),
            float(item[1][0]),
            float(item[1][2]),
        )
    )
    output = []
    for region_index, (score, center, normal, radius, area) in enumerate(
        candidates[: int(maximum_regions)]
    ):
        output.append(
            InteractionPoint(
                region_index=region_index,
                point_world=center,
                normal_world=normal,
                radius_m=radius,
                support_area_m2=area,
                geometric_score=float(score),
                body_parts=route.body_parts,
            )
        )
    return output


def _approach_directions(normal_world: np.ndarray, count: int = 12) -> np.ndarray:
    output: list[np.ndarray] = []
    horizontal = np.asarray(normal_world, dtype=np.float32)[[0, 2]]
    magnitude = float(np.linalg.norm(horizontal))
    if magnitude > 0.20:
        output.extend((horizontal / magnitude, -horizontal / magnitude))
    for angle in np.linspace(0.0, 2.0 * np.pi, int(count), endpoint=False):
        direction = np.asarray([math.cos(float(angle)), math.sin(float(angle))], dtype=np.float32)
        if not any(float(np.dot(direction, old)) > 0.999 for old in output):
            output.append(direction)
    return np.stack(output).astype(np.float32)


def _action_standoffs(action: str) -> tuple[float, ...]:
    if action == "sit":
        return (0.28, 0.38, 0.50, 0.62, 0.74)
    if action == "lie":
        return (0.30, 0.45, 0.60, 0.75)
    return (0.32, 0.44, 0.56, 0.68, 0.80)


def _nominal_interaction_reachable(
    route: RawTextRoute,
    interaction: InteractionPoint,
    approach_xz: np.ndarray,
) -> bool:
    center = interaction.point_world
    horizontal = float(np.linalg.norm(center[[0, 2]] - approach_xz))
    if route.action == "sit":
        return bool(horizontal <= 0.78 and 0.24 <= float(center[1]) <= 0.82)
    if route.action == "lie":
        return bool(horizontal <= 0.85 and 0.20 <= float(center[1]) <= 0.72)
    # Conservative shoulder proxy; it is an affordance/reach gate, not body GT.
    shoulder = np.asarray([approach_xz[0], 1.18, approach_xz[1]], dtype=np.float32)
    return bool(np.linalg.norm(center - shoulder) <= 0.92)


@dataclass(frozen=True)
class _FeasiblePlanCandidate:
    interaction: InteractionPoint
    approach: ApproachRoot
    dense_grid_path: np.ndarray
    dense_world_path: np.ndarray
    minimum_path_clearance_m: float
    selection_key: tuple[Any, ...]


def enumerate_feasible_plan_candidates(
    sealed: SealedPlannerInput,
    route: RawTextRoute,
    nav: NavigationGrid,
    dijkstra: DijkstraResult,
    interactions: Sequence[InteractionPoint],
    *,
    direction_count: int = 12,
) -> list[_FeasiblePlanCandidate]:
    feasible: list[_FeasiblePlanCandidate] = []
    start = sealed.initial_root_xz
    for interaction in interactions:
        directions = _approach_directions(interaction.normal_world, int(direction_count))
        approach_number = 0
        for direction in directions:
            for standoff in _action_standoffs(route.action):
                approach_xz = interaction.point_world[[0, 2]] + direction * float(standoff)
                ix, iz, inside = world_to_grid(approach_xz, nav)
                if not inside or not bool(nav.free[ix, iz]):
                    approach_number += 1
                    continue
                path_length = float(dijkstra.distances_m[ix, iz])
                if not math.isfinite(path_length) or not _nominal_interaction_reachable(
                    route, interaction, approach_xz
                ):
                    approach_number += 1
                    continue
                grid_path = backtrack_grid_path(dijkstra, (ix, iz))
                world_path = np.stack([grid_to_world(index, nav) for index in grid_path])
                # Grid centers are planning discretization only.  Preserve the
                # measured start and requested approach endpoint exactly.
                world_path[0] = start
                world_path[-1] = approach_xz
                heading = interaction.point_world[[0, 2]] - approach_xz
                heading_norm = float(np.linalg.norm(heading))
                if heading_norm <= 1.0e-6:
                    approach_number += 1
                    continue
                heading = (heading / heading_norm).astype(np.float32)
                direct = float(np.linalg.norm(approach_xz - start))
                excess = path_length / max(direct, 1.0e-6)
                clearance = float(np.min(nav.sdf_m[grid_path[:, 0], grid_path[:, 1]]))
                approach = ApproachRoot(
                    region_index=interaction.region_index,
                    approach_index=approach_number,
                    root_xz_world=approach_xz.astype(np.float32),
                    heading_to_interaction=heading,
                    standoff_m=float(standoff),
                    endpoint_clearance_m=float(nav.sdf_m[ix, iz]),
                    path_length_m=path_length,
                    path_excess_ratio=excess,
                )
                key = (
                    -float(interaction.geometric_score),
                    float(excess),
                    -float(clearance),
                    float(path_length),
                    int(interaction.region_index),
                    int(approach_number),
                )
                feasible.append(
                    _FeasiblePlanCandidate(
                        interaction=interaction,
                        approach=approach,
                        dense_grid_path=grid_path,
                        dense_world_path=world_path.astype(np.float32),
                        minimum_path_clearance_m=clearance,
                        selection_key=key,
                    )
                )
                approach_number += 1
    feasible.sort(key=lambda candidate: candidate.selection_key)
    return feasible


def build_initial_discrete_plan(
    sealed: SealedPlannerInput,
    *,
    clearance_margin_m: float = 0.12,
    patch_cell_m: float = 0.22,
    maximum_regions: int = 64,
    direction_count: int = 12,
    rdp_epsilon_m: float = 0.10,
    desired_waypoint_spacing_m: float = 0.75,
) -> DiscretePlan:
    """Build one causal initial plan and its native sparse root interface."""

    route = parse_raw_text_route(sealed.raw_text)
    if not route.interaction_required:
        start = sealed.initial_root_xz.astype(np.float32)
        native = make_native_sparse_root_interface(
            sealed.sample_id, start, np.asarray([0]), start[None]
        )
        return DiscretePlan(
            sample_id=sealed.sample_id,
            route=route,
            interaction=None,
            approach_root=None,
            dense_path_world_xz=start[None],
            rdp_path_world_xz=start[None],
            sparse_waypoints_world_xz=start[None],
            sparse_waypoint_frames=np.asarray([0], dtype=np.int64),
            native_root=native,
            candidate_region_count=0,
            feasible_approach_count=0,
            minimum_path_clearance_m=float("nan"),
        )

    nav = build_navigation_grid(
        sealed.raw_scene,
        sealed.scene_bounds,
        clearance_margin_m=float(clearance_margin_m),
    )
    dijkstra = dijkstra_with_predecessor(nav, sealed.initial_root_xz)
    interactions = propose_interaction_points(
        sealed,
        route,
        patch_cell_m=float(patch_cell_m),
        maximum_regions=int(maximum_regions),
    )
    if not interactions:
        raise NoFeasiblePlan(f"{sealed.sample_id}: no geometric interaction region")
    feasible = enumerate_feasible_plan_candidates(
        sealed,
        route,
        nav,
        dijkstra,
        interactions,
        direction_count=int(direction_count),
    )
    if not feasible:
        raise NoFeasiblePlan(f"{sealed.sample_id}: no reachable approach root")
    selected = feasible[0]
    rdp_path, waypoints, frames = sparse_waypoints_from_path(
        selected.dense_world_path,
        sealed.num_frames,
        rdp_epsilon_m=float(rdp_epsilon_m),
        desired_spacing_m=float(desired_waypoint_spacing_m),
    )
    native = make_native_sparse_root_interface(
        sealed.sample_id,
        sealed.initial_root_xz,
        frames,
        waypoints,
    )
    if np.linalg.norm(
        selected.interaction.point_world[[0, 2]] - selected.approach.root_xz_world
    ) <= 1.0e-4:
        raise PlannerContractError("interaction point was collapsed into approach root")
    return DiscretePlan(
        sample_id=sealed.sample_id,
        route=route,
        interaction=selected.interaction,
        approach_root=selected.approach,
        dense_path_world_xz=selected.dense_world_path,
        rdp_path_world_xz=rdp_path,
        sparse_waypoints_world_xz=waypoints,
        sparse_waypoint_frames=frames,
        native_root=native,
        candidate_region_count=len(interactions),
        feasible_approach_count=len(feasible),
        minimum_path_clearance_m=selected.minimum_path_clearance_m,
    )


class FeedbackAction(str, Enum):
    KEEP_BODY = "KEEP_BODY"
    REGENERATE_BODY = "REGENERATE_BODY"
    UPDATE_TERMINAL_ROOT = "UPDATE_TERMINAL_ROOT"
    UPDATE_PATH = "UPDATE_PATH"
    CHANGE_APPROACH = "CHANGE_APPROACH"
    CHANGE_REGION = "CHANGE_REGION"
    STOP = "STOP"


@dataclass(frozen=True)
class FailureAbstraction:
    """Typed failure summary emitted after root/body/physics validation."""

    unrecoverable: bool = False
    region_invalid: bool = False
    approach_invalid: bool = False
    path_invalid: bool = False
    terminal_root_invalid: bool = False
    body_unreachable: bool = False
    body_invalid: bool = False
    contact_phase_invalid: bool = False
    details: tuple[str, ...] = ()

    @property
    def success(self) -> bool:
        return not any(
            (
                self.unrecoverable,
                self.region_invalid,
                self.approach_invalid,
                self.path_invalid,
                self.terminal_root_invalid,
                self.body_unreachable,
                self.body_invalid,
                self.contact_phase_invalid,
            )
        )

    def to_receipt(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "unrecoverable": self.unrecoverable,
            "region_invalid": self.region_invalid,
            "approach_invalid": self.approach_invalid,
            "path_invalid": self.path_invalid,
            "terminal_root_invalid": self.terminal_root_invalid,
            "body_unreachable": self.body_unreachable,
            "body_invalid": self.body_invalid,
            "contact_phase_invalid": self.contact_phase_invalid,
            "details": self.details,
        }

    @classmethod
    def from_metrics(
        cls,
        metrics: Mapping[str, Any],
        *,
        waypoint_error_threshold_m: float = 0.10,
        terminal_error_threshold_m: float = 0.12,
        body_reach_threshold_m: float = 0.15,
    ) -> "FailureAbstraction":
        """Convert validator metrics without consulting GT generation inputs."""

        path_collision = float(metrics.get("root_collision_or_oob_rate", 0.0)) > 0.0
        waypoint_error = float(metrics.get("root_waypoint_max_error_m", 0.0))
        terminal_error = float(metrics.get("terminal_root_error_m", 0.0))
        body_reach = float(metrics.get("body_reach_error_m", 0.0))
        details = tuple(str(item) for item in metrics.get("failure_details", ()))
        return cls(
            unrecoverable=bool(metrics.get("unrecoverable", False))
            or not bool(metrics.get("finite", True)),
            region_invalid=not bool(metrics.get("interaction_region_valid", True)),
            approach_invalid=not bool(metrics.get("approach_valid", True)),
            path_invalid=path_collision
            or waypoint_error > float(waypoint_error_threshold_m)
            or not bool(metrics.get("path_valid", True)),
            terminal_root_invalid=terminal_error > float(terminal_error_threshold_m),
            body_unreachable=body_reach > float(body_reach_threshold_m),
            body_invalid=not bool(metrics.get("body_valid", True)),
            contact_phase_invalid=not bool(metrics.get("contact_phase_valid", True)),
            details=details,
        )


@dataclass(frozen=True)
class FeedbackDecision:
    attempt_index: int
    action: FeedbackAction
    reason: str
    remaining_rollouts: int
    failure: FailureAbstraction


class FeedbackRouter:
    """Map one typed failure to the highest layer that must change."""

    def route(
        self,
        failure: FailureAbstraction,
        *,
        attempt_index: int,
        rollout_budget: int,
    ) -> FeedbackDecision:
        if int(rollout_budget) <= 0 or int(attempt_index) < 0:
            raise PlannerContractError("rollout budget/attempt index is invalid")
        remaining = max(int(rollout_budget) - int(attempt_index) - 1, 0)
        if failure.success:
            return FeedbackDecision(
                int(attempt_index), FeedbackAction.KEEP_BODY, "validation_passed", remaining, failure
            )
        if failure.unrecoverable:
            action, reason = FeedbackAction.STOP, "unrecoverable_or_nonfinite"
        elif remaining == 0:
            action, reason = FeedbackAction.STOP, "fixed_rollout_budget_exhausted"
        elif failure.region_invalid:
            action, reason = FeedbackAction.CHANGE_REGION, "interaction_region_invalid"
        elif failure.approach_invalid:
            action, reason = FeedbackAction.CHANGE_APPROACH, "approach_direction_or_standoff_invalid"
        elif failure.path_invalid:
            action, reason = FeedbackAction.UPDATE_PATH, "root_path_invalid"
        elif failure.terminal_root_invalid or failure.body_unreachable:
            action, reason = FeedbackAction.UPDATE_TERMINAL_ROOT, "terminal_root_or_body_reach_invalid"
        elif failure.body_invalid or failure.contact_phase_invalid:
            action, reason = FeedbackAction.REGENERATE_BODY, "body_sample_or_contact_phase_invalid"
        else:
            action, reason = FeedbackAction.STOP, "unclassified_failure"
        return FeedbackDecision(int(attempt_index), action, reason, remaining, failure)


@dataclass(frozen=True)
class FeedbackCursor:
    """Causal revision counters; no offline target enters a revision."""

    region_revision: int = 0
    approach_revision: int = 0
    path_revision: int = 0
    terminal_root_revision: int = 0
    body_revision: int = 0


def apply_feedback_action(cursor: FeedbackCursor, action: FeedbackAction) -> FeedbackCursor:
    if action == FeedbackAction.CHANGE_REGION:
        return replace(
            cursor,
            region_revision=cursor.region_revision + 1,
            approach_revision=0,
            path_revision=0,
            terminal_root_revision=0,
            body_revision=0,
        )
    if action == FeedbackAction.CHANGE_APPROACH:
        return replace(
            cursor,
            approach_revision=cursor.approach_revision + 1,
            path_revision=0,
            terminal_root_revision=0,
            body_revision=0,
        )
    if action == FeedbackAction.UPDATE_PATH:
        return replace(cursor, path_revision=cursor.path_revision + 1, body_revision=0)
    if action == FeedbackAction.UPDATE_TERMINAL_ROOT:
        return replace(
            cursor,
            terminal_root_revision=cursor.terminal_root_revision + 1,
            body_revision=0,
        )
    if action == FeedbackAction.REGENERATE_BODY:
        return replace(cursor, body_revision=cursor.body_revision + 1)
    if action in (FeedbackAction.KEEP_BODY, FeedbackAction.STOP):
        return cursor
    raise AssertionError(action)


@dataclass(frozen=True)
class FeedbackRunResult:
    final_cursor: FeedbackCursor
    history: tuple[FeedbackDecision, ...]

    @property
    def final_action(self) -> FeedbackAction:
        return self.history[-1].action


def run_fixed_budget_feedback(
    evaluator: Callable[[FeedbackCursor, int], FailureAbstraction],
    *,
    rollout_budget: int,
    initial_cursor: FeedbackCursor = FeedbackCursor(),
    router: FeedbackRouter | None = None,
) -> FeedbackRunResult:
    """Evaluate/mutate at most ``rollout_budget`` times, then stop deterministically."""

    budget = int(rollout_budget)
    if budget <= 0:
        raise PlannerContractError("rollout_budget must be positive")
    router = router or FeedbackRouter()
    cursor = initial_cursor
    history: list[FeedbackDecision] = []
    for attempt in range(budget):
        failure = evaluator(cursor, attempt)
        if not isinstance(failure, FailureAbstraction):
            raise PlannerContractError("feedback evaluator must return FailureAbstraction")
        decision = router.route(
            failure, attempt_index=attempt, rollout_budget=budget
        )
        history.append(decision)
        if decision.action in (FeedbackAction.KEEP_BODY, FeedbackAction.STOP):
            break
        cursor = apply_feedback_action(cursor, decision.action)
    if not history:
        raise AssertionError("feedback loop produced no decision")
    return FeedbackRunResult(cursor, tuple(history))


def _synthetic_scene(action: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Small causal occupancy used only by the contract/plumbing smoke."""

    shape = (40, 60, 40)
    bounds = infer_scene_metric_bounds(shape)
    scene = np.zeros(shape, dtype=np.uint8)
    # A partial wall requires an actual Dijkstra detour but leaves free space.
    scene[19:21, 4:55, 0:25] = 1
    if action == "sit":
        scene[27:33, 0:30, 26:32] = 1
    elif action == "pick_up":
        scene[27:30, 0:45, 27:30] = 1
    elif action == "put_down":
        scene[26:34, 0:40, 25:33] = 1
    start = np.asarray([-0.30, -0.30], dtype=np.float32)
    return scene, bounds, start


def run_synthetic_four_sample_smoke() -> list[dict[str, Any]]:
    """Round-trip four strict archives and exercise planner/root plumbing."""

    specs = (
        ("seg_00286", "walk forward", "walk", 73),
        ("seg_00302", "sit down on office chair", "sit", 177),
        ("seg_00385", "pick up guitar with left hand", "pick_up", 192),
        ("seg_01915", "put down book in left hand on chair", "put_down", 138),
    )
    summaries: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="p80_planner_smoke_") as directory:
        root = Path(directory)
        for sample_id, text, action, frames in specs:
            scene, bounds, start = _synthetic_scene(action)
            scene_path = root / f"{sample_id}_scene.npy"
            np.save(scene_path, scene, allow_pickle=False)
            sealed_path = root / f"{sample_id}.npz"
            np.savez_compressed(
                sealed_path,
                **make_sealed_input_payload(
                    sample_id=sample_id,
                    raw_text=text,
                    num_frames=frames,
                    initial_root_xz=start,
                    raw_scene_path=scene_path,
                    scene_bounds=bounds,
                ),
            )
            sealed = load_sealed_planner_input(sealed_path)
            plan = build_initial_discrete_plan(sealed)
            root_receipt = plan.native_root.to_receipt()
            summaries.append(
                {
                    "sample_id": sample_id,
                    "route_action": plan.route.action,
                    "interaction_required": plan.route.interaction_required,
                    "interaction_present": plan.interaction is not None,
                    "approach_present": plan.approach_root is not None,
                    "sparse_point_count": len(plan.sparse_waypoint_frames),
                    "target_path_passed_to_model": root_receipt[
                        "target_path_passed_to_model"
                    ],
                    "initial_condition_method": root_receipt[
                        "initial_condition_method"
                    ],
                    "status": "ok",
                }
            )
    return summaries


def plan_sealed_input_cohort(paths: Sequence[str | Path]) -> dict[str, Any]:
    """Plan every valid seal and retain causal planning failures per sample.

    A valid sealed input whose current geometry pool has no feasible region is
    a feedback event, not a process/schema failure.  It is therefore recorded
    with ``CHANGE_REGION`` while later cohort samples continue.  Contract/hash
    failures still raise immediately because generation authority is unknown.
    """

    records: list[dict[str, Any]] = []
    failures = 0
    for path in paths:
        sealed = load_sealed_planner_input(path)
        try:
            plan = build_initial_discrete_plan(sealed)
        except NoFeasiblePlan as error:
            failures += 1
            abstraction = FailureAbstraction(
                region_invalid=True,
                details=(str(error), "all_current_regions_or_approaches_exhausted"),
            )
            decision = FeedbackRouter().route(
                abstraction, attempt_index=0, rollout_budget=2
            )
            if decision.action != FeedbackAction.CHANGE_REGION:
                raise AssertionError("no-plan failure did not route to CHANGE_REGION")
            records.append(
                {
                    "schema": PLAN_SCHEMA,
                    "sample_id": sealed.sample_id,
                    "status": "planning_failed_feedback_required",
                    "failure": abstraction,
                    "feedback_action": decision.action,
                    "feedback_reason": decision.reason,
                    "generation_input_contract": ALLOWED_GENERATION_INPUTS,
                    "gt_used_in_generation": False,
                    "donor_used": False,
                }
            )
            continue
        receipt = plan.to_receipt()
        receipt["status"] = "ok"
        records.append(receipt)
    return {
        "status": "complete" if failures == 0 else "complete_with_planning_failures",
        "sample_count": len(records),
        "planned_count": len(records) - failures,
        "planning_failure_count": failures,
        "records": records,
    }


def _command_plan(paths: Sequence[str]) -> int:
    result = plan_sealed_input_cohort(paths)
    print(json.dumps(_jsonable(result), indent=2, sort_keys=True))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    smoke = subparsers.add_parser(
        "synthetic-smoke", help="run four strict no-GT synthetic plumbing samples"
    )
    smoke.set_defaults(command_name="synthetic-smoke")
    plan = subparsers.add_parser("plan", help="plan one or more sealed causal archives")
    plan.add_argument("sealed_inputs", nargs="+")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "synthetic-smoke":
        records = run_synthetic_four_sample_smoke()
        print(
            json.dumps(
                {"status": "complete", "sample_count": len(records), "records": records},
                indent=2,
                sort_keys=True,
            )
        )
        return 0
    if args.command == "plan":
        return _command_plan(args.sealed_inputs)
    raise AssertionError(args.command)


if __name__ == "__main__":
    raise SystemExit(main())
