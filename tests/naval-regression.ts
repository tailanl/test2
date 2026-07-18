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
import { buildDecisionPrompt } from '../src/ai/llm-decision-schema';
import { createShipForClass } from '../src/game/naval/naval-debug';
import { detectNavalTarget } from '../src/game/naval/intel/naval-visibility';
import { canFireNavalWeapon } from '../src/game/naval/ship/ship-weapons';
import { getFleetCombatProfile, getShipCombatProfile, getWeaponSystemReadiness } from '../src/game/naval/ship/ship-combat-profile';
import { useNavalStore } from '../src/store/naval-store';
import { buildReconProbabilityClouds } from '../src/game/naval/intel/recon-probability';
import { createDefaultCarrierAirGroup, createSearchMission, resolveAirSearchMission } from '../src/game/naval/ship/ship-aircraft';
import type { NavalContact } from '../src/game/naval/intel/naval-intel-types';
import type {
  FleetAutomationPriorities,
  FleetAutomationPriority,
  FleetAutomationWorkType,
  StrategicFleet,
} from '../src/game/naval/naval-strategic-types';
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

function enemySurfaceFleet(x = 580, y = 500): { fleet: StrategicFleet; shipId: string } {
  const enemyShip = createShipForClass('battleship', 'enemy', 'BB Target', x, y, 90, 16, 'surface_combatant');
  return {
    shipId: enemyShip.id,
    fleet: {
      id: `enemy_${enemyShip.id}`,
      name: 'Enemy Surface Force',
      faction: 'enemy',
      type: 'surface_action_group',
      position: { regionX: 0, regionY: 0, chunkX: 0, chunkY: 0, globalX: x, globalY: y },
      ships: [enemyShip],
      command: {
        controller: 'enemy_ai',
        riskTolerance: 'medium',
        engagementPolicy: 'engage_surface_only',
        preserveCapitalShips: true,
      },
      mission: 'patrol',
      fuelState: 'good',
      ammoState: 'good',
      detectedByPlayer: false,
    },
  };
}

function surfaceFleet(): StrategicFleet {
  const base = fleet();
  base.type = 'surface_action_group';
  base.ships = [
    createShipForClass('heavy_cruiser', 'player', 'CA Test', 700, 500, 270, 22, 'surface_combatant'),
    createShipForClass('destroyer', 'player', 'DD Test', 710, 506, 270, 28, 'torpedo_attack'),
  ];
  base.command = {
    controller: 'player_direct',
    riskTolerance: 'medium',
    engagementPolicy: 'engage_surface_only',
    preserveCapitalShips: true,
  };
  base.airGroupState = undefined;
  return base;
}

function transportFleet(): StrategicFleet {
  const base = fleet();
  base.type = 'transport_convoy';
  base.ships = [
    createShipForClass('transport', 'player', 'AP Test', 700, 500, 270, 14, 'transport'),
    createShipForClass('destroyer', 'player', 'DE Test', 706, 504, 270, 20, 'screen'),
  ];
  base.command = {
    controller: 'player_direct',
    riskTolerance: 'low',
    engagementPolicy: 'avoid_unless_attacked',
    preserveCapitalShips: true,
  };
  base.airGroupState = undefined;
  return base;
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

const automationWorkTypes: FleetAutomationWorkType[] = [
  'damage_control',
  'formation',
  'routing',
  'search',
  'combat_air_patrol',
  'contact_shadow',
  'evasive_maneuver',
  'radio_silence',
  'smoke_screen',
  'rendezvous',
  'air_recovery',
  'strike_ready',
];

function automationPriorities(
  overrides: Partial<Record<FleetAutomationWorkType, FleetAutomationPriority>>
): FleetAutomationPriorities {
  const priorities = Object.fromEntries(automationWorkTypes.map((workType) => [workType, 0])) as FleetAutomationPriorities;
  for (const [workType, priority] of Object.entries(overrides) as Array<[FleetAutomationWorkType, FleetAutomationPriority]>) {
    priorities[workType] = priority;
  }
  return priorities;
}

function fleetWithAutomation(
  base: StrategicFleet,
  priorities: Partial<Record<FleetAutomationWorkType, FleetAutomationPriority>>
): StrategicFleet {
  return {
    ...base,
    command: {
      controller: base.command?.controller ?? 'player_direct',
      riskTolerance: base.command?.riskTolerance ?? 'medium',
      engagementPolicy: base.command?.engagementPolicy ?? 'engage_if_advantage',
      preserveCapitalShips: base.command?.preserveCapitalShips ?? true,
      ...base.command,
      automation: {
        priorities: automationPriorities(priorities),
      },
    },
  };
}

function loadAutomationStore(params: {
  fleets: StrategicFleet[];
  contacts?: NavalContact[];
  currentTurn?: number;
  weather?: 'clear'|'rain'|'squall'|'fog'|'storm';
  facilities?: any[];
}) {
  resetLocalMultiplayerForTest();
  const state = campaignState({ fleets: params.fleets, contacts: params.contacts || [] });
  const local = useNavalStore.getState().localMultiplayer;
  useNavalStore.setState({
    ...state,
    overlay: {} as any,
    currentTurn: params.currentTurn ?? 2,
    weather: params.weather ?? 'clear',
    facilities: params.facilities ?? state.facilities,
    commandHistory: [],
    pendingAuthorizations: [],
    fleetCommunications: [],
    battleLog: [],
    reports: [],
    airOperations: [],
    autoDoctrineEnabled: true,
    autoTurnEnabled: false,
    autoPauseOnCritical: false,
    victory: 'none',
    localMultiplayer: {
      ...local,
      mode: 'human_multiplayer',
      activePlayerId: 'blue_command',
      fleetOwners: {},
      shipOwners: {},
      allowCrossControl: true,
      visibilityMode: 'role_fog_of_war',
      phase: 'orders',
      readyPlayerIds: [],
      pendingOrders: [],
      commandLog: [],
    },
  });
}

function resetLocalMultiplayerForTest() {
  const local = useNavalStore.getState().localMultiplayer;
  useNavalStore.setState({
    localMultiplayer: {
      ...local,
      mode: 'llm_commander',
      activePlayerId: 'blue_command',
      fleetOwners: {},
      shipOwners: {},
      allowCrossControl: true,
      visibilityMode: 'role_fog_of_war',
      phase: 'orders',
      readyPlayerIds: [],
      pendingOrders: [],
      commandLog: [],
    },
  });
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

await testAsync('LLM prepare_strike sets fleet-level operation posture', async () => {
  const state = campaignState();
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => decision({
      type: 'prepare_strike',
      fleetId: 'tf_test',
      aircraftCount: 12,
      durationTurns: 1,
      priority: 1,
      reason: 'ready a deck cycle without launching yet',
    }),
  });
  assert(state.fleets[0].operation?.posture === 'strike_preparation', `expected strike_preparation, got ${state.fleets[0].operation?.posture}`);
  assert(state.fleets[0].mission === 'carrier_strike', `expected carrier_strike mission, got ${state.fleets[0].mission}`);
  assert(result.stateDiff?.changes.some(c => c.includes('operation normal -> strike_preparation')), 'expected operation diff');
  assert(state.reports.some((report: any) => report.summary.includes('Strike deck cycle prepared')), 'expected strike prep report');
});

