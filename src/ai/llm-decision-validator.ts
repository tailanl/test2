/**
 * LLM Decision Validator - 验证 LLM 输出合法性
 */

import type { LLMCommanderDecision, LLMDecisionAction, LLMDecisionContext } from './llm-decision-types';
import type { FactionKnowledgeState } from '../game/naval/intel/faction-knowledge-types';

const IMPLEMENTED_ACTIONS = new Set([
  'assign_mission', 'move_fleet', 'launch_search', 'launch_cap', 'launch_strike',
  'shadow_contact', 'intercept_contact', 'withdraw_fleet', 'repair_fleet',
  'protect_base', 'protect_supply_line', 'support_landing', 'hold_position',
]);

export function validateLLMCommanderDecision(params: {
  decision: LLMCommanderDecision;
  context: LLMDecisionContext;
  knowledge: FactionKnowledgeState;
}): {
  valid: boolean;
  acceptedActions: LLMDecisionAction[];
  rejectedActions: Array<{ action: LLMDecisionAction; reason: string }>;
  warnings: string[];
  correctedDecision?: LLMCommanderDecision;
} {
  const { decision, context, knowledge } = params;
  const rejected: Array<{ action: LLMDecisionAction; reason: string }> = [];
  const accepted: LLMDecisionAction[] = [];
  const warnings: string[] = [];
  if (!decision.situationAssessment) warnings.push('Decision missing situationAssessment OODA section');
  if (!decision.missionAnalysis) warnings.push('Decision missing missionAnalysis OODA section');
  if (!decision.availableDecisionReview || decision.availableDecisionReview.length === 0) warnings.push('Decision missing availableDecisionReview OODA section');
  if (!decision.courseOfActionAnalysis || decision.courseOfActionAnalysis.length === 0) warnings.push('Decision missing courseOfActionAnalysis OODA section');
  if (!decision.selectedDecisionRationale) warnings.push('Decision missing selectedDecisionRationale');

  const ownFleetIds = new Set(context.ownForces.map(f => f.fleetId));
  const knownContactIds = new Set(context.knownContacts.map(c => c.contactId));
  const knownBaseIds = new Set(context.knownBases.map(b => b.baseId));
  const knownSupplyLineIds = new Set(context.knownSupplyLines.map(s => s.supplyLineId));
  const allowedStrikeLevels = new Set(['classified', 'identified', 'tracked', 'confirmed']);
  const lowConfidenceLevels = new Set(['none', 'suspected', 'detected', 'unknown', 'lost']);

  function reject(action: LLMDecisionAction, reason: string): void {
    rejected.push({ action, reason });
  }

  function fleetFor(action: LLMDecisionAction) {
    return action.fleetId ? context.ownForces.find(f => f.fleetId === action.fleetId) : undefined;
  }

  function knownFleetFor(action: LLMDecisionAction) {
    return action.fleetId ? knowledge.knownOwnFleets.find(f => f.fleetId === action.fleetId) : undefined;
  }

  function carrierAirCapacity(action: LLMDecisionAction): { search: number; cap: number; strike: number; ready: number } {
    const knownFleet = knownFleetFor(action);
    if (!knownFleet) return { search: 0, cap: 0, strike: 0, ready: 0 };
    if (knownFleet.carrierAir) {
      return {
        search: knownFleet.carrierAir.maxSearchAircraft,
        cap: knownFleet.carrierAir.maxCapFighters,
        strike: knownFleet.carrierAir.maxStrikeAircraft,
        ready: knownFleet.carrierAir.readyAircraft,
      };
    }
    return knownFleet.ships.reduce((acc, ship) => {
      const air = ship.aircraft || '';
      const match = air.match(/F(\d+)\/DB(\d+)\/TB(\d+)(?:\/READY(\d+))?/);
      if (!match) return acc;
      const fighters = Number(match[1]);
      const diveBombers = Number(match[2]);
      const torpedoBombers = Number(match[3]);
      const ready = match[4] ? Number(match[4]) : fighters + diveBombers + torpedoBombers;
      return {
        search: acc.search + Math.min(ready, fighters + diveBombers),
        cap: acc.cap + Math.min(ready, fighters),
        strike: acc.strike + Math.min(ready, diveBombers + torpedoBombers),
        ready: acc.ready + ready,
      };
    }, { search: 0, cap: 0, strike: 0, ready: 0 });
  }

  for (const rawAction of decision.decisions) {
    const action = normalizeFleetReference(rawAction, context, warnings);
    let ok = true;

    if (!action.type || !IMPLEMENTED_ACTIONS.has((action as any).type)) {
      reject(action, `Unsupported or missing action type ${String((action as any).type)}`);
      ok = false;
    }

    if (!action.fleetId && action.type !== 'protect_supply_line') {
      reject(action, `${action.type} requires fleetId`);
      ok = false;
    } else if (action.fleetId && !ownFleetIds.has(action.fleetId)) {
      reject(action, `Fleet ${action.fleetId} not in own forces`);
      ok = false;
    }

    if (action.contactId && !knownContactIds.has(action.contactId)) {
      reject(action, `Contact ${action.contactId} not in known contacts`);
      ok = false;
    }

    if (action.baseId && !knownBaseIds.has(action.baseId)) {
      reject(action, `Base ${action.baseId} not known`);
      ok = false;
    }

    if (action.supplyLineId && !knownSupplyLineIds.has(action.supplyLineId)) {
      reject(action, `Supply line ${action.supplyLineId} not known`);
      ok = false;
    }

    const fleet = fleetFor(action);
    const isOffensive = action.type === 'launch_strike' || action.type === 'intercept_contact';
    if (isOffensive && fleet) {
      if (fleet.readiness === 'exhausted' || fleet.readiness === 'repairing' || fleet.damageSummary !== 'intact') {
        reject(action, `Fleet ${fleet.name} too damaged or unavailable for offensive action`);
        ok = false;
      }
      if (fleet.ammoState === 'critical') {
        reject(action, `Fleet ${fleet.name} lacks ammunition for offensive action`);
        ok = false;
      }
      if (action.type === 'launch_strike' && (fleet.aircraftState === 'depleted' || carrierAirCapacity(action).strike <= 0)) {
        reject(action, `Fleet ${fleet.name} has no usable carrier air group for strike`);
        ok = false;
      }
    }

    switch (action.type) {
      case 'assign_mission':
        if (!action.mission && !action.reason) {
          reject(action, 'assign_mission requires mission or reason');
          ok = false;
        }
        break;

      case 'move_fleet':
        if (!isValidPosition(action.targetPosition)) {
          reject(action, 'move_fleet requires targetPosition');
          ok = false;
        }
        break;

      case 'launch_search':
        if (!action.searchArea && !isValidPosition(action.targetPosition) && !action.searchArcDeg && action.headingDeg === undefined) {
          reject(action, 'launch_search requires searchArea, targetPosition, searchArcDeg, or headingDeg');
          ok = false;
        }
        if (fleet && fleet.aircraftState === 'depleted') {
          reject(action, `Fleet ${fleet.name} has depleted air group for search`);
          ok = false;
        }
        if (fleet && carrierAirCapacity(action).search <= 0) {
          reject(action, `Fleet ${fleet.name} has no ready aircraft for search`);
          ok = false;
        }
        if (fleet && action.aircraftCount !== undefined && action.aircraftCount > carrierAirCapacity(action).search) {
          reject(action, `launch_search aircraftCount ${action.aircraftCount} exceeds available search aircraft ${carrierAirCapacity(action).search}`);
          ok = false;
        }
        break;

      case 'launch_cap':
        if (fleet && fleet.aircraftState === 'depleted') {
          reject(action, `Fleet ${fleet.name} has depleted air group for CAP`);
          ok = false;
        }
        if (fleet && carrierAirCapacity(action).cap <= 0) {
          reject(action, `Fleet ${fleet.name} has no ready fighters for CAP`);
          ok = false;
        }
        if (fleet && action.aircraftCount !== undefined && action.aircraftCount > carrierAirCapacity(action).cap) {
          reject(action, `launch_cap aircraftCount ${action.aircraftCount} exceeds available fighters ${carrierAirCapacity(action).cap}`);
          ok = false;
        }
        break;

      case 'launch_strike':
      case 'intercept_contact': {
        if (!action.contactId) {
          reject(action, `${action.type} requires contactId`);
          ok = false;
          break;
        }
        const contact = context.knownContacts.find(c => c.contactId === action.contactId);
        if (!contact) {
          reject(action, `Cannot target unknown contact ${action.contactId}`);
          ok = false;
        } else if (lowConfidenceLevels.has(contact.detectionLevel) || !allowedStrikeLevels.has(contact.detectionLevel)) {
          reject(action, `Cannot ${action.type === 'launch_strike' ? 'strike' : 'intercept'} ${contact.detectionLevel} contact - need tracked/identified/classified`);
          ok = false;
        }
        if (action.type === 'launch_strike' && fleet && action.aircraftCount !== undefined && action.aircraftCount > carrierAirCapacity(action).strike) {
          reject(action, `launch_strike aircraftCount ${action.aircraftCount} exceeds available strike aircraft ${carrierAirCapacity(action).strike}`);
          ok = false;
        }
        break;
      }

      case 'shadow_contact':
        if (!action.contactId) {
          reject(action, 'shadow_contact requires contactId');
          ok = false;
        }
        break;

      case 'withdraw_fleet':
      case 'hold_position':
        break;

      case 'repair_fleet':
        if (!action.baseId) {
          reject(action, 'repair_fleet requires baseId');
          ok = false;
        }
        if (fleet && fleet.damageSummary === 'intact' && fleet.readiness !== 'repairing') {
          warnings.push(`Fleet ${fleet.name} is intact; repair_fleet will only set repair posture`);
        }
        break;

      case 'protect_base':
      case 'support_landing':
        if (!action.baseId) {
          reject(action, `${action.type} requires baseId`);
          ok = false;
        }
        break;

      case 'protect_supply_line':
        if (!action.supplyLineId) {
          reject(action, 'protect_supply_line requires supplyLineId');
          ok = false;
        }
        break;

      default: {
        const _exhaustive: never = action.type;
        reject(action, `Unsupported action type ${String(_exhaustive)}`);
        ok = false;
      }
    }

    if (ok) accepted.push(action);
  }

  return {
    valid: rejected.length === 0,
    acceptedActions: accepted,
    rejectedActions: rejected,
    warnings,
  };
}

function isValidPosition(position: LLMDecisionAction['targetPosition']): boolean {
  return !!position && Number.isFinite(position.x) && Number.isFinite(position.y);
}

function normalizeFleetReference(
  action: LLMDecisionAction,
  context: LLMDecisionContext,
  warnings: string[]
): LLMDecisionAction {
  if (!action.fleetId || context.ownForces.some(f => f.fleetId === action.fleetId)) {
    return action;
  }

  const normalized = action.fleetId.trim().toLowerCase();
  const matches = context.ownForces.filter(f =>
    f.type.toLowerCase() === normalized ||
    f.name.toLowerCase() === normalized ||
    f.name.toLowerCase().replace(/\s+/g, '_') === normalized
  );

  if (matches.length !== 1) return action;

  warnings.push(`Corrected fleetId ${action.fleetId} to ${matches[0].fleetId}`);
  return { ...action, fleetId: matches[0].fleetId };
}
