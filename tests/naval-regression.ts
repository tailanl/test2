import { generateStratMap } from '../src/game/naval/naval-map-generator';
import {
  campaignDecisionToActions,
  normalizeCampaignDecision,
  parseCampaignDecision,
} from '../src/ai/naval-campaign-policy';
import { runAITurnPipeline } from '../src/ai/ai-turn-pipeline';
import { createCampaignMemory } from '../src/ai/campaign-memory';
import { buildFactionKnowledge, sanitizeKnowledgeForLLM } from '../src/ai/information-filter';
import { validateLLMCommanderDecision } from '../src/ai/llm-decision-validator';
import { createShipForClass } from '../src/game/naval/naval-debug';
import { detectNavalTarget } from '../src/game/naval/intel/naval-visibility';
import { canFireNavalWeapon } from '../src/game/naval/ship/ship-weapons';
import { getShipCombatProfile, getWeaponSystemReadiness } from '../src/game/naval/ship/ship-combat-profile';
import { useNavalStore } from '../src/store/naval-store';
import type { NavalContact } from '../src/game/naval/intel/naval-intel-types';
import type { StrategicFleet } from '../src/game/naval/naval-strategic-types';
import type { LLMCommanderDecision } from '../src/ai/llm-decision-types';

declare const process: any;

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function contact(id: string, detectionLevel: NavalContact['detectionLevel'], x = 420, y = 520): NavalContact {
  return {
    id,
    originalEntityId: `${id}_ship`,
    contactType: 'surface_ship',
    detectionLevel,
    factionEstimate: 'enemy',
    estimatedClass: 'battleship',
    estimatedCount: 1,
    lastKnownPosition: { x, y },
    uncertaintyRadius: detectionLevel === 'tracked' ? 8 : 60,
    lastDetectedTurn: 1,
    confidence: detectionLevel === 'tracked' ? 'high' : 'medium',
    detectedBy: [],
    trackHistory: [],
    stale: false,
  };
}

function fleet(): StrategicFleet {
  const cv = createShipForClass('fleet_carrier', 'player', 'CV Test', 700, 500, 270, 20, 'carrier');
  return {
    id: 'tf_test',
    name: 'TF Test',
    faction: 'player',
    type: 'carrier_task_force',
    position: { regionX: 0, regionY: 0, chunkX: 0, chunkY: 0, globalX: 700, globalY: 500 },
    ships: [cv],
    command: {
      controller: 'player_direct',
      riskTolerance: 'medium',
      engagementPolicy: 'carrier_strike_only',
      preserveCapitalShips: true,
    },
    mission: 'patrol',
    fuelState: 'good',
    ammoState: 'good',
    airGroupState: 'ready',
    detectedByPlayer: true,
  };
}

function campaignState(overrides: Partial<{
  fleets: StrategicFleet[];
  contacts: NavalContact[];
}> = {}): any {
  return {
    currentTurn: 2,
    date: '1942-06-04',
    currentPhase: 'carrier_turning_point_1942',
    fleets: overrides.fleets || [fleet()],
    intel: {
      turn: 2,
      playerContacts: overrides.contacts || [],
      enemyContacts: [],
      knownFriendlyFleets: [],
      fogTiles: {},
      searchMissions: [],
      contactReports: [],
    },
    reports: [],
    battleLog: [],
    airOperations: [],
    facilities: [{ id: 'base_1', name: 'Forward Base', faction: 'player', type: 'naval_base', x: 700, y: 500 }],
    weather: 'clear',
  };
}

function decision(action: LLMCommanderDecision['decisions'][number]): LLMCommanderDecision {
  return {
    assessment: 'test',
    intent: action.type === 'launch_strike' ? 'strike' : action.type === 'launch_search' ? 'search' : 'hold',
    confidence: 'high',
    risk: 'medium',
    decisions: [action],
    assumptions: [],
    informationGaps: [],
    abortConditions: [],
    nextReviewTurn: 3,
  };
}