await testAsync('LLM lay_smoke changes only fleet-level posture and log', async () => {
  const state = campaignState();
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => decision({
      type: 'lay_smoke',
      fleetId: 'tf_test',
      durationTurns: 1,
      priority: 1,
      reason: 'cover fleet maneuver',
    }),
  });
  assert(state.fleets[0].operation?.posture === 'smoke_screen', `expected smoke_screen, got ${state.fleets[0].operation?.posture}`);
  assert(result.execution?.executed[0]?.action.type === 'lay_smoke', 'expected smoke action executed');
  assert(state.battleLog.some((event: any) => event.description.includes('smoke screen')), 'expected smoke log');
});

await testAsync('LLM low-confidence contact cannot trigger torpedo attack posture', async () => {
  const state = campaignState({ fleets: [surfaceFleet()], contacts: [contact('weak_torp', 'detected', 735, 500)] });
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => decision({
      type: 'launch_torpedo_attack',
      fleetId: 'tf_test',
      contactId: 'weak_torp',
      priority: 1,
      reason: 'too little confidence',
    }),
  });
  assert(result.validation?.acceptedActions.length === 0, 'expected torpedo action rejected');
  assert(!state.fleets[0].operation, 'expected no operation set by rejected action');
  assert(result.stateDiff?.logMessages.some(message => message.includes('low-confidence contact')), 'expected rejection reason in state diff log');
});

await testAsync('LLM tracked contact can trigger fleet-level torpedo attack posture', async () => {
  const state = campaignState({ fleets: [surfaceFleet()], contacts: [contact('track_torp', 'tracked', 735, 500)] });
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => decision({
      type: 'launch_torpedo_attack',
      fleetId: 'tf_test',
      contactId: 'track_torp',
      durationTurns: 1,
      priority: 1,
      reason: 'reliable night surface contact',
    }),
  });
  assert(state.fleets[0].operation?.posture === 'torpedo_attack', `expected torpedo_attack, got ${state.fleets[0].operation?.posture}`);
  assert(state.fleets[0].mission === 'intercept', `expected intercept mission, got ${state.fleets[0].mission}`);
  assert(state.fleets[0].ammoState === 'limited', `expected ammo limited after torpedo attack, got ${state.fleets[0].ammoState}`);
  assert(result.execution?.executed.length === 1, 'expected torpedo attack executed');
});

await testAsync('LLM run_transport is restricted to convoy-style fleets', async () => {
  const carrierState = campaignState();
  const carrierResult = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state: carrierState,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => decision({
      type: 'run_transport',
      fleetId: 'tf_test',
      targetPosition: { x: 620, y: 500 },
      priority: 1,
      reason: 'carrier should not act as transport',
    }),
  });
  assert(carrierResult.validation?.acceptedActions.length === 0, 'expected carrier transport run rejected');
  assert(!carrierState.fleets[0].operation, 'expected rejected carrier unchanged');

  const transportState = campaignState({ fleets: [transportFleet()] });
  const transportResult = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state: transportState,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => decision({
      type: 'run_transport',
      fleetId: 'tf_test',
      targetPosition: { x: 620, y: 500 },
      durationTurns: 2,
      priority: 1,
      reason: 'move convoy to objective area',
    }),
  });
  assert(transportState.fleets[0].operation?.posture === 'transport_run', `expected transport_run, got ${transportState.fleets[0].operation?.posture}`);
  assert((transportState.fleets[0] as any).targetPosition?.x === 620, 'expected transport target set');
  assert(transportResult.execution?.executed.length === 1, 'expected transport action executed');
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
  assert((result.context.commanderBrief?.taskCards.length || 0) > 0, 'expected commander task cards');
  assert(result.context.commanderBrief?.taskCards[0]?.recommendedOrders.some(order => order.type === 'launch_search'), 'expected recommended search order');
  assert(result.context.commanderBrief?.taskCards[0]?.recommendedOrders[0]?.fields.searchArcDeg?.centerDeg !== undefined, 'expected search arc fields in commander brief');
  assert(result.context.reconAssessment?.summary.includes('contact probability cloud'), 'expected recon probability summary');
  assert((result.context.reconAssessment?.recommendedSearches.length || 0) >= 0, 'expected recon search recommendations array');
});

await testAsync('LLM decision prompt exposes commander brief recommended order fields', async () => {
  const state = campaignState();
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'advisor',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => null,
  });
  const prompt = buildDecisionPrompt(result.context);
  assert(prompt.user.includes('COMMANDER BRIEF'), 'expected commander brief section in prompt');
  assert(prompt.user.includes('RECON PROBABILITY CLOUDS'), 'expected recon probability section in prompt');
  assert(prompt.user.includes('recommended:launch_search'), 'expected launch_search recommendation in prompt');
  assert(prompt.user.includes('arc:'), 'expected search arc field in prompt');
});

test('Recon probability clouds summarize search coverage and contact uncertainty', () => {
  const preparingClouds = buildReconProbabilityClouds({
    contacts: [],
    airOperations: [{
      id: 'search_op_prepping',
      type: 'search',
      originX: 700,
      originY: 500,
      targetX: 460,
      targetY: 500,
      heading: 270,
      arcWidthDeg: 70,
      range: 260,
      status: 'preparing',
      aircraft: 4,
      fleetName: 'TF Test',
    }],
    currentTurn: 3,
    weather: 'clear',
  });
  assert(!preparingClouds.some((cloud) => cloud.kind === 'search_coverage'), 'expected preparing search to withhold coverage cloud');

  const clouds = buildReconProbabilityClouds({
    contacts: [contact('probable_enemy', 'detected', 520, 480)],
    airOperations: [{
      id: 'search_op_1',
      type: 'search',
      x: 640,
      y: 500,
      sweepPoints: [{ x: 700, y: 500 }, { x: 640, y: 500 }],
      sweepRadius: 72,
      originX: 700,
      originY: 500,
      targetX: 460,
      targetY: 500,
      heading: 270,
      arcWidthDeg: 70,
      range: 260,
      status: 'outbound',
      aircraft: 4,
      fleetName: 'TF Test',
    }],
    currentTurn: 3,
    weather: 'clear',
    ownPosition: { x: 700, y: 500 },
  });
  assert(clouds.some((cloud) => cloud.kind === 'search_coverage' && cloud.origin?.x === 640), 'expected search coverage cloud to follow aircraft position');
  assert(clouds.some((cloud) => cloud.kind === 'search_coverage' && cloud.path?.length === 2), 'expected search coverage cloud to expose aircraft sweep track');
  assert(clouds.some((cloud) => cloud.kind === 'contact_probability' && cloud.sourceId === 'probable_enemy'), 'expected contact probability cloud');
});

