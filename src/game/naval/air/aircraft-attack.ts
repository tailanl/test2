/**
 * 飞机攻击系统 - forward cone / canAircraftAttack / resolveAircraftAttack
 */

import type { NavalAircraft, AircraftAttackState } from './aircraft-types';
import { normalizeHeading, headingDifferenceDeg } from './aircraft-types';
import type { AircraftWeaponProfile, AircraftAttackCone } from './aircraft-weapons';
import { getWeaponsForAircraft } from './aircraft-weapons';
import type { NavalContact } from '../intel/naval-intel-types';
import type { NavalShip } from '../ship/ship-types';
import type { NavalEnvironmentState } from '../naval-types';
import type { NavalBattleLogEvent } from '../ship/ship-damage';
import { applyNavalDamage } from '../ship/ship-damage';

// ===== 前向扇区检查 =====

export function isTargetInForwardCone(params: {
  attackerPosition: { x: number; y: number };
  attackerHeadingDeg: number;
  targetPosition: { x: number; y: number };
  forwardArcDeg: number;
  minRange: number;
  maxRange: number;
}): {
  inCone: boolean;
  distance: number;
  angleToTargetDeg: number;
  headingErrorDeg: number;
  reason: string;
} {
  const { attackerPosition, attackerHeadingDeg, targetPosition, forwardArcDeg, minRange, maxRange } = params;

  const dx = targetPosition.x - attackerPosition.x;
  const dy = targetPosition.y - attackerPosition.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  const angleToTargetRad = Math.atan2(dy, dx);
  let angleToTargetDeg = (angleToTargetRad * 180) / Math.PI;
  angleToTargetDeg = ((angleToTargetDeg % 360) + 360) % 360;

  const headingErrorDeg = Math.abs(headingDifferenceDeg(attackerHeadingDeg, angleToTargetDeg));
  const halfCone = forwardArcDeg / 2;
  const inCone = headingErrorDeg <= halfCone;

  if (distance < minRange) {
    return { inCone: false, distance, angleToTargetDeg, headingErrorDeg, reason: 'Target too close' };
  }
  if (distance > maxRange) {
    return { inCone: false, distance, angleToTargetDeg, headingErrorDeg, reason: 'Target out of range' };
  }
  if (!inCone) {
    return { inCone: false, distance, angleToTargetDeg, headingErrorDeg, reason: `Target outside forward cone (${headingErrorDeg.toFixed(1)}° > ${halfCone}°)` };
  }

  return { inCone: true, distance, angleToTargetDeg, headingErrorDeg, reason: 'Target in forward cone' };
}

// ===== 判定能否攻击 =====

export function canAircraftAttack(params: {
  aircraft: NavalAircraft;
  weapon: AircraftWeaponProfile;
  targetContact: NavalContact;
  targetPosition: { x: number; y: number };
  environment: NavalEnvironmentState;
}): {
  canAttack: boolean;
  reason: string;
  coneCheck: ReturnType<typeof isTargetInForwardCone>;
  speedOk: boolean;
  contactOk: boolean;
} {
  const { aircraft, weapon, targetContact, targetPosition } = params;

  const coneCheck = isTargetInForwardCone({
    attackerPosition: aircraft.position,
    attackerHeadingDeg: aircraft.headingDeg,
    targetPosition,
    forwardArcDeg: weapon.attackCone.forwardArcDeg,
    minRange: weapon.attackCone.minRange,
    maxRange: weapon.attackCone.maxRange,
  });

  // Contact quality
  const contactOk =
    targetContact.detectionLevel === 'tracked' ||
    targetContact.detectionLevel === 'identified' ||
    targetContact.detectionLevel === 'classified';

  // Speed window
  const speedOk = aircraft.speedKts >= weapon.minSpeedKts && aircraft.speedKts <= weapon.maxSpeedKts;

  // Ammo
  let ammoOk = true;
  if (weapon.type === 'machine_gun' && aircraft.ammo.machineGunAmmo <= 0) ammoOk = false;
  if (weapon.type === 'bomb' && aircraft.ammo.bombs <= 0) ammoOk = false;
  if (weapon.type === 'torpedo' && aircraft.ammo.torpedoes <= 0) ammoOk = false;

  // Status
  const statusOk =
    aircraft.status === 'en_route' ||
    aircraft.status === 'attack_run' ||
    aircraft.status === 'searching';

  const reasons: string[] = [];
  if (!coneCheck.inCone) reasons.push(coneCheck.reason);
  if (!contactOk) reasons.push(`Contact quality too low (${targetContact.detectionLevel})`);
  if (!speedOk) reasons.push(`Speed ${aircraft.speedKts}kts outside window [${weapon.minSpeedKts}-${weapon.maxSpeedKts}]`);
  if (!ammoOk) reasons.push('No ammo');
  if (!statusOk) reasons.push(`Aircraft status ${aircraft.status} cannot attack`);

  return {
    canAttack: coneCheck.inCone && contactOk && speedOk && ammoOk && statusOk,
    reason: reasons.length > 0 ? reasons.join('; ') : 'Ready to attack',
    coneCheck,
    speedOk,
    contactOk,
  };
}