function detailedDecision(action: LLMCommanderDecision['decisions'][number]): LLMCommanderDecision {
  return {
    ...decision(action),
    situationAssessment: {
      enemy: 'No confirmed contact; enemy location unknown.',
      friendly: 'Friendly base support is available.',
      self: 'Carrier air group is ready for limited next-turn action.',
      battlefield: 'Clear weather favors search.',
    },
    missionAnalysis: {
      primaryTask: 'locate enemy fleet',
      constraints: ['known information only', 'preserve carrier force'],
      desiredEffect: 'improve contact picture without overcommitting',
      riskTolerance: 'medium',
    },
    availableDecisionReview: [{
      actionType: action.type,
      feasible: true,
      method: 'use available fleet resources',
      quantity: action.aircraftCount,
      constraints: ['validator must still approve'],
      estimatedSuccess: action.successEstimate || 'medium',
      reason: action.reason,
    }],
    courseOfActionAnalysis: [{
      option: 'selected next-turn order',
      actionTypes: [action.type],
      successEstimate: action.successEstimate || 'medium',
      risk: 'low',
      resourceUse: action.resourceCommitment || 'limited',
      reason: 'best feasible action for current task',
    }],
    selectedDecisionRationale: 'Selected the lowest-risk action that changes useful state this turn.',
  };
}

function contextFor(state: ReturnType<typeof campaignState>) {
  const truth = {
    turn: state.currentTurn,
    weather: state.weather,
    playerFleets: state.fleets.filter(f => f.faction === 'player'),
    enemyFleets: state.fleets.filter(f => f.faction === 'enemy'),
    allBases: [],
    allSupplyLines: [],
  };
  const knowledge = buildFactionKnowledge({
    faction: 'player',
    truth,
    intel: state.intel,
    reports: state.reports,
    currentTurn: state.currentTurn,
    memory: createCampaignMemory(),
  });
  return { knowledge, context: sanitizeKnowledgeForLLM(knowledge, state.currentPhase as any) };
}

test('map scales real islands and keeps facilities in bounds', () => {
  const map = generateStratMap({ width: 1024, height: 768, seed: 7, islandGroups: 12, maxIslandR: 80, minIslandR: 12, seaLevel: 0.42 });
  assert(map.facilities.length > 0, 'expected facilities');
  assert(map.shippingLanes.length > 0, 'expected shipping lanes');
  for (const facility of map.facilities) {
    assert(facility.x >= 0 && facility.x < 1024, `facility x out of bounds: ${facility.x}`);
    assert(facility.y >= 0 && facility.y < 768, `facility y out of bounds: ${facility.y}`);
  }
});

test('map factions follow west enemy and east player theater line', () => {
  const map = generateStratMap({ width: 1024, height: 768, seed: 8, islandGroups: 12, maxIslandR: 80, minIslandR: 12, seaLevel: 0.42 });
  for (const facility of map.facilities) {
    if (facility.faction === 'player') assert(facility.x >= 512, `player facility on west side: ${facility.x}`);
    if (facility.faction === 'enemy') assert(facility.x < 512, `enemy facility on east side: ${facility.x}`);
  }
});

test('LLM strike with no contacts is downgraded to search', () => {
  const raw = '{"situation":"attack","orders":[{"intent":"strike","reason":"guess"}]}';
  const decision = normalizeCampaignDecision(parseCampaignDecision(raw), { turn: 1, playerFleet: fleet(), contacts: [] });
  assert(decision.orders[0]?.intent === 'search', `expected search, got ${decision.orders[0]?.intent}`);
});

test('LLM strike against weak contact is downgraded to search', () => {
  const raw = '{"situation":"attack","orders":[{"intent":"strike","targetContactId":"c1"}]}';
  const decision = normalizeCampaignDecision(parseCampaignDecision(raw), {
    turn: 1,
    playerFleet: fleet(),
    contacts: [contact('c1', 'detected')],
  });
  assert(decision.orders[0]?.intent === 'search', `expected search, got ${decision.orders[0]?.intent}`);
});

test('LLM strike against tracked contact becomes executable launch_strike', () => {
  const raw = '{"situation":"tracked","orders":[{"intent":"strike","targetContactId":"c1"}]}';
  const state = { turn: 1, playerFleet: fleet(), contacts: [contact('c1', 'tracked')] };
  const decision = normalizeCampaignDecision(parseCampaignDecision(raw), state);
  const actions = campaignDecisionToActions(decision, state);
  assert(actions[0]?.type === 'launch_strike', `expected launch_strike, got ${actions[0]?.type}`);
  assert(actions[0]?.targetContactId === 'c1', `expected c1, got ${actions[0]?.targetContactId}`);
});