test('Air search resolves sector geometry instead of broad aircraft icons', () => {
  const airGroup = createDefaultCarrierAirGroup('fleet_carrier');
  const result = createSearchMission({
    shipId: 'cv_test',
    airGroup,
    originPosition: { x: 0, y: 0 },
    targetArea: { x: 120, y: 0, radius: 80 },
    searchArcDeg: { centerDeg: 90, widthDeg: 30, range: 180 },
    aircraftCount: 6,
  });
  const inside = createShipForClass('battleship', 'enemy', 'BB Inside', 120, 0, 0, 0, 'surface_combatant');
  const outside = createShipForClass('battleship', 'enemy', 'BB Outside', 0, -120, 0, 0, 'surface_combatant');
  const mission = { ...result.mission, status: 'searching' as const, etaTurns: 0 };
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const outsideResult = resolveAirSearchMission({
      mission,
      enemyShips: [outside],
      environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, windDirectionDeg: 0, windSpeedKts: 0, visibilityModifier: 1 },
      currentTurn: 4,
    });
    const insideResult = resolveAirSearchMission({
      mission,
      enemyShips: [inside],
      environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, windDirectionDeg: 0, windSpeedKts: 0, visibilityModifier: 1 },
      currentTurn: 4,
    });
    assert(outsideResult.contacts.length === 0, 'expected sector search to ignore target outside arc');
    assert(insideResult.contacts.length === 1, 'expected sector search to detect target inside arc when random succeeds');
    assert(insideResult.contacts[0].uncertaintyRadius > 5, 'expected sector-based contact uncertainty');
  } finally {
    Math.random = originalRandom;
  }
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

test('human sector search supports aircraft mix and formation fan modifiers', () => {
  resetLocalMultiplayerForTest();
  const state = campaignState();
  useNavalStore.setState({
    ...state,
    commandHistory: [],
    pendingAuthorizations: [],
    fleetCommunications: [],
    battleLog: [],
    airOperations: [],
  });
  const beforeReady = useNavalStore.getState().fleets[0].ships[0].aircraft?.readyAircraft ?? 0;
  const formationOk = useNavalStore.getState().setFleetFormation('tf_test', 'line_abreast');
  const ok = useNavalStore.getState().launchAirSearchSector('tf_test', {
    headingDeg: 270,
    arcWidthDeg: 60,
    range: 120,
    fighters: 1,
    diveBombers: 2,
    torpedoBombers: 0,
  });
  const next = useNavalStore.getState();
  const mission = next.intel.searchMissions[0];
  assert(formationOk, 'expected formation order accepted');
  assert(ok, 'expected sector search accepted');
  assert(mission?.type === 'search', `expected search mission, got ${mission?.type}`);
  assert(mission.searchArcDeg?.centerDeg === 270, `expected heading 270, got ${mission.searchArcDeg?.centerDeg}`);
  assert(mission.searchArcDeg?.widthDeg === 87, `expected line formation arc 87, got ${mission.searchArcDeg?.widthDeg}`);
  assert(mission.searchArcDeg?.range === 126, `expected line formation range 126, got ${mission.searchArcDeg?.range}`);
  assert(mission.aircraftMix?.fighters === 1 && mission.aircraftMix?.diveBombers === 2, 'expected aircraft mix saved on mission');
  assert(next.airOperations[0]?.arcWidthDeg === 87, 'expected visible air operation to keep sector arc');
  assert(next.airOperations[0]?.status === 'preparing', `expected visible search to start preparing, got ${next.airOperations[0]?.status}`);
  assert(next.airOperations[0]?.prepTurns === 1, `expected one turn prep, got ${next.airOperations[0]?.prepTurns}`);
  assert(mission.status === 'preparing', `expected mission to start preparing, got ${mission.status}`);
  assert(mission.prepTurns === 1, `expected mission prep countdown, got ${mission.prepTurns}`);
  assert((next.fleets[0].ships[0].aircraft?.readyAircraft ?? 0) === beforeReady - 3, 'expected selected aircraft to be occupied');

  const prepClouds = buildReconProbabilityClouds({
    contacts: [],
    airOperations: next.airOperations,
    searchMissions: next.intel.searchMissions,
    currentTurn: next.currentTurn,
    weather: 'clear',
  });
  assert(!prepClouds.some((cloud) => cloud.kind === 'search_coverage'), 'expected no search cloud while aircraft are preparing');

  useNavalStore.getState().advanceNavalTurn();
  const advanced = useNavalStore.getState();
  const activeClouds = buildReconProbabilityClouds({
    contacts: [],
    airOperations: advanced.airOperations,
    searchMissions: advanced.intel.searchMissions,
    currentTurn: advanced.currentTurn,
    weather: 'clear',
  });
  assert(advanced.airOperations[0]?.status === 'outbound', `expected search to launch after prep, got ${advanced.airOperations[0]?.status}`);
  assert(activeClouds.some((cloud) => cloud.kind === 'search_coverage'), 'expected search cloud after deck preparation completes');
});

test('human fan search splits selected teams across equal sector headings', () => {
  loadAutomationStore({ fleets: [fleet()] });
  const beforeReady = useNavalStore.getState().fleets[0].ships[0].aircraft?.readyAircraft ?? 0;
  const ok = useNavalStore.getState().launchAirSearchSector('tf_test', {
    headingDeg: 270,
    arcWidthDeg: 80,
    range: 160,
    teams: 5,
    scouts: 5,
  });
  const next = useNavalStore.getState();
  const searchOps = next.airOperations.filter((operation) => operation.type === 'search');
  assert(ok, 'expected fan search accepted');
  assert(searchOps.length === 5, `expected five search team operations, got ${searchOps.length}`);
  assert(next.intel.searchMissions.length === 5, `expected five search missions, got ${next.intel.searchMissions.length}`);
  assert(searchOps.map((operation) => operation.heading).join(',') === '230,250,270,290,310', `expected equal fan headings, got ${searchOps.map((operation) => operation.heading).join(',')}`);
  assert(searchOps.every((operation, index) => operation.teamIndex === index && operation.teamCount === 5), 'expected team indexes on search operations');
  assert(searchOps.every((operation) => operation.sweepPoints?.length === 1), 'expected each team to start a sweep track at carrier');
  assert((next.fleets[0].ships[0].aircraft?.readyAircraft ?? 0) === beforeReady - 5, 'expected five scout aircraft occupied');
});

