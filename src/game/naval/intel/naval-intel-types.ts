/**
 * 海军情报类型定义
 */

import type { NavalShipClass } from '../ship/ship-types';
import type { NavalFleetType } from '../naval-strategic-types';
import type { NavalAirMission } from '../ship/ship-aircraft';
import type { NavalAIReport } from '../ai/naval-ai-types';
import type { NavalShip } from '../ship/ship-types';

// ===== 探测等级 =====

export type DetectionLevel =
  | 'none'
  | 'suspected'
  | 'detected'
  | 'classified'
  | 'identified'
  | 'tracked'
  | 'lost';

// ===== 传感器类型 =====

export type NavalSensorType =
  | 'visual'
  | 'surface_radar'
  | 'air_search_radar'
  | 'sonar'
  | 'aircraft_search'
  | 'radio_intercept'
  | 'reported_contact';

// ===== 海军接触 =====

export interface NavalContact {
  id: string;
  originalEntityId?: string;
  contactType:
    | 'surface_ship'
    | 'submarine'
    | 'aircraft'
    | 'fleet'
    | 'unknown';
  detectionLevel: DetectionLevel;
  factionEstimate: 'enemy' | 'neutral' | 'unknown';
  estimatedClass?: NavalShipClass | NavalFleetType | 'unknown';
  estimatedCount?: number;
  lastKnownPosition: {
    x: number;
    y: number;
  };
  uncertaintyRadius: number;
  lastDetectedTurn: number;
  confidence: 'low' | 'medium' | 'high';
  detectedBy: Array<{
    sensorPlatformId: string;
    sensorType: NavalSensorType;
    turn: number;
  }>;
  trackHistory: Array<{
    turn: number;
    x: number;
    y: number;
    uncertaintyRadius: number;
    detectionLevel: DetectionLevel;
  }>;
  stale: boolean;
}

// ===== 战争迷雾瓦片状态 =====

export interface FogTileState {
  key: string;
  globalX: number;
  globalY: number;
  visibility: 'unknown' | 'searched' | 'observed' | 'controlled';
  lastSeenTurn?: number;
}

// ===== 海军情报状态 =====

export interface NavalIntelState {
  turn: number;
  playerContacts: NavalContact[];
  enemyContacts: NavalContact[];
  knownFriendlyFleets: string[];
  fogTiles: Record<string, FogTileState>;
  searchMissions: NavalAirMission[];
  contactReports: NavalAIReport[];
}

// ===== 探测输入 =====

export interface DetectionInput {
  observer: NavalShip;
  target: NavalShip;
  sensorType: NavalSensorType;
  environment: {
    timeOfDay: 'day' | 'dusk' | 'night';
    weather: 'clear' | 'rain' | 'squall' | 'fog' | 'storm';
    seaState: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    smoke: number;
  };
  distance: number;
  lineOfSightBlocked: boolean;
}

// ===== 探测结果 =====

export interface DetectionResult {
  success: boolean;
  detectionLevel: DetectionLevel;
  confidence: 'low' | 'medium' | 'high';
  estimatedClass?: NavalShipClass | 'unknown';
  positionErrorRadius: number;
  reason: string;
}

// ===== 默认情报状态 =====

export function createDefaultIntelState(): NavalIntelState {
  return {
    turn: 0,
    playerContacts: [],
    enemyContacts: [],
    knownFriendlyFleets: [],
    fogTiles: {},
    searchMissions: [],
    contactReports: [],
  };
}