await testAsync('LLM pipeline legal search mutates search mission state', async () => {
  const state = campaignState();
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => decision({
      type: 'launch_search',
      fleetId: 'tf_test',
      targetPosition: { x: 500, y: 460 },
      searchArcDeg: { centerDeg: 250, widthDeg: 80, range: 120 },
      priority: 1,
      reason: 'sweep likely approach',
    }),
  });
  assert(state.intel.searchMissions.length === 1, 'expected search mission created');
  assert(state.airOperations.length === 1 && state.airOperations[0].heading === 250, 'expected air operation with requested heading');
  assert(result.stateDiff?.changes.some(c => c.includes('searchMissions')), 'expected state diff to mention search missions');
});

await testAsync('LLM pipeline consecutive searches can use remaining ready aircraft', async () => {
  const state = campaignState();
  for (let i = 0; i < 2; i++) {
    const result = await runAITurnPipeline({
      faction: 'player',
      mode: 'commander',
      state,
      memory: createCampaignMemory(),
      skipVisualAssessment: true,
      decisionProvider: () => decision({
        type: 'launch_search',
        fleetId: 'tf_test',
        searchArcDeg: { centerDeg: 240 + i * 20, widthDeg: 60, range: 100 },
        priority: 1,
        reason: `consecutive search ${i + 1}`,
      }),
    });
    assert(result.execution?.failed.length === 0, `expected search ${i + 1} not to fail: ${result.execution?.failed[0]?.reason}`);
    assert(result.execution?.executed[0]?.action.type === 'launch_search', `expected search ${i + 1} executed`);
  }
  assert(state.intel.searchMissions.length === 2, `expected two search missions, got ${state.intel.searchMissions.length}`);
  assert(state.fleets[0].ships[0].aircraft.readyAircraft === 82, `expected 82 ready aircraft after two searches, got ${state.fleets[0].ships[0].aircraft.readyAircraft}`);
});

await testAsync('LLM pipeline legal move mutates fleet target and order', async () => {
  const state = campaignState();
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => decision({
      type: 'move_fleet',
      fleetId: 'tf_test',
      targetPosition: { x: 640, y: 530 },
      priority: 1,
      reason: 'close search box',
    }),
  });
  assert((state.fleets[0] as any).targetPosition?.x === 640, 'expected target position set');
  assert(state.fleets[0].command?.currentOrderId?.includes('move_fleet'), 'expected current order id set');
  assert(result.execution?.executed.length === 1, 'expected move executed');
});

await testAsync('LLM low-confidence contact strike is rejected and not executed', async () => {
  const state = campaignState({ contacts: [contact('weak_1', 'suspected')] });
  const beforeMissions = state.intel.searchMissions.length;
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => decision({
      type: 'launch_strike',
      fleetId: 'tf_test',
      contactId: 'weak_1',
      priority: 1,
      reason: 'premature attack',
    }),
  });
  assert(result.validation?.acceptedActions.length === 0, 'expected no accepted actions');
  assert(result.validation?.rejectedActions[0]?.reason.includes('Cannot strike suspected contact'), 'expected low-confidence rejection reason');
  assert(state.intel.searchMissions.length === beforeMissions, 'expected no mission state change');
  assert((result.execution?.executed.length || 0) === 0, 'expected executor not to run rejected action');
});

await testAsync('LLM tracked contact strike creates strike task', async () => {
  const state = campaignState({ contacts: [contact('track_1', 'tracked')] });
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => decision({
      type: 'launch_strike',
      fleetId: 'tf_test',
      contactId: 'track_1',
      priority: 1,
      reason: 'reliable target',
    }),
  });
  assert(state.intel.searchMissions[0]?.type === 'strike', `expected strike mission, got ${state.intel.searchMissions[0]?.type}`);
  assert(state.fleets[0].mission === 'carrier_strike', `expected carrier_strike mission, got ${state.fleets[0].mission}`);
  assert(result.execution?.executed.length === 1, 'expected strike executed');
});

