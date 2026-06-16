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
    shipCount?: number; damagedShipCount?: number;
    carrierAir?: {
      readyAircraft: number;
      fighters: number;
      diveBombers: number;
      torpedoBombers: number;
      maxSearchAircraft: number;
      maxCapFighters: number;
      maxStrikeAircraft: number;
      deckCycleState?: string;
    };
    combatProfile?: {
      readiness: number;
      firepower: {
        antiSurface: number;
        antiAir: number;
        antiSubmarine: number;
        torpedo: number;
        aviationStrike: number;
      };
      modules: {
        mobility: number;
        sensors: number;
        command: number;
        firepower: number;
        aviation: number;
        damageControl: number;
        hull: number;
      };
    };
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
    position?: { x: number; y: number };
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
  decisionFramework?: LLMDecisionFramework;
  visualAssessment?: {
    assessment: string;
    bearingSummary: string;
    threatRanking: Array<{ contact: string; bearing: number; dist: number; threat: string }>;
    recommendation: string;
    model: string;
  };
}

export interface LLMDecisionFramework {
  mission: {
    primaryTask: string;
    secondaryTasks: string[];
    constraints: string[];
    riskTolerance: 'low' | 'medium' | 'high';
  };
  situation: {
    enemy: string;
    friendly: string;
    self: string;
    battlefield: string;
  };
  availableOptions: LLMAvailableDecisionOption[];
}

export interface LLMAvailableDecisionOption {
  actionType: LLMDecisionActionType;
  fleetId?: string;
  targetId?: string;
  method: string;
  maxQuantity?: number;
  estimatedSuccess: 'low' | 'medium' | 'high';
  constraints: string[];
  reason: string;
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
  mission?: string;
  headingDeg?: number;
  speedKts?: number;
  aircraftCount?: number;
  durationTurns?: number;
  searchArea?: { x: number; y: number; radius?: number };
  searchArcDeg?: { centerDeg: number; widthDeg: number; range?: number };
  successEstimate?: 'low' | 'medium' | 'high';
  expectedEffect?: string;
  resourceCommitment?: string;
  priority: number;
  reason: string;
}

export interface LLMCommanderDecision {
  situationAssessment?: {
    enemy: string;
    friendly: string;
    self: string;
    battlefield: string;
  };
  missionAnalysis?: {
    primaryTask: string;
    constraints: string[];
    desiredEffect: string;
    riskTolerance: 'low' | 'medium' | 'high';
  };
  availableDecisionReview?: Array<{
    actionType: string;
    feasible: boolean;
    method: string;
    quantity?: number;
    constraints: string[];
    estimatedSuccess: 'low' | 'medium' | 'high';
    reason: string;
  }>;
  courseOfActionAnalysis?: Array<{
    option: string;
    actionTypes: string[];
    successEstimate: 'low' | 'medium' | 'high';
    risk: 'low' | 'medium' | 'high';
    resourceUse: string;
    reason: string;
  }>;
  selectedDecisionRationale?: string;
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
