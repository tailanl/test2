/**
 * 海军视野/探测核心系统 - detectNavalTarget
 * 这是唯一允许读取真实 enemyShips 的系统
 */

import type { DetectionInput, DetectionResult, DetectionLevel } from './naval-intel-types';
import type { NavalShip } from '../ship/ship-types';

// ===== 核心探测函数 =====

export function detectNavalTarget(input: DetectionInput): DetectionResult {
  const { observer, target, sensorType, environment, distance, lineOfSightBlocked } = input;
  const observerShip = observer as NavalShip;
  const targetShip = target as NavalShip;

  const defaultResult: DetectionResult = {
    success: false,
    detectionLevel: 'none',
    confidence: 'low',
    estimatedClass: 'unknown',
    positionErrorRadius: 20,
    reason: 'No contact',
  };

  if (!observerShip || !targetShip) return defaultResult;

  switch (sensorType) {
    case 'visual':
      return detectVisual(observerShip, targetShip, environment, distance, lineOfSightBlocked);
    case 'surface_radar':
      return detectSurfaceRadar(observerShip, targetShip, environment, distance);
    case 'air_search_radar':
      return detectAirSearchRadar(observerShip, targetShip, environment, distance);
    case 'sonar':
      return detectSonar(observerShip, targetShip, environment, distance);
    case 'aircraft_search':
      return detectAircraftSearch(observerShip, targetShip, environment, distance);
    case 'radio_intercept':
      return detectRadioIntercept(observerShip, targetShip, environment, distance);
    case 'reported_contact':
      return detectReportedContact(observerShip, targetShip, environment, distance);
    default:
      return defaultResult;
  }
}

// ===== 目视探测 =====

function detectVisual(
  observer: NavalShip,
  target: NavalShip,
  env: DetectionInput['environment'],
  distance: number,
  lineOfSightBlocked: boolean
): DetectionResult {
  const sensor = observer.sensors;
  let range = sensor.visualRange;

  // 环境修正
  if (env.timeOfDay === 'night') range *= 0.1 + sensor.nightFightingBonus * 0.01;
  else if (env.timeOfDay === 'dusk') range *= 0.5;

  if (env.weather === 'fog') range *= 0.15;
  else if (env.weather === 'rain') range *= 0.6;
  else if (env.weather === 'squall') range *= 0.3;
  else if (env.weather === 'storm') range *= 0.05;

  // 海况降低目视
  if (env.seaState >= 4) range *= 0.7;
  if (env.seaState >= 5) range *= 0.5;

  // 烟雾影响
  range *= Math.max(0.1, 1 - env.smoke * 0.01);

  // 目标隐匿属性
  range *= (1 - target.stealth.surfaceSignature / 200);

  // 船员质量修正
  if (sensor.crewQuality === 'elite') range *= 1.2;
  else if (sensor.crewQuality === 'veteran') range *= 1.1;
  else if (sensor.crewQuality === 'poor') range *= 0.8;

  if (distance > range || lineOfSightBlocked) {
    return {
      success: false,
      detectionLevel: 'none',
      confidence: 'low',
      positionErrorRadius: 20,
      reason: lineOfSightBlocked ? 'Line of sight blocked' : 'Out of visual range',
    };
  }

  const confidence = getConfidence(distance, range);
  const level = getDetectionLevelFromConfidence(confidence, target.shipClass, distance, range);

  return {
    success: true,
    detectionLevel: level,
    confidence,
    estimatedClass: level === 'identified' ? target.shipClass : (level === 'classified' ? target.shipClass : 'unknown'),
    positionErrorRadius: Math.max(0.5, distance * 0.05),
    reason: 'Visual contact',
  };
}

// ===== 水面雷达探测 =====

function detectSurfaceRadar(
  observer: NavalShip,
  target: NavalShip,
  env: DetectionInput['environment'],
  distance: number
): DetectionResult {
  if (!observer.sensors.radarOperational) {
    return {
      success: false,
      detectionLevel: 'none',
      confidence: 'low',
      positionErrorRadius: 20,
      reason: 'Radar not operational',
    };
  }

  let range = observer.sensors.surfaceRadarRange;

  // CIC 加成
  if (observer.sensors.cicOperational) range *= 1.1;

  // 天气影响雷达较小
  if (env.weather === 'rain') range *= 0.9;
  if (env.weather === 'squall') range *= 0.8;
  if (env.weather === 'storm') range *= 0.5;

  // 目标雷达特征
  range *= (target.stealth.radarSignature / 100);

  if (distance > range) {
    return {
      success: false,
      detectionLevel: 'none',
      confidence: 'low',
      positionErrorRadius: 20,
      reason: 'Out of radar range',
    };
  }

  const confidence = getConfidence(distance, range);
  const level = confidence === 'high' ? 'detected' : 'detected';

  return {
    success: true,
    detectionLevel: level,
    confidence,
    estimatedClass: 'unknown',
    positionErrorRadius: Math.max(1, distance * 0.03),
    reason: 'Radar contact',
  };
}

// ===== 对空搜索雷达 =====