test('LLM severely damaged fleet cannot launch strike', () => {
  const damagedFleet = fleet();
  damagedFleet.ships[0].damage.status = 'crippled';
  damagedFleet.ships[0].damage.hullIntegrity = 20;
  const state = campaignState({ fleets: [damagedFleet], contacts: [contact('track_2', 'tracked')] });
  const { knowledge, context } = contextFor(state);
  const validation = validateLLMCommanderDecision({
    decision: decision({
      type: 'launch_strike',
      fleetId: 'tf_test',
      contactId: 'track_2',
      priority: 1,
      reason: 'bad idea',
    }),
    context,
    knowledge,
  });
  assert(!validation.valid, 'expected damaged fleet strike rejected');
  assert(validation.rejectedActions[0]?.reason.includes('too damaged'), 'expected damaged rejection reason');
});

test('LLM fleet type in fleetId is corrected when uniquely matching own fleet', () => {
  const state = campaignState();
  const { knowledge, context } = contextFor(state);
  const validation = validateLLMCommanderDecision({
    decision: decision({
      type: 'move_fleet',
      fleetId: 'carrier_task_force',
      targetPosition: { x: 620, y: 520 },
      priority: 1,
      reason: 'model copied type instead of id',
    }),
    context,
    knowledge,
  });
  assert(validation.valid, `expected corrected action, got ${validation.rejectedActions[0]?.reason}`);
  assert(validation.acceptedActions[0]?.fleetId === 'tf_test', `expected tf_test, got ${validation.acceptedActions[0]?.fleetId}`);
  assert(validation.warnings.some(w => w.includes('Corrected fleetId carrier_task_force')), 'expected correction warning');
});

await testAsync('runAITurnPipeline no longer uses empty store calls', async () => {
  const state = campaignState();
  const beforeReports = state.reports.length;
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => decision({
      type: 'move_fleet',
      fleetId: 'tf_test',
      targetPosition: { x: 620, y: 520 },
      priority: 1,
      reason: 'verify real mutation',
    }),
  });
  assert(state.reports.length > beforeReports, 'expected report mutation from real store call');
  assert((state.fleets[0] as any).targetPosition?.x === 620, 'expected real fleet mutation');
  assert((result.stateDiff?.changes.length || 0) > 0, 'expected non-empty state diff');
});

await testAsync('LLM pipeline assign_mission changes fleet mission', async () => {
  const state = campaignState();
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => decision({
      type: 'assign_mission',
      fleetId: 'tf_test',
      mission: 'search',
      priority: 1,
      reason: 'establish scout line',
    }),
  });
  assert(state.fleets[0].mission === 'search', `expected search mission, got ${state.fleets[0].mission}`);
  assert(state.battleLog.some((event: any) => event.description.includes('Assigned mission search')), 'expected assignment log');
  assert(result.execution?.executed.length === 1, 'expected assign mission executed');
});

await testAsync('LLM pipeline launch_cap creates CAP task and consumes aircraft', async () => {
  const state = campaignState();
  const beforeReady = state.fleets[0].ships[0].aircraft.readyAircraft;
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => decision({
      type: 'launch_cap',
      fleetId: 'tf_test',
      targetPosition: { x: 700, y: 500 },
      aircraftCount: 4,
      priority: 1,
      reason: 'cover carrier',
    }),
  });
  assert(state.intel.searchMissions[0]?.type === 'cap', `expected cap mission, got ${state.intel.searchMissions[0]?.type}`);
  assert(state.airOperations[0]?.type === 'cap', `expected cap air operation, got ${state.airOperations[0]?.type}`);
  assert(state.fleets[0].ships[0].aircraft.readyAircraft < beforeReady, 'expected CAP to consume ready aircraft');
  assert(result.stateDiff?.changes.some(c => c.includes('aircraftReady')), 'expected aircraft readiness diff');
});

await testAsync('LLM pipeline withdraw_fleet sets withdrawal mission and target', async () => {
  const state = campaignState();
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => decision({
      type: 'withdraw_fleet',
      fleetId: 'tf_test',
      targetPosition: { x: 720, y: 500 },
      priority: 1,
      reason: 'retire to base',
    }),
  });
  assert(state.fleets[0].mission === 'withdraw', `expected withdraw mission, got ${state.fleets[0].mission}`);
  assert((state.fleets[0] as any).targetPosition?.x === 720, 'expected withdrawal target set');
  assert(result.executionReport?.affectedFleetIds.includes('tf_test'), 'expected execution report affected fleet');
});

