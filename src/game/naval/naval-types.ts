/**
 * Naval 基础类型定义
 * 独立海战系统 - 不依赖 WorldAtlas / RegionTile / WorldCell
 */

// ===== 坐标 =====

export interface WorldPosition {
  globalX: number;
  globalY: number;
}

// ===== 海军海区类型 =====

export type NavalSeaZoneType =
  | 'deep_ocean'
  | 'coastal_water'
  | 'shallow_water'
  | 'reef'
  | 'island'
  | 'port'
  | 'naval_base'
  | 'airfield'
  | 'anchorage'
  | 'shipping_lane';

// ===== 海军环境状态 =====

export interface NavalEnvironmentState {
  timeOfDay: 'day' | 'dusk' | 'night';
  weather: 'clear' | 'rain' | 'squall' | 'fog' | 'storm';
  seaState: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  windDirectionDeg: number;
  windSpeedKts: number;
  visibilityModifier: number;
}

// ===== 海军单元格覆盖层 =====

export interface NavalCellOverlay {
  globalX: number;
  globalY: number;

  seaZoneType: NavalSeaZoneType;

  seaDepth: number;

  islandId?: string;
  portId?: string;
  navalBaseId?: string;
  airfieldId?: string;

  weatherZone?: 'clear' | 'rain' | 'squall' | 'fog' | 'storm';
  visibilityModifier: number;

  seaState: 0 | 1 | 2 | 3 | 4 | 5 | 6;

  strategicValue: {
    shipping: number;
    base: number;
    airCoverage: number;
    submarineRisk: number;
    invasionValue: number;
  };
}

// ===== 海军战场地图 =====

export interface NavalBattleMap {
  id: string;

  worldRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  center: WorldPosition;

  overlayCells: NavalCellOverlay[][];

  environment: NavalEnvironmentState;

  scale: 'naval_combat';

  regionTileOrigin: WorldPosition;
}

// ===== 海军作战视图 =====

export interface NavalOperationView {
  id: string;

  worldRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  overlayCells: NavalCellOverlay[][];

  environment: NavalEnvironmentState;

  scale: 'naval_operation';

  regionTileOrigin: WorldPosition;
}

// ===== 海军战斗视口 =====

export interface NavalCombatViewport {
  id: string;

  worldRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  overlayCells: NavalCellOverlay[][];

  center: WorldPosition;

  environment: NavalEnvironmentState;

  scale: 'naval_combat';

  regionTileOrigin: WorldPosition;
}

// ===== 默认环境状态 =====

export function createDefaultNavalEnvironment(): NavalEnvironmentState {
  return {
    timeOfDay: 'day',
    weather: 'clear',
    seaState: 1,
    windDirectionDeg: 90,
    windSpeedKts: 10,
    visibilityModifier: 1.0,
  };
}

// ===== 工具：从细胞特征判断海区类型（保留兼容） =====
// 独立地图系统使用 naval-map-generator.ts 直接生成，此函数不再需要 WorldCell
