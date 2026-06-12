/**
 * 独立海军地图生成器
 * 不依赖 WorldAtlas / RegionTile / WorldCell
 * 直接生成 NavalCellOverlay[][] 海战网格
 */

import type { NavalCellOverlay, NavalSeaZoneType } from './naval-types';

// ===== 配置 =====

export interface NavalMapConfig {
  width: number;
  height: number;
  seed: number;
  islandDensity: number;
  portDensity: number;
}

export const DEFAULT_NAVAL_MAP_CONFIG: NavalMapConfig = {
  width: 1024,
  height: 1024,
  seed: 42,
  islandDensity: 0.08,
  portDensity: 0.015,
};

// ===== 简单 PRNG =====

function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ===== 柏林噪声模拟 =====

function noise2D(x: number, y: number, rand: () => number): number {
  const ix = Math.floor(x); const iy = Math.floor(y);
  const fx = x - ix; const fy = y - iy;

  const hash = (a: number, b: number) => {
    const v = Math.sin(a * 12.9898 + b * 78.233 + rand() * 43758.5453) * 43758.5453;
    return v - Math.floor(v);
  };

  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const n0 = hash(ix, iy); const n1 = hash(ix + 1, iy);
  const nx0 = n0 + sx * (n1 - n0);
  const n2 = hash(ix, iy + 1); const n3 = hash(ix + 1, iy + 1);
  const nx1 = n2 + sx * (n3 - n2);

  return nx0 + sy * (nx1 - nx0);
}

function fbm(x: number, y: number, rand: () => number, octaves = 4): number {
  let value = 0; let amplitude = 1; let frequency = 1; let max = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * noise2D(x * frequency, y * frequency, rand);
    max += amplitude; amplitude *= 0.5; frequency *= 2;
  }
  return value / max;
}

// ===== 生成海洋地图覆盖层 =====

