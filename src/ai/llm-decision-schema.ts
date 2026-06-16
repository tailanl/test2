/**
 * LLM Decision Schema - JSON prompt builder.
 */

import type { LLMDecisionContext, LLMCommanderDecision } from './llm-decision-types';

export function buildDecisionPrompt(context: LLMDecisionContext): { system: string; user: string } {
  const exampleFleetId = context.ownForces[0]?.fleetId || 'fleet_id';

  const system = `You are a Pacific naval task force commander.
Use only the known information provided below. Do not assume hidden enemy fleets exist.
If intelligence is insufficient, prefer search, shadowing, CAP, withdrawal, or holding position.
Follow an OODA staff cycle: observe known facts, orient by enemy/friendly/self/battlefield, decide from feasible options, then act.
Return strict JSON only. Do not return markdown or explanatory prose.
All fields shown as strings must be strings, not arrays or objects. Do not copy long base names; summarize counts.
Keep availableDecisionReview and courseOfActionAnalysis to 1-2 items. Always include a decisions array with at least one executable action.

JSON schema:
{
  "situationAssessment": {
    "enemy": "short string: known contacts, confidence, gaps",
    "friendly": "short string: base/support count and constraints",
    "self": "short string: own mission, damage, fuel, ammo, aircraft",
    "battlefield": "short string: weather, distance, search geometry, risk"
  },
  "missionAnalysis": {
    "primaryTask": "current task",
    "constraints": ["hard constraints from known state"],
    "desiredEffect": "what the next turn should accomplish",
    "riskTolerance": "low|medium|high"
  },
  "availableDecisionReview": [{
    "actionType": "one legal action type",
    "feasible": true,
    "method": "how to do it",
    "quantity": 4,
    "constraints": ["resource/target limit"],
    "estimatedSuccess": "low|medium|high",
    "reason": "brief reason"
  }],
  "courseOfActionAnalysis": [{
    "option": "short option name",
    "actionTypes": ["launch_search"],
    "successEstimate": "low|medium|high",
    "risk": "low|medium|high",
    "resourceUse": "aircraft/fuel/ammo/time committed",
    "reason": "why this COA is or is not best"
  }],
  "selectedDecisionRationale": "why selected actions are best now",
  "assessment": "1-2 sentence tactical assessment",
  "intent": "search|shadow|intercept|strike|withdraw|protect|raid|support_landing|repair|hold",
  "confidence": "low|medium|high",
  "risk": "low|medium|high",
  "decisions": [{
    "type": "launch_search|launch_strike|move_fleet|withdraw_fleet|intercept_contact|shadow_contact|hold_position|repair_fleet|protect_base|protect_supply_line|assign_mission|launch_cap|support_landing",
    "fleetId": "copy one exact id from YOUR FORCES, never use fleet type/name",
    "contactId": "target contact id or empty",
    "baseId": "target base id or empty",
    "targetPosition": {"x":0,"y":0},
    "mission": "patrol|search|raid|escort|invasion_support|carrier_strike|intercept|withdraw|resupply",
    "headingDeg": 270,
    "speedKts": 20,
    "aircraftCount": 4,
    "durationTurns": 2,
    "searchArea": {"x":0,"y":0,"radius":80},
    "searchArcDeg": {"centerDeg":270,"widthDeg":90,"range":160},
    "successEstimate": "low|medium|high",
    "expectedEffect": "what state or intel should improve",
    "resourceCommitment": "aircraft/fuel/ammo/time used",
    "priority": 1,
    "reason": "why"
  }],
  "assumptions": ["what you assume about enemy"],
  "informationGaps": ["what intel is missing"],
  "abortConditions": ["when to abort"],
  "nextReviewTurn": 5
}`;

  const user = `TURN ${context.turn} (${context.faction})

YOUR FORCES:
${context.ownForces.map(f => `  id:${f.fleetId} name:${f.name} type:${f.type} pos:[${f.position.x},${f.position.y}] ships:${f.shipCount ?? '?'} damaged:${f.damagedShipCount ?? 0} mission:${f.currentMission || 'unknown'} readiness:${f.readiness} damage:${f.damageSummary} fuel:${f.fuelState} ammo:${f.ammoState} air:${formatAir(f.carrierAir)}`).join('\n')}

KNOWN CONTACTS:
${context.knownContacts.length === 0 ? '  NONE' : context.knownContacts.map(c => `  [${c.detectionLevel}] ${c.estimatedClass || '?'} (${c.lastKnownPosition.x},${c.lastKnownPosition.y}) +/-${c.uncertaintyRadius} conf:${c.confidence} id:${c.contactId}`).join('\n')}

KNOWN FRIENDLY BASES:
${context.knownBases.length === 0 ? '  NONE' : context.knownBases.map(b => `  id:${b.baseId} ${b.name} type:${b.type} pos:[${b.position?.x ?? '?'},${b.position?.y ?? '?'}] supply:${b.supplyKnown || 'unknown'}`).join('\n')}

LEGAL ACTIONS: ${context.legalActionHints.join(', ')}

DECISION FRAMEWORK:
Mission: ${context.decisionFramework?.mission.primaryTask || context.strategicSituation.currentObjectives.join('; ')}
Constraints: ${(context.decisionFramework?.mission.constraints || []).join('; ') || 'none'}
Situation enemy: ${context.decisionFramework?.situation.enemy || 'unknown'}
Situation friendly: ${context.decisionFramework?.situation.friendly || 'unknown'}
Situation self: ${context.decisionFramework?.situation.self || 'unknown'}
Situation battlefield: ${context.decisionFramework?.situation.battlefield || 'unknown'}
Available options:
${(context.decisionFramework?.availableOptions || []).map(o => `  ${o.actionType} fleet:${o.fleetId || ''} target:${o.targetId || ''} method:${o.method} max:${o.maxQuantity ?? '-'} success:${o.estimatedSuccess} constraints:${o.constraints.join('|') || 'none'} reason:${o.reason}`).join('\n') || '  NONE'}

ACTION FIELD RULES:
- fleetId must exactly copy an id: value from YOUR FORCES, for example "${exampleFleetId}". Do not put fleet type like carrier_task_force in fleetId.
- launch_search requires fleetId and searchArea, targetPosition, contactId, searchArcDeg, or headingDeg; use the requested area/direction, never a fixed heading.
- move_fleet requires fleetId and targetPosition.
- launch_strike requires fleetId and a tracked/identified/classified contactId.
- repair_fleet requires fleetId and a known baseId.
- assign_mission should include mission.
- aircraftCount must not exceed the option max quantity or known ready aircraft/fighters.
- Decisions must be a short next-turn order set, not a long campaign plan.
- Do not use nested objects for situationAssessment, resourceUse, or battlefield text; use strings.
- Do not invent actionTypes like "search"; use exact values such as "launch_search".

MEMORY: ${context.memorySummary.previousOutcome || 'none'}

Return JSON decision:`;

  return { system, user };
}

