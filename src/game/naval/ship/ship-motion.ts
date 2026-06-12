/**
 * 舰船运动系统 - 航向/速度/舵角/惯性
 */

import type { NavalShip } from './ship-types';

// ===== 运动性能 =====

export interface TurnRateEntry {
  speedRatioMin: number;
  speedRatioMax: number;
  turnRateMultiplier: number;
}

export interface ShipMotionProfile {
  maxSpeedKts: number;
  accelerationKtsPerTurn: number;
  decelerationKtsPerTurn: number;
  maxRudderDeg: number;
  baseTurnRateDegPerTurn: number;
  turnRateBySpeed: TurnRateEntry[];
  stoppingDistanceTurns: number;
}

// ===== 默认运动性能（根据舰种） =====

export function createDefaultMotionProfile(shipClass: string): ShipMotionProfile {
  switch (shipClass) {
    case 'fleet_carrier':
    case 'light_carrier':
      return {
        maxSpeedKts: 33,
        accelerationKtsPerTurn: 2,
        decelerationKtsPerTurn: 3,
        maxRudderDeg: 35,
        baseTurnRateDegPerTurn: 3,
        turnRateBySpeed: [
          { speedRatioMin: 0.0, speedRatioMax: 0.3, turnRateMultiplier: 0.4 },
          { speedRatioMin: 0.3, speedRatioMax: 0.6, turnRateMultiplier: 0.7 },
          { speedRatioMin: 0.6, speedRatioMax: 0.85, turnRateMultiplier: 1.0 },
          { speedRatioMin: 0.85, speedRatioMax: 1.0, turnRateMultiplier: 1.2 },
        ],
        stoppingDistanceTurns: 25,
      };
    case 'escort_carrier':
      return {
        maxSpeedKts: 19,
        accelerationKtsPerTurn: 1,
        decelerationKtsPerTurn: 2,
        maxRudderDeg: 35,
        baseTurnRateDegPerTurn: 2,
        turnRateBySpeed: [
          { speedRatioMin: 0.0, speedRatioMax: 0.3, turnRateMultiplier: 0.3 },
          { speedRatioMin: 0.3, speedRatioMax: 0.6, turnRateMultiplier: 0.6 },
          { speedRatioMin: 0.6, speedRatioMax: 0.85, turnRateMultiplier: 1.0 },
          { speedRatioMin: 0.85, speedRatioMax: 1.0, turnRateMultiplier: 1.1 },
        ],
        stoppingDistanceTurns: 15,
      };
    case 'battleship':
      return {
        maxSpeedKts: 28,
        accelerationKtsPerTurn: 1,
        decelerationKtsPerTurn: 2,
        maxRudderDeg: 35,
        baseTurnRateDegPerTurn: 4,
        turnRateBySpeed: [
          { speedRatioMin: 0.0, speedRatioMax: 0.3, turnRateMultiplier: 0.3 },
          { speedRatioMin: 0.3, speedRatioMax: 0.6, turnRateMultiplier: 0.7 },
          { speedRatioMin: 0.6, speedRatioMax: 0.85, turnRateMultiplier: 1.0 },
          { speedRatioMin: 0.85, speedRatioMax: 1.0, turnRateMultiplier: 1.3 },
        ],
        stoppingDistanceTurns: 20,
      };
    case 'heavy_cruiser':
      return {
        maxSpeedKts: 32,
        accelerationKtsPerTurn: 2,
        decelerationKtsPerTurn: 3,
        maxRudderDeg: 35,
        baseTurnRateDegPerTurn: 5,
        turnRateBySpeed: [
          { speedRatioMin: 0.0, speedRatioMax: 0.3, turnRateMultiplier: 0.4 },
          { speedRatioMin: 0.3, speedRatioMax: 0.6, turnRateMultiplier: 0.7 },
          { speedRatioMin: 0.6, speedRatioMax: 0.85, turnRateMultiplier: 1.0 },
          { speedRatioMin: 0.85, speedRatioMax: 1.0, turnRateMultiplier: 1.2 },
        ],
        stoppingDistanceTurns: 15,
      };
    case 'light_cruiser':
      return {
        maxSpeedKts: 33,
        accelerationKtsPerTurn: 2,
        decelerationKtsPerTurn: 3,
        maxRudderDeg: 35,
        baseTurnRateDegPerTurn: 6,
        turnRateBySpeed: [
          { speedRatioMin: 0.0, speedRatioMax: 0.3, turnRateMultiplier: 0.4 },
          { speedRatioMin: 0.3, speedRatioMax: 0.6, turnRateMultiplier: 0.7 },
          { speedRatioMin: 0.6, speedRatioMax: 0.85, turnRateMultiplier: 1.0 },
          { speedRatioMin: 0.85, speedRatioMax: 1.0, turnRateMultiplier: 1.3 },
        ],
        stoppingDistanceTurns: 12,
      };
    case 'destroyer':
      return {
        maxSpeedKts: 35,
        accelerationKtsPerTurn: 3,
        decelerationKtsPerTurn: 4,
        maxRudderDeg: 35,
        baseTurnRateDegPerTurn: 8,
        turnRateBySpeed: [
          { speedRatioMin: 0.0, speedRatioMax: 0.3, turnRateMultiplier: 0.3 },
          { speedRatioMin: 0.3, speedRatioMax: 0.6, turnRateMultiplier: 0.7 },
          { speedRatioMin: 0.6, speedRatioMax: 0.85, turnRateMultiplier: 1.0 },
          { speedRatioMin: 0.85, speedRatioMax: 1.0, turnRateMultiplier: 1.4 },
        ],
        stoppingDistanceTurns: 8,
      };
    case 'submarine':
      return {
        maxSpeedKts: 20,
        accelerationKtsPerTurn: 1,
        decelerationKtsPerTurn: 2,
        maxRudderDeg: 35,
        baseTurnRateDegPerTurn: 4,
        turnRateBySpeed: [
          { speedRatioMin: 0.0, speedRatioMax: 0.3, turnRateMultiplier: 0.2 },
          { speedRatioMin: 0.3, speedRatioMax: 0.6, turnRateMultiplier: 0.6 },
          { speedRatioMin: 0.6, speedRatioMax: 0.85, turnRateMultiplier: 1.0 },
          { speedRatioMin: 0.85, speedRatioMax: 1.0, turnRateMultiplier: 0.9 },
        ],
        stoppingDistanceTurns: 10,
      };
    case 'transport':
    case 'oiler':
    case 'landing_ship':
    default:
      return {
        maxSpeedKts: 16,
        accelerationKtsPerTurn: 1,
        decelerationKtsPerTurn: 1,
        maxRudderDeg: 35,
        baseTurnRateDegPerTurn: 2,
        turnRateBySpeed: [
          { speedRatioMin: 0.0, speedRatioMax: 0.3, turnRateMultiplier: 0.2 },
          { speedRatioMin: 0.3, speedRatioMax: 0.6, turnRateMultiplier: 0.5 },
          { speedRatioMin: 0.6, speedRatioMax: 0.85, turnRateMultiplier: 1.0 },
          { speedRatioMin: 0.85, speedRatioMax: 1.0, turnRateMultiplier: 1.0 },
        ],
        stoppingDistanceTurns: 12,
      };
  }
}