test('human strike group uses selected aircraft mix against tracked contact', () => {
  resetLocalMultiplayerForTest();
  const state = campaignState({ contacts: [contact('track_human', 'tracked', 620, 500)] });
  useNavalStore.setState({
    ...state,
    commandHistory: [],
    pendingAuthorizations: [],
    fleetCommunications: [],
    battleLog: [],
    airOperations: [],
  });
  const ok = useNavalStore.getState().launchAirStrikeGroup('tf_test', {
    contactId: 'track_human',
    fighters: 2,
    diveBombers: 4,
    torpedoBombers: 2,
  });
  const next = useNavalStore.getState();
  const mission = next.intel.searchMissions[0];
  assert(ok, 'expected strike group accepted');
  assert(mission?.type === 'strike', `expected strike mission, got ${mission?.type}`);
  assert(mission.targetContactId === 'track_human', `expected target contact saved, got ${mission.targetContactId}`);
  assert(mission.aircraftMix?.fighters === 2 && mission.aircraftMix?.diveBombers === 4 && mission.aircraftMix?.torpedoBombers === 2, 'expected strike aircraft mix saved');
  assert(next.airOperations[0]?.targetContactId === 'track_human', 'expected visible strike operation target');
  assert(next.fleets[0].operation?.posture === 'strike_preparation', `expected strike_preparation, got ${next.fleets[0].operation?.posture}`);
});

test('human strike group refuses low-confidence contact without mutating state', () => {
  resetLocalMultiplayerForTest();
  const state = campaignState({ contacts: [contact('weak_human', 'detected', 620, 500)] });
  useNavalStore.setState({
    ...state,
    commandHistory: [],
    pendingAuthorizations: [],
    fleetCommunications: [],
    battleLog: [],
    airOperations: [],
  });
  const ok = useNavalStore.getState().launchAirStrikeGroup('tf_test', {
    contactId: 'weak_human',
    fighters: 2,
    diveBombers: 4,
    torpedoBombers: 2,
  });
  const next = useNavalStore.getState();
  assert(!ok, 'expected low-confidence contact strike refused');
  assert(next.intel.searchMissions.length === 0, 'expected no strike mission created');
  assert(next.airOperations.length === 0, 'expected no visible strike operation created');
});

test('air search can reveal a target and follow-on strike damages it', () => {
  const playerFleet = fleet();
  const enemy = enemySurfaceFleet(580, 500);
  loadAutomationStore({ fleets: [playerFleet, enemy.fleet], currentTurn: 2 });
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const searchOk = useNavalStore.getState().launchAirSearchSector('tf_test', {
      headingDeg: 270,
      arcWidthDeg: 70,
      range: 240,
      scouts: 8,
      fighters: 2,
    });
    assert(searchOk, 'expected search sector launch accepted');
    for (let i = 0; i < 5; i++) useNavalStore.getState().advanceNavalTurn();

    let state = useNavalStore.getState();
    const spotted = state.intel.playerContacts.find((item) =>
      item.originalEntityId === enemy.shipId &&
      ['classified', 'tracked', 'identified', 'confirmed'].includes(item.detectionLevel)
    );
    if (!spotted) {
      throw new Error(`expected air search to create a strike-legal contact, got ${state.intel.playerContacts.map((item) => item.detectionLevel).join(',')}`);
    }

    const beforeHull = state.fleets
      .find((item) => item.id === enemy.fleet.id)!
      .ships.find((ship) => ship.id === enemy.shipId)!.damage.hullIntegrity;
    const strikeOk = useNavalStore.getState().launchAirStrikeGroup('tf_test', {
      contactId: spotted.id,
      fighters: 2,
      diveBombers: 8,
      torpedoBombers: 4,
    });
    assert(strikeOk, 'expected strike launch against searched contact accepted');
    for (let i = 0; i < 8; i++) useNavalStore.getState().advanceNavalTurn();

    state = useNavalStore.getState();
    const afterHull = state.fleets
      .find((item) => item.id === enemy.fleet.id)!
      .ships.find((ship) => ship.id === enemy.shipId)!.damage.hullIntegrity;
    assert(afterHull < beforeHull, `expected strike to damage target hull, before ${beforeHull}, after ${afterHull}`);
    assert(state.battleLog.some((event) => event.type === 'air_strike_hit' && event.targetId === enemy.shipId), 'expected air_strike_hit log for target');
  } finally {
    Math.random = originalRandom;
  }
});

test('carrier air group editor clamps ready aircraft to edited group total', () => {
  const baseFleet = fleet();
  loadAutomationStore({ fleets: [baseFleet] });
  const carrier = useNavalStore.getState().fleets[0].ships.find((ship) => ship.aircraft);
  if (!carrier?.aircraft) throw new Error('expected test carrier with air group');

  const ok = useNavalStore.getState().editCarrierAirGroup('tf_test', carrier.id, {
    fighters: 12,
    diveBombers: 8,
    torpedoBombers: 4,
    readyAircraft: 99,
  });
  const editedCarrier = useNavalStore.getState().fleets[0].ships.find((ship) => ship.id === carrier.id)!;
  assert(ok, 'expected air group edit accepted');
  assert(editedCarrier.aircraft?.fighters === 12, 'expected fighters edited');
  assert(editedCarrier.aircraft?.diveBombers === 8, 'expected dive bombers edited');
  assert(editedCarrier.aircraft?.torpedoBombers === 4, 'expected torpedo bombers edited');
  assert(editedCarrier.aircraft?.readyAircraft === 24, `expected ready aircraft clamped to total, got ${editedCarrier.aircraft?.readyAircraft}`);
  assert(useNavalStore.getState().battleLog.some((event) => event.description.includes('air group edited')), 'expected edit event in battle log');
});

