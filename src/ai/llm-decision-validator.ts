/**
 * LLM Decision Validator - 验证 LLM 输出合法性
 */

import type { LLMCommanderDecision, LLMDecisionAction, LLMDecisionContext } from './llm-decision-types';
import type { FactionKnowledgeState } from '../game/naval/intel/faction-knowledge-types';

export function validateLLMCommanderDecision(params: {
  decision: LLMCommanderDecision;
  context: LLMDecisionContext;
  knowledge: FactionKnowledgeState;
}): {
  valid: boolean;
  acceptedActions: LLMDecisionAction[];
  rejectedActions: Array<{ action: LLMDecisionAction; reason: string }>;
  correctedDecision?: LLMCommanderDecision;
} {
  const { decision, context, knowledge } = params;
  const rejected: Array<{ action: LLMDecisionAction; reason: string }> = [];
  const accepted: LLMDecisionAction[] = [];

  const ownFleetIds = new Set(context.ownForces.map(f => f.fleetId));
  const knownContactIds = new Set(context.knownContacts.map(c => c.contactId));
  const knownBaseIds = new Set(context.knownBases.map(b => b.baseId));

  for (const action of decision.decisions) {
    let ok = true;

    // Rule 1: fleetId must be own fleet
    if (action.fleetId && !ownFleetIds.has(action.fleetId)) {
      rejected.push({ action, reason: `Fleet ${action.fleetId} not in own forces` });
      ok = false;
    }

    // Rule 2: contactId must be known
    if (action.contactId && !knownContactIds.has(action.contactId)) {
      rejected.push({ action, reason: `Contact ${action.contactId} not in known contacts` });
      ok = false;
    }

    // Rule 3: strike needs sufficient intel
    if (action.type === 'launch_strike' || action.type === 'intercept_contact') {
      if (action.contactId) {
        const contact = context.knownContacts.find(c => c.contactId === action.contactId);
        if (contact && (contact.detectionLevel === 'suspected' || contact.detectionLevel === 'detected')) {
          rejected.push({ action, reason: `Cannot strike ${contact.detectionLevel} contact - need classified+` });
          ok = false;
        }
        if (!contact) {
          rejected.push({ action, reason: 'Cannot strike unknown contact' });
          ok = false;
        }
      }
      if (!action.contactId && action.type === 'launch_strike') {
        rejected.push({ action, reason: 'Strike requires contactId' });
        ok = false;
      }
    }

    // Rule 4: baseId must be known
    if ((action.type === 'protect_base' || action.type === 'support_landing') && action.baseId && !knownBaseIds.has(action.baseId)) {
      rejected.push({ action, reason: `Base ${action.baseId} not known` });
      ok = false;
    }

    // Rule 5: damaged fleet cannot attack
    if (action.type === 'launch_strike' || action.type === 'intercept_contact') {
      if (action.fleetId) {
        const fleet = context.ownForces.find(f => f.fleetId === action.fleetId);
        if (fleet && (fleet.readiness === 'exhausted' || fleet.readiness === 'repairing' || fleet.damageSummary !== 'intact')) {
          rejected.push({ action, reason: `Fleet ${fleet.name} too damaged for offensive action` });
          ok = false;
        }
      }
    }

    if (ok) accepted.push(action);
  }

  return {
    valid: rejected.length === 0,
    acceptedActions: accepted,
    rejectedActions: rejected,
  };
}