// ===== 执行攻击 =====

export function resolveAircraftAttack(params: {
  aircraft: NavalAircraft;
  weapon: AircraftWeaponProfile;
  targetShip: NavalShip;
  targetContact: NavalContact;
  environment: NavalEnvironmentState;
  currentTurn: number;
}): {
  aircraft: NavalAircraft;
  targetShip: NavalShip;
  events: NavalBattleLogEvent[];
  hit: boolean;
  reason: string;
} {
  const { aircraft, weapon, targetShip, targetContact, environment, currentTurn } = params;
  const events: NavalBattleLogEvent[] = [];
  const newAc = { ...aircraft };

  // 检查能否攻击
  const canResult = canAircraftAttack({
    aircraft, weapon, targetContact,
    targetPosition: targetContact.lastKnownPosition,
    environment,
  });

  if (!canResult.canAttack) {
    return { aircraft: newAc, targetShip, events, hit: false, reason: canResult.reason };
  }

  // 命中率
  let hitChance = weapon.baseAccuracy;
  if (targetContact.detectionLevel === 'tracked') hitChance += 0.2;
  if (targetContact.detectionLevel === 'identified') hitChance += 0.15;
  if (targetContact.detectionLevel === 'classified') hitChance += 0.05;
  if (targetContact.detectionLevel === 'suspected') hitChance -= 0.25;
  if (environment.weather === 'storm') hitChance -= 0.25;
  if (environment.weather === 'rain') hitChance -= 0.1;
  if (environment.timeOfDay === 'night') hitChance -= 0.2;
  hitChance -= targetShip.speedKts / 1000;
  hitChance = Math.max(0.02, Math.min(0.85, hitChance));

  const hit = Math.random() < hitChance;

  // 弹药扣除
  if (weapon.type === 'torpedo') newAc.ammo = { ...newAc.ammo, torpedoes: Math.max(0, newAc.ammo.torpedoes - 1) };
  if (weapon.type === 'bomb') newAc.ammo = { ...newAc.ammo, bombs: Math.max(0, newAc.ammo.bombs - 1) };
  if (weapon.type === 'machine_gun') newAc.ammo = { ...newAc.ammo, machineGunAmmo: Math.max(0, newAc.ammo.machineGunAmmo - 100) };

  // 攻击后状态
  newAc.status = 'egress';
  newAc.attackState = {
    ...(newAc.attackState || { attackType: weapon.attackType, attackRunStartedTurn: currentTurn, committed: true }),
    weaponReleased: true,
    egressHeadingDeg: (aircraft.headingDeg + 180) % 360,
  } as AircraftAttackState;

  if (hit) {
    const hitLocation = weapon.navalDamageType === 'torpedo_hit' ? 'below_waterline' as const :
      weapon.navalDamageType === 'bomb_hit' ? 'superstructure' as const : 'midships' as const;

    const damResult = applyNavalDamage({
      ship: targetShip, hitLocation,
      damageType: weapon.navalDamageType,
      penetration: weapon.penetration,
      explosivePower: weapon.explosivePower,
      underwater: weapon.type === 'torpedo',
      turn: currentTurn,
    });

    events.push({
      id: `air_att_${currentTurn}_${Date.now()}`,
      turn: currentTurn,
      type: `${weapon.type}_hit`,
      description: `${aircraft.name} ${weapon.attackType}: ${weapon.type} HIT on ${targetShip.name}! (${hitChance.toFixed(0)}% chance)`,
      shipId: targetShip.id,
      damage: weapon.explosivePower,
      attackDirection: weapon.navalDamageType === 'torpedo_hit' ? 'side_attack' : weapon.navalDamageType === 'bomb_hit' ? 'vertical_attack' : 'side_attack',
      impactSurface: weapon.navalDamageType === 'torpedo_hit' ? 'underwater_hull' : weapon.navalDamageType === 'bomb_hit' ? 'deck' : 'superstructure',
      penetrationSucceeded: true,
    });

    events.push(...damResult.events);

    return { aircraft: newAc, targetShip: damResult.ship, events, hit: true, reason: `Hit! ${weapon.type} struck ${targetShip.name}` };
  }

  events.push({
    id: `air_miss_${currentTurn}_${Date.now()}`,
    turn: currentTurn,
    type: `${weapon.type}_miss`,
    description: `${aircraft.name} ${weapon.attackType}: ${weapon.type} MISSED ${targetShip.name} (${hitChance.toFixed(0)}% chance)`,
    shipId: targetShip.id,
  });

  return { aircraft: newAc, targetShip, events, hit: false, reason: `Missed (${hitChance.toFixed(0)}% chance)` };
}

