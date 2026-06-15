/**
 * LLM Decision Debug - 情报隔离测试
 */

import { buildFactionKnowledge, sanitizeKnowledgeForLLM } from './information-filter';
import { validateLLMCommanderDecision } from './llm-decision-validator';
import type { LLMCommanderDecision, LLMDecisionContext } from './llm-decision-types';
import type { FactionKnowledgeState } from '../game/naval/intel/faction-knowledge-types';

export function debugLLMKnowledgeIsolation(): {
  hiddenEnemyExists: boolean;
  playerContacts: number;
  contextMentionsHiddenEnemy: boolean;
  illegalStrikeRejected: boolean;
  passed: boolean;
} {
  // 真实世界里有1支隐藏敌方舰队，但playerContacts=[]
  const truth = {
    turn: 1, weather: 'clear',
    playerFleets: [{
      id: 'p1', name: 'TF 16', type: 'carrier_task_force', faction: 'player',
      position: { globalX: 100, globalY: 100, regionX: 0, regionY: 0, chunkX: 0, chunkY: 0 },
      ships: [{ id: 's1', name: 'CV Enterprise', shipClass: 'fleet_carrier', position: { x: 100, y: 100 }, headingDeg: 0, speedKts: 20, damage: { status: 'combat_effective', flooding: 0, fire: 0, hullIntegrity: 100, buoyancy: 100, stability: 100, crewEfficiency: 100, speedPenalty: 0, turnPenalty: 0, sensorPenalty: 0, weaponPenalty: 0, aircraftOperationPenalty: 0 }, sensors: { radarOperational: true, sonarOperational: false, cicOperational: true, visualRange: 25, surfaceRadarRange: 30, airSearchRadarRange: 100, sonarRange: 5, nightFightingBonus: 0, airSearchBonus: 0, surfaceSearchBonus: 0, crewQuality: 'veteran' } }],
      fuelState: 'good', ammoState: 'good', mission: 'patrol',
    }],
    enemyFleets: [{
      id: 'e1', name: 'Mobile Fleet', type: 'surface_action_group', faction: 'enemy',
      position: { globalX: 500, globalY: 400, regionX: 0, regionY: 0, chunkX: 0, chunkY: 0 },
      ships: [{ id: 'e_s1', name: 'BB Yamato', shipClass: 'battleship', position: { x: 500, y: 400 }, headingDeg: 0, speedKts: 18, damage: { status: 'combat_effective', flooding: 0, fire: 0, hullIntegrity: 100, buoyancy: 100, stability: 100, crewEfficiency: 100, speedPenalty: 0, turnPenalty: 0, sensorPenalty: 0, weaponPenalty: 0, aircraftOperationPenalty: 0 }, sensors: { radarOperational: true, sonarOperational: false, cicOperational: true, visualRange: 28, surfaceRadarRange: 35, airSearchRadarRange: 100, sonarRange: 3, nightFightingBonus: 0, airSearchBonus: 0, surfaceSearchBonus: 0, crewQuality: 'veteran' } }],
      fuelState: 'good', ammoState: 'good', mission: 'intercept',
    }],
    allBases: [],
    allSupplyLines: [],
  } as any;

  const intel = { turn: 1, playerContacts: [], enemyContacts: [], knownFriendlyFleets: [], fogTiles: {}, searchMissions: [], contactReports: [] } as any;
  const knowledge = buildFactionKnowledge({ faction: 'player', truth, intel, reports: [], currentTurn: 1 });
  const context = sanitizeKnowledgeForLLM(knowledge);

  // Check context does NOT mention hidden enemy
  const ctxStr = JSON.stringify(context);
  const contextMentionsHiddenEnemy = ctxStr.includes('Yamato') || ctxStr.includes('Mobile Fleet') || ctxStr.includes('e1');

  // Try to strike hidden enemy - should be rejected
  const fakeDecision: LLMCommanderDecision = {
    assessment: 'test', intent: 'strike', confidence: 'high', risk: 'high',
    decisions: [{ type: 'launch_strike', fleetId: 'p1', contactId: 'hidden_contact', priority: 1, reason: 'test' }],
    assumptions: [], informationGaps: [], abortConditions: [], nextReviewTurn: 5,
  };

  const validation = validateLLMCommanderDecision({ decision: fakeDecision, context, knowledge });
  const illegalStrikeRejected = !validation.valid && validation.rejectedActions.length > 0;

  return {
    hiddenEnemyExists: true,
    playerContacts: 0,
    contextMentionsHiddenEnemy,
    illegalStrikeRejected,
    passed: !contextMentionsHiddenEnemy && illegalStrikeRejected,
  };
}

export function debugLLMContactBasedDecision(): {
  suspectedStrikeRejected: boolean;
  classifiedStrikeAccepted: boolean;
  passed: boolean;
} {
  // Create context with suspected contact
  const context: LLMDecisionContext = {
    faction: 'player', turn: 1,
    strategicSituation: { posture: 'search', currentObjectives: ['locate'], riskTolerance: 'medium' },
    ownForces: [{ fleetId: 'p1', name: 'TF16', type: 'carrier_task_force', position: { x: 0, y: 0 }, readiness: 'ready', damageSummary: 'intact', fuelState: 'good', ammoState: 'good' }],
    knownContacts: [
      { contactId: 'c1', contactType: 'surface_ship', detectionLevel: 'suspected', confidence: 'low', estimatedClass: 'unknown', lastKnownPosition: { x: 100, y: 100 }, uncertaintyRadius: 30, lastDetectedTurn: 1, detectedBy: ['visual'] },
      { contactId: 'c2', contactType: 'surface_ship', detectionLevel: 'classified', confidence: 'high', estimatedClass: 'battleship', lastKnownPosition: { x: 200, y: 200 }, uncertaintyRadius: 5, lastDetectedTurn: 1, detectedBy: ['visual'] },
    ],
    knownBases: [], knownSupplyLines: [], recentReports: [],
    memorySummary: { recurringProblems: [], enemyPatternEstimates: [] },
    legalActionHints: ['launch_search'],
  };

  const knowledge: FactionKnowledgeState = {
    faction: 'player', turn: 1,
    knownOwnFleets: [], knownOwnShips: [], knownContacts: [],
    knownBases: [], knownSupplyLines: [], knownAirMissions: [],
    recentReports: [], recentBattleEvents: [], assumptions: [],
  };

  // Test suspected strike - should reject
  const suspectedDecision: LLMCommanderDecision = {
    assessment: 'test', intent: 'strike', confidence: 'high', risk: 'high',
    decisions: [{ type: 'launch_strike', fleetId: 'p1', contactId: 'c1', priority: 1, reason: 'test' }],
    assumptions: [], informationGaps: [], abortConditions: [], nextReviewTurn: 5,
  };
  const v1 = validateLLMCommanderDecision({ decision: suspectedDecision, context, knowledge });
  const suspectedStrikeRejected = !v1.valid;

  // Test classified strike - should accept
  const classifiedDecision: LLMCommanderDecision = {
    assessment: 'test', intent: 'strike', confidence: 'high', risk: 'high',
    decisions: [{ type: 'launch_strike', fleetId: 'p1', contactId: 'c2', priority: 1, reason: 'test' }],
    assumptions: [], informationGaps: [], abortConditions: [], nextReviewTurn: 5,
  };
  const v2 = validateLLMCommanderDecision({ decision: classifiedDecision, context, knowledge });
  const classifiedStrikeAccepted = v2.valid;

  return { suspectedStrikeRejected, classifiedStrikeAccepted, passed: suspectedStrikeRejected && classifiedStrikeAccepted };
}
