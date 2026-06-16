# Local Ollama OODA Decision System

This project uses local small Ollama models as naval commanders. The commander must not be a direct "prompt -> action" shortcut. Every AI turn should follow a compact command-staff cycle that can be inspected in traces and reports:

1. Observe: read only sanitized faction knowledge.
2. Orient: separate enemy, friendly, self, and battlefield assessments.
3. Decide: compare mission, available forces, feasible methods, quantities, and success odds.
4. Act: emit validator-safe actions that mutate game state through the executor.
5. Review: store traces, validation results, execution report, and state diff for tests/UI.

## Non-Negotiable Rules

- Use only known information in `LLMDecisionContext`; never infer hidden enemy fleets.
- The default commander provider is Ollama. DeepSeek is available only if explicitly configured.
- Automated tests for this workflow must use mock decisions or local Ollama models, not remote LLM APIs.
- Illegal actions must be rejected before executor entry.
- Every accepted action must either mutate real state or return an explicit execution failure.

## Situation Breakdown

The prompt asks the model to fill this structure before selecting actions:

- `enemy`: known contacts, confidence, uncertainty, likely threat, and information gaps.
- `friendly`: friendly bases, supply lines, existing missions, and support constraints.
- `self`: own fleet mission, damage, readiness, fuel, ammo, air group, sensors, and deck status.
- `battlefield`: weather, distance, search geometry, base distance, and tactical risk.

The model should not skip from "no contacts" directly to strike. If no reliable contact exists, the expected decisions are search, CAP, move, hold, protect, withdraw, or repair.

## Mission And Capability Review

Before deciding, the model receives deterministic `decisionFramework` support data:

- `mission.primaryTask`: the current operational task.
- `mission.constraints`: hard limits such as no hidden enemy knowledge, damaged ships, or poor weather.
- `availableOptions`: feasible action candidates produced from sanitized state.
- `availableOptions.maxQuantity`: aircraft, fighters, or other resource ceiling where known.
- `availableOptions.estimatedSuccess`: low, medium, or high, based on contact confidence, weather, readiness, and target uncertainty.

The model must echo its review in:

- `missionAnalysis`
- `availableDecisionReview`
- `courseOfActionAnalysis`
- `selectedDecisionRationale`

These fields are not used to bypass validation. They exist so UI, traces, and tests can explain why an action was selected.

## Action Selection Logic

Recommended local model decision order:

1. Identify current task: search, protect, strike, withdraw, repair, or hold.
2. Check self capability:
   - ready aircraft for search/strike
   - ready fighters for CAP
   - fuel/ammo state
   - damage and repair state
3. Check target legitimacy:
   - suspected/detected/unknown contacts cannot be struck or intercepted
   - tracked/identified/classified/confirmed contacts may be considered
4. Estimate success:
   - high certainty contact + good weather + ready air group => higher success
   - large uncertainty radius, poor weather, damage, or depleted air => lower success
5. Select the smallest useful action set for the next turn.

## Supported Actions

Implemented and executable actions:

- `assign_mission`
- `move_fleet`
- `launch_search`
- `launch_cap`
- `launch_strike`
- `shadow_contact`
- `intercept_contact`
- `withdraw_fleet`
- `repair_fleet`
- `protect_base`
- `protect_supply_line`
- `support_landing`
- `hold_position`

Validator and executor must stay exhaustive over this list.

## Local Model Guidance

Recommended models for 16 GB RAM / small local experiments:

- `qwen3.5:0.8b`: very fast, usable for simple search/hold decisions; may need JSON repair for truncated endings.
- `qwen3.5:2b`: better tactical consistency while still lightweight.

Ollama chat requests set `think: false`, temperature `0`, and a strict JSON prompt. This is important because Qwen thinking models may otherwise spend the whole response budget in `message.thinking` and return empty `message.content`.

## Test Discipline

Use these commands:

```powershell
npm test
npm run test:web-smoke
$env:WEB_SMOKE_LLM='ollama'; $env:WEB_SMOKE_MODEL='qwen3.5:0.8b'; npm run test:web-smoke
$env:WEB_SMOKE_LLM='ollama'; $env:WEB_SMOKE_MODEL='qwen3.5:2b'; npm run test:web-smoke
npm run build
```

Artifacts are saved under:

- `artifacts/web-smoke/<timestamp>/phases.json`
- `artifacts/web-smoke/<timestamp>/llm-traces.json`
- `artifacts/web-smoke/<timestamp>/report.json`
- `artifacts/web-smoke/<timestamp>/screenshot.png`
- `artifacts/web-smoke/<timestamp>/body.txt`

These files are ignored by git and are intended for iterative local debugging.

## Still Abstracted

This system is intentionally small. It does not yet model full carrier deck cycles, communication delay, replenishment convoys, operational deception, search-plane endurance, full strike package composition, landing operations, or detailed damage-control time. The current goal is a testable local commander loop, not a complete Pacific War staff simulation.