test('fleet formation effects alter AA and search profile', () => {
  resetLocalMultiplayerForTest();
  const baseFleet = fleet();
  baseFleet.ships.push(createShipForClass('destroyer', 'player', 'DD Screen', 720, 500, 270, 28, 'screen'));
  useNavalStore.setState({
    ...campaignState({ fleets: [baseFleet] }),
    commandHistory: [],
    pendingAuthorizations: [],
    fleetCommunications: [],
    battleLog: [],
  });
  const ok = useNavalStore.getState().setFleetFormation('tf_test', 'circular_screen');
  const nextFleet = useNavalStore.getState().fleets[0];
  const profile = getFleetCombatProfile(nextFleet);
  assert(ok, 'expected circular formation accepted');
  assert(nextFleet.formation?.type === 'circular_screen', `expected circular_screen, got ${nextFleet.formation?.type}`);
  assert(profile.formationEffects?.antiAirCenterModifier === 1.35, 'expected circular screen AA modifier');
  assert((profile.formationEffects?.effectiveAntiAir ?? 0) > profile.firepower.antiAir, 'expected effective AA boosted by formation');
  assert(nextFleet.ships.some((ship) => ship.commandState.formationId === 'circular_screen'), 'expected ship command formation ids updated');
});

test('detach damaged ships creates a withdrawal element', () => {
  resetLocalMultiplayerForTest();
  const baseFleet = fleet();
  const damaged = createShipForClass('destroyer', 'player', 'DD Damaged', 730, 500, 270, 24, 'screen');
  damaged.damage.status = 'damaged';
  damaged.damage.hullIntegrity = 45;
  baseFleet.ships.push(damaged);
  useNavalStore.setState({
    ...campaignState({ fleets: [baseFleet] }),
    commandHistory: [],
    pendingAuthorizations: [],
    fleetCommunications: [],
    battleLog: [],
  });
  const ok = useNavalStore.getState().detachDamagedShips('tf_test', 70);
  const next = useNavalStore.getState();
  const detached = next.fleets.find((item) => item.name.includes('Withdrawal Element'));
  const source = next.fleets.find((item) => item.id === 'tf_test');
  assert(ok, 'expected damaged detachment accepted');
  assert(next.fleets.length === 2, `expected two fleets after detachment, got ${next.fleets.length}`);
  assert(detached?.mission === 'withdraw', `expected detached mission withdraw, got ${detached?.mission}`);
  assert(detached?.navigation?.status === 'en_route', `expected withdrawal route, got ${detached?.navigation?.status}`);
  assert(!source?.ships.some((ship) => ship.id === damaged.id), 'expected damaged ship removed from source fleet');
});

test('returning sector search recovers to moving carrier instead of launch point', () => {
  resetLocalMultiplayerForTest();
  const state = campaignState();
  useNavalStore.setState({
    ...state,
    commandHistory: [],
    pendingAuthorizations: [],
    fleetCommunications: [],
    battleLog: [],
    airOperations: [],
  });
  useNavalStore.getState().setControlMode('human_multiplayer');
  const beforeReady = useNavalStore.getState().fleets[0].ships[0].aircraft?.readyAircraft ?? 0;
  const launchX = useNavalStore.getState().fleets[0].ships[0].position.x;
  const launched = useNavalStore.getState().launchAirSearchSector('tf_test', {
    headingDeg: 270,
    arcWidthDeg: 40,
    range: 40,
    fighters: 1,
    diveBombers: 1,
  });
  assert(launched, 'expected short-range sector search launched');
  assert((useNavalStore.getState().fleets[0].ships[0].aircraft?.readyAircraft ?? 0) === beforeReady - 2, 'expected aircraft occupied after launch');
  const moved = useNavalStore.getState().setFleetDestination('tf_test', { x: launchX + 260, y: 500 }, { mode: 'direct' });
  assert(moved, 'expected carrier movement order accepted');
  for (let i = 0; i < 16; i++) useNavalStore.getState().advanceNavalTurn();
  const next = useNavalStore.getState();
  const carrierX = next.fleets[0].ships[0].position.x;
  assert(carrierX > launchX + 30, `expected carrier to move away from launch point, got ${carrierX} from ${launchX}`);
  assert(next.airOperations.length === 0, `expected visible air operation recovered, got ${next.airOperations.length}`);
  assert((next.fleets[0].ships[0].aircraft?.readyAircraft ?? 0) === beforeReady, `expected aircraft restored to ${beforeReady}, got ${next.fleets[0].ships[0].aircraft?.readyAircraft}`);
  useNavalStore.getState().setControlMode('llm_commander');
});

test('priority doctrine launches CAP and recovers fighters after patrol endurance', () => {
  const automatedFleet = fleetWithAutomation(fleet(), { combat_air_patrol: 1 });
  loadAutomationStore({ fleets: [automatedFleet], currentTurn: 0 });
  const beforeReady = useNavalStore.getState().fleets[0].ships[0].aircraft?.readyAircraft ?? 0;

  useNavalStore.getState().runPlayerAutomationPulse();
  let next = useNavalStore.getState();
  assert(next.fleets[0].command?.automation?.lastTask === 'combat_air_patrol', `expected CAP last task, got ${next.fleets[0].command?.automation?.lastTask}`);
  assert(next.airOperations[0]?.type === 'cap', `expected visible CAP operation, got ${next.airOperations[0]?.type}`);
  assert(next.airOperations[0]?.status === 'outbound', `expected CAP airborne, got ${next.airOperations[0]?.status}`);
  assert((next.fleets[0].ships[0].aircraft?.readyAircraft ?? 0) === beforeReady - 4, 'expected automatic CAP to consume four fighters');

  for (let i = 0; i < 12; i++) useNavalStore.getState().advanceNavalTurn();
  next = useNavalStore.getState();
  assert(!next.airOperations.some((operation) => operation.type === 'cap'), 'expected CAP air operation recovered and cleared');
  assert((next.fleets[0].ships[0].aircraft?.readyAircraft ?? 0) === beforeReady, `expected fighters recovered to ${beforeReady}, got ${next.fleets[0].ships[0].aircraft?.readyAircraft}`);
  assert(next.battleLog.some((event: any) => event.description.includes('recovered 4 aircraft from cap mission')), 'expected CAP recovery log');
});

test('priority doctrine enters radio silence in low visibility', () => {
  const automatedFleet = fleetWithAutomation(fleet(), { radio_silence: 1 });
  loadAutomationStore({ fleets: [automatedFleet], currentTurn: 2, weather: 'fog' });

  useNavalStore.getState().runPlayerAutomationPulse();
  const next = useNavalStore.getState();
  assert(next.fleets[0].command?.automation?.lastTask === 'radio_silence', `expected radio silence task, got ${next.fleets[0].command?.automation?.lastTask}`);
  assert(next.fleets[0].operation?.posture === 'radio_silence', `expected radio_silence posture, got ${next.fleets[0].operation?.posture}`);
  assert(next.fleets[0].operation?.durationTurns === 3, 'expected radio silence duration');
});

