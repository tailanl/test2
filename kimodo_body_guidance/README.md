# Joint-wise body pose guidance

This directory contains the reusable core of the current validated body-pose
guidance configuration.  It refines Kimodo's four semantic key poses with 88
event/joint tokens while preserving the supplied root trajectory exactly.

## Current selection

The selected configuration is `JointWiseBodyPoseRefiner` with action-weighted
completion supervision, a frozen-base ranking loss, and exact-SDF body-proxy
supervision.  On the current one-scene micro holdout it produced:

| Metric | Frozen base | Refined | Gain |
|---|---:|---:|---:|
| action-weighted completion FK | 0.174546 m | 0.173924 m | +0.000623 m |
| event-pose penetration CVaR | 0.019603 m | 0.003146 m | +0.016457 m |

These numbers are a structure screen, not a full-dataset generalization claim.
The experimental joint-local `space_goal_v2` was not promoted: although its
generic pose FK was slightly lower, its action-weighted completion FK regressed
by 0.000528 m relative to the frozen base on the same holdout.

## Architecture

The model receives only inference-time tensors:

- base event tokens and base local 6D rotations;
- proposal features and immutable external root features softly pooled at the
  four predicted event times;
- projected scene and text embeddings with valid masks.

It emits local-rotation and pelvis-world-Y residuals.  Both residual heads are
zero initialized, so enabling a fresh module leaves the frozen Kimodo output
bit-exact.  It never emits root translation or heading.

```python
from kimodo_sceneco.body_pose_guidance import (
    JointWiseBodyPoseRefiner,
    soft_event_pool,
)

refiner = JointWiseBodyPoseRefiner(
    proposal_dim=273,
    root_dim=5,
    hidden_size=1024,
    num_layers=4,
)

proposal_event = soft_event_pool(proposal_norm, event_time_distribution)
root_event = soft_event_pool(external_root_norm, event_time_distribution)

result = refiner(
    base_event_tokens=event_tokens,
    base_local_rotation_6d=base_pose_6d,
    base_pelvis_world_y=base_pelvis_y,
    proposal_event_features=proposal_event,
    external_root_event=root_event,
    scene_embeddings=projected_scene,
    text_embeddings=projected_text,
    scene_valid_mask=scene_valid,
    text_valid_mask=text_valid,
)
```

The callable input list is audited at import time.  Adding target, label,
donor, oracle, GT, or full-path arguments fails closed.

## Training objectives

`objectives.py` provides three independent loss components:

1. `action_weighted_completion_loss`: final-event FK and local-rotation loss;
2. `completion_rank_loss`: requires the refined final pose to beat the frozen
   base by a configurable margin;
3. `event_space_loss`: mean penetration plus CVaR over an exact-SDF 85-point
   SMPL-X-22 body proxy.

SDF and target tensors are constructed only after model inference.  They are
loss/evaluation inputs and must never enter the refiner.  The tested short-run
weights were completion `3.0`, completion rank `1.0`, and event space `2.0`.
FP32 is currently required for the formal refiner training path; the audited
AMP smoke produced a non-finite gradient at step zero.

Run the standalone tests with:

```bash
python -m pytest -q tests/test_body_pose_guidance.py
```