// ===== 方位角归一化 =====

export function normalizeHeading(deg: number): number {
  let h = deg % 360;
  if (h < 0) h += 360;
  return h;
}

// ===== 计算航向差 =====

export function headingDifference(h1: number, h2: number): number {
  let diff = normalizeHeading(h1 - h2);
  if (diff > 180) diff -= 360;
  return diff;
}

// ===== 舵角限制 =====

export function clampRudder(rudder: number, maxRudder: number): number {
  return Math.max(-maxRudder, Math.min(maxRudder, rudder));
}

// ===== 获取速度比率对应的转向倍率 =====

export function getTurnRateMultiplier(
  profile: ShipMotionProfile,
  speedKts: number
): number {
  const speedRatio = profile.maxSpeedKts > 0 ? speedKts / profile.maxSpeedKts : 1;
  for (const entry of profile.turnRateBySpeed) {
    if (speedRatio >= entry.speedRatioMin && speedRatio <= entry.speedRatioMax) {
      return entry.turnRateMultiplier;
    }
  }
  return 1.0;
}

// ===== 核心：更新舰船运动 =====

export function updateShipMotion(
  ship: NavalShip,
  deltaTurns: number
): NavalShip {
  const result = { ...ship };
  let { speedKts, targetSpeedKts, rudderDeg, headingDeg, motion } = result;
  const { maxSpeedKts, accelerationKtsPerTurn, decelerationKtsPerTurn, maxRudderDeg, baseTurnRateDegPerTurn } = motion;

  // 1. 加速/减速：逐步接近目标速度
  for (let t = 0; t < deltaTurns; t++) {
    if (speedKts < targetSpeedKts) {
      speedKts = Math.min(targetSpeedKts, speedKts + accelerationKtsPerTurn);
    } else if (speedKts > targetSpeedKts) {
      speedKts = Math.max(targetSpeedKts, speedKts - decelerationKtsPerTurn);
    }
  }

  // 损伤惩罚
  const effectiveMaxSpeed = maxSpeedKts * (1 - ship.damage.speedPenalty);
  speedKts = Math.min(speedKts, effectiveMaxSpeed);
  result.speedKts = Math.max(0, speedKts);

  // 2. 计算转向
  rudderDeg = clampRudder(rudderDeg, maxRudderDeg);
  result.rudderDeg = rudderDeg;

  const speedRatio = effectiveMaxSpeed > 0 ? result.speedKts / effectiveMaxSpeed : 1;
  const turnMultiplier = getTurnRateMultiplier(motion, result.speedKts);

  // 损伤转向惩罚
  const effectiveTurnRate = baseTurnRateDegPerTurn * turnMultiplier * (1 - ship.damage.turnPenalty);

  // 舵角贡献的转向率（满舵 = 最大转向率）
  const rudderRatio = maxRudderDeg > 0 ? Math.abs(rudderDeg) / maxRudderDeg : 0;
  const headingDeltaPerTurn = effectiveTurnRate * rudderRatio * Math.sign(rudderDeg) || 0;

  // 3. 仅在有速度时才能转向（不能原地转向）
  let totalHeadingDelta = 0;
  if (result.speedKts > 0.5) {
    totalHeadingDelta = headingDeltaPerTurn * deltaTurns;
    result.headingDeg = normalizeHeading(headingDeg + totalHeadingDelta);
  } else {
    result.headingDeg = headingDeg;
  }

  // 4. 根据航向和速度计算移动距离
  const avgSpeed = result.speedKts;
  const distancePerTurn = avgSpeed * 0.02; // 每节每秒约 0.02 单位距离（每turn）
  const totalDistance = distancePerTurn * deltaTurns;

  // 使用平均航向计算位移
  const avgHeadingRad = ((headingDeg + result.headingDeg) / 2) * (Math.PI / 180);
  const dx = totalDistance * Math.sin(avgHeadingRad);
  const dy = -totalDistance * Math.cos(avgHeadingRad); // Y轴向上

  result.position = {
    x: result.position.x + dx,
    y: result.position.y + dy,
  };

  return result;
}

// ===== 设置舰船目标速度 =====

export function setShipTargetSpeed(ship: NavalShip, targetKts: number): NavalShip {
  const maxSpeed = ship.motion.maxSpeedKts * (1 - ship.damage.speedPenalty);
  return {
    ...ship,
    targetSpeedKts: Math.max(0, Math.min(maxSpeed, targetKts)),
  };
}

// ===== 设置舰船舵角 =====

export function setShipRudder(ship: NavalShip, rudderDeg: number): NavalShip {
  return {
    ...ship,
    rudderDeg: clampRudder(rudderDeg, ship.motion.maxRudderDeg),
  };
}
