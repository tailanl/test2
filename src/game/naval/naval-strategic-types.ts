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

export type FleetOperationalPosture =
  | 'normal'
  | 'strike_preparation'
  | 'aircraft_recovery'
  | 'fighter_direction'
  | 'smoke_screen'
  | 'surface_engagement'
  | 'torpedo_attack'
  | 'radio_silence'
  | 'shore_bombardment'
  | 'underway_replenishment'
  | 'transport_run';

export interface FleetOperationState {
  posture: FleetOperationalPosture;
  startedTurn: number;
  durationTurns?: number;
  targetContactId?: string;
  targetBaseId?: string;
  targetPosition?: { x: number; y: number };
  description: string;
  expectedEffect?: string;
}

export type FleetFormationType =
  | 'standard_screen'
  | 'line_abreast'
  | 'circular_screen'
  | 'column'
  | 'scout_line';

export interface FleetFormationState {
  type: FleetFormationType;
  assignedTurn: number;
  spacing: number;
  searchArcModifier: number;
  searchRangeModifier: number;
  antiAirCenterModifier: number;
  screenCoverageModifier: number;
  description: string;
}

export type FleetNavigationMode =
  | 'direct'
  | 'safe_transit'
  | 'combat_approach'
  | 'night_dash'
  | 'withdrawal'
  | 'rendezvous';

export type FleetAutomationWorkType =
  | 'damage_control'
  | 'formation'
  | 'routing'
  | 'search'
  | 'combat_air_patrol'
  | 'contact_shadow'
  | 'evasive_maneuver'
  | 'radio_silence'
  | 'smoke_screen'
  | 'rendezvous'
  | 'air_recovery'
  | 'strike_ready';

export type FleetAutomationPriority = 0 | 1 | 2 | 3 | 4;

export type FleetAutomationPriorities = Record<FleetAutomationWorkType, FleetAutomationPriority>;

export interface FleetAutomationState {
  priorities: FleetAutomationPriorities;
  lastTask?: FleetAutomationWorkType;
  lastTaskTurn?: number;
}

export interface FleetNavigationSegment {
  from: { x: number; y: number };
  to: { x: number; y: number };
  bearingDeg: number;
  distance: number;
  seaZone: string;
  risk: 'low' | 'medium' | 'high';
  cost: number;
  note: string;
}

export interface FleetNavigationState {
  destination: { x: number; y: number };
  path: Array<{ x: number; y: number }>;
  pathIndex: number;
  status: 'idle' | 'en_route' | 'arrived' | 'blocked';
  routeSource?: 'auto' | 'manual_waypoints';
  manualWaypoints?: Array<{ x: number; y: number }>;
  mode?: FleetNavigationMode;
  etaTurns?: number;
  totalDistance?: number;
  riskScore?: number;
  routeRisk?: 'low' | 'medium' | 'high';
  currentLegNote?: string;
  segments?: FleetNavigationSegment[];
}

// ===== 舰队指挥意图 =====

export type CommanderIntent =
  | 'search'
  | 'intercept'
  | 'strike'
  | 'escort'
  | 'avoid_contact'
  | 'hold_sea_area'
  | 'support_landing'
  | 'withdraw'
  | 'destroy_enemy_carriers'
  | 'seek_decisive_battle';

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

  automation?: FleetAutomationState;
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

  targetPosition?: {
    x: number;
    y: number;
  };

  navigation?: FleetNavigationState;

  operation?: FleetOperationState;
  formation?: FleetFormationState;
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
