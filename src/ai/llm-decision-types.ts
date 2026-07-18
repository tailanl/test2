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
    operation?: {
      posture: string;
      startedTurn: number;
      durationTurns?: number;
      targetContactId?: string;
      targetBaseId?: string;
      targetPosition?: { x: number; y: number };
      description: string;
      expectedEffect?: string;
    };
    navigation?: {
      status: string;
      mode?: string;
      routeSource?: string;
      destination: { x: number; y: number };
      manualWaypoints?: Array<{ x: number; y: number }>;
      nextWaypoint?: { x: number; y: number };
      etaTurns?: number;
      totalDistance?: number;
      routeRisk?: string;
      riskScore?: number;
      currentLegNote?: string;
      remainingWaypoints: number;
    };
    automation?: {
      priorities: Record<string, number>;
      lastTask?: string;
      lastTaskTurn?: number;
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
  commanderBrief?: LLMCommanderBrief;
  reconAssessment?: LLMReconAssessment;
  visualAssessment?: {
    assessment: string;
    bearingSummary: string;
    threatRanking: Array<{ contact: string; bearing: number; dist: number; threat: string }>;
    recommendation: string;
    model: string;
  };
}

export interface LLMReconAssessment {
  summary: string;
  recommendedSearches: string[];
  staleContactIds: string[];
  clouds: Array<{
    id: string;
    kind: 'search_coverage' | 'contact_probability';
    sourceId: string;
    label: string;
    center: { x: number; y: number };
    radiusX: number;
    radiusY: number;
    bearingDeg?: number;
    arcWidthDeg?: number;
    range?: number;
    probability: number;
    confidence: 'low' | 'medium' | 'high';
    freshness: number;
    risk: 'low' | 'medium' | 'high';
    recommendation: string;
    strikeWindowTurns?: number;
  }>;
}

export interface LLMCommanderBrief {
  summary: string;
  actionWritingRules: string[];
  taskCards: LLMCommanderTaskCard[];
}

export interface LLMCommanderTaskCard {
  fleetId: string;
  fleetName: string;
  priority: number;
  currentProblem: string;
  recommendedOrders: Array<{
    type: LLMDecisionActionType;
    reason: string;
    fields: {
      fleetId: string;
      contactId?: string;
      baseId?: string;
      targetPosition?: { x: number; y: number };
      headingDeg?: number;
      aircraftCount?: number;
      searchArcDeg?: { centerDeg: number; widthDeg: number; range?: number };
      navigationMode?: LLMDecisionAction['navigationMode'];
      formationType?: LLMDecisionAction['formationType'];
      durationTurns?: number;
    };
  }>;
  avoidActionTypes: LLMDecisionActionType[];
  resourceLimits: string[];
  navigationAdvice: string;
  airOpsAdvice: string;
  reviewTrigger: string;
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
  | 'protect_base' | 'protect_supply_line' | 'support_landing' | 'hold_position'
  | 'prepare_strike' | 'recover_aircraft' | 'vector_cap' | 'lay_smoke'
  | 'surface_engage' | 'launch_torpedo_attack' | 'radio_silence'
  | 'bombard_airfield' | 'replenish_at_sea' | 'run_transport';

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
  navigationMode?: 'direct' | 'safe_transit' | 'combat_approach' | 'night_dash' | 'withdrawal' | 'rendezvous';
  formationType?: 'standard_screen' | 'line_abreast' | 'circular_screen' | 'column' | 'scout_line';
  doctrine?: 'carrier_search' | 'carrier_strike' | 'surface_night_attack' | 'convoy_evasion' | 'replenishment';
  timing?: 'immediate' | 'dawn' | 'dusk' | 'night' | 'after_search_confirmed';
  coordination?: string;
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
  intent: 'search'|'shadow'|'intercept'|'strike'|'withdraw'|'protect'|'raid'|'support_landing'|'repair'|'hold'|'screen'|'surface'|'bombard'|'replenish'|'transport'|'air_ops';
  confidence: 'low'|'medium'|'high';
  risk: 'low'|'medium'|'high';
  decisions: LLMDecisionAction[];
  assumptions: string[];
  informationGaps: string[];
  abortConditions: string[];
  nextReviewTurn: number;
}