export function generateNavalOverlay(config: Partial<NavalMapConfig> = {}): NavalCellOverlay[][] {
  const cfg = { ...DEFAULT_NAVAL_MAP_CONFIG, ...config };
  const rand = mulberry32(cfg.seed);
  const rand2 = mulberry32(cfg.seed + 1);

  const overlay: NavalCellOverlay[][] = [];

  // 预生成端口位置
  const portCount = Math.floor(cfg.width * cfg.height * cfg.portDensity);
  const ports: Array<{ x: number; y: number; id: string; isNavalBase: boolean }> = [];

  for (let i = 0; i < portCount; i++) {
    const px = Math.floor(rand2() * cfg.width);
    const py = Math.floor(rand2() * cfg.height);
    ports.push({ x: px, y: py, id: `port_${i}`, isNavalBase: rand2() < 0.3 });
  }

  for (let y = 0; y < cfg.height; y++) {
    const row: NavalCellOverlay[] = [];
    for (let x = 0; x < cfg.width; x++) {
      const nx = x / cfg.width * 8;
      const ny = y / cfg.height * 8;
      const elevation = fbm(nx, ny, rand, 5);
      const moisture = fbm(nx + 5, ny + 5, rand, 3);

      let seaZoneType: NavalSeaZoneType;
      let seaDepth: number;
      let isIsland = false;

      if (elevation > 0.55) {
        // 岛屿
        seaZoneType = 'island';
        seaDepth = 0;
        isIsland = true;
      } else if (elevation > 0.45) {
        // 浅水 / 礁石
        if (moisture > 0.5) seaZoneType = 'shallow_water';
        else seaZoneType = 'reef';
        seaDepth = (0.55 - elevation) * 200;
      } else if (elevation > 0.3) {
        seaZoneType = 'coastal_water';
        seaDepth = (0.55 - elevation) * 400;
      } else {
        seaZoneType = 'deep_ocean';
        seaDepth = 500 + (0.3 - elevation) * 2000;
      }

      // 检查是否靠近 port
      let portId: string | undefined;
      let navalBaseId: string | undefined;
      for (const port of ports) {
        const dist = Math.sqrt((x - port.x) ** 2 + (y - port.y) ** 2);
        if (dist < 5 && !isIsland) {
          portId = port.id;
          if (port.isNavalBase) navalBaseId = port.id;
          seaZoneType = 'port';
          seaDepth = 20 + rand() * 30;
          break;
        }
      }

      // 岛屿附近的航道
      const nearIsland = seaZoneType === 'coastal_water' || seaZoneType === 'shallow_water' || seaZoneType === 'reef';
      let finalType: NavalSeaZoneType = seaZoneType;
      if (nearIsland && rand() < 0.05) finalType = 'shipping_lane';

      // 视野修正
      const visibilityModifier =
        finalType === 'deep_ocean' ? 1.0 :
        finalType === 'coastal_water' ? 0.85 :
        finalType === 'shallow_water' || finalType === 'reef' ? 0.7 :
        finalType === 'island' ? 0.3 : 0.9;

      // 海况
      const seaState: 0 | 1 | 2 | 3 | 4 | 5 | 6 =
        finalType === 'deep_ocean' ? (elevation < 0.1 ? 3 : 2) as 2 | 3 :
        finalType === 'coastal_water' ? 1 : 0;

      row.push({
        globalX: x,
        globalY: y,
        seaZoneType: finalType,
        seaDepth,
        islandId: isIsland ? `island_${x}_${y}` : undefined,
        portId,
        navalBaseId,
        airfieldId: portId && rand() < 0.3 ? `airfield_${portId}` : undefined,
        weatherZone: 'clear',
        visibilityModifier,
        seaState,
        strategicValue: {
          shipping: finalType === 'shipping_lane' ? 0.8 : finalType === 'coastal_water' ? 0.4 : 0.1,
          base: navalBaseId ? 1.0 : portId ? 0.6 : 0,
          airCoverage: portId ? 0.5 : 0,
          submarineRisk: seaDepth > 500 ? 0.6 : seaDepth > 100 ? 0.3 : 0.1,
          invasionValue: isIsland ? 0.7 : finalType === 'port' ? 0.8 : 0,
        },
      });
    }
    overlay.push(row);
  }

  return overlay;
}

// ===== 从 Overlay 裁剪 BattleMap =====

function clampViewStart(center: number, size: number, maxSize: number): number {
  if (size >= maxSize) return 0;
  const raw = Math.floor(center - size / 2);
  return Math.max(0, Math.min(raw, maxSize - size));
}

import type { NavalBattleMap } from './naval-types';

export function createNavalBattleMap(params: {
  overlay: NavalCellOverlay[][];
  centerGlobalX: number;
  centerGlobalY: number;
  width: number;
  height: number;
}): NavalBattleMap {
  const { overlay, centerGlobalX, centerGlobalY, width, height } = params;
  const oh = overlay.length;
  const ow = overlay[0]?.length ?? 0;

  const sx = clampViewStart(centerGlobalX, width, ow);
  const sy = clampViewStart(centerGlobalY, height, oh);
  const ex = sx + width;
  const ey = sy + height;

  const cells: NavalCellOverlay[][] = [];
  for (let y = sy; y < ey && y < oh; y++) {
    const row: NavalCellOverlay[] = [];
    for (let x = sx; x < ex && x < ow; x++) {
      row.push(overlay[y][x]);
    }
    cells.push(row);
  }

  return {
    id: `naval_battle_${centerGlobalX}_${centerGlobalY}`,
    worldRect: { x: sx, y: sy, width: ex - sx, height: ey - sy },
    center: { globalX: centerGlobalX, globalY: centerGlobalY },
    overlayCells: cells,
    environment: {
      timeOfDay: 'day', weather: 'clear', seaState: 1,
      windDirectionDeg: 90, windSpeedKts: 10, visibilityModifier: 1.0,
    },
    scale: 'naval_combat',
    regionTileOrigin: { globalX: 0, globalY: 0 },
  };
}