function detectAirSearchRadar(
  observer: NavalShip,
  target: NavalShip,
  env: DetectionInput['environment'],
  distance: number
): DetectionResult {
  if (!observer.sensors.radarOperational) {
    return {
      success: false,
      detectionLevel: 'none',
      confidence: 'low',
      positionErrorRadius: 20,
      reason: 'Radar not operational',
    };
  }

  // 对空搜索雷达主要用于发现 aircraft，对水面舰效果差
  let range = observer.sensors.airSearchRadarRange * 0.3;

  if (distance > range) {
    return {
      success: false,
      detectionLevel: 'none',
      confidence: 'low',
      positionErrorRadius: 20,
      reason: 'Out of air search radar range',
    };
  }

  return {
    success: true,
    detectionLevel: 'suspected',
    confidence: 'low',
    estimatedClass: 'unknown',
    positionErrorRadius: 10,
    reason: 'Air search radar suspect contact',
  };
}

// ===== 声呐探测 =====

function detectSonar(
  observer: NavalShip,
  target: NavalShip,
  env: DetectionInput['environment'],
  distance: number
): DetectionResult {
  if (!observer.sensors.sonarOperational) {
    return {
      success: false,
      detectionLevel: 'none',
      confidence: 'low',
      positionErrorRadius: 20,
      reason: 'Sonar not operational',
    };
  }

  let range = observer.sensors.sonarRange;

  // 自身速度影响声呐
  const ownSpeedFactor = Math.max(0.3, 1 - observer.speedKts / 40);
  range *= ownSpeedFactor;

  // 海况影响
  if (env.seaState >= 4) range *= 0.6;
  if (env.seaState >= 5) range *= 0.4;

  // 目标声学特征
  range *= (target.stealth.acousticSignature / 100);

  if (distance > range) {
    return {
      success: false,
      detectionLevel: 'none',
      confidence: 'low',
      positionErrorRadius: 20,
      reason: 'Out of sonar range',
    };
  }

  const confidence = target.shipClass === 'submarine' ? 'medium' : 'low';
  const level: DetectionLevel = target.shipClass === 'submarine' ? 'detected' : 'suspected';

  return {
    success: true,
    detectionLevel: level,
    confidence,
    estimatedClass: target.shipClass === 'submarine' ? 'submarine' : 'unknown',
    positionErrorRadius: Math.max(2, distance * 0.1),
    reason: 'Sonar contact',
  };
}

// ===== 航空搜索 =====

function detectAircraftSearch(
  observer: NavalShip,
  target: NavalShip,
  env: DetectionInput['environment'],
  distance: number
): DetectionResult {
  // 航空搜索范围大但精度低
  let range = 80;

  if (env.weather === 'rain') range *= 0.6;
  if (env.weather === 'squall') range *= 0.3;
  if (env.weather === 'fog' || env.weather === 'storm') range *= 0.1;

  range *= (1 - target.stealth.surfaceSignature / 200);

  if (distance > range) {
    return {
      success: false,
      detectionLevel: 'none',
      confidence: 'low',
      positionErrorRadius: 20,
      reason: 'Out of search range',
    };
  }

  const confidence = getConfidence(distance, range);
  const level = confidence === 'high' ? 'classified' : 'detected';

  return {
    success: true,
    detectionLevel: level,
    confidence,
    estimatedClass: confidence === 'high' ? target.shipClass : 'unknown',
    positionErrorRadius: Math.max(3, distance * 0.08),
    reason: 'Aircraft search contact',
  };
}

// ===== 无线电侦听 =====

function detectRadioIntercept(
  _observer: NavalShip,
  target: NavalShip,
  _env: DetectionInput['environment'],
  distance: number
): DetectionResult {
  // 无线电侦听不给精确位置，只能 suspected
  const range = 100;

  if (distance > range) {
    return {
      success: false,
      detectionLevel: 'none',
      confidence: 'low',
      positionErrorRadius: 20,
      reason: 'No radio intercept',
    };
  }

  return {
    success: true,
    detectionLevel: 'suspected',
    confidence: 'low',
    estimatedClass: 'unknown',
    positionErrorRadius: 15,
    reason: 'Radio intercept',
  };
}

// ===== 报告接触 =====

function detectReportedContact(
  _observer: NavalShip,
  _target: NavalShip,
  _env: DetectionInput['environment'],
  _distance: number
): DetectionResult {
  return {
    success: true,
    detectionLevel: 'suspected',
    confidence: 'low',
    estimatedClass: 'unknown',
    positionErrorRadius: 12,
    reason: 'Reported contact',
  };
}

// ===== 辅助函数 =====

function getConfidence(distance: number, maxRange: number): 'low' | 'medium' | 'high' {
  const ratio = distance / (maxRange || 1);
  if (ratio < 0.4) return 'high';
  if (ratio < 0.7) return 'medium';
  return 'low';
}

function getDetectionLevelFromConfidence(
  confidence: 'low' | 'medium' | 'high',
  shipClass: string,
  distance: number,
  maxRange: number
): DetectionLevel {
  if (confidence === 'high' && distance < maxRange * 0.2) return 'identified';
  if (confidence === 'high') return 'classified';
  if (confidence === 'medium') return 'detected';
  return 'detected';
}
