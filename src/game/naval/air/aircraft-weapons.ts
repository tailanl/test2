/**
 * 飞机武器系统 - 武器配置
 */

import type { NavalAircraft } from './aircraft-types';

// ===== 飞机武器类型 =====

export type AircraftWeaponType = 'machine_gun' | 'bomb' | 'torpedo' | 'rocket';

// ===== 攻击扇区 =====

export interface AircraftAttackCone {
  forwardArcDeg: number;
  minRange: number;
  maxRange: number;
}

// ===== 武器配置 =====

export interface AircraftWeaponProfile {
  type: AircraftWeaponType;
  attackType: 'strafing' | 'dive_bombing' | 'level_bombing' | 'torpedo_drop';
  attackCone: AircraftAttackCone;
  minSpeedKts: number;
  maxSpeedKts: number;
  baseAccuracy: number;
  penetration: number;
  explosivePower: number;
  navalDamageType: 'shell_hit' | 'bomb_hit' | 'torpedo_hit';
}

// ===== 获取飞机可用武器 =====

export function getWeaponsForAircraft(aircraft: NavalAircraft): AircraftWeaponProfile[] {
  const weapons: AircraftWeaponProfile[] = [];

  switch (aircraft.aircraftClass) {
    case 'fighter':
      if (aircraft.ammo.machineGunAmmo > 0) {
        weapons.push({
          type: 'machine_gun', attackType: 'strafing',
          attackCone: { forwardArcDeg: 20, minRange: 1, maxRange: 8 },
          minSpeedKts: 120, maxSpeedKts: 330,
          baseAccuracy: 0.25, penetration: 10, explosivePower: 10,
          navalDamageType: 'shell_hit',
        });
      }
      break;

    case 'dive_bomber':
      if (aircraft.ammo.bombs > 0) {
        weapons.push({
          type: 'bomb', attackType: 'dive_bombing',
          attackCone: { forwardArcDeg: 25, minRange: 1, maxRange: 6 },
          minSpeedKts: 130, maxSpeedKts: 290,
          baseAccuracy: 0.45, penetration: 80, explosivePower: 90,
          navalDamageType: 'bomb_hit',
        });
      }
      if (aircraft.ammo.machineGunAmmo > 0) {
        weapons.push({
          type: 'machine_gun', attackType: 'strafing',
          attackCone: { forwardArcDeg: 20, minRange: 1, maxRange: 6 },
          minSpeedKts: 120, maxSpeedKts: 290,
          baseAccuracy: 0.18, penetration: 8, explosivePower: 8,
          navalDamageType: 'shell_hit',
        });
      }
      break;

    case 'torpedo_bomber':
      if (aircraft.ammo.torpedoes > 0) {
        weapons.push({
          type: 'torpedo', attackType: 'torpedo_drop',
          attackCone: { forwardArcDeg: 15, minRange: 4, maxRange: 12 },
          minSpeedKts: 90, maxSpeedKts: 160,
          baseAccuracy: 0.35, penetration: 120, explosivePower: 120,
          navalDamageType: 'torpedo_hit',
        });
      }
      if (aircraft.ammo.machineGunAmmo > 0) {
        weapons.push({
          type: 'machine_gun', attackType: 'strafing',
          attackCone: { forwardArcDeg: 20, minRange: 1, maxRange: 6 },
          minSpeedKts: 100, maxSpeedKts: 220,
          baseAccuracy: 0.15, penetration: 8, explosivePower: 6,
          navalDamageType: 'shell_hit',
        });
      }
      break;

    case 'level_bomber':
      if (aircraft.ammo.bombs > 0) {
        weapons.push({
          type: 'bomb', attackType: 'level_bombing',
          attackCone: { forwardArcDeg: 35, minRange: 3, maxRange: 10 },
          minSpeedKts: 120, maxSpeedKts: 220,
          baseAccuracy: 0.20, penetration: 70, explosivePower: 100,
          navalDamageType: 'bomb_hit',
        });
      }
      break;

    default:
      if (aircraft.ammo.machineGunAmmo > 0) {
        weapons.push({
          type: 'machine_gun', attackType: 'strafing',
          attackCone: { forwardArcDeg: 25, minRange: 1, maxRange: 5 },
          minSpeedKts: 80, maxSpeedKts: 180,
          baseAccuracy: 0.12, penetration: 5, explosivePower: 5,
          navalDamageType: 'shell_hit',
        });
      }
      break;
  }

  return weapons;
}
