/**
 * 飞机运动系统 - updateAircraftMotion
 */

import type { NavalAircraft } from './aircraft-types';
import { normalizeHeading, headingDifferenceDeg, degToRad } from './aircraft-types';

// ===== 速度渐进 =====

export function approachSpeed(params: {
  current: number;
  target: number;
  acceleration: number;
  deceleration: number;
  deltaTurns: number;
}): number {
  let speed = params.current;
  for (let t = 0; t < params.deltaTurns; t++) {
    if (speed < params.target) {
      speed = Math.min(params.target, speed + params.acceleration);
    } else if (speed > params.target) {
      speed = Math.max(params.target, speed - params.deceleration);
    }
  }
  return Math.max(0, Math.min(speed, 999));
}

// ===== 转向率 =====

export function getAircraftTurnRate(aircraft: NavalAircraft): number {
  const m = aircraft.motion;
  if (!m.maxSpeedKts || m.maxSpeedKts <= 0) return m.maxTurnRateDegPerTurn * m.turnAgility;

  const speedRatio = Math.max(0, Math.min(1, aircraft.speedKts / m.maxSpeedKts));
  let multiplier = 1.0;

  for (const entry of m.turnRateBySpeed) {
    if (speedRatio >= entry.speedRatioMin && speedRatio <= entry.speedRatioMax) {
      multiplier = entry.turnRateMultiplier;
      break;
    }
  }

  let turnRate = m.maxTurnRateDegPerTurn * m.turnAgility * multiplier;

  // 低速惩罚
  if (aircraft.speedKts < 60) turnRate *= 0.4;

  // 攻击航线中转向限制
  if (aircraft.status === 'attack_run' && aircraft.attackState?.committed) {
    turnRate *= 0.35;
  }

  // 损伤惩罚
  turnRate *= (1 - aircraft.damage.controlPenalty);

  return Math.max(1, turnRate);
}

// ===== 核心：更新飞机运动 =====

export function updateAircraftMotion(params: {
  aircraft: NavalAircraft;
  targetHeadingDeg?: number;
  deltaTurns: number;
}): NavalAircraft {
  const { aircraft, targetHeadingDeg, deltaTurns } = params;
  const result = { ...aircraft };
  const m = result.motion;

  // 1. 速度
  result.speedKts = approachSpeed({
    current: result.speedKts,
    target: result.targetSpeedKts,
    acceleration: m.accelerationKtsPerTurn,
    deceleration: m.decelerationKtsPerTurn,
    deltaTurns,
  });
  result.speedKts = Math.min(result.speedKts, m.maxSpeedKts * (1 - result.damage.speedPenalty));

  // 2. 转向
  if (targetHeadingDeg !== undefined) {
    const maxTurn = getAircraftTurnRate(result) * deltaTurns;
    const diff = headingDifferenceDeg(result.headingDeg, targetHeadingDeg);
    const change = Math.max(-maxTurn, Math.min(maxTurn, diff));
    result.headingDeg = normalizeHeading(result.headingDeg + change);
  }

  // 3. 移动
  const avgSpeed = result.speedKts;
  const distancePerTurn = avgSpeed * 0.015;
  const totalDist = distancePerTurn * deltaTurns;
  const rad = degToRad(result.headingDeg);
  result.position = {
    x: result.position.x + Math.cos(rad) * totalDist,
    y: result.position.y + Math.sin(rad) * totalDist,
  };

  // 4. 燃油
  result.fuel = Math.max(0, result.fuel - deltaTurns * 2);
  if (result.fuel <= 0 && result.status !== 'lost') {
    result.status = 'returning';
  }

  return result;
}
