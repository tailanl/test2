/**
 * LLM Decision Types - JSON schema + 决策上下文
 */

import type { FactionId } from '../game/naval/intel/faction-knowledge-types';
import type { PacificWarPhaseId } from '../game/naval/campaign/campaign-types';

// ========== LLMDecisionContext ==========
export interface LLMDecisionContext {
  faction: FactionId;
  turn: number;
  currentPhase?: PacificWarPhaseId;

  strategicSituation: {
    posture: 'defense' | 'raid' | 'search' | 'offensive' | 'withdraw' | 'landing_support';
    currentObjectives: string[];
    riskTolerance: 'low' | 'medium' | 'high';
  };

  ownForces: Array<{
    fleetId: string; name: string; type: string;
    position: { x: number; y: number };
    readiness: string; damageSummary: string;
    fuelState: string; ammoState: string;
    aircraftState?: string; currentMission?: string;
  }>;

  knownContacts: Array<{
    contactId: string; contactType: string;
    detectionLevel: string; confidence: string;
    estimatedClass?: string; estimatedCount?: number;
    lastKnownPosition: { x: number; y: number };
    uncertaintyRadius: number; lastDetectedTurn: number;
    detectedBy: string[];
  }>;

  knownBases: Array<{
    baseId: string; name: string; owner: string; type: string;
    level?: number; knownDamage?: number; supplyKnown?: string;
  }>;

  knownSupplyLines: Array<{
    supplyLineId: string; from: string; to: string;
    status: string; riskEstimate: string;
  }>;

  recentReports: Array<{
    turn: number; type: string; summary: string;
    facts: string[]; estimates: string[];
  }>;

  memorySummary: {
    previousPlan?: string; previousOutcome?: string;
    recurringProblems: string[]; enemyPatternEstimates: string[];
  };

  legalActionHints: string[];
  visualAssessment?: {
    assessment: string;
    bearingSummary: string;
    threatRanking: Array<{ contact: string; bearing: number; dist: number; threat: string }>;
    recommendation: string;
    model: string;
  };
}

// ========== LLMCommanderDecision ==========
export type LLMDecisionActionType =
  | 'assign_mission' | 'move_fleet' | 'launch_search' | 'launch_cap' | 'launch_strike'
  | 'shadow_contact' | 'intercept_contact' | 'withdraw_fleet' | 'repair_fleet'
  | 'protect_base' | 'protect_supply_line' | 'support_landing' | 'hold_position';

export interface LLMDecisionAction {
  type: LLMDecisionActionType;
  fleetId?: string;
  contactId?: string;
  baseId?: string;
  supplyLineId?: string;
  targetPosition?: { x: number; y: number };
  priority: number;
  reason: string;
}

export interface LLMCommanderDecision {
  assessment: string;
  intent: 'search'|'shadow'|'intercept'|'strike'|'withdraw'|'protect'|'raid'|'support_landing'|'repair'|'hold';
  confidence: 'low'|'medium'|'high';
  risk: 'low'|'medium'|'high';
  decisions: LLMDecisionAction[];
  assumptions: string[];
  informationGaps: string[];
  abortConditions: string[];
  nextReviewTurn: number;
}
