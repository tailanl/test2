import { generateStratMap } from '../src/game/naval/naval-map-generator';
import {
  campaignDecisionToActions,
  normalizeCampaignDecision,
  parseCampaignDecision,
} from '../src/ai/naval-campaign-policy';
import { createShipForClass } from '../src/game/naval/naval-debug';
import type { NavalContact } from '../src/game/naval/intel/naval-intel-types';
import type { StrategicFleet } from '../src/game/naval/naval-strategic-types';

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

console.log(`\nRegression tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
