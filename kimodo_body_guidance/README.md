# Kimodo scene-guidance core primitives

This directory is a deliberately small, reviewable package extracted from the
larger local experiment tree. It contains three independent pieces:

- `root_feedback`: strict no-oracle sparse planner/replanner prototypes;
- `interaction_guidance`: IntentMotion-style contact memory and a zero-init
  ReMoGen-style MIM primitive;
- `body_pose_guidance`: joint/event residual pose refinement and
  SDF-compatible reductions.

It is not an end-to-end Kimodo integration: the package does not install Body
layer hooks, propagate key poses into continuous motion, query a scene SDF, or
run the official Kimodo sampler. Those remain explicit host responsibilities.
The next-version contract and the audited nine-root loop table are in `docs/`
and `reports/`.

## Body pose primitive

The Body module refines four host-provided semantic key poses with 88
event/joint tokens. It does not return a Root trajectory.

## Micro-holdout structure screen

The tested configuration is `JointWiseBodyPoseRefiner` with action-weighted
terminal-pose reconstruction, a frozen-base ranking loss, and externally
queried signed-distance supervision. On one scene micro holdout it produced:

| Metric | Frozen base | Refined | Gain |
|---|---:|---:|---:|
| action-weighted terminal-pose FK | 0.174546 m | 0.173924 m | +0.000623 m |
| event-pose penetration CVaR | 0.019603 m | 0.003146 m | +0.016457 m |

These numbers are a structure screen, not task-success evidence or a
full-dataset generalization claim.
The experimental joint-local `space_goal_v2` was not promoted: although its
generic pose FK was slightly lower, its action-weighted completion FK regressed
by 0.000528 m relative to the frozen base on the same holdout.

## Architecture

The model receives host-provided inference-time tensors:

- base event tokens and base local 6D rotations;
- proposal features and immutable external root features softly pooled at the
  four predicted event times;
- projected scene and text embeddings with valid masks.

It emits local-rotation and pelvis-world-Y residuals. Both residual heads are
zero initialized, so a fresh module is an identity on those outputs. It never
emits root translation or heading, but the host must still enforce ownership
of Root channels and decide whether pelvis-Y may affect Root height.

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

The callable input list is audited at import time. Adding target, label,
donor, oracle, GT, or full-path arguments fails closed.

The package does not construct the event tokens, time distribution, projected
scene/text features, FK joints, or signed-distance samples shown above. Those
are explicit host integration contracts.

## Training objectives

`objectives.py` provides three independent loss components:

1. `action_weighted_completion_loss`: action-weighted GT terminal-pose FK and
   local-rotation reconstruction (the historical function name is retained);
2. `completion_rank_loss`: requires the refined final pose to beat the frozen
   base by a configurable margin;
3. `event_space_loss`: mean penetration plus CVaR over host-supplied signed
   distances for an 85-point SMPL-X-22 body proxy.

This package builds the proxy points and reductions; it does not implement the
scene SDF query, world-FK transform, or continuous-motion collision check. SDF
and target tensors are constructed only after inference and must never enter
the refiner. The tested short-run weights were reconstruction `3.0`, rank
`1.0`, and event space `2.0`. FP32 is currently required by the audited path;
the AMP smoke produced a non-finite gradient at step zero.

Run the standalone tests with:

```bash
python -m pytest -q
```
