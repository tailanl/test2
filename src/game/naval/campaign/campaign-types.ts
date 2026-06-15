/**
 * Campaign Types - 太平洋战争战役系统核心类型
 */

// ========== 太平洋战争阶段 ==========
export type PacificWarPhaseId =
  | 'japanese_offensive_1941_1942'
  | 'carrier_turning_point_1942'
  | 'solomons_attrition_1942_1943'
  | 'central_pacific_offensive_1943_1944'
  | 'philippines_leyte_1944'
  | 'iwo_okinawa_1945'
  | 'home_islands_approach_1945';

export interface PacificWarPhase {
  id: PacificWarPhaseId;
  name: string;
  startDate: string; endDate: string;
  description: string;
  playerStrategicPosture: 'defense'|'counterattack'|'limited_offensive'|'major_offensive'|'decisive_offensive';
  enemyStrategicPosture: 'offensive'|'expansion'|'defensive_perimeter'|'attrition_defense'|'desperate_defense';
  victoryPressure: { player: number; enemy: number };
}

// ========== 太平洋区域 ==========
export type PacificRegionId = 'hawaii'|'coral_sea'|'midway'|'solomons'|'new_guinea'|'gilberts'|'marshalls'|'truk'|'marianas'|'philippines'|'iwo_jima'|'okinawa'|'home_islands';

export interface PacificRegion {
  id: PacificRegionId; name: string;
  owner: 'player'|'enemy'|'contested'|'neutral';
  seaControl: { player: number; enemy: number };
  airControl: { player: number; enemy: number };
  supplyLevel: { player: number; enemy: number };
  bases: PacificBase[];
  activeFleetIds: string[];
  threatLevel: number;
}

// ========== 基地 ==========
export interface PacificBase {
  id: string; name: string;
  regionId: PacificRegionId;
  type: 'port'|'naval_base'|'airfield'|'anchorage'|'supply_depot';
  owner: 'player'|'enemy'|'neutral';
  level: 1|2|3|4|5;
  repairCapacity: number; fuelCapacity: number; ammoCapacity: number; aircraftCapacity: number;
  constructionProgress: number; damage: number; isolated: boolean;
}

// ========== 补给线 ==========
export interface SupplyLine {
  id: string;
  fromBaseId: string; toBaseId: string;
  route: Array<{ x: number; y: number }>;
  owner: 'player'|'enemy';
  capacity: number;
  interdictionRisk: number; submarineThreat: number; airThreat: number; surfaceRaidThreat: number;
  status: 'open'|'contested'|'interdicted'|'cut';
}

// ========== 目标 ==========
export interface PacificObjective {
  id: string; name: string;
  type: 'hold_base'|'capture_base'|'destroy_fleet'|'protect_convoy'|'cut_supply_line'|'establish_airfield'|'support_landing'|'raid_shipping'|'neutralize_airbase';
  targetRegionId?: PacificRegionId; targetBaseId?: string; targetFleetId?: string;
  priority: number; deadlineTurn?: number;
  status: 'inactive'|'active'|'completed'|'failed';
}

// ========== 历史事件 ==========
export interface HistoricalEvent {
  id: string; name: string;
  turn: number;
  phaseId: PacificWarPhaseId;
  description: string;
  effects: { type: string; target: string; value: number }[];
}

// ========== 登陆作战 ==========
export interface AmphibiousOperation {
  id: string; targetBaseId: string;
  phase: 'planning'|'assembly'|'approach'|'shore_bombardment'|'landing'|'securing_airfield'|'base_construction'|'completed'|'failed';
  requiredSeaControl: number; requiredAirControl: number;
  landingForceStrength: number; transportCapacity: number;
  navalSupportFleetIds: string[]; carrierCoverFleetIds: string[];
  risk: number; progress: number;
}

// ========== 舰队战备 ==========
export interface FleetReadiness {
  fleetId: string;
  fuel: number; ammo: number;
  aircraftReplacement: number;
  crewFatigue: number; maintenanceNeed: number;
  repairDaysRemaining: number; sortieCooldown: number;
  readiness: 'ready'|'limited'|'exhausted'|'repairing'|'refitting';
}

// ========== 太平洋战役状态 ==========
export interface PacificCampaignState {
  currentDate: string;
  currentPhaseId: PacificWarPhaseId;
  turn: number;
  regions: PacificRegion[];
  playerObjectives: PacificObjective[];
  enemyObjectives: PacificObjective[];
  activeOperations: AmphibiousOperation[];
  completedOperations: AmphibiousOperation[];
  supplyLines: SupplyLine[];
  historicalEvents: HistoricalEvent[];
  fleetReadiness: FleetReadiness[];
  victoryState: 'none'|'player'|'enemy'|'ongoing';
  eventLog: Array<{ turn: number; type: string; description: string }>;
}