// ===== 空战拦截（CAP 最小逻辑） =====

export function resolveAircraftInterception(params: {
  fighter: NavalAircraft;
  targetAircraft: NavalAircraft;
  currentTurn: number;
}): {
  fighter: NavalAircraft;
  targetAircraft: NavalAircraft;
  events: NavalBattleLogEvent[];
} {
  const { fighter, targetAircraft, currentTurn } = params;
  const events: NavalBattleLogEvent[] = [];
  let newFighter = { ...fighter };
  let newTarget = { ...targetAircraft };

  const coneCheck = isTargetInForwardCone({
    attackerPosition: fighter.position,
    attackerHeadingDeg: fighter.headingDeg,
    targetPosition: targetAircraft.position,
    forwardArcDeg: 30,
    minRange: 1,
    maxRange: 8,
  });

  if (!coneCheck.inCone || fighter.ammo.machineGunAmmo <= 0) {
    events.push({
      id: `cap_fail_${currentTurn}`,
      turn: currentTurn,
      type: 'cap_engagement',
      description: `${fighter.name} could not engage ${targetAircraft.name}: ${coneCheck.reason}`,
    });
    return { fighter: newFighter, targetAircraft: newTarget, events };
  }

  newFighter.ammo = { ...newFighter.ammo, machineGunAmmo: Math.max(0, newFighter.ammo.machineGunAmmo - 200) };
  const hitChance = 0.35;
  const hit = Math.random() < hitChance;

  if (hit) {
    newTarget.status = newTarget.damage.speedPenalty > 0.5 ? 'lost' : 'damaged';
    newTarget.damage = { ...newTarget.damage, status: newTarget.status === 'lost' ? 'lost' : 'damaged' };
    events.push({
      id: `cap_kill_${currentTurn}`,
      turn: currentTurn,
      type: 'aircraft_shot_down',
      description: `${fighter.name} shot down ${targetAircraft.name}!`,
    });
  } else {
    events.push({
      id: `cap_miss_${currentTurn}`,
      turn: currentTurn,
      type: 'cap_engagement',
      description: `${fighter.name} engaged ${targetAircraft.name} but missed.`,
    });
  }

  return { fighter: newFighter, targetAircraft: newTarget, events };
}