export function parseLLMDecision(resp: string, defaultTurn: number = 1): LLMCommanderDecision | null {
  try {
    const m = resp.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]);
    return {
      situationAssessment: normalizeSituationAssessment(p.situationAssessment),
      missionAnalysis: normalizeMissionAnalysis(p.missionAnalysis),
      availableDecisionReview: Array.isArray(p.availableDecisionReview) ? p.availableDecisionReview : [],
      courseOfActionAnalysis: Array.isArray(p.courseOfActionAnalysis) ? p.courseOfActionAnalysis : [],
      selectedDecisionRationale: typeof p.selectedDecisionRationale === 'string' ? p.selectedDecisionRationale : undefined,
      assessment: p.assessment || '',
      intent: p.intent || 'hold',
      confidence: p.confidence || 'medium',
      risk: p.risk || 'medium',
      decisions: Array.isArray(p.decisions) ? p.decisions : [],
      assumptions: Array.isArray(p.assumptions) ? p.assumptions : [],
      informationGaps: Array.isArray(p.informationGaps) ? p.informationGaps : [],
      abortConditions: Array.isArray(p.abortConditions) ? p.abortConditions : [],
      nextReviewTurn: typeof p.nextReviewTurn === 'number' ? p.nextReviewTurn : defaultTurn + 5,
    };
  } catch {
    return null;
  }
}

function formatAir(air: LLMDecisionContext['ownForces'][number]['carrierAir']): string {
  if (!air) return 'none';
  return `ready:${air.readyAircraft} F:${air.fighters} DB:${air.diveBombers} TB:${air.torpedoBombers} searchMax:${air.maxSearchAircraft} capMax:${air.maxCapFighters} strikeMax:${air.maxStrikeAircraft} deck:${air.deckCycleState || 'unknown'}`;
}

function normalizeSituationAssessment(value: any): LLMCommanderDecision['situationAssessment'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return {
    enemy: String(value.enemy || ''),
    friendly: String(value.friendly || ''),
    self: String(value.self || ''),
    battlefield: String(value.battlefield || ''),
  };
}

function normalizeMissionAnalysis(value: any): LLMCommanderDecision['missionAnalysis'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const riskTolerance = value.riskTolerance === 'low' || value.riskTolerance === 'high' ? value.riskTolerance : 'medium';
  return {
    primaryTask: String(value.primaryTask || ''),
    constraints: Array.isArray(value.constraints) ? value.constraints.map(String) : [],
    desiredEffect: String(value.desiredEffect || ''),
    riskTolerance,
  };
}