await testAsync('LLM pipeline hold_position anchors fleet at current position', async () => {
  const state = campaignState();
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => decision({
      type: 'hold_position',
      fleetId: 'tf_test',
      priority: 1,
      reason: 'screen current sea area',
    }),
  });
  assert((state.fleets[0] as any).targetPosition?.x === state.fleets[0].position.globalX, 'expected hold target x at current x');
  assert((state.fleets[0] as any).targetPosition?.y === state.fleets[0].position.globalY, 'expected hold target y at current y');
  assert(state.fleets[0].command?.commanderIntent === 'hold_sea_area', 'expected hold commander intent');
  assert(result.execution?.executed.length === 1, 'expected hold executed');
});

await testAsync('LLM pipeline repair_fleet at friendly base sets repair posture', async () => {
  const state = campaignState();
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => decision({
      type: 'repair_fleet',
      fleetId: 'tf_test',
      baseId: 'base_1',
      priority: 1,
      reason: 'restore readiness',
    }),
  });
  assert(state.fleets[0].mission === 'resupply', `expected resupply mission, got ${state.fleets[0].mission}`);
  assert((state.fleets[0] as any).repairStatus === 'repairing', 'expected repair status set');
  assert(result.validation?.warnings.some(w => w.includes('repair_fleet will only set repair posture')), 'expected intact repair warning');
  assert(result.stateDiff?.changes.some(c => c.includes('repair')), 'expected repair status diff');
});

await testAsync('LLM context exposes OODA decision framework and carrier air capacity', async () => {
  const state = campaignState();
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'advisor',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => null,
  });
  assert(result.context.ownForces[0]?.carrierAir?.readyAircraft === 90, `expected 90 ready aircraft, got ${result.context.ownForces[0]?.carrierAir?.readyAircraft}`);
  assert((result.context.decisionFramework?.availableOptions.length || 0) > 0, 'expected decision framework options');
  assert(result.context.decisionFramework?.situation.enemy.includes('No enemy contact'), 'expected enemy situation summary');
});

await testAsync('LLM execution report preserves OODA decision process', async () => {
  const state = campaignState();
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => detailedDecision({
      type: 'hold_position',
      fleetId: 'tf_test',
      successEstimate: 'high',
      priority: 1,
      reason: 'preserve readiness while searching later',
    }),
  });
  assert(result.executionReport?.decisionProcess?.situationAssessment?.enemy.includes('No confirmed contact'), 'expected situation assessment in report');
  assert(result.executionReport?.decisionProcess?.availableDecisionReview?.[0]?.actionType === 'hold_position', 'expected decision review in report');
});

test('LLM validator rejects aircraftCount above available search aircraft', () => {
  const limitedFleet = fleet();
  limitedFleet.ships[0].aircraft!.readyAircraft = 2;
  const state = campaignState({ fleets: [limitedFleet] });
  const { knowledge, context } = contextFor(state);
  const validation = validateLLMCommanderDecision({
    decision: detailedDecision({
      type: 'launch_search',
      fleetId: 'tf_test',
      aircraftCount: 4,
      searchArcDeg: { centerDeg: 270, widthDeg: 60, range: 120 },
      priority: 1,
      reason: 'over-commit aircraft',
    }),
    context,
    knowledge,
  });
  assert(!validation.valid, 'expected over-capacity search rejected');
  assert(validation.rejectedActions[0]?.reason.includes('exceeds available search aircraft 2'), `unexpected reason ${validation.rejectedActions[0]?.reason}`);
});

test('modular AA damage disables anti-air firepower and AA weapons', () => {
  const cv = createShipForClass('fleet_carrier', 'player', 'CV Module Test', 0, 0, 0, 20, 'carrier');
  const before = getShipCombatProfile(cv);
  cv.modules = cv.modules.map((module) => module.type === 'aa_battery'
    ? { ...module, hp: 0, status: 'destroyed' as const }
    : module);
  const after = getShipCombatProfile(cv);
  const aaWeapon = cv.weapons.find((weapon) => weapon.type === 'aa_gun')!;
  const firing = canFireNavalWeapon({
    attacker: cv,
    weapon: aaWeapon,
    targetContact: contact('air_like', 'tracked', 3, 0),
    intel: campaignState().intel,
    environment: campaignState().environment || { timeOfDay: 'day', weather: 'clear', seaState: 1, windDirectionDeg: 0, windSpeedKts: 0, visibilityModifier: 1 },
  });
  assert(after.firepower.antiAir < before.firepower.antiAir, 'expected AA firepower to drop after AA modules destroyed');
  assert(getWeaponSystemReadiness(cv, 'aa_gun') <= 0.05, 'expected AA readiness disabled');
  assert(!firing.canFire && firing.reason.includes('disabled'), `expected AA fire blocked, got ${firing.reason}`);
});

