/**
 * 飞机基础类型 - NavalAircraft, AircraftMotionProfile, 弹药/攻击状态
 */

// ===== 飞机类型 =====

export type NavalAircraftClass =
  | 'fighter'
  | 'dive_bomber'
  | 'torpedo_bomber'
  | 'scout'
  | 'level_bomber'
  | 'floatplane';

// ===== 飞机运动性能 =====

export interface AircraftMotionProfile {
  maxSpeedKts: number;
  cruiseSpeedKts: number;
  minAttackSpeedKts: number;
  maxAttackSpeedKts: number;
  accelerationKtsPerTurn: number;
  decelerationKtsPerTurn: number;
  maxTurnRateDegPerTurn: number;
  turnAgility: number;
  turnRateBySpeed: Array<{
    speedRatioMin: number;
    speedRatioMax: number;
    turnRateMultiplier: number;
  }>;
}

// ===== 飞机弹药 =====

export interface AircraftAmmoState {
  machineGunAmmo: number;
  bombs: number;
  torpedoes: number;
  rockets?: number;
}

// ===== 飞机攻击状态 =====

export interface AircraftAttackState {
  targetContactId?: string;
  targetShipId?: string;
  attackType: 'strafing' | 'dive_bombing' | 'level_bombing' | 'torpedo_drop' | 'search_only';
  attackRunStartedTurn: number;
  committed: boolean;
  weaponReleased: boolean;
  egressHeadingDeg?: number;
}

// ===== 飞机传感器 =====

export interface AircraftSensorProfile {
  visualRange: number;
  surfaceRadarRange: number;
  nightPenalty: number;
}

// ===== 飞机损伤 =====

export interface AircraftDamageState {
  controlPenalty: number;
  speedPenalty: number;
  status: 'ok' | 'damaged' | 'crippled' | 'lost';
}

// ===== 核心 NavalAircraft =====

export interface NavalAircraft {
  id: string;
  name: string;
  aircraftClass: NavalAircraftClass;
  faction: 'player' | 'enemy' | 'neutral';
  originShipId?: string;
  missionId?: string;
  position: { x: number; y: number };
  headingDeg: number;
  speedKts: number;
  targetSpeedKts: number;
  motion: AircraftMotionProfile;
  fuel: number;
  maxFuel: number;
  ammo: AircraftAmmoState;
  status:
    | 'ready' | 'launching' | 'en_route' | 'searching'
    | 'attack_run' | 'egress' | 'returning' | 'landing'
    | 'landed' | 'damaged' | 'lost';
  attackState?: AircraftAttackState;
  sensor: AircraftSensorProfile;
  damage: AircraftDamageState;
}

// ===== 工具：标准化航向 =====

export function normalizeHeading(deg: number): number {
  let h = deg % 360;
  if (h < 0) h += 360;
  return h;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function headingDifferenceDeg(fromDeg: number, toDeg: number): number {
  let diff = normalizeHeading(toDeg - fromDeg);
  if (diff > 180) diff -= 360;
  return diff;
}

// ===== 默认运动性能 =====

export function createDefaultAircraftMotionProfile(aircraftClass: NavalAircraftClass): AircraftMotionProfile {
  const baseTurnRates = [
    { speedRatioMin: 0.0, speedRatioMax: 0.3, turnRateMultiplier: 0.4 },
    { speedRatioMin: 0.3, speedRatioMax: 0.6, turnRateMultiplier: 0.75 },
    { speedRatioMin: 0.6, speedRatioMax: 0.85, turnRateMultiplier: 1.0 },
    { speedRatioMin: 0.85, speedRatioMax: 1.0, turnRateMultiplier: 0.9 },
  ];

  switch (aircraftClass) {
    case 'fighter':
      return {
        maxSpeedKts: 330, cruiseSpeedKts: 220,
        minAttackSpeedKts: 140, maxAttackSpeedKts: 320,
        accelerationKtsPerTurn: 45, decelerationKtsPerTurn: 55,
        maxTurnRateDegPerTurn: 45, turnAgility: 1.4,
        turnRateBySpeed: baseTurnRates,
      };
    case 'dive_bomber':
      return {
        maxSpeedKts: 260, cruiseSpeedKts: 170,
        minAttackSpeedKts: 130, maxAttackSpeedKts: 290,
        accelerationKtsPerTurn: 30, decelerationKtsPerTurn: 45,
        maxTurnRateDegPerTurn: 32, turnAgility: 1.0,
        turnRateBySpeed: baseTurnRates,
      };
    case 'torpedo_bomber':
      return {
        maxSpeedKts: 220, cruiseSpeedKts: 150,
        minAttackSpeedKts: 90, maxAttackSpeedKts: 160,
        accelerationKtsPerTurn: 25, decelerationKtsPerTurn: 35,
        maxTurnRateDegPerTurn: 24, turnAgility: 0.75,
        turnRateBySpeed: baseTurnRates,
      };
    case 'scout':
    case 'floatplane':
      return {
        maxSpeedKts: 180, cruiseSpeedKts: 120,
        minAttackSpeedKts: 90, maxAttackSpeedKts: 160,
        accelerationKtsPerTurn: 20, decelerationKtsPerTurn: 25,
        maxTurnRateDegPerTurn: 22, turnAgility: 0.7,
        turnRateBySpeed: baseTurnRates,
      };
    case 'level_bomber':
    default:
      return {
        maxSpeedKts: 230, cruiseSpeedKts: 160,
        minAttackSpeedKts: 120, maxAttackSpeedKts: 220,
        accelerationKtsPerTurn: 20, decelerationKtsPerTurn: 25,
        maxTurnRateDegPerTurn: 18, turnAgility: 0.55,
        turnRateBySpeed: baseTurnRates,
      };
  }
}

export function createDefaultAircraft(
  aircraftClass: NavalAircraftClass,
  faction: 'player' | 'enemy' | 'neutral',
  name: string,
  x: number,
  y: number,
  headingDeg: number,
  speedKts: number,
  originShipId?: string,
  missionId?: string,
): NavalAircraft {
  const motion = createDefaultAircraftMotionProfile(aircraftClass);

  const ammo: AircraftAmmoState = { machineGunAmmo: 1000, bombs: 0, torpedoes: 0 };
  if (aircraftClass === 'dive_bomber') { ammo.bombs = 2; ammo.machineGunAmmo = 500; }
  if (aircraftClass === 'torpedo_bomber') { ammo.torpedoes = 1; ammo.machineGunAmmo = 300; }
  if (aircraftClass === 'fighter') { ammo.machineGunAmmo = 1500; }
  if (aircraftClass === 'level_bomber') { ammo.bombs = 4; ammo.machineGunAmmo = 400; }

  return {
    id: `ac_${faction}_${aircraftClass}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    aircraftClass,
    faction,
    originShipId,
    missionId,
    position: { x, y },
    headingDeg,
    speedKts,
    targetSpeedKts: speedKts,
    motion,
    fuel: 100,
    maxFuel: 100,
    ammo,
    status: 'en_route',
    sensor: { visualRange: 15, surfaceRadarRange: 5, nightPenalty: 0.1 },
    damage: { controlPenalty: 0, speedPenalty: 0, status: 'ok' },
  };
}
