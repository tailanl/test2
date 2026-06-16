# Naval Command and Combat Model

This note documents the current playable command loop and the next realism targets.

## Decision Loop

The intended loop is:

1. Build sanitized faction knowledge from own forces, known contacts, known bases, reports, and memory.
2. Give one fleet-level LLM a single-fleet context when `fleetId` is supplied.
3. Validate every LLM or human-derived action against known information.
4. Execute accepted actions through the same store adapter.
5. Mutate game state, write battle log/report entries, and update memory/traces.
6. Ask the player for yes/no authorization when a command is high risk.

The LLM should not act as an omniscient theater commander. It should reason in OODA style:

- Observe: known contacts only, no hidden enemy truth.
- Orient: enemy, friendly, self, battlefield.
- Decide: compare feasible actions, resource quantities, success chances, and abort conditions.
- Act: issue one or more validated actions for its fleet.

## Single-Ship Combat Model

Ships have modules rather than only hit points:

- Command: bridge, CIC.
- Sensors: radar, sonar, CIC.
- Firepower: main battery, secondary battery, AA battery, torpedo tubes.
- Mobility: engine room, boiler room, rudder, propellers.
- Aviation: flight deck, hangar, catapult, elevator.
- Damage control and hull compartments.

`ship-combat-profile.ts` summarizes each ship and fleet:

- Module readiness by category.
- Firepower by domain: anti-surface, anti-air, anti-submarine, torpedo, aviation strike.
- Sensor readiness for visual, radar, sonar, and aircraft search.

Weapon firing and sensor detection now read these readiness values. For example, destroyed AA modules can disable AA fire, and damaged radar/CIC reduces radar detection range.

## Visibility and Fog of War

Enemy truth is read only by the detection/intel update layer. LLM and human command validation use:

- `intel.playerContacts`
- detection level
- confidence
- uncertainty radius
- last detected turn

Low-confidence contacts can be searched or shadowed, but not directly struck. Strike remains limited to classified/identified/tracked contacts.

## Human Command Layer

Human text commands are parsed into two kinds of orders:

- Validated LLM-style actions: search, CAP, strike, move, withdraw, hold, repair.
- Special human orders: split fleet, direct ship control, delegate AI template, fleet message.

High-risk commands such as strikes and fleet detachments create a pending authorization record with yes/no choices. Approved commands execute through the same validator/executor path.

Command examples:

- `launch search west with 4 aircraft`
- `move Task Force 16 to 2400,1100 speed 25`
- `launch CAP 6 fighters`
- `strike contact contact_enemy_1`
- `split Fletcher from Task Force 16`
- `direct Fletcher heading 270 speed 30`
- `delegate search screen`

## Fleet Communication

Fleet messages are stored as queued/delivered communication records. This is intentionally separate from global AI context. Future LLM prompts should include only messages delivered to that fleet, not all global friendly plans.

## Reports

Reports are generated for:

- Contact changes.
- Air search, CAP, strike, withdrawal, repair, and human command execution.
- Periodic situation reports every three turns.
- Critical authorization situations such as severe ship damage or high-confidence enemy contact.

## Current Limits

Still simplified:

- No full deck cycle timing or aircraft spotting queues.
- No detailed ammunition calibers by mount.
- No radio delay or command degradation by distance/weather yet.
- No logistics pipeline, replenishment schedule, or port repair capacity model.
- No full carrier strike resolution against hidden task force truth beyond existing mission/contact mechanics.
- Fleet-level LLM isolation exists through `fleetId`, but the UI still needs richer per-fleet message routing and model assignment controls.
