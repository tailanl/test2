/**
 * 海军传感器模型
 */

import type { NavalSensorType, DetectionLevel } from './naval-intel-types';

export type { NavalSensorType };

// ===== 传感器基础属性 =====

export interface SensorBaseStats {
  type: NavalSensorType;
  baseRange: number;
  affectedByWeather: boolean;
  affectedByNight: boolean;
  affectedBySeaState: boolean;
  affectedBySpeed: boolean;
  canIdentify: boolean;
  canClassify: boolean;
}

export const SENSOR_BASE_STATS: Record<NavalSensorType, SensorBaseStats> = {
  visual: {
    type: 'visual',
    baseRange: 20,
    affectedByWeather: true,
    affectedByNight: true,
    affectedBySeaState: true,
    affectedBySpeed: false,
    canIdentify: true,
    canClassify: true,
  },
  surface_radar: {
    type: 'surface_radar',
    baseRange: 30,
    affectedByWeather: true,
    affectedByNight: false,
    affectedBySeaState: true,
    affectedBySpeed: false,
    canIdentify: false,
    canClassify: true,
  },
  air_search_radar: {
    type: 'air_search_radar',
    baseRange: 100,
    affectedByWeather: true,
    affectedByNight: false,
    affectedBySeaState: false,
    affectedBySpeed: false,
    canIdentify: false,
    canClassify: false,
  },
  sonar: {
    type: 'sonar',
    baseRange: 10,
    affectedByWeather: false,
    affectedByNight: false,
    affectedBySeaState: true,
    affectedBySpeed: true,
    canIdentify: false,
    canClassify: true,
  },
  aircraft_search: {
    type: 'aircraft_search',
    baseRange: 60,
    affectedByWeather: true,
    affectedByNight: true,
    affectedBySeaState: true,
    affectedBySpeed: false,
    canIdentify: false,
    canClassify: true,
  },
  radio_intercept: {
    type: 'radio_intercept',
    baseRange: 80,
    affectedByWeather: false,
    affectedByNight: false,
    affectedBySeaState: false,
    affectedBySpeed: false,
    canIdentify: false,
    canClassify: false,
  },
  reported_contact: {
    type: 'reported_contact',
    baseRange: 50,
    affectedByWeather: false,
    affectedByNight: false,
    affectedBySeaState: false,
    affectedBySpeed: false,
    canIdentify: false,
    canClassify: false,
  },
};

// ===== 探测级别升级规则 =====

export function upgradeDetectionLevel(
  currentLevel: DetectionLevel,
  newDetection: DetectionLevel,
  confidence: 'low' | 'medium' | 'high'
): DetectionLevel {
  const levelOrder: DetectionLevel[] = ['none', 'suspected', 'detected', 'classified', 'identified', 'tracked'];

  const currentIdx = levelOrder.indexOf(currentLevel);
  const newIdx = levelOrder.indexOf(newDetection);

  if (newIdx <= currentIdx) return currentLevel;

  // suspected → detected 需要 medium 以上 confidence
  if (currentLevel === 'suspected' && newDetection === 'detected' && confidence === 'low') {
    return 'suspected';
  }

  // detected → classified 需要 high confidence
  if (currentLevel === 'detected' && newDetection === 'classified' && confidence !== 'high') {
    return 'detected';
  }

  return newDetection;
}

// ===== 探测级别衰减 =====

export function decayDetectionLevel(
  currentLevel: DetectionLevel,
  turnsSinceLastDetection: number
): DetectionLevel {
  switch (currentLevel) {
    case 'tracked':
      if (turnsSinceLastDetection >= 3) return 'identified';
      return 'tracked';
    case 'identified':
      if (turnsSinceLastDetection >= 5) return 'classified';
      return 'identified';
    case 'classified':
      if (turnsSinceLastDetection >= 8) return 'detected';
      return 'classified';
    case 'detected':
      if (turnsSinceLastDetection >= 10) return 'lost';
      return 'detected';
    case 'suspected':
      if (turnsSinceLastDetection >= 6) return 'lost';
      return 'suspected';
    case 'lost':
      return 'lost';
    default:
      return 'none';
  }
}

// ===== 不确定性半径增长 =====

export function growUncertaintyRadius(
  currentRadius: number,
  turnsSinceLastDetection: number
): number {
  return currentRadius * (1 + turnsSinceLastDetection * 0.15);
}