test('radar module damage reduces radar detection to no contact', () => {
  const observer = createShipForClass('fleet_carrier', 'player', 'CV Radar Test', 0, 0, 0, 20, 'carrier');
  const target = createShipForClass('battleship', 'enemy', 'BB Target', 10, 0, 0, 20, 'surface_combatant');
  const before = detectNavalTarget({
    observer,
    target,
    sensorType: 'surface_radar',
    environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, smoke: 0 },
    distance: 10,
    lineOfSightBlocked: false,
  });
  observer.modules = observer.modules.map((module) => module.type === 'radar'
    ? { ...module, hp: 0, status: 'destroyed' as const }
    : module);
  observer.damage.sensorPenalty = 1;
  const after = detectNavalTarget({
    observer,
    target,
    sensorType: 'surface_radar',
    environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, smoke: 0 },
    distance: 10,
    lineOfSightBlocked: false,
  });
  assert(before.success, `expected radar contact before damage, got ${before.reason}`);
  assert(!after.success, 'expected radar contact blocked after radar destroyed');
});

await testAsync('human command launch search mutates store through validator/executor', async () => {
  const state = campaignState();
  useNavalStore.setState({
    ...state,
    commandHistory: [],
    pendingAuthorizations: [],
    fleetCommunications: [],
  });
  const receipt = useNavalStore.getState().submitNavalCommand('launch search west with 4 aircraft', ['tf_test']);
  const next = useNavalStore.getState();
  assert(receipt.accepted, `expected command accepted: ${receipt.resultSummary}`);
  assert(next.intel.searchMissions.length === 1, 'expected human search command to create search mission');
  assert(next.commandHistory.length === 1, 'expected command history saved');
});

test('human split fleet command creates a new player fleet after confirmation', () => {
  const baseFleet = fleet();
  const dd = createShipForClass('destroyer', 'player', 'DD Fletcher', 710, 510, 270, 28, 'screen');
  baseFleet.ships.push(dd);
  useNavalStore.setState({
    ...campaignState({ fleets: [baseFleet] }),
    commandHistory: [],
    pendingAuthorizations: [],
    fleetCommunications: [],
  });
  const receipt = useNavalStore.getState().submitNavalCommand('split DD Fletcher confirm', ['tf_test']);
  const next = useNavalStore.getState();
  assert(receipt.accepted, `expected split accepted: ${receipt.resultSummary}`);
  assert(next.fleets.length === 2, `expected new detached fleet, got ${next.fleets.length}`);
  assert(next.fleets.some(f => f.name.includes('Detached')), 'expected detached fleet name');
});

await testAsync('fleet-scoped LLM pipeline only exposes and mutates selected fleet', async () => {
  const first = fleet();
  const second = fleet();
  second.id = 'tf_second';
  second.name = 'TF Second';
  second.position = { ...second.position, globalX: 820, globalY: 560 };
  second.ships = second.ships.map(ship => ({ ...ship, position: { x: 820, y: 560 }, name: `${ship.name} II` }));
  const state = campaignState({ fleets: [first, second] });
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    fleetId: 'tf_second',
    decisionProvider: (context) => {
      assert(context.ownForces.length === 1, `expected one fleet context, got ${context.ownForces.length}`);
      assert(context.ownForces[0].fleetId === 'tf_second', `expected tf_second context, got ${context.ownForces[0].fleetId}`);
      return decision({
        type: 'move_fleet',
        fleetId: 'tf_second',
        targetPosition: { x: 850, y: 590 },
        priority: 1,
        reason: 'fleet scoped move',
      });
    },
  });
  assert((state.fleets[1] as any).targetPosition?.x === 850, 'expected second fleet target set');
  assert(!(state.fleets[0] as any).targetPosition, 'expected first fleet unchanged');
  assert(result.execution?.executed.length === 1, 'expected scoped move executed');
});

console.log(`\nRegression tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
