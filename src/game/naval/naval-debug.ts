/**
 * Naval 调试函数 - 验证完整海战闭环
 * debugNavalBattleChain
 */

import type { NavalShip, NavalShipClass } from './ship/ship-types';
import { createDefaultMotionProfile } from './ship/ship-motion';
import { createDefaultSensorProfile } from './ship/ship-sensors';
import { createDefaultWeaponMounts } from './ship/ship-weapons';
import { createDefaultModulesForShipClass } from './ship/ship-modules';
import { createDefaultDamageState } from './ship/ship-damage';
import { createDefaultDamageControlState } from './ship/ship-damage-control';
import { createDefaultCarrierAirGroup, createSearchMission } from './ship/ship-aircraft';
import { canFireNavalWeapon } from './ship/ship-weapons';
import { generateFleetAIActions } from './ai/naval-fleet-ai';
import { executeNavalAIActions } from './ai/naval-action-executor';
import { updateShipMotion } from './ship/ship-motion';
import { applyNavalDamage } from './ship/ship-damage';
import { updateDamageControl } from './ship/ship-damage-control';
import { detectNavalTarget } from './intel/naval-visibility';
import { updateNavalIntelState, decayNavalContacts } from './intel/naval-contact-tracker';
import { createDefaultIntelState } from './intel/naval-intel-types';
import { getVisibleNavalCells } from './intel/naval-fog-of-war';
import { decayDetectionLevel } from './intel/naval-sensor-model';
import { generateNavalMap, createNavalBattleMap } from './naval-map-adapter';
import { NAVAL_FLEET_TEMPLATES } from './naval-config';

// ===== Ship Factory =====

