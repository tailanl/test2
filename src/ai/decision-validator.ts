/**
 * Decision Validator - 验证 LLM 输出合法性
 * 检查战争迷雾、补给限制、舰队可用性
 */
import type { PacificStrategicDecision } from './layers/strategic-director';
import type { PacificCampaignState } from '../game/naval/campaign/campaign-types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  corrected?: PacificStrategicDecision;
}

export function validateStrategicDecision(
  decision: PacificStrategicDecision,
  state: PacificCampaignState
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Objective exists
  const obj = state.playerObjectives.find(o => o.id === decision.selectedObjectiveId);
  if (!obj) errors.push(`Objective ${decision.selectedObjectiveId} not found`);

  // 2. Region exists
  if (decision.directive.targetRegionId) {
    const region = state.regions.find(r => r.id === decision.directive.targetRegionId);
    if (!region) errors.push(`Region ${decision.directive.targetRegionId} not found`);
    if (region && region.owner === 'player' && decision.directive.intent === 'capture') {
      errors.push(`Cannot capture own region ${region.name}`);
    }
  }

  // 3. Supply line check for offensive operations
  const offensiveIntents = ['capture', 'seek_decisive_battle', 'raid'];
  if (offensiveIntents.includes(decision.directive.intent)) {
    const openSupplyLines = state.supplyLines.filter(s => s.status === 'open' && s.owner === 'player');
    if (openSupplyLines.length === 0) {
      warnings.push('No open supply lines - offensive operations may be unsustainable');
    }
    if (decision.directive.targetRegionId) {
      const regionSupply = state.supplyLines.filter(s =>
        s.status !== 'cut' && s.toBaseId && state.regions.find(r => r.id === decision.directive.targetRegionId)?.bases.some(b => b.id === s.toBaseId)
      );
      if (regionSupply.length === 0) {
        warnings.push(`Region ${decision.directive.targetRegionId} has no supply lines`);
      }
    }
  }

  // 4. Risk tolerance vs fleet readiness
  const exhaustedFleets = state.fleetReadiness.filter(r => r.readiness === 'exhausted' || r.readiness === 'repairing');
  if (exhaustedFleets.length > 0 && decision.directive.riskTolerance === 'high') {
    warnings.push(`${exhaustedFleets.length} fleets are exhausted/repairing - high risk may cause losses`);
  }

  // 5. Required intel must be satisfied
  if (decision.requiredIntel.length > 0) {
    decision.requiredIntel.forEach(item => {
      if (!state.eventLog.some(e => e.description.includes(item))) {
        warnings.push(`Intel requirement "${item}" not yet satisfied`);
      }
    });
  }

  // 6. Review turn must be in the future
  if (decision.nextReviewTurn <= state.turn) {
    errors.push(`Review turn ${decision.nextReviewTurn} must be after current turn ${state.turn}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Fallback: when LLM output is invalid, generate a safe defensive directive
 */
export function getFallbackDirective(state: PacificCampaignState): PacificStrategicDecision {
  const firstObjective = state.playerObjectives.find(o => o.status === 'active');
  return {
    assessment: 'LLM output invalid - using fallback defensive posture',
    selectedObjectiveId: firstObjective?.id || 'patrol',
    directive: {
      objectiveId: firstObjective?.id || 'patrol',
      intent: 'defend',
      riskTolerance: 'low',
      reason: 'Validator rejected LLM output - maintaining defensive posture',
    },
    assumptions: [],
    risks: ['LLM output validation failure'],
    requiredIntel: [],
    nextReviewTurn: state.turn + 3,
  };
}