test('priority doctrine deploys smoke screen against close tracked contact', () => {
  const automatedFleet = fleetWithAutomation(fleet(), { smoke_screen: 1 });
  const enemyContact = contact('smoke_enemy', 'tracked', 820, 500);
  loadAutomationStore({ fleets: [automatedFleet], contacts: [enemyContact], currentTurn: 2 });

  useNavalStore.getState().runPlayerAutomationPulse();
  const next = useNavalStore.getState();
  assert(next.fleets[0].command?.automation?.lastTask === 'smoke_screen', `expected smoke task, got ${next.fleets[0].command?.automation?.lastTask}`);
  assert(next.fleets[0].operation?.posture === 'smoke_screen', `expected smoke_screen posture, got ${next.fleets[0].operation?.posture}`);
  assert(next.fleets[0].command?.commanderIntent === 'avoid_contact', `expected avoid_contact intent, got ${next.fleets[0].command?.commanderIntent}`);
  assert(next.fleets[0].ships[0].headingDeg !== automatedFleet.ships[0].headingDeg, 'expected smoke order to alter heading across threat bearing');
});

test('priority doctrine plots evasive dog-leg away from nearby contact', () => {
  const automatedFleet = fleetWithAutomation(fleet(), { evasive_maneuver: 1 });
  const enemyContact = contact('evasion_enemy', 'tracked', 1040, 500);
  loadAutomationStore({ fleets: [automatedFleet], contacts: [enemyContact], currentTurn: 2 });

  useNavalStore.getState().runPlayerAutomationPulse();
  const next = useNavalStore.getState();
  const destination = next.fleets[0].navigation?.destination;
  const originalDistance = Math.hypot(enemyContact.lastKnownPosition.x - automatedFleet.position.globalX, enemyContact.lastKnownPosition.y - automatedFleet.position.globalY);
  const destinationDistance = destination
    ? Math.hypot(enemyContact.lastKnownPosition.x - destination.x, enemyContact.lastKnownPosition.y - destination.y)
    : 0;
  assert(next.fleets[0].command?.automation?.lastTask === 'evasive_maneuver', `expected evasive task, got ${next.fleets[0].command?.automation?.lastTask}`);
  assert(next.fleets[0].command?.commanderIntent === 'avoid_contact', `expected avoid_contact intent, got ${next.fleets[0].command?.commanderIntent}`);
  assert(next.fleets[0].navigation?.status === 'en_route', `expected evasion route en_route, got ${next.fleets[0].navigation?.status}`);
  assert(destinationDistance > originalDistance, `expected evasion destination farther from contact than ${originalDistance}, got ${destinationDistance}`);
});

test('priority doctrine shadows contact at carrier standoff range', () => {
  const automatedFleet = fleetWithAutomation(fleet(), { contact_shadow: 1 });
  const enemyContact = contact('shadow_enemy', 'tracked', 1400, 500);
  loadAutomationStore({ fleets: [automatedFleet], contacts: [enemyContact], currentTurn: 2 });

  useNavalStore.getState().runPlayerAutomationPulse();
  const next = useNavalStore.getState();
  const destination = next.fleets[0].navigation?.destination;
  const standoff = destination
    ? Math.hypot(enemyContact.lastKnownPosition.x - destination.x, enemyContact.lastKnownPosition.y - destination.y)
    : 0;
  assert(next.fleets[0].command?.automation?.lastTask === 'contact_shadow', `expected shadow task, got ${next.fleets[0].command?.automation?.lastTask}`);
  assert(next.fleets[0].mission === 'search', `expected search mission while shadowing, got ${next.fleets[0].mission}`);
  assert(next.fleets[0].operation?.targetContactId === 'shadow_enemy', `expected operation target shadow_enemy, got ${next.fleets[0].operation?.targetContactId}`);
  assert(standoff >= 520 && standoff <= 600, `expected carrier standoff about 560, got ${standoff}`);
});

test('priority doctrine routes depleted fleet to replenishment rendezvous', () => {
  const baseFleet = fleet();
  baseFleet.fuelState = 'limited';
  const automatedFleet = fleetWithAutomation(baseFleet, { rendezvous: 1 });
  loadAutomationStore({
    fleets: [automatedFleet],
    currentTurn: 2,
    facilities: [{ id: 'base_far', name: 'Forward Base Far', faction: 'player', type: 'naval_base', x: 940, y: 500 }],
  });

  useNavalStore.getState().runPlayerAutomationPulse();
  const next = useNavalStore.getState();
  assert(next.fleets[0].command?.automation?.lastTask === 'rendezvous', `expected rendezvous task, got ${next.fleets[0].command?.automation?.lastTask}`);
  assert(next.fleets[0].mission === 'resupply', `expected resupply mission, got ${next.fleets[0].mission}`);
  assert(next.fleets[0].operation?.posture === 'underway_replenishment', `expected underway replenishment posture, got ${next.fleets[0].operation?.posture}`);
  assert(next.fleets[0].navigation?.mode === 'rendezvous', `expected rendezvous route mode, got ${next.fleets[0].navigation?.mode}`);
  assert(next.fleets[0].navigation?.destination.x === 940, `expected route to friendly base x=940, got ${next.fleets[0].navigation?.destination.x}`);
});