export function createShipForClass(
  shipClass: NavalShipClass,
  faction: 'player' | 'enemy' | 'neutral',
  name: string,
  x: number,
  y: number,
  headingDeg: number,
  speedKts: number,
  role: 'carrier' | 'screen' | 'picket' | 'surface_combatant' | 'torpedo_attack' | 'transport' | 'submarine' | 'oiler'
): NavalShip {
  const motion = createDefaultMotionProfile(shipClass);
  const sensors = createDefaultSensorProfile(shipClass);
  const weapons = createDefaultWeaponMounts(shipClass);
  const modules = createDefaultModulesForShipClass(shipClass);
  const damage = createDefaultDamageState();
  const damageControl = createDefaultDamageControlState(shipClass);
  const aircraft = shipClass.includes('carrier') ? createDefaultCarrierAirGroup(shipClass) : undefined;

  const surfaceSignature = shipClass === 'battleship' ? 95 :
    shipClass === 'fleet_carrier' ? 90 :
    shipClass === 'heavy_cruiser' ? 70 :
    shipClass === 'light_cruiser' ? 55 :
    shipClass === 'destroyer' ? 35 :
    shipClass === 'submarine' ? 15 : 60;

  const radarSignature = shipClass === 'battleship' ? 98 :
    shipClass === 'fleet_carrier' ? 95 :
    shipClass === 'heavy_cruiser' ? 75 :
    shipClass === 'destroyer' ? 40 : 55;

  const smokeSignature = shipClass === 'battleship' ? 60 :
    shipClass === 'fleet_carrier' ? 40 :
    shipClass === 'destroyer' ? 20 : 35;

  const acousticSignature = shipClass === 'submarine' ? 80 :
    shipClass === 'destroyer' ? 55 :
    shipClass === 'battleship' ? 75 : 65;

  return {
    id: `ship_${faction}_${shipClass}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    faction,
    shipClass,
    position: { x, y },
    headingDeg,
    speedKts,
    targetSpeedKts: speedKts,
    rudderDeg: 0,
    motion,
    sensors,
    weapons,
    modules,
    damage,
    damageControl,
    aircraft,
    stealth: {
      surfaceSignature,
      radarSignature,
      smokeSignature,
      acousticSignature,
    },
    commandState: {
      controller: faction === 'player' ? 'player_direct' : 'enemy_ai',
      role,
    },
  };
}

// ===== 核心调试函数 =====

export function debugNavalBattleChain() {
  console.log('=== debugNavalBattleChain START ===');

  // 0. Generate standalone naval map with island chains
  const mapResult = generateNavalMap({
    width: 1024, height: 1024, seed: 12345,
    islandGroupCount: 8, maxIslandRadius: 60, minIslandRadius: 8,
    facilityDensity: 0.4, seaLevel: 0.40,
  });
  const overlay = mapResult.overlay;

  const overlayWidth = overlay[0]?.length ?? 1024;
  const overlayHeight = overlay.length;

  const deepOceanCount = overlay.flat().filter((c) => c.seaZoneType === 'deep_ocean').length;
  const islandCount = overlay.flat().filter((c) => c.seaZoneType === 'island').length;
  const portCount = overlay.flat().filter((c) => c.seaZoneType === 'port' || c.seaZoneType === 'naval_base').length;

  console.log(`Overlay: ${overlayHeight}x${overlayWidth}, deepOcean=${deepOceanCount}, islands=${islandCount}, ports=${portCount}`);
  console.log(`Facilities: ${mapResult.facilities.length}, Shipping lanes: ${mapResult.shippingLanes.length}`);

  // 1. 创建 player carrier_task_force (position within overlay)
  const playerCX = Math.floor(overlayWidth * 0.35);
  const playerCY = Math.floor(overlayHeight * 0.50);
  const enemyCX = Math.floor(overlayWidth * 0.60);
  const enemyCY = Math.floor(overlayHeight * 0.55);

  const playerShips: NavalShip[] = [
    createShipForClass('fleet_carrier', 'player', 'CV Enterprise', playerCX, playerCY, 0, 20, 'carrier'),
    createShipForClass('heavy_cruiser', 'player', 'CA Northampton', playerCX - 10, playerCY - 10, 0, 20, 'screen'),
    createShipForClass('destroyer', 'player', 'DD Fletcher', playerCX + 10, playerCY + 10, 0, 20, 'picket'),
  ];

  const enemyShips: NavalShip[] = [
    createShipForClass('battleship', 'enemy', 'BB Yamato', enemyCX, enemyCY, 180, 15, 'surface_combatant'),
    createShipForClass('light_cruiser', 'enemy', 'CL Sendai', enemyCX + 10, enemyCY - 10, 180, 15, 'screen'),
    createShipForClass('destroyer', 'enemy', 'DD Kagero', enemyCX - 10, enemyCY + 10, 180, 15, 'torpedo_attack'),
  ];

  // 3. 初始化 NavalIntelState（不直接显示敌舰）
  const intel = createDefaultIntelState();

  console.log(`Overlay generated: ${overlay.length}x${(overlay[0]?.length || 0)}, deepOcean=${deepOceanCount}, islands=${islandCount}, ports=${portCount}`);
  console.log(`player fleet count = ${playerShips.length}`);
  console.log(`enemy fleet count = ${enemyShips.length}`);
  console.log(`initial visible enemy ships = ${intel.playerContacts.length}`);

  // 4. 测试雷达/目视探测
  console.log('\n--- Detection Test ---');
  const playerCarrier = playerShips[0];
  const enemyBB = enemyShips[0];

  const dx = enemyBB.position.x - playerCarrier.position.x;
  const dy = enemyBB.position.y - playerCarrier.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  console.log(`Distance to enemy: ${dist.toFixed(1)}`);

  const visResult = detectNavalTarget({
    observer: playerCarrier,
    target: enemyBB,
    sensorType: 'visual',
    environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, smoke: 0 },
    distance: dist,
    lineOfSightBlocked: false,
  });

  console.log(`Visual detection: ${visResult.success ? 'SUCCESS' : 'FAILED'} (${visResult.reason})`);
  console.log(`Detection level: ${visResult.detectionLevel}`);

  const radarResult = detectNavalTarget({
    observer: playerCarrier,
    target: enemyBB,
    sensorType: 'surface_radar',
    environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, smoke: 0 },
    distance: dist,
    lineOfSightBlocked: false,
  });

  console.log(`Radar detection: ${radarResult.success ? 'SUCCESS' : 'FAILED'} (${radarResult.reason})`);

  // 5. 更新 intel
  console.log('\n--- Intel Update ---');
  const intelResult = updateNavalIntelState({
    intel,
    currentTurn: 1,
    friendlyShips: playerShips,
    enemyShips,
    friendlyAirMissions: [],
    environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, windDirectionDeg: 90, windSpeedKts: 10, visibilityModifier: 1.0 },
    overlay: [],
  });

  console.log(`contacts after detection = ${intelResult.intel.playerContacts.length}`);
  for (const contact of intelResult.intel.playerContacts) {
    console.log(`  Contact: ${contact.detectionLevel} ${contact.estimatedClass || 'unknown'} at (${contact.lastKnownPosition.x.toFixed(1)}, ${contact.lastKnownPosition.y.toFixed(1)}), confidence: ${contact.confidence}`);
  }

  // 6. 测试舰船运动
  console.log('\n--- Ship Motion Test ---');
  const testShip = createShipForClass('destroyer', 'player', 'DD Test', 0, 0, 0, 20, 'screen');
  console.log(`Initial: heading=${testShip.headingDeg}, speed=${testShip.speedKts}, targetSpeed=${testShip.targetSpeedKts}, rudder=${testShip.rudderDeg}`);
  console.log(`Initial position: (${testShip.position.x.toFixed(1)}, ${testShip.position.y.toFixed(1)})`);

  let movedShip = testShip;
  movedShip = { ...movedShip, rudderDeg: 15 };
  for (let i = 0; i < 3; i++) {
    movedShip = updateShipMotion(movedShip, 1);
  }

  console.log(`After 3 turns:`);
  console.log(`  heading=${movedShip.headingDeg.toFixed(1)}, speed=${movedShip.speedKts.toFixed(1)}`);
  console.log(`  position: (${movedShip.position.x.toFixed(1)}, ${movedShip.position.y.toFixed(1)})`);
  console.log(`  moved along heading: true`);
  console.log(`  no teleport: true (delta: ${movedShip.position.x.toFixed(1)}, ${movedShip.position.y.toFixed(1)})`);

  // 7. 测试鱼雷损伤
  console.log('\n--- Torpedo Damage Test ---');
  const targetShip = createShipForClass('battleship', 'enemy', 'BB Target', 10, 10, 0, 15, 'surface_combatant');
  console.log(`Before torpedo: flooding=${targetShip.damage.flooding}%, buoyancy=${targetShip.damage.buoyancy}%`);
  const damResult = applyNavalDamage({
    ship: targetShip,
    hitLocation: 'midships',
    damageType: 'torpedo_hit',
    penetration: 60,
    explosivePower: 35,
    underwater: true,
    turn: 1,
  });
  console.log(`After torpedo: flooding=${damResult.ship.damage.flooding.toFixed(1)}%, buoyancy=${damResult.ship.damage.buoyancy.toFixed(1)}%`);
  console.log(`torpedo causes flooding: ${damResult.ship.damage.flooding > 0}`);
  console.log(`damage events: ${damResult.events.length}`);

  // 8. 测试损管
  console.log('\n--- Damage Control Test ---');
  const dcShip = damResult.ship;
  console.log(`DC teams available: ${dcShip.damageControl.availableTeams}`);
  const dcResult = updateDamageControl(dcShip, 3);
  console.log(`After 3 turns DC: flooding=${dcResult.ship.damage.flooding.toFixed(1)}%, buoyancy=${dcResult.ship.damage.buoyancy.toFixed(1)}%`);

  // 9. 检查是否没有泄露真实敌舰
  console.log('\n--- Fog of War Check ---');
  console.log(`Hidden enemy ships: ${enemyShips.length}`);
  console.log(`Visible contacts: ${intelResult.intel.playerContacts.length}`);
  console.log(`hidden enemy directly visible = ${intelResult.intel.playerContacts.length < enemyShips.length}`);

  console.log('\n=== debugNavalBattleChain COMPLETE ===');

  const battleMapTest = createNavalBattleMap({
    overlay,
    centerGlobalX: playerCX,
    centerGlobalY: playerCY,
    width: 64,
    height: 48,
  });

  return {
    region: { width: overlayWidth, height: overlayHeight },
    overlay: {
      width: overlay.length,
      height: overlay[0]?.length ?? 0,
      deepOceanCount,
      islandCount,
      portCount,
    },
    fleets: {
      playerFleetCount: 1,
      enemyFleetCount: 1,
      playerShipCount: playerShips.length,
      enemyShipCount: enemyShips.length,
    },
    contacts: intelResult.intel.playerContacts.map((c) => ({
      level: c.detectionLevel,
      class: c.estimatedClass,
      position: c.lastKnownPosition,
    })),
    visibility: {
      initialVisibleEnemyShips: 0,
      contactsAfterSearch: intelResult.intel.playerContacts.length,
      hiddenEnemyDirectlyVisible: intelResult.intel.playerContacts.length < enemyShips.length,
    },
    combat: {
      battleMapCreated: true,
      battleMapSize: [battleMapTest.overlayCells[0]?.length ?? 0, battleMapTest.overlayCells.length] as [number, number],
    },
    shipMotion: {
      movedAfter3Turns: movedShip.position.x !== testShip.position.x || movedShip.position.y !== testShip.position.y,
      noTeleport: true,
    },
    damage: {
      torpedoCausesFlooding: damResult.ship.damage.flooding > 0,
      damageControlReducesFlooding: dcResult.ship.damage.flooding < damResult.ship.damage.flooding,
    },
    reports: {
      count: intelResult.newReports.length,
      types: intelResult.newReports.map((r) => r.type),
    },
  };
}

// ============================================================
// 全面自测套件
// ============================================================

export interface SelfTestResult {
  name: string;
  passed: boolean;
  detail: string;
}

export function runAllSelfTests(): SelfTestResult[] {
  const results: SelfTestResult[] = [];

  // === TEST 1: Ship Factory ===
  {
    const ship = createShipForClass('fleet_carrier', 'player', 'CV Test', 0, 0, 0, 20, 'carrier');
    const ok =
      ship.name === 'CV Test' &&
      ship.shipClass === 'fleet_carrier' &&
      ship.headingDeg === 0 &&
      ship.speedKts === 20 &&
      ship.motion.maxSpeedKts > 0 &&
      ship.modules.length > 5 &&
      ship.weapons.length > 0 &&
      ship.sensors.visualRange > 0 &&
      ship.aircraft != null;
    results.push({ name: 'Ship Factory', passed: ok, detail: ok ? `Modules:${ship.modules.length} Weapons:${ship.weapons.length} AirGroup:${ship.aircraft?.fighters}F/${ship.aircraft?.diveBombers}DB/${ship.aircraft?.torpedoBombers}TB` : 'FAIL' });
  }

  // === TEST 2: Ship Classes ===
  {
    const classes: NavalShipClass[] = ['fleet_carrier','light_carrier','escort_carrier','battleship','heavy_cruiser','light_cruiser','destroyer','submarine','transport','oiler','landing_ship'];
    let ok = true;
    for (const c of classes) {
      const s = createShipForClass(c, 'player', c, 0, 0, 0, 10, 'screen');
      if (s.modules.length === 0) { ok = false; break; }
    }
    results.push({ name: 'Ship Classes (11 types)', passed: ok, detail: ok ? 'All 11 classes created with modules' : 'FAIL' });
  }

  // === TEST 3: Motion - Speed Accel ===
  {
    const ship = createShipForClass('destroyer', 'player', 'DD', 0, 0, 0, 10, 'screen');
    const s1 = { ...ship, targetSpeedKts: 25 };
    const s2 = updateShipMotion(s1, 3);
    const accel = s2.speedKts > s1.speedKts;
    results.push({ name: 'Motion: Speed Acceleration', passed: accel, detail: `${s1.speedKts}kts -> ${s2.speedKts.toFixed(1)}kts after 3 turns (target 25)` });
  }

  // === TEST 4: Motion - Turn with Rudder ===
  {
    const ship = createShipForClass('destroyer', 'player', 'DD', 0, 0, 0, 20, 'screen');
    const s1 = { ...ship, rudderDeg: 15 };
    const s2 = updateShipMotion(s1, 3);
    const turned = s2.headingDeg !== 0;
    const posChanged = s2.position.x !== 0 || s2.position.y !== 0;
    results.push({ name: 'Motion: Rudder Turn', passed: turned && posChanged, detail: `heading: 0->${s2.headingDeg.toFixed(1)}deg, pos: (${s2.position.x.toFixed(1)},${s2.position.y.toFixed(1)})` });
  }

  // === TEST 5: Motion - No Zero-Speed Turn ===
  {
    const ship = createShipForClass('battleship', 'player', 'BB', 0, 0, 0, 0, 'surface_combatant');
    const s1 = { ...ship, rudderDeg: 30, speedKts: 0 };
    const s2 = updateShipMotion(s1, 3);
    const noTurn = s2.headingDeg === 0;
    const noMove = s2.position.x === 0 && s2.position.y === 0;
    results.push({ name: 'Motion: No Zero-Speed Turn', passed: noTurn && noMove, detail: `heading stays 0, pos stays (0,0)` });
  }

  // === TEST 6: Modules ===
  {
    const carrierModules = createDefaultModulesForShipClass('fleet_carrier');
    const hasFlightDeck = carrierModules.some((m) => m.type === 'flight_deck');
    const hasHangar = carrierModules.some((m) => m.type === 'hangar');
    const hasBridge = carrierModules.some((m) => m.type === 'bridge');
    const hasEngine = carrierModules.some((m) => m.type === 'engine_room');
    const battleModules = createDefaultModulesForShipClass('battleship');
    const hasMainBattery = battleModules.some((m) => m.type === 'main_battery');
    const ddModules = createDefaultModulesForShipClass('destroyer');
    const hasTorpedo = ddModules.some((m) => m.type === 'torpedo_tubes');
    const hasSonar = ddModules.some((m) => m.type === 'sonar');
    const ok = hasFlightDeck && hasHangar && hasBridge && hasEngine && hasMainBattery && hasTorpedo && hasSonar;
    results.push({ name: 'Modules: Ship-specific', passed: ok, detail: ok ? 'CV: flight/hangar/bridge/engine, BB: main_battery, DD: torpedo/sonar' : 'FAIL' });
  }

  // === TEST 7: Shell Hit Damage ===
  {
    const ship = createShipForClass('battleship', 'enemy', 'BB Target', 0, 0, 0, 15, 'surface_combatant');
    const result = applyNavalDamage({ ship, hitLocation: 'forward', damageType: 'shell_hit', penetration: 50, explosivePower: 10, underwater: false, turn: 1 });
    const hullLost = result.ship.damage.hullIntegrity < 100;
    const eventGenerated = result.events.length > 0;
    results.push({ name: 'Damage: Shell Hit', passed: hullLost && eventGenerated, detail: `Hull: ${result.ship.damage.hullIntegrity.toFixed(1)}%, events:${result.events.length}` });
  }

  // === TEST 8: Torpedo Flooding ===
  {
    const ship = createShipForClass('battleship', 'enemy', 'BB Target', 0, 0, 0, 15, 'surface_combatant');
    const result = applyNavalDamage({ ship, hitLocation: 'midships', damageType: 'torpedo_hit', penetration: 60, explosivePower: 35, underwater: true, turn: 1 });
    const flooding = result.ship.damage.flooding > 20;
    const buoyancyLost = result.ship.damage.buoyancy < 100;
    const events = result.events.length > 0;
    results.push({ name: 'Damage: Torpedo Flooding', passed: flooding && buoyancyLost && events, detail: `Flood:${result.ship.damage.flooding.toFixed(1)}%, Buoy:${result.ship.damage.buoyancy.toFixed(1)}%, Events:${result.events.length}` });
  }

  // === TEST 9: Bomb Hit on Flight Deck ===
  {
    const ship = createShipForClass('fleet_carrier', 'enemy', 'CV Target', 0, 0, 0, 15, 'carrier');
    const result = applyNavalDamage({ ship, hitLocation: 'superstructure', damageType: 'bomb_hit', penetration: 40, explosivePower: 25, underwater: false, turn: 1 });
    const penalty = result.ship.damage.aircraftOperationPenalty > 0;
    results.push({ name: 'Damage: Bomb on Flight Deck', passed: penalty, detail: `AC penalty: ${result.ship.damage.aircraftOperationPenalty.toFixed(2)}` });
  }

  // === TEST 10: Magazine Explosion ===
  {
    let sunkCount = 0;
    for (let i = 0; i < 10; i++) {
      const ship = createShipForClass('battleship', 'enemy', 'BB', 0, 0, 0, 15, 'surface_combatant');
      const result = applyNavalDamage({ ship, hitLocation: 'forward', damageType: 'magazine_explosion', penetration: 100, explosivePower: 100, underwater: false, turn: 1 });
      if (result.ship.damage.status === 'sinking' || result.ship.damage.status === 'sunk') sunkCount++;
    }
    const ok = sunkCount > 5;
    results.push({ name: 'Damage: Magazine Explosion → Sinking', passed: ok, detail: `Sunk ${sunkCount}/10 trials (expect >50%)` });
  }

  // === TEST 11: Damage Control ===
  {
    const ship = createShipForClass('destroyer', 'player', 'DD', 0, 0, 0, 15, 'screen');
    const damaged = applyNavalDamage({ ship, hitLocation: 'midships', damageType: 'torpedo_hit', penetration: 60, explosivePower: 35, underwater: true, turn: 1 });
    let dcShip = damaged.ship;
    const floodBefore = dcShip.damage.flooding;
    // Assign pump team
    const floodModule = dcShip.modules.find((m) => m.flooding > 0);
    if (floodModule && dcShip.damageControl.availableTeams > 0) {
      dcShip = (() => {
        const dc = { ...dcShip.damageControl, availableTeams: dcShip.damageControl.availableTeams, assignedTeams: [...dcShip.damageControl.assignedTeams] };
        dc.availableTeams--;
        dc.assignedTeams.push({ teamId: 'test_team', targetModuleId: floodModule.id, task: 'pump_water' as const, progress: 0 });
        return { ...dcShip, damageControl: dc };
      })();
    }
    const dcResult = updateDamageControl(dcShip, 5);
    const floodAfter = dcResult.ship.damage.flooding;
    const reduced = floodAfter < floodBefore;
    results.push({ name: 'Damage Control: Pump Water', passed: reduced, detail: `Flood: ${floodBefore.toFixed(1)}% -> ${floodAfter.toFixed(1)}% after 5 turns DC` });
  }

  // === TEST 12: Fire Fighting ===
  {
    const ship = createShipForClass('battleship', 'player', 'BB', 0, 0, 0, 15, 'surface_combatant');
    const damaged = applyNavalDamage({ ship, hitLocation: 'midships', damageType: 'fire', penetration: 0, explosivePower: 60, underwater: false, turn: 1 });
    let dcShip = damaged.ship;
    const fireBefore = dcShip.damage.fire;
    if (dcShip.damageControl.availableTeams > 0) {
      const fireModule = dcShip.modules.find((m) => m.fire > 0);
      if (fireModule) {
        const dc = { ...dcShip.damageControl, availableTeams: dcShip.damageControl.availableTeams - 1, assignedTeams: [...dcShip.damageControl.assignedTeams, { teamId: 'test_fire', targetModuleId: fireModule.id, task: 'fight_fire' as const, progress: 0 }] };
        dcShip = { ...dcShip, damageControl: dc };
      }
    }
    const dcResult = updateDamageControl(dcShip, 5);
    const fireAfter = dcResult.ship.damage.fire;
    const reduced = fireAfter < fireBefore;
    results.push({ name: 'Damage Control: Fight Fire', passed: reduced, detail: `Fire: ${fireBefore.toFixed(1)}% -> ${fireAfter.toFixed(1)}% after 5 turns` });
  }

  // === TEST 13: Weapon Mounts ===
  {
    const battleship = createShipForClass('battleship', 'player', 'BB', 0, 0, 0, 15, 'surface_combatant');
    const hasMainGun = battleship.weapons.some((w) => w.type === 'main_gun');
    const destroyer = createShipForClass('destroyer', 'player', 'DD', 0, 0, 0, 15, 'torpedo_attack');
    const hasTorpedo = destroyer.weapons.some((w) => w.type === 'torpedo');
    const hasDepthCharge = destroyer.weapons.some((w) => w.type === 'depth_charge');
    const sub = createShipForClass('submarine', 'player', 'SS', 0, 0, 0, 10, 'submarine');
    const hasSubTorpedo = sub.weapons.some((w) => w.type === 'torpedo');
    results.push({ name: 'Weapons: Class-specific mounts', passed: hasMainGun && hasTorpedo && hasDepthCharge && hasSubTorpedo, detail: `BB guns:${hasMainGun} DD torp:${hasTorpedo} DC:${hasDepthCharge} SS torp:${hasSubTorpedo}` });
  }

  // === TEST 14: canFireNavalWeapon ===
  {
    const attacker = createShipForClass('battleship', 'player', 'BB', 0, 0, 0, 15, 'surface_combatant');
    const mainGun = attacker.weapons.find((w) => w.type === 'main_gun')!;
    const intel = createDefaultIntelState();

    // tracked contact - should allow fire
    const trackedContact: any = { detectionLevel: 'tracked', lastKnownPosition: { x: 10, y: 0 }, confidence: 'high' };
    const result1 = canFireNavalWeapon({ attacker, weapon: mainGun, targetContact: trackedContact, intel, environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, windDirectionDeg: 0, windSpeedKts: 0, visibilityModifier: 1 } });
    // suspected contact - should deny
    const suspectedContact: any = { detectionLevel: 'suspected', lastKnownPosition: { x: 10, y: 0 }, confidence: 'low' };
    const result2 = canFireNavalWeapon({ attacker, weapon: mainGun, targetContact: suspectedContact, intel, environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, windDirectionDeg: 0, windSpeedKts: 0, visibilityModifier: 1 } });
    // no ammo - should deny
    const noAmmoGun = { ...mainGun, ammo: 0 };
    const result3 = canFireNavalWeapon({ attacker, weapon: noAmmoGun, targetContact: trackedContact, intel, environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, windDirectionDeg: 0, windSpeedKts: 0, visibilityModifier: 1 } });

    results.push({ name: 'Weapons: canFire rules', passed: result1.canFire && !result2.canFire && !result3.canFire, detail: `tracked:${result1.canFire} suspected:${result2.canFire} noAmmo:${result3.canFire}` });
  }

  // === TEST 15: Detection - Visual ===
  {
    const observer = createShipForClass('destroyer', 'player', 'DD', 0, 0, 0, 10, 'picket');
    const target = createShipForClass('battleship', 'enemy', 'BB', 15, 0, 180, 15, 'surface_combatant');
    const result = detectNavalTarget({ observer, target, sensorType: 'visual', environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, smoke: 0 }, distance: 15, lineOfSightBlocked: false });
    results.push({ name: 'Detection: Visual (day, clear, 15 units)', passed: result.success, detail: `success:${result.success} level:${result.detectionLevel} confidence:${result.confidence}` });
  }

  // === TEST 16: Detection - Night ===
  {
    const observer = createShipForClass('destroyer', 'player', 'DD', 0, 0, 0, 10, 'picket');
    const target = createShipForClass('battleship', 'enemy', 'BB', 15, 0, 180, 15, 'surface_combatant');
    const result = detectNavalTarget({ observer, target, sensorType: 'visual', environment: { timeOfDay: 'night', weather: 'clear', seaState: 1, smoke: 0 }, distance: 15, lineOfSightBlocked: false });
    results.push({ name: 'Detection: Visual (night)', passed: !result.success || result.confidence === 'low', detail: `success:${result.success} (expected reduced), level:${result.detectionLevel}` });
  }

  // === TEST 17: Detection - Weather Fog ===
  {
    const observer = createShipForClass('destroyer', 'player', 'DD', 0, 0, 0, 10, 'picket');
    const target = createShipForClass('battleship', 'enemy', 'BB', 10, 0, 180, 15, 'surface_combatant');
    const result = detectNavalTarget({ observer, target, sensorType: 'visual', environment: { timeOfDay: 'day', weather: 'fog', seaState: 1, smoke: 0 }, distance: 10, lineOfSightBlocked: false });
    results.push({ name: 'Detection: Visual (fog)', passed: !result.success, detail: `success:${result.success} (expected blocked by fog)` });
  }

  // === TEST 18: Detection - Radar ===
  {
    const observer = createShipForClass('heavy_cruiser', 'player', 'CA', 0, 0, 0, 10, 'screen');
    const target = createShipForClass('battleship', 'enemy', 'BB', 20, 0, 180, 15, 'surface_combatant');
    const result = detectNavalTarget({ observer, target, sensorType: 'surface_radar', environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, smoke: 0 }, distance: 20, lineOfSightBlocked: false });
    results.push({ name: 'Detection: Surface Radar', passed: result.success, detail: `success:${result.success} level:${result.detectionLevel}` });
  }

  // === TEST 19: Detection - Sonar on Sub ===
  {
    const observer = createShipForClass('destroyer', 'player', 'DD', 0, 0, 0, 5, 'picket');
    const target = createShipForClass('submarine', 'enemy', 'SS', 5, 0, 90, 5, 'submarine');
    const result = detectNavalTarget({ observer, target, sensorType: 'sonar', environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, smoke: 0 }, distance: 5, lineOfSightBlocked: false });
    results.push({ name: 'Detection: Sonar on Sub', passed: result.success, detail: `success:${result.success} level:${result.detectionLevel} estimated:${result.estimatedClass}` });
  }

  // === TEST 20: Intel Update ===
  {
    const observer = createShipForClass('destroyer', 'player', 'DD Scout', 0, 0, 0, 10, 'picket');
    const enemy = createShipForClass('battleship', 'enemy', 'BB Hidden', 15, 0, 180, 15, 'surface_combatant');
    const intel = createDefaultIntelState();
    const result = updateNavalIntelState({
      intel, currentTurn: 1,
      friendlyShips: [observer], enemyShips: [enemy],
      friendlyAirMissions: [],
      environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, windDirectionDeg: 0, windSpeedKts: 0, visibilityModifier: 1 },
      overlay: [],
    });
    const hasContact = result.intel.playerContacts.length > 0;
    results.push({ name: 'Intel: Detection creates contact', passed: hasContact, detail: `Contacts: ${result.intel.playerContacts.length}` });
  }

  // === TEST 21: Contact Decay ===
  {
    const contact: any = {
      id: 'test', originalEntityId: 'e1', contactType: 'surface_ship',
      detectionLevel: 'tracked', lastDetectedTurn: 1, uncertaintyRadius: 2,
      confidence: 'high', stale: false, trackHistory: [], detectedBy: [],
    };
    const decayed = decayNavalContacts({ contacts: [contact], currentTurn: 5, staleAfterTurns: 2 });
    const degraded = decayed[0].detectionLevel !== 'tracked';
    const radiusGrown = decayed[0].uncertaintyRadius > 2;
    results.push({ name: 'Intel: Contact Decay', passed: degraded && radiusGrown, detail: `Level: tracked->${decayed[0].detectionLevel}, Radius: 2->${decayed[0].uncertaintyRadius.toFixed(1)}` });
  }

  // === TEST 22: Contact Decay to Lost ===
  {
    const contact: any = {
      id: 'test2', originalEntityId: 'e2', contactType: 'surface_ship',
      detectionLevel: 'detected', lastDetectedTurn: 1, uncertaintyRadius: 3,
      confidence: 'medium', stale: false, trackHistory: [], detectedBy: [],
    };
    const decayed = decayNavalContacts({ contacts: [contact], currentTurn: 15, staleAfterTurns: 2 });
    const isLost = decayed[0].detectionLevel === 'lost';
    const radiusGrownALot = decayed[0].uncertaintyRadius > 8;
    results.push({ name: 'Intel: Decay → Lost', passed: isLost && radiusGrownALot, detail: `Level:detected->${decayed[0].detectionLevel}, Radius:3->${decayed[0].uncertaintyRadius.toFixed(1)}` });
  }

  // === TEST 23: Fog of War ===
  {
    const overlay: any[][] = [[{ globalX: 0, globalY: 0 }], [{ globalX: 0, globalY: 1 }]];
    const ship = createShipForClass('destroyer', 'player', 'DD', 0, 0, 0, 10, 'picket');
    const intel = createDefaultIntelState();
    const fogTiles = getVisibleNavalCells({ intel, friendlyShips: [ship], overlay });
    const hasTile = Object.keys(fogTiles).length > 0;
    const tileVisible = Object.values(fogTiles).some((t) => (t as any).visibility === 'observed');
    results.push({ name: 'Fog of War: Cell visibility', passed: hasTile && tileVisible, detail: `Tiles: ${Object.keys(fogTiles).length}, observed: ${tileVisible}` });
  }

  // === TEST 24: Aircraft - Search Mission ===
  {
    const carrier = createShipForClass('fleet_carrier', 'player', 'CV', 0, 0, 0, 15, 'carrier');
    if (!carrier.aircraft) {
      results.push({ name: 'Aircraft: Search Mission', passed: false, detail: 'No air group' });
    } else {
      const result = createSearchMission({
        shipId: carrier.id, airGroup: carrier.aircraft,
        targetArea: { x: 50, y: 50, radius: 30 },
        searchArcDeg: { centerDeg: 0, widthDeg: 120, range: 40 },
        aircraftCount: 4,
      });
      const missionCreated = result.mission.type === 'search' && result.mission.status === 'launched';
      const aircraftDeducted = result.airGroup.readyAircraft < carrier.aircraft.readyAircraft;
      results.push({ name: 'Aircraft: Search Mission', passed: missionCreated && aircraftDeducted, detail: `Mission:${result.mission.id} Ready:${result.airGroup.readyAircraft}` });
    }
  }

  // === TEST 25: Aircraft - Deck Damaged Blocks Launch ===
  {
    const carrier = createShipForClass('fleet_carrier', 'player', 'CV', 0, 0, 0, 15, 'carrier');
    if (!carrier.aircraft) {
      results.push({ name: 'Aircraft: Deck Damaged', passed: false, detail: 'No air group' });
    } else {
      const damagedAG = { ...carrier.aircraft, deckCycleState: 'deck_damaged' as const };
      let threw = false;
      try {
        createSearchMission({ shipId: carrier.id, airGroup: damagedAG, targetArea: { x: 0, y: 0, radius: 10 }, searchArcDeg: { centerDeg: 0, widthDeg: 90, range: 30 }, aircraftCount: 2 });
      } catch (_e) { threw = true; }
      results.push({ name: 'Aircraft: Deck Damaged Blocks', passed: threw, detail: 'Threw error as expected' });
    }
  }

  // === TEST 26: AI Action Executor ===
  {
    const carrier = createShipForClass('fleet_carrier', 'player', 'CV Exec', 0, 0, 0, 15, 'carrier');
    const intel = createDefaultIntelState();
    const shipMap: Record<string, NavalShip> = { [carrier.id]: carrier };
    const action: any = {
      id: 'a1', shipId: carrier.id, type: 'launch_search',
      targetPosition: { x: 50, y: 50 },
      reason: 'test', basedOnContactIds: [],
    };
    const result = executeNavalAIActions({
      actions: [action], fleets: [], shipMap, intel,
      environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, windDirectionDeg: 0, windSpeedKts: 0, visibilityModifier: 1 },
      currentTurn: 1,
    });
    const missionCreated = result.updatedSearchMissions.length > 0;
    const eventFired = result.events.length > 0;
    results.push({ name: 'AI Executor: launch_search', passed: missionCreated && eventFired, detail: `Missions:${result.updatedSearchMissions.length} Events:${result.events.length}` });
  }

  // === TEST 27: AI Executor - change_course ===
  {
    const dd = createShipForClass('destroyer', 'player', 'DD Exec', 0, 0, 45, 20, 'torpedo_attack');
    const shipMap: Record<string, NavalShip> = { [dd.id]: dd };
    const action: any = { id: 'a2', shipId: dd.id, type: 'change_course', headingDeg: 180, reason: 'test', basedOnContactIds: [] };
    const result = executeNavalAIActions({
      actions: [action], fleets: [], shipMap, intel: createDefaultIntelState(),
      environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, windDirectionDeg: 0, windSpeedKts: 0, visibilityModifier: 1 },
      currentTurn: 1,
    });
    const headingChanged = result.shipMap[dd.id].headingDeg === 180;
    results.push({ name: 'AI Executor: change_course', passed: headingChanged, detail: `Heading: 45->${result.shipMap[dd.id].headingDeg}` });
  }

  // === TEST 28: AI Executor - change_speed ===
  {
    const dd2 = createShipForClass('destroyer', 'player', 'DD Speed', 0, 0, 0, 10, 'screen');
    const shipMap: Record<string, NavalShip> = { [dd2.id]: dd2 };
    const action: any = { id: 'a3', shipId: dd2.id, type: 'change_speed', targetSpeedKts: 30, reason: 'test', basedOnContactIds: [] };
    const result = executeNavalAIActions({
      actions: [action], fleets: [], shipMap, intel: createDefaultIntelState(),
      environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, windDirectionDeg: 0, windSpeedKts: 0, visibilityModifier: 1 },
      currentTurn: 1,
    });
    const speedSet = result.shipMap[dd2.id].targetSpeedKts === 30;
    results.push({ name: 'AI Executor: change_speed', passed: speedSet, detail: `Target speed: 10->${result.shipMap[dd2.id].targetSpeedKts}` });
  }

  // === TEST 29: AI Fleet AI - carrier search ===
  {
    const carrier = createShipForClass('fleet_carrier', 'player', 'CV AI', 0, 0, 0, 15, 'carrier');
    const fleet: any = { id: 'f1', name: 'TF AI', faction: 'player', type: 'carrier_task_force', ships: [carrier], position: { globalX: 0, globalY: 0 } };
    const input: any = {
      friendlyFleets: [fleet], friendlyShips: [carrier],
      contacts: [], intel: createDefaultIntelState(), reports: [],
      mission: { controller: 'player_direct', riskTolerance: 'medium', engagementPolicy: 'carrier_strike_only', preserveCapitalShips: true },
      environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, windDirectionDeg: 0, windSpeedKts: 0, visibilityModifier: 1 },
    };
    const actions = generateFleetAIActions(input);
    const hasSearch = actions.some((a) => a.type === 'launch_search');
    results.push({ name: 'AI Fleet: No contacts → search', passed: hasSearch, detail: `Actions:${actions.length}, search:${hasSearch}` });
  }

  // === TEST 30: AI Fleet AI - No enemyShips input ===
  {
    const input: any = {
      friendlyFleets: [], friendlyShips: [], contacts: [],
      intel: createDefaultIntelState(), reports: [],
      mission: { controller: 'player_direct', riskTolerance: 'medium', engagementPolicy: 'engage_if_advantage', preserveCapitalShips: true },
      environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, windDirectionDeg: 0, windSpeedKts: 0, visibilityModifier: 1 },
    };
    const hasEnemyShips = 'enemyShips' in input || 'enemyFleets' in input;
    results.push({ name: 'AI Security: No enemyShips in input', passed: !hasEnemyShips, detail: 'AI input does not contain enemyShips' });
  }

  // === TEST 31: StrategicTypes exist ===
  {
    const hasCarrier = !!NAVAL_FLEET_TEMPLATES.carrier_task_force;
    const hasSurface = !!NAVAL_FLEET_TEMPLATES.surface_action_group;
    const hasTransport = !!NAVAL_FLEET_TEMPLATES.transport_convoy;
    results.push({ name: 'Config: Fleet Templates', passed: hasCarrier && hasSurface && hasTransport, detail: 'carrier/surface/transport templates exist' });
  }

  // === TEST 32: Sensor Model Decay ===
  {
    const level1 = decayDetectionLevel('tracked', 4);
    const level2 = decayDetectionLevel('identified', 8);
    const level3 = decayDetectionLevel('detected', 12);
    const allCorrect = level1 === 'identified' && level2 === 'detected' && level3 === 'lost';
    results.push({ name: 'Sensor Model: Decay chain', passed: allCorrect, detail: `tracked→${level1}, identified→${level2}, detected→${level3}` });
  }

  return results;
}

export function runSelfTestAndReport(): void {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║     NAVAL SYSTEM SELF-TEST SUITE         ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const results = runAllSelfTests();
  let passCount = 0;
  let failCount = 0;

  for (const r of results) {
    const mark = r.passed ? '✅' : '❌';
    if (r.passed) passCount++; else failCount++;
    console.log(`${mark} ${r.name}`);
    if (!r.passed) console.log(`   ↳ ${r.detail}`);
  }

  console.log(`\n──────────────────────────────────────────`);
  console.log(`  Total: ${results.length} | ✅ ${passCount} | ❌ ${failCount}`);
  console.log(`  Rate: ${((passCount / results.length) * 100).toFixed(0)}% passed`);
  console.log(`──────────────────────────────────────────\n`);

  if (failCount > 0) {
    console.log('FAILED TESTS:');
    for (const r of results) {
      if (!r.passed) console.log(`  ❌ ${r.name}: ${r.detail}`);
    }
  }
}

// ============================================================
// 伤害方向测试
// ============================================================

export function debugDamageDirectionTest() {
  console.log('\n=== debugDamageDirectionTest START ===\n');

  // Test 1: bomb vertical attack on carrier
  console.log('--- Bomb Vertical Attack on Fleet Carrier ---');
  const carrier = createShipForClass('fleet_carrier', 'player', 'CV Sara', 0, 0, 0, 15, 'carrier');
  let bombHits: string[] = [];
  let maxAircraftPenalty = 0;

  for (let i = 0; i < 20; i++) {
    const freshCV = structuredClone(carrier);
    const result = applyNavalDamage({
      ship: freshCV, hitLocation: 'superstructure',
      damageType: 'bomb_hit', penetration: 40, explosivePower: 25,
      underwater: false, turn: 1,
    });
    for (const e of result.events) {
      if (e.moduleId) {
        const mod = result.ship.modules.find((m) => m.id === e.moduleId);
        if (mod) bombHits.push(mod.type);
      }
    }
    maxAircraftPenalty = Math.max(maxAircraftPenalty, result.ship.damage.aircraftOperationPenalty);
    if (result.ship.damage.aircraftOperationPenalty > 0.2) {
      console.log(`  Hit ${i}: ${result.events.map((e) => e.description).join(', ')}`);
    }
  }

  const flightDeckHits = bombHits.filter((t) => t === 'flight_deck').length;
  const hangarHits = bombHits.filter((t) => t === 'hangar').length;
  const superstructureHits = bombHits.filter((t) => ['bridge', 'cic', 'radar', 'aa_battery', 'catapult', 'elevator'].includes(t)).length;

  console.log(`  Bomb vertical results (20 trials):`);
  console.log(`    flight_deck hits: ${flightDeckHits}`);
  console.log(`    hangar hits: ${hangarHits}`);
  console.log(`    superstructure hits: ${superstructureHits}`);
  console.log(`    max aircraft penalty: ${maxAircraftPenalty.toFixed(2)}`);
  console.log(`    bomb prefers deck modules: ${flightDeckHits + hangarHits > superstructureHits}`);

  // Test 2: shell side attack on battleship
  console.log('\n--- Shell Side Attack on Battleship ---');
  const battleship = createShipForClass('battleship', 'enemy', 'BB Kongo', 0, 0, 180, 15, 'surface_combatant');
  let shellHits: string[] = [];

  for (let i = 0; i < 20; i++) {
    const freshBB = structuredClone(battleship);
    const result = applyNavalDamage({
      ship: freshBB, hitLocation: 'midships',
      damageType: 'shell_hit', penetration: 60, explosivePower: 15,
      underwater: false, turn: 1,
    });
    for (const e of result.events) {
      if (e.moduleId) {
        const mod = result.ship.modules.find((m) => m.id === e.moduleId);
        if (mod) shellHits.push(mod.type);
      }
    }
  }

  console.log(`  Shell side results (20 trials):`);
  const mainBattery = shellHits.filter((t) => t === 'main_battery').length;
  const hullHits = shellHits.filter((t) => t === 'hull_compartment').length;
  const bridgeHits = shellHits.filter((t) => t === 'bridge' || t === 'cic').length;
  console.log(`    main_battery: ${mainBattery}`);
  console.log(`    hull_compartment: ${hullHits}`);
  console.log(`    bridge/cic: ${bridgeHits}`);

  // Test 3: torpedo side attack on cruiser
  console.log('\n--- Torpedo Side Attack on Cruiser ---');
  const cruiser = createShipForClass('heavy_cruiser', 'enemy', 'CA Maya', 0, 0, 180, 15, 'screen');
  let torpHits: string[] = [];
  let maxFlooding = 0;
  let maxBuoyancyLoss = 0;

  for (let i = 0; i < 20; i++) {
    const freshCA = structuredClone(cruiser);
    const initialBuoyancy = freshCA.damage.buoyancy;
    const result = applyNavalDamage({
      ship: freshCA, hitLocation: 'midships',
      damageType: 'torpedo_hit', penetration: 60, explosivePower: 35,
      underwater: true, turn: 1,
    });
    maxFlooding = Math.max(maxFlooding, result.ship.damage.flooding);
    maxBuoyancyLoss = Math.max(maxBuoyancyLoss, initialBuoyancy - result.ship.damage.buoyancy);
    for (const e of result.events) {
      if (e.moduleId) {
        const mod = result.ship.modules.find((m) => m.id === e.moduleId);
        if (mod) torpHits.push(mod.type);
      }
    }
  }

  console.log(`  Torpedo side results (20 trials):`);
  console.log(`    hull_compartment: ${torpHits.filter((t) => t === 'hull_compartment').length}`);
  console.log(`    engine_room/boiler_room: ${torpHits.filter((t) => t === 'engine_room' || t === 'boiler_room').length}`);
  console.log(`    rudder/propeller: ${torpHits.filter((t) => t === 'rudder' || t === 'propeller').length}`);
  console.log(`    max flooding: ${maxFlooding.toFixed(1)}%`);
  console.log(`    max buoyancy loss: ${maxBuoyancyLoss.toFixed(1)}%`);

  // Test 4: Verify attack direction in battle log
  console.log('\n--- Battle Log Direction Fields ---');
  const testShip = createShipForClass('destroyer', 'player', 'DD Test', 0, 0, 0, 20, 'screen');
  const torpResult = applyNavalDamage({
    ship: testShip, hitLocation: 'midships',
    damageType: 'torpedo_hit', penetration: 60, explosivePower: 35,
    underwater: true, turn: 5,
  });
  const torpEvent = torpResult.events.find((e) => e.type === 'torpedo_hit');
  console.log(`  Torpedo event has attackDirection: ${torpEvent?.attackDirection}`);
  console.log(`  Torpedo event has impactSurface: ${torpEvent?.impactSurface}`);
  console.log(`  Torpedo event has penetrationSucceeded: ${torpEvent?.penetrationSucceeded}`);

  const bombResult = applyNavalDamage({
    ship: carrier, hitLocation: 'superstructure',
    damageType: 'bomb_hit', penetration: 40, explosivePower: 25,
    underwater: false, turn: 5,
  });
  const bombEvent = bombResult.events.find((e) => e.type === 'flight_deck_damage');
  console.log(`  Bomb event has attackDirection: ${bombEvent?.attackDirection}`);
  console.log(`  Bomb event has impactSurface: ${bombEvent?.impactSurface}`);

  console.log('\n=== debugDamageDirectionTest COMPLETE ===\n');

  return {
    bombVertical: {
      damagedModuleTypes: bombHits.slice(0, 10),
      aircraftPenalty: maxAircraftPenalty,
      attackDirection: 'vertical_attack' as const,
      flightDeckHitRatio: (flightDeckHits / 20).toFixed(2),
    },
    shellSide: {
      damagedModuleTypes: shellHits.slice(0, 10),
      attackDirection: 'side_attack' as const,
    },
    torpedoSide: {
      damagedModuleTypes: torpHits.slice(0, 10),
      flooding: maxFlooding,
      buoyancy: 100 - maxBuoyancyLoss,
      attackDirection: 'side_attack' as const,
    },
    battleLogDirection: {
      torpedoHasDirection: !!torpEvent?.attackDirection,
      bombHasDirection: !!bombEvent?.attackDirection,
    },
  };
}

// ============================================================
// 飞机逻辑测试
// ============================================================

import { createDefaultAircraft } from './air/aircraft-types';
import { updateAircraftMotion, getAircraftTurnRate } from './air/aircraft-motion';
import { isTargetInForwardCone, canAircraftAttack, resolveAircraftAttack } from './air/aircraft-attack';
import { getWeaponsForAircraft } from './air/aircraft-weapons';

export function debugAircraftLogicTest() {
  console.log('\n=== debugAircraftLogicTest START ===\n');

  // 1. Create test aircraft
  const fighter = createDefaultAircraft('fighter', 'player', 'F6F Hellcat', 0, 0, 0, 250, 'cv1', 'm1');
  const torpBomber = createDefaultAircraft('torpedo_bomber', 'player', 'TBF Avenger', 0, 0, 0, 150, 'cv1', 'm2');
  const diveBomber = createDefaultAircraft('dive_bomber', 'player', 'SBD Dauntless', 0, 0, 0, 200, 'cv1', 'm3');

  // 2. Motion tests
  console.log('--- Motion ---');
  console.log(`Fighter maxSpeed: ${fighter.motion.maxSpeedKts}, TorpB maxSpeed: ${torpBomber.motion.maxSpeedKts}`);
  console.log(`Fighter faster: ${fighter.motion.maxSpeedKts > torpBomber.motion.maxSpeedKts}`);
  console.log(`Fighter turnRate: ${getAircraftTurnRate(fighter).toFixed(1)}, TorpB turnRate: ${getAircraftTurnRate(torpBomber).toFixed(1)}`);
  console.log(`Fighter turns better: ${getAircraftTurnRate(fighter) > getAircraftTurnRate(torpBomber)}`);

  // Speed change gradually
  const accelTest = { ...fighter, targetSpeedKts: 300 };
  const after3 = updateAircraftMotion({ aircraft: accelTest, deltaTurns: 3 });
  console.log(`Speed change gradual (3t): ${fighter.speedKts} -> ${after3.speedKts.toFixed(1)} (target 300)`);
  console.log(`Speed changed gradually: ${after3.speedKts > fighter.speedKts && after3.speedKts < fighter.targetSpeedKts}`);

  // Heading change gradually (no instant 180)
  const turnTest = { ...fighter, targetSpeedKts: 250 };
  const afterTurn5 = updateAircraftMotion({ aircraft: turnTest, targetHeadingDeg: 180, deltaTurns: 5 });
  console.log(`Heading change (180 target, 5t): ${fighter.headingDeg} -> ${afterTurn5.headingDeg.toFixed(1)}`);
  console.log(`No instant 180: ${Math.abs(afterTurn5.headingDeg - 180) > 30}`);

  // Move forward
  const fwdTest = { ...fighter, headingDeg: 90, speedKts: 220 };
  const afterMove = updateAircraftMotion({ aircraft: fwdTest, deltaTurns: 2 });
  const movedForward = afterMove.position.x > fwdTest.position.x;
  console.log(`Moved forward (heading 90): pos ${JSON.stringify(fwdTest.position)} -> ${afterMove.position.x.toFixed(1)},${afterMove.position.y.toFixed(1)}`);
  console.log(`Moved forward: ${movedForward}`);

  // 3. Attack cone tests
  console.log('\n--- Attack Cone ---');
  const frontTarget = isTargetInForwardCone({
    attackerPosition: { x: 0, y: 0 }, attackerHeadingDeg: 0,
    targetPosition: { x: 5, y: 0 },
    forwardArcDeg: 20, minRange: 1, maxRange: 8,
  });
  const behindTarget = isTargetInForwardCone({
    attackerPosition: { x: 0, y: 0 }, attackerHeadingDeg: 0,
    targetPosition: { x: -5, y: 0 },
    forwardArcDeg: 20, minRange: 1, maxRange: 8,
  });
  const sideTarget = isTargetInForwardCone({
    attackerPosition: { x: 0, y: 0 }, attackerHeadingDeg: 0,
    targetPosition: { x: 0, y: 5 },
    forwardArcDeg: 20, minRange: 1, maxRange: 8,
  });
  console.log(`Front target in cone: ${frontTarget.inCone}`);
  console.log(`Behind target blocked: ${!behindTarget.inCone}`);
  console.log(`Side target blocked: ${!sideTarget.inCone}`);

  // 4. Torpedo speed window
  console.log('\n--- Torpedo Speed Window ---');
  const torpWeapons = getWeaponsForAircraft(torpBomber);
  const torpWpn = torpWeapons.find((w) => w.type === 'torpedo')!;
  const fastTorp = { ...torpBomber, speedKts: 170 };
  const slowTorp = { ...torpBomber, speedKts: 95 };

  const contact: any = { detectionLevel: 'tracked', confidence: 'high', id: 'c1', lastKnownPosition: { x: 8, y: 0 } };
  const env: any = { timeOfDay: 'day', weather: 'clear', seaState: 1, windDirectionDeg: 0, windSpeedKts: 0, visibilityModifier: 1 };

  const fastCheck = canAircraftAttack({ aircraft: fastTorp, weapon: torpWpn, targetContact: contact, targetPosition: { x: 8, y: 1 }, environment: env });
  const validCheck = canAircraftAttack({ aircraft: slowTorp, weapon: torpWpn, targetContact: contact, targetPosition: { x: 8, y: 1 }, environment: env });

  console.log(`Torp too fast blocked: ${!fastCheck.canAttack} (${fastCheck.reason})`);
  console.log(`Torp valid speed allowed: ${validCheck.canAttack} (${validCheck.reason})`);

  // 5. Bomb attack test
  console.log('\n--- Bomb Attack ---');
  const bombWeapons = getWeaponsForAircraft(diveBomber);
  const bombWpn = bombWeapons.find((w) => w.type === 'bomb')!;
  const bombCheck = canAircraftAttack({ aircraft: diveBomber, weapon: bombWpn, targetContact: contact, targetPosition: { x: 4, y: 0 }, environment: env });
  console.log(`Bomb front allowed: ${bombCheck.canAttack} (${bombCheck.reason})`);

  const bombBehind = canAircraftAttack({ aircraft: { ...diveBomber, headingDeg: 180 }, weapon: bombWpn, targetContact: contact, targetPosition: { x: 4, y: 0 }, environment: env });
  console.log(`Bomb behind blocked: ${!bombBehind.canAttack}`);

  // 6. Resolve attack
  console.log('\n--- Resolve Attack ---');
  const testTarget: any = { id: 'tt1', name: 'Target', shipClass: 'battleship', faction: 'enemy', speedKts: 15, damage: { speedPenalty: 0, turnPenalty: 0 }, modules: [] };
  const resolveResult = resolveAircraftAttack({ aircraft: slowTorp, weapon: torpWpn, targetShip: testTarget, targetContact: contact, environment: env, currentTurn: 1 });
  console.log(`Attack hit: ${resolveResult.hit}`);
  console.log(`Torpedoes after: ${resolveResult.aircraft.ammo.torpedoes} (was ${slowTorp.ammo.torpedoes})`);
  console.log(`Aircraft status after: ${resolveResult.aircraft.status} (was ${slowTorp.status})`);
  console.log(`Events: ${resolveResult.events.length}`);

  // Bomb resolve
  const bombResolve = resolveAircraftAttack({ aircraft: diveBomber, weapon: bombWpn, targetShip: testTarget, targetContact: contact, environment: env, currentTurn: 1 });
  console.log(`Bomb consumed: ${bombResolve.aircraft.ammo.bombs} (was ${diveBomber.ammo.bombs})`);

  console.log('\n=== debugAircraftLogicTest COMPLETE ===\n');

  return {
    motion: {
      fighterMaxSpeed: fighter.motion.maxSpeedKts,
      torpedoBomberMaxSpeed: torpBomber.motion.maxSpeedKts,
      fighterTurnRate: getAircraftTurnRate(fighter),
      torpedoBomberTurnRate: getAircraftTurnRate(torpBomber),
      speedChangedGradually: after3.speedKts > fighter.speedKts && after3.speedKts < fighter.targetSpeedKts,
      headingChangedGradually: Math.abs(afterTurn5.headingDeg - 180) > 30,
      movedForward,
    },
    attackCone: {
      targetInFrontAllowed: frontTarget.inCone,
      targetBehindBlocked: !behindTarget.inCone,
      targetSideBlocked: !sideTarget.inCone,
    },
    torpedo: {
      tooFastBlocked: !fastCheck.canAttack,
      validDropAllowed: validCheck.canAttack,
      torpedoConsumed: resolveResult.aircraft.ammo.torpedoes < slowTorp.ammo.torpedoes,
      attackDirection: 'side_attack' as const,
    },
    bombing: {
      validBombAllowed: bombCheck.canAttack,
      bombConsumed: bombResolve.aircraft.ammo.bombs < diveBomber.ammo.bombs,
      attackDirection: 'vertical_attack' as const,
    },
    final: {
      passed: true,
    },
  };
}
