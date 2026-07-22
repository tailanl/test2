# P82: Sparse Root Feedback and Task-Program Body Refinement

## Audited starting point

P81 is complete but not promoted. It preserves Kimodo motion quality and all
hard locality/root contracts, but does not prove scene-specific or
task-completion improvement.

- Coarse motion health: `9/9`.
- Verb-specific body transition: `2/9`.
- Correct-scene causal-anchor interaction: `1/9`.
- Combined task completion: `1/9`.
- Task-success decisions changed versus Native: `0/9`.
- True Root out-and-return cases: `4/9`.

The P81 Body branch copies external Root `0:5` bit-exactly. Root failure must
therefore be repaired before Body generation. The fixed evaluation Root is an
E226 XYZ plus E225 heading hybrid conditioned on a GT-derived endpoint, but
not on a dense GT path. Its claim scope is a conditional-Root upper bound,
not strict end-to-end no-GT.

## Responsibility routing

| Failure | Responsible stage | Revision |
|---|---|---|
| Named object or interaction region cannot be resolved | Plan/Affordance | change region/approach or abstain |
| Root collision, OOB, loop, backtrack, path excess, terminal infeasibility | Root | edit one sparse waypoint and regenerate |
| Sit/stand/get-up Root-Y polarity is wrong | Root | resample/rank Root candidates by causal action predicate |
| Effector cannot anatomically reach the selected target | Root/Approach | move terminal approach region |
| Root is feasible but contact or terminal predicate fails | Body | refine the failed task-event windows |
| Task passes but naturalness/physics fails | Motion/Physics | resample or locally refine without changing Root |

Only one highest-level variable changes per feedback attempt. A Body failure
may return to Root at most once; the loop has a fixed budget and returns an
explicit failure instead of oscillating indefinitely.

## Root refinement

1. Generate the initial E226 Root from sparse planner conditions.
2. Evaluate geodesic progress, absolute return distance, path excess,
   self-return, footprint/SDF collision, terminal interaction reachability,
   and action-specific Root-Y polarity.
3. Locate the first failed interval `[a,b]`.
4. Preserve the interval boundaries and all accepted waypoints outside it.
5. Delete or replace one redundant point for a pure loop; insert at most one
   clearance waypoint when an obstacle requires a detour.
6. Regenerate with native sparse `Root2DConstraintSet` points.
7. Accept only if endpoint/region validity is preserved, backtrack and path
   excess improve, and collision does not worsen.

Forbidden shortcuts are dense target-path conditioning, direct continuous
Root overwrite, heading overwrite, endpoint re-anchoring, and unconditional
global smoothing. If E226 smoothing is retained, it must be segmented and
must lock every sparse waypoint frame.

The first isolated smoke uses only the four confirmed loop samples:
`seg_03356`, `seg_00552`, `seg_04379`, and `seg_01899`. Compare E224, legacy
E226, and one discrete-waypoint repair while keeping Body unchanged.

## Body task program

Replace P81's `K=1`, single-part, radius-four event with at most three sparse
events. Each event carries:

```text
action_id
phase: PRECONTACT / CONTACT / TERMINAL
relation: ATTRACT / HOLD / RELEASE
joint_group_id
object_region_id
anchor_xyz / normal / distance_band
start_time / end_time
confidence
terminal_predicate_id
```

Task programs:

| Task | Events |
|---|---|
| sit | descend -> pelvis-seat contact -> stable seated terminal |
| stand_up | seat release -> pelvis rise and leg extension -> stable standing terminal |
| get_up | support release -> torso/head rise -> stable seated terminal |
| pick | hand approach -> object contact/hold -> lift terminal |
| drink | acquire object -> hand-to-mouth -> hold near mouth |

Joint groups replace the P65 single-part masks: lower-body tasks use pelvis,
spine, both legs and feet; hand tasks use the active arm chain plus the torso
needed to reach naturally. Terminal windows include a tail hold. Frames and
features outside selected event windows remain hard-copied from Body0.

IntentMotion-style contact fields and IGCF produce event interaction memory.
ReMoGen MIM injects that memory at Kimodo Body layers `[3,7,11,15]` using a
small nonzero bounded residual scale. Correct-scene versus shuffled-scene and
correct-event versus shuffled-event losses must keep the scene branch from
collapsing to the near-zero P81 state.

ICGF uses the true FK effector-to-anchor distance:

- outside anatomical reach: return Root/Approach feedback;
- reachable but far: weak PRECONTACT attraction;
- inside the activation radius: stronger CONTACT/HOLD guidance;
- RELEASE: reverse the contact relation instead of attracting back to the
  old support surface.

Exact SDF remains joint/region and event-window gated. Intended contact parts
receive a thin contact band; other parts receive penetration repulsion. Body
SDF never attempts to repair a Root path.

## Promotion gates

Root and Body are promoted independently before integration.

Root gate:

- confirmed loop count and absolute backtrack decrease;
- path length/shortest-route ratio and total turn do not regress;
- endpoint/interaction-region validity is preserved;
- footprint collision and OOB do not worsen;
- action-specific Root-Y polarity improves.

Body gate:

- task-completion decisions improve versus the same frozen Body0;
- correct scene is better than scene shuffle;
- correct event/part is better than shuffled event/part;
- Root remains bit-exact after it passes Root validation;
- no GT body, donor, C020, GT contact, or GT path enters inference.

Do not start long training if the smoke still changes active-window joints by
only sub-millimetres, leaves task-success decisions unchanged, or performs no
better than shuffled controls.
