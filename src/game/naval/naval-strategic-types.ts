/**
 * 战略舰队类型定义
 */

import type { NavalShip } from './ship/ship-types';

// ===== 舰队类型 =====

export type NavalFleetType =
  | 'carrier_task_force'
  | 'surface_action_group'
  | 'submarine_group'
  | 'transport_convoy'
  | 'amphibious_group'
  | 'patrol_group'
  | 'supply_group';

// ===== 舰队任务类型 =====

export type NavalFleetMission =
  | 'patrol'
  | 'search'
  | 'raid'
  | 'escort'
  | 'invasion_support'
  | 'carrier_strike'
  | 'intercept'
  | 'withdraw'
  | 'resupply';

// ===== 舰队指挥意图 =====

export type CommanderIntent =
  | 'search'
  | 'intercept'
  | 'strike'
  | 'escort'
  | 'avoid_contact'
  | 'hold_sea_area'
  | 'support_landing'
  | 'withdraw';

// ===== 舰队接战规则 =====

export type EngagementPolicy =
  | 'avoid_unless_attacked'
  | 'engage_if_advantage'
  | 'engage_surface_only'
  | 'carrier_strike_only'
  | 'free_engagement';

// ===== 舰队指挥状态 =====

export interface NavalFleetCommandState {
  controller: 'player_direct' | 'ai_delegated' | 'enemy_ai';

  currentOrderId?: string;

  commanderIntent?: CommanderIntent;

  riskTolerance: 'low' | 'medium' | 'high';

  engagementPolicy: EngagementPolicy;

  preserveCapitalShips: boolean;
}

// ===== 战略舰队 =====

export interface StrategicFleet {
  id: string;
  name: string;

  faction: 'player' | 'enemy' | 'neutral';

  type: NavalFleetType;

  position: {
    regionX: number;
    regionY: number;
    chunkX: number;
    chunkY: number;
    globalX: number;
    globalY: number;
  };

  ships: NavalShip[];

  command?: NavalFleetCommandState;

  mission: NavalFleetMission;

  fuelState: 'good' | 'limited' | 'critical';
  ammoState: 'good' | 'limited' | 'critical';
  airGroupState?: 'ready' | 'depleted' | 'recovering';

  detectedByPlayer: boolean;

  lastKnownPosition?: {
    globalX: number;
    globalY: number;
    turn: number;
    confidence: 'low' | 'medium' | 'high';
    uncertaintyRadius: number;
  };
}

// ===== 默认舰队命令状态 =====

export function createDefaultFleetCommandState(
  controller: 'player_direct' | 'ai_delegated' | 'enemy_ai'
): NavalFleetCommandState {
  return {
    controller,
    riskTolerance: 'medium',
    engagementPolicy: 'engage_if_advantage',
    preserveCapitalShips: true,
  };
}
