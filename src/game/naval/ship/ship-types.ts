/**
 * 舰船类型定义 - 二战太平洋海战核心舰船类型
 */

import type { ShipMotionProfile } from './ship-motion';
import type { ShipSensorProfile } from './ship-sensors';
import type { ShipWeaponMount } from './ship-weapons';
import type { ShipModule } from './ship-modules';
import type { ShipDamageState } from './ship-damage';
import type { DamageControlState } from './ship-damage-control';
import type { CarrierAirGroup } from './ship-aircraft';

// ===== 舰船类型 =====

export type NavalShipClass =
  | 'fleet_carrier'
  | 'light_carrier'
  | 'escort_carrier'
  | 'battleship'
  | 'heavy_cruiser'
  | 'light_cruiser'
  | 'destroyer'
  | 'submarine'
  | 'transport'
  | 'oiler'
  | 'landing_ship';

// ===== 舰船角色 =====

export type ShipRole =
  | 'carrier'
  | 'screen'
  | 'picket'
  | 'surface_combatant'
  | 'torpedo_attack'
  | 'transport'
  | 'submarine'
  | 'oiler';

// ===== 舰船命令状态 =====

export interface ShipCommandState {
  controller: 'player_direct' | 'ai_delegated' | 'enemy_ai';
  currentOrderId?: string;
  formationId?: string;
  role: ShipRole;
}

// ===== 舰船隐匿属性 =====

export interface ShipStealth {
  surfaceSignature: number;
  radarSignature: number;
  smokeSignature: number;
  acousticSignature: number;
}

// ===== 舰船主类型 =====

export interface NavalShip {
  id: string;
  name: string;

  faction: 'player' | 'enemy' | 'neutral';

  shipClass: NavalShipClass;

  position: {
    x: number;
    y: number;
  };

  headingDeg: number;
  speedKts: number;
  targetSpeedKts: number;
  rudderDeg: number;

  motion: ShipMotionProfile;

  sensors: ShipSensorProfile;

  weapons: ShipWeaponMount[];

  modules: ShipModule[];

  damage: ShipDamageState;

  damageControl: DamageControlState;

  aircraft?: CarrierAirGroup;

  stealth: ShipStealth;

  commandState: ShipCommandState;
}

// ===== 舰船状态快照（用于 UI 展示） =====

export interface NavalShipStatusSnapshot {
  id: string;
  name: string;
  shipClass: NavalShipClass;
  faction: 'player' | 'enemy' | 'neutral';
  position: { x: number; y: number };
  headingDeg: number;
  speedKts: number;
  targetSpeedKts: number;
  rudderDeg: number;
  hullIntegrity: number;
  buoyancy: number;
  stability: number;
  fire: number;
  flooding: number;
  crewEfficiency: number;
  status: ShipDamageState['status'];
  modules: Array<{
    id: string;
    type: string;
    name: string;
    hp: number;
    maxHp: number;
    status: string;
    fire: number;
    flooding: number;
  }>;
  weaponMounts: Array<{
    id: string;
    type: string;
    name: string;
    ammo: number;
    cooldown: number;
  }>;
}
