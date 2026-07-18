import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useNavalStore } from '../src/store/naval-store';
import { createShipForClass } from '../src/game/naval/naval-debug';
import { createDefaultIntelState, type NavalContact } from '../src/game/naval/intel/naval-intel-types';
import type { StrategicFleet } from '../src/game/naval/naval-strategic-types';
import type { NavalShip } from '../src/game/naval/ship/ship-types';

declare const process: any;

type TurnSnapshot = {
  turn: number;
  distance: number;
  victory: string;
  playerMission?: string;
  enemyMission?: string;
  playerIntent?: string;
  enemyIntent?: string;
  playerContacts: number;
  enemyContacts: number;
  searchMissions: number;
  playerHullMin: number;
  enemyHullMin: number;
  playerDamaged: number;
  enemyDamaged: number;
  newEvents: Array<{ type: string; shipId?: string; targetId?: string; description: string }>;
};

function mulberry32(seed: number) {
  let value = seed;
  return () => {
    value |= 0;
    value = value + 0x6D2B79F5 | 0;
    let t = Math.imul(value ^ value >>> 15, 1 | value);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function fleetCenter(ships: NavalShip[]) {
  return {
    x: Math.round(ships.reduce((sum, ship) => sum + ship.position.x, 0) / ships.length),
    y: Math.round(ships.reduce((sum, ship) => sum + ship.position.y, 0) / ships.length),
  };
}

function makeFleet(params: {
  id: string;
  name: string;
  faction: 'player' | 'enemy';
  ships: NavalShip[];
}): StrategicFleet {
  const center = fleetCenter(params.ships);
  return {
    id: params.id,
    name: params.name,
    faction: params.faction,
    type: 'surface_action_group',
    position: { regionX: 0, regionY: 0, chunkX: 0, chunkY: 0, globalX: center.x, globalY: center.y },
    ships: params.ships,
    command: {
      controller: params.faction === 'enemy' ? 'enemy_ai' : 'player_direct',
      riskTolerance: 'medium',
      engagementPolicy: 'engage_if_advantage',
      preserveCapitalShips: true,
    },
    mission: 'patrol',
    fuelState: 'good',
    ammoState: 'good',
    detectedByPlayer: params.faction === 'player',
  };
}

function makeContact(params: {
  id: string;
  originalEntityId: string;
  x: number;
  y: number;
  estimatedClass: NavalContact['estimatedClass'];
}): NavalContact {
  return {
    id: params.id,
    originalEntityId: params.originalEntityId,
    contactType: 'surface_ship',
    detectionLevel: 'tracked',
    factionEstimate: 'enemy',
    estimatedClass: params.estimatedClass,
    estimatedCount: 1,
    lastKnownPosition: { x: params.x, y: params.y },
    uncertaintyRadius: 6,
    lastDetectedTurn: 0,
    confidence: 'high',
    detectedBy: [],
    trackHistory: [],
    stale: false,
  };
}

function minHull(fleet?: StrategicFleet) {
  if (!fleet || fleet.ships.length === 0) return 0;
  return Math.round(Math.min(...fleet.ships.map((ship) => ship.damage.hullIntegrity)));
}

function damagedCount(fleet?: StrategicFleet) {
  return fleet?.ships.filter((ship) => ship.damage.status !== 'combat_effective').length ?? 0;
}

function distanceBetween(a?: StrategicFleet, b?: StrategicFleet) {
  if (!a || !b) return 0;
  return Math.round(Math.hypot(a.position.globalX - b.position.globalX, a.position.globalY - b.position.globalY));
}

async function main() {
  const originalRandom = Math.random;
  Math.random = mulberry32(19420604);

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(process.cwd(), 'artifacts', 'test-runs', `bilateral-objective-${runId}`);
  await mkdir(runDir, { recursive: true });

  try {
    const playerShips = [
      createShipForClass('battleship', 'player', 'BB Washington', 700, 500, 90, 20, 'surface_combatant'),
      createShipForClass('heavy_cruiser', 'player', 'CA Northampton', 696, 504, 90, 22, 'surface_combatant'),
      createShipForClass('light_cruiser', 'player', 'CL Atlanta', 696, 496, 90, 24, 'screen'),
      createShipForClass('destroyer', 'player', 'DD Fletcher', 692, 500, 90, 28, 'torpedo_attack'),
    ];
    const enemyShips = [
      createShipForClass('battleship', 'enemy', 'BB Kongo', 724, 500, 270, 20, 'surface_combatant'),
      createShipForClass('heavy_cruiser', 'enemy', 'CA Tone', 728, 504, 270, 22, 'surface_combatant'),
      createShipForClass('light_cruiser', 'enemy', 'CL Sendai', 728, 496, 270, 24, 'screen'),
      createShipForClass('destroyer', 'enemy', 'DD Kagero', 732, 500, 270, 28, 'torpedo_attack'),
    ];

    const playerFleet = makeFleet({ id: 'sim_player_sag', name: 'Player Battle Line', faction: 'player', ships: playerShips });
    const enemyFleet = makeFleet({ id: 'sim_enemy_sag', name: 'Enemy Battle Line', faction: 'enemy', ships: enemyShips });
    const intel = createDefaultIntelState();
    intel.playerContacts = [makeContact({
      id: 'enemy_battle_line_track',
      originalEntityId: enemyShips[0].id,
      x: enemyFleet.position.globalX,
      y: enemyFleet.position.globalY,
      estimatedClass: 'battleship',
    })];
    intel.enemyContacts = [makeContact({
      id: 'player_battle_line_track',
      originalEntityId: playerShips[0].id,
      x: playerFleet.position.globalX,
      y: playerFleet.position.globalY,
      estimatedClass: 'battleship',
    })];

    useNavalStore.setState({
      overlay: [],
      fleets: [playerFleet, enemyFleet],
      selectedFleetId: playerFleet.id,
      facilities: [],
      shippingLanes: [],
      islands: [],
      tacticalMaps: [],
      airOperations: [],
      landAirfields: [],
      weather: 'clear',
      victory: 'none',
      intel,
      reports: [],
      commandHistory: [],
      pendingAuthorizations: [],
      fleetCommunications: [],
      currentTurn: 0,
      environment: {
        timeOfDay: 'day',
        weather: 'clear',
        seaState: 1,
        windDirectionDeg: 90,
        windSpeedKts: 10,
        visibilityModifier: 1,
      },
      battleLog: [],
      navalMode: 'strategic',
    });

    const assigned = useNavalStore.getState().assignFleetObjective(
      [playerFleet.id, enemyFleet.id],
      'annihilate_enemy',
    );

    const snapshots: TurnSnapshot[] = [];
    const maxTurns = 20;
    for (let i = 0; i < maxTurns; i++) {
      const beforeLogLength = useNavalStore.getState().battleLog.length;
      useNavalStore.getState().advanceNavalTurn();
      const state = useNavalStore.getState();
      const player = state.fleets.find((fleet) => fleet.id === playerFleet.id);
      const enemy = state.fleets.find((fleet) => fleet.id === enemyFleet.id);
      const newEvents = state.battleLog.slice(beforeLogLength).map((event) => ({
        type: event.type,
        shipId: event.shipId,
        targetId: event.targetId,
        description: event.description,
      }));
      snapshots.push({
        turn: state.currentTurn,
        distance: distanceBetween(player, enemy),
        victory: state.victory,
        playerMission: player?.mission,
        enemyMission: enemy?.mission,
        playerIntent: player?.command?.commanderIntent,
        enemyIntent: enemy?.command?.commanderIntent,
        playerContacts: state.intel.playerContacts.length,
        enemyContacts: state.intel.enemyContacts.length,
        searchMissions: state.intel.searchMissions.length,
        playerHullMin: minHull(player),
        enemyHullMin: minHull(enemy),
        playerDamaged: damagedCount(player),
        enemyDamaged: damagedCount(enemy),
        newEvents,
      });
      if (state.victory !== 'none') break;
    }

    const finalState = useNavalStore.getState();
    const shipFaction = new Map(finalState.fleets.flatMap((fleet) => fleet.ships.map((ship) => [ship.id, fleet.faction] as const)));
    const playerFired = finalState.battleLog.some((event) => event.type === 'fire_main_guns' && shipFaction.get(String(event.shipId)) === 'player');
    const enemyFired = finalState.battleLog.some((event) => event.type === 'fire_main_guns' && shipFaction.get(String(event.shipId)) === 'enemy');
    const playerTorpedoes = finalState.battleLog.some((event) => event.type === 'fire_torpedoes' && shipFaction.get(String(event.shipId)) === 'player');
    const enemyTorpedoes = finalState.battleLog.some((event) => event.type === 'fire_torpedoes' && shipFaction.get(String(event.shipId)) === 'enemy');
    const damageEvents = finalState.battleLog.filter((event) =>
      !['human_command', 'change_course', 'change_speed', 'fire_main_guns', 'fire_torpedoes'].includes(event.type)
    );
    const finalPlayer = finalState.fleets.find((fleet) => fleet.id === playerFleet.id);
    const finalEnemy = finalState.fleets.find((fleet) => fleet.id === enemyFleet.id);
    const summary = {
      ok: assigned && playerFired && enemyFired && damageEvents.length > 0,
      assigned,
      completedDestruction: finalState.victory !== 'none',
      victory: finalState.victory,
      turnsRun: snapshots.length,
      playerIntent: finalPlayer?.command?.commanderIntent,
      enemyIntent: finalEnemy?.command?.commanderIntent,
      playerMission: finalPlayer?.mission,
      enemyMission: finalEnemy?.mission,
      playerFired,
      enemyFired,
      playerTorpedoes,
      enemyTorpedoes,
      damageEvents: damageEvents.length,
      finalDistance: distanceBetween(finalPlayer, finalEnemy),
      playerHullMin: minHull(finalPlayer),
      enemyHullMin: minHull(finalEnemy),
      playerDamaged: damagedCount(finalPlayer),
      enemyDamaged: damagedCount(finalEnemy),
      playerContacts: finalState.intel.playerContacts.map((contact) => ({
        id: contact.id,
        level: contact.detectionLevel,
        class: contact.estimatedClass,
        x: Math.round(contact.lastKnownPosition.x),
        y: Math.round(contact.lastKnownPosition.y),
      })),
      enemyContacts: finalState.intel.enemyContacts.map((contact) => ({
        id: contact.id,
        level: contact.detectionLevel,
        class: contact.estimatedClass,
        x: Math.round(contact.lastKnownPosition.x),
        y: Math.round(contact.lastKnownPosition.y),
      })),
    };

    await writeFile(join(runDir, 'summary.json'), JSON.stringify({ summary, snapshots }, null, 2));
    await writeFile(join(runDir, 'summary.md'), [
      '# Bilateral Annihilate Objective Simulation',
      '',
      `- Assigned objective: ${assigned ? 'yes' : 'no'}`,
      `- Result: ${summary.ok ? 'PASS' : 'FAIL'}`,
      `- Completed destruction/victory: ${summary.completedDestruction ? `yes (${summary.victory})` : 'no'}`,
      `- Turns run: ${summary.turnsRun}`,
      `- Player fired main guns: ${summary.playerFired}`,
      `- Enemy fired main guns: ${summary.enemyFired}`,
      `- Damage events: ${summary.damageEvents}`,
      `- Final distance: ${summary.finalDistance}`,
      `- Player min hull: ${summary.playerHullMin}`,
      `- Enemy min hull: ${summary.enemyHullMin}`,
      '',
      '## Turns',
      '',
      ...snapshots.map((snapshot) => [
        `### Turn ${snapshot.turn}`,
        `- Distance: ${snapshot.distance}`,
        `- Victory: ${snapshot.victory}`,
        `- Player: ${snapshot.playerMission}/${snapshot.playerIntent}, contacts ${snapshot.playerContacts}, min hull ${snapshot.playerHullMin}, damaged ${snapshot.playerDamaged}`,
        `- Enemy: ${snapshot.enemyMission}/${snapshot.enemyIntent}, contacts ${snapshot.enemyContacts}, min hull ${snapshot.enemyHullMin}, damaged ${snapshot.enemyDamaged}`,
        `- Events: ${snapshot.newEvents.length}`,
        ...snapshot.newEvents.slice(0, 8).map((event) => `  - ${event.type}: ${event.description}`),
        '',
      ].join('\n')),
    ].join('\n'));

    console.log(JSON.stringify({ runDir, summary }, null, 2));
    if (!summary.ok) process.exitCode = 1;
  } finally {
    Math.random = originalRandom;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