await testAsync('human command can issue fleet-level prepare strike posture', async () => {
  const state = campaignState();
  useNavalStore.setState({
    ...state,
    commandHistory: [],
    pendingAuthorizations: [],
    fleetCommunications: [],
  });
  const receipt = useNavalStore.getState().submitNavalCommand('prepare strike with 10 aircraft confirm', ['tf_test']);
  const next = useNavalStore.getState();
  assert(receipt.accepted, `expected prepare strike accepted: ${receipt.resultSummary}`);
  assert(next.fleets[0].operation?.posture === 'strike_preparation', `expected strike_preparation, got ${next.fleets[0].operation?.posture}`);
  assert(next.commandHistory[0]?.actions[0]?.type === 'prepare_strike', `expected prepare_strike command action, got ${next.commandHistory[0]?.actions[0]?.type}`);
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

test('human annihilate enemy command assigns decisive objective', () => {
  const baseFleet = fleet();
  useNavalStore.setState({
    ...campaignState({ fleets: [baseFleet] }),
    commandHistory: [],
    pendingAuthorizations: [],
    fleetCommunications: [],
  });
  const receipt = useNavalStore.getState().submitNavalCommand('annihilate enemy', ['tf_test']);
  const next = useNavalStore.getState();
  const updated = next.fleets.find(f => f.id === 'tf_test');
  assert(receipt.accepted, `expected annihilate command accepted: ${receipt.resultSummary}`);
  assert(receipt.specialOrders[0]?.type === 'assign_objective', `expected assign_objective, got ${receipt.specialOrders[0]?.type}`);
  assert(updated?.command?.commanderIntent === 'seek_decisive_battle', `expected seek_decisive_battle, got ${updated?.command?.commanderIntent}`);
  assert(updated?.mission === 'intercept', `expected intercept mission, got ${updated?.mission}`);
  assert(next.commandHistory.length === 1, 'expected command history saved');
});

test('human multiplayer mode disables automatic AI orders', () => {
  resetLocalMultiplayerForTest();
  const player = fleet();
  player.type = 'surface_action_group';
  player.ships = [createShipForClass('heavy_cruiser', 'player', 'CA Human', 700, 500, 90, 20, 'surface_combatant')];
  player.position = { ...player.position, globalX: 700, globalY: 500 };
  const enemyShip = createShipForClass('heavy_cruiser', 'enemy', 'CA Opponent', 800, 500, 270, 20, 'surface_combatant');
  const enemy: StrategicFleet = {
    id: 'enemy_human',
    name: 'Enemy Human',
    faction: 'enemy',
    type: 'surface_action_group',
    position: { regionX: 0, regionY: 0, chunkX: 0, chunkY: 0, globalX: 800, globalY: 500 },
    ships: [enemyShip],
    command: { controller: 'enemy_ai', riskTolerance: 'medium', engagementPolicy: 'engage_if_advantage', preserveCapitalShips: true },
    mission: 'patrol',
    fuelState: 'good',
    ammoState: 'good',
    detectedByPlayer: false,
  };
  const state = campaignState({ fleets: [player, enemy], contacts: [contact('enemy_human_track', 'tracked', 800, 500)] });
  useNavalStore.setState({
    ...state,
    intel: {
      ...state.intel,
      playerContacts: [contact('enemy_human_track', 'tracked', 800, 500)],
      enemyContacts: [contact('player_human_track', 'tracked', 700, 500)],
    },
    battleLog: [],
  });
  useNavalStore.getState().setControlMode('human_multiplayer');
  useNavalStore.getState().advanceNavalTurn();
  const next = useNavalStore.getState();
  assert(next.localMultiplayer.mode === 'human_multiplayer', 'expected human multiplayer mode');
  assert(!next.battleLog.some(e => e.type === 'change_course' || e.type === 'fire_main_guns' || e.type === 'fire_torpedoes'), 'expected no generated AI order events in human mode');
  useNavalStore.getState().setControlMode('llm_commander');
});

test('human multiplayer can transfer detachment and cross-control ships', () => {
  resetLocalMultiplayerForTest();
  const baseFleet = fleet();
  const dd = createShipForClass('destroyer', 'player', 'DD Transfer', 710, 510, 270, 28, 'screen');
  baseFleet.ships.push(dd);
  useNavalStore.setState({
    ...campaignState({ fleets: [baseFleet] }),
    commandHistory: [],
    pendingAuthorizations: [],
    fleetCommunications: [],
    battleLog: [],
  });
  const store = useNavalStore.getState();
  store.setControlMode('human_multiplayer');
  store.setActiveLocalPlayer('red_command');
  const splitOk = useNavalStore.getState().splitFleetToLocalPlayer('tf_test', [dd.id], 'red_command', 'Red Detachment');
  let next = useNavalStore.getState();
  const detached = next.fleets.find(f => f.name === 'Red Detachment');
  assert(splitOk, 'expected split to active red player');
  assert(detached, 'expected detached fleet created');
  assert(next.localMultiplayer.fleetOwners[detached!.id] === 'red_command', 'expected red owns detached fleet');
  assert(next.localMultiplayer.shipOwners[dd.id] === 'red_command', 'expected red owns detached ship');

  useNavalStore.getState().setActiveLocalPlayer('blue_command');
  const directOk = useNavalStore.getState().directControlShipsAsLocalPlayer(detached!.id, [dd.id], {
    headingDeg: 180,
    speedKts: 12,
    reason: 'blue cross-control test',
  });
  next = useNavalStore.getState();
  const controlledShip = next.fleets.find(f => f.id === detached!.id)?.ships.find(s => s.id === dd.id);
  assert(directOk, 'expected cross-player direct control accepted');
  assert(controlledShip?.headingDeg === 180, `expected heading 180, got ${controlledShip?.headingDeg}`);
  assert(controlledShip?.targetSpeedKts === 12, `expected speed 12, got ${controlledShip?.targetSpeedKts}`);
  assert(next.localMultiplayer.shipOwners[dd.id] === 'red_command', 'direct control should not change ownership');
  useNavalStore.getState().setControlMode('llm_commander');
});

test('human multiplayer approval gates cross-control when disabled', () => {
  resetLocalMultiplayerForTest();
  const baseFleet = fleet();
  const dd = createShipForClass('destroyer', 'player', 'DD Approval', 710, 510, 270, 28, 'screen');
  baseFleet.ships.push(dd);
  useNavalStore.setState({
    ...campaignState({ fleets: [baseFleet] }),
    commandHistory: [],
    pendingAuthorizations: [],
    fleetCommunications: [],
    battleLog: [],
  });
  useNavalStore.getState().setControlMode('human_multiplayer');
  useNavalStore.getState().setLocalCrossControl(false);
  useNavalStore.getState().setActiveLocalPlayer('red_command');
  const requested = useNavalStore.getState().directControlShipsAsLocalPlayer('tf_test', [dd.id], {
    headingDeg: 180,
    speedKts: 12,
    reason: 'red requests cross-control',
  });
  let next = useNavalStore.getState();
  let controlledShip = next.fleets.find(f => f.id === 'tf_test')?.ships.find(s => s.id === dd.id);
  assert(requested, 'expected cross-control request queued');
  assert(next.localMultiplayer.pendingOrders.length === 1, 'expected one local pending order');
  assert(controlledShip?.headingDeg !== 180, 'ship should not turn before approval');
  assert(next.localMultiplayer.pendingOrders[0].approverPlayerId === 'blue_command', 'expected blue owner approval');

  useNavalStore.getState().setActiveLocalPlayer('blue_command');
  const approved = useNavalStore.getState().approveLocalPendingOrder(next.localMultiplayer.pendingOrders[0].id, true);
  next = useNavalStore.getState();
  controlledShip = next.fleets.find(f => f.id === 'tf_test')?.ships.find(s => s.id === dd.id);
  assert(approved, 'expected approval accepted');
  assert(next.localMultiplayer.pendingOrders.length === 0, 'expected approval queue cleared');
  assert(controlledShip?.headingDeg === 180, `expected heading after approval, got ${controlledShip?.headingDeg}`);
  assert(controlledShip?.targetSpeedKts === 12, `expected speed after approval, got ${controlledShip?.targetSpeedKts}`);
  useNavalStore.getState().setControlMode('llm_commander');
});

test('human multiplayer fleet messages queue with distance delay and deliver on turn advance', () => {
  resetLocalMultiplayerForTest();
  const first = fleet();
  const second = fleet();
  second.id = 'tf_second';
  second.name = 'TF Second';
  second.position = { ...second.position, globalX: 2100, globalY: 500 };
  second.ships = second.ships.map(ship => ({ ...ship, id: `${ship.id}_second`, name: `${ship.name} Second`, position: { x: 2100, y: 500 } }));
  useNavalStore.setState({
    ...campaignState({ fleets: [first, second] }),
    currentTurn: 2,
    commandHistory: [],
    pendingAuthorizations: [],
    fleetCommunications: [],
    battleLog: [],
    weather: 'clear',
  });
  useNavalStore.getState().setControlMode('human_multiplayer');
  const sent = useNavalStore.getState().sendFleetMessage('tf_test', 'tf_second', 'hold screen station');
  let next = useNavalStore.getState();
  const message = next.fleetCommunications[0];
  assert(sent, 'expected message queued');
  assert(message.status === 'queued', 'expected queued message');
  assert((message.deliveredTurn ?? 0) > next.currentTurn + 1, `expected distance delay, got T${message.deliveredTurn}`);
  while (useNavalStore.getState().currentTurn < (message.deliveredTurn ?? 0)) {
    useNavalStore.getState().advanceNavalTurn();
  }
  next = useNavalStore.getState();
  assert(next.fleetCommunications[0].status === 'delivered', `expected delivered, got ${next.fleetCommunications[0].status}`);
  useNavalStore.getState().setControlMode('llm_commander');
});

test('human multiplayer ready markers reset after turn resolution', () => {
  resetLocalMultiplayerForTest();
  useNavalStore.setState({
    ...campaignState({ fleets: [fleet()] }),
    battleLog: [],
  });
  useNavalStore.getState().setControlMode('human_multiplayer');
  useNavalStore.getState().markLocalPlayerReady('blue_command', true);
  useNavalStore.getState().markLocalPlayerReady('red_command', true);
  assert(useNavalStore.getState().localMultiplayer.readyPlayerIds.length === 2, 'expected two ready players');
  useNavalStore.getState().advanceNavalTurn();
  assert(useNavalStore.getState().localMultiplayer.readyPlayerIds.length === 0, 'expected ready markers cleared after resolution');
  useNavalStore.getState().setControlMode('llm_commander');
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

test('annihilate enemy objective drives both factions through own contact boards', () => {
  const playerShip = createShipForClass('heavy_cruiser', 'player', 'CA Objective Test', 700, 500, 90, 20, 'surface_combatant');
  const enemyShip = createShipForClass('battleship', 'enemy', 'BB Objective Target', 724, 500, 270, 20, 'surface_combatant');
  const playerFleet: StrategicFleet = {
    id: 'p_objective_sag',
    name: 'Player Objective SAG',
    faction: 'player',
    type: 'surface_action_group',
    position: { regionX: 0, regionY: 0, chunkX: 0, chunkY: 0, globalX: 700, globalY: 500 },
    ships: [playerShip],
    command: {
      controller: 'player_direct',
      riskTolerance: 'medium',
      engagementPolicy: 'engage_if_advantage',
      preserveCapitalShips: true,
    },
    mission: 'patrol',
    fuelState: 'good',
    ammoState: 'good',
    detectedByPlayer: true,
  };
  const enemyFleet: StrategicFleet = {
    id: 'e_objective_sag',
    name: 'Enemy Objective SAG',
    faction: 'enemy',
    type: 'surface_action_group',
    position: { regionX: 0, regionY: 0, chunkX: 0, chunkY: 0, globalX: 724, globalY: 500 },
    ships: [enemyShip],
    command: {
      controller: 'enemy_ai',
      riskTolerance: 'medium',
      engagementPolicy: 'engage_if_advantage',
      preserveCapitalShips: true,
    },
    mission: 'patrol',
    fuelState: 'good',
    ammoState: 'good',
    detectedByPlayer: false,
  };
  const playerContact: NavalContact = {
    ...contact('enemy_track', 'tracked', 724, 500),
    originalEntityId: enemyShip.id,
    estimatedClass: 'battleship',
  };
  const enemyContact: NavalContact = {
    ...contact('player_track', 'tracked', 700, 500),
    originalEntityId: playerShip.id,
    estimatedClass: 'heavy_cruiser',
  };
  const state = campaignState({ fleets: [playerFleet, enemyFleet], contacts: [playerContact] });
  useNavalStore.setState({
    ...state,
    intel: {
      ...state.intel,
      playerContacts: [playerContact],
      enemyContacts: [enemyContact],
      searchMissions: [],
    },
    battleLog: [],
    reports: [],
    commandHistory: [],
    pendingAuthorizations: [],
    fleetCommunications: [],
  });

  const assigned = useNavalStore.getState().assignFleetObjective(['p_objective_sag', 'e_objective_sag'], 'annihilate_enemy');
  assert(assigned, 'expected objective assignment accepted');
  let next = useNavalStore.getState();
  assert(next.fleets.find(f => f.id === 'p_objective_sag')?.command?.commanderIntent === 'seek_decisive_battle', 'expected player decisive intent');
  assert(next.fleets.find(f => f.id === 'e_objective_sag')?.command?.commanderIntent === 'seek_decisive_battle', 'expected enemy decisive intent');

  useNavalStore.getState().advanceNavalTurn();
  next = useNavalStore.getState();
  assert(next.battleLog.some(e => e.type === 'fire_main_guns' && e.shipId === playerShip.id), 'expected player fleet to fire on own known enemy contact');
  assert(next.battleLog.some(e => e.type === 'fire_main_guns' && e.shipId === enemyShip.id), 'expected enemy fleet to fire on enemyContacts known player contact');
  assert(next.intel.enemyContacts.some(c => c.id === 'player_track' || c.originalEntityId === playerShip.id), 'expected enemy contact board preserved/updated');
});

console.log(`\nRegression tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
