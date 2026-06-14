/**
 * 太平洋海战地图生成器 - 岛链 + 设施 + 航道
 * 
 * 技术来源：原 game/strategic-gen 的三层FBM噪声 + 地形分类 + 设施放置
 * 独立于 WorldAtlas/RegionTile，直接生成 NavalCellOverlay
 */

import type { NavalCellOverlay, NavalSeaZoneType, WorldPosition, NavalBattleMap } from './naval-types';

// ============================================================
// 0. 配置
// ============================================================

export interface NavalMapConfig {
  width: number;
  height: number;
  seed: number;
  /** 岛屿组数量 */
  islandGroupCount: number;
  /** 最大岛屿半径 (cells) */
  maxIslandRadius: number;
  /** 最小岛屿半径 */
  minIslandRadius: number;
  /** 设施密度 [0-1] */
  facilityDensity: number;
  /** 海平面阈值 [0-1]: 越高越多水 */
  seaLevel: number;
}

export const PACIFIC_MAP_CONFIG: NavalMapConfig = {
  width: 1024,
  height: 1024,
  seed: 1942,
  islandGroupCount: 8,
  maxIslandRadius: 60,
  minIslandRadius: 8,
  facilityDensity: 0.4,
  seaLevel: 0.40,
};

export const TACTICAL_MAP_CONFIG: NavalMapConfig = {
  width: 256,
  height: 192,
  seed: 1942,
  islandGroupCount: 3,
  maxIslandRadius: 40,
  minIslandRadius: 5,
  facilityDensity: 0.6,
  seaLevel: 0.35,
};

// ============================================================
// 1. PRNG + 噪声
// ============================================================

function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise2D(x: number, y: number, perm: number[]): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const aa = perm[perm[X] + Y];
  const ab = perm[perm[X] + Y + 1];
  const ba = perm[perm[X + 1] + Y];
  const bb = perm[perm[X + 1] + Y + 1];

  const grad = (hash: number, dx: number, dy: number): number => {
    const h = hash & 3;
    return (h === 0 ? dx + dy : h === 1 ? -dx + dy : h === 2 ? dx - dy : -dx - dy);
  };

  const x1 = grad(aa, xf, yf);
  const x2 = grad(ba, xf - 1, yf);
  const y1 = x1 + u * (x2 - x1);
  const y2 = grad(ab, xf, yf - 1);
  const y3 = grad(bb, xf - 1, yf - 1);
  const y4 = y2 + u * (y3 - y2);

  return y1 + v * (y4 - y1);
}

function buildPermutation(seed: number): number[] {
  const p: number[] = [];
  for (let i = 0; i < 256; i++) p[i] = i;
  const rng = mulberry32(seed);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const doubled: number[] = [];
  for (let i = 0; i < 512; i++) doubled[i] = p[i & 255];
  return doubled;
}

function fbm(x: number, y: number, perm: number[], octaves = 4, lacunarity = 2.0, gain = 0.5): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let max = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * noise2D(x * frequency, y * frequency, perm);
    max += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / max;
}

// ============================================================
// 2. 高程地图生成
// ============================================================

function generateHeightmap(
  width: number, height: number,
  perm: number[],
  islandCenters: Array<{ x: number; y: number; radius: number }>,
  seaLevel: number,
): number[][] {
  const elevation: number[][] = [];

  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      // 三层 FBM 噪声 (参考 generateStrategicHeightmap)
      const continental = fbm(x / width * 3, y / height * 3, perm, 4, 2.0, 0.5);
      const mountain = fbm(x / width * 5, y / height * 5, perm, 5, 2.1, 0.45);
      const local = fbm(x / width * 10, y / height * 10, perm, 3, 2.0, 0.5);

      let e = continental * 0.55 + mountain * 0.30 + local * 0.15;

      // 岛链效果：对每个岛屿中心施加径向距离降级 (参考 applyWorldShape 'island')
      for (const ic of islandCenters) {
        const dx = (x - ic.x) / ic.radius;
        const dy = (y - ic.y) / ic.radius;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= 1.0) {
          e += (1 - Math.pow(d, 1.8)) * 0.40 - d * 0.15;
        }
      }

      // 避免完全平坦的海底
      e += noise2D(x / width * 15, y / height * 15, perm) * 0.05;

      row.push(Math.max(0, Math.min(1, e)));
    }
    elevation.push(row);
  }

  return elevation;
}

// ============================================================
// 3. 岛链中心生成
// ============================================================

function generateIslandCenters(
  width: number, height: number,
  rng: () => number,
  config: NavalMapConfig,
): Array<{ x: number; y: number; radius: number; name: string }> {
  const centers: Array<{ x: number; y: number; radius: number; name: string }> = [];

  const islandNames = [
    'Wake', 'Midway', 'Guadalcanal', 'Tulagi', 'Saipan', 'Guam',
    'Peleliu', 'Tarawa', 'Kwajalein', 'Eniwetok', 'Truk',
    'Iwo Jima', 'Okinawa', 'Leyte', 'Luzon', 'Rabaul',
  ];

  for (let i = 0; i < config.islandGroupCount; i++) {
    // 岛屿倾向于连成岛链：沿弧形分布
    const baseAngle = rng() * Math.PI * 2;
    const chainRadius = Math.min(width, height) * 0.25 * (0.6 + rng() * 0.4);

    const cx = width / 2 + Math.cos(baseAngle) * chainRadius * (0.5 + rng() * 0.5);
    const cy = height / 2 + Math.sin(baseAngle) * chainRadius * (0.5 + rng() * 0.5);
    const clampedX = Math.max(config.maxIslandRadius, Math.min(width - config.maxIslandRadius, cx));
    const clampedY = Math.max(config.maxIslandRadius, Math.min(height - config.maxIslandRadius, cy));

    const radius = config.minIslandRadius + rng() * (config.maxIslandRadius - config.minIslandRadius);

    centers.push({
      x: clampedX,
      y: clampedY,
      radius,
      name: islandNames[i % islandNames.length],
    });

    // 小岛群：在大岛周围放若干卫星小岛
    const satelliteCount = Math.floor(rng() * 3);
    for (let s = 0; s < satelliteCount; s++) {
      const angle = rng() * Math.PI * 2;
      const dist = radius * 1.5 + rng() * radius * 1.5;
      const sx = clampedX + Math.cos(angle) * dist;
      const sy = clampedY + Math.sin(angle) * dist;
      if (sx > 0 && sx < width && sy > 0 && sy < height) {
        centers.push({
          x: sx, y: sy,
          radius: config.minIslandRadius * (0.5 + rng() * 0.5),
          name: `${islandNames[i % islandNames.length]}_Atoll`,
        });
      }
    }
  }

  return centers;
}

// ============================================================
// 4. 设施定义
// ============================================================

export interface NavalFacility {
  id: string;
  type: 'port' | 'naval_base' | 'airfield' | 'supply_depot' | 'coastal_battery';
  name: string;
  position: WorldPosition;
  islandName: string;
  faction: 'player' | 'enemy' | 'neutral';
}

export interface ShippingLane {
  id: string;
  fromId: string;
  toId: string;
  waypoints: WorldPosition[];
}

// ============================================================
// 5. 坡度计算 (参考 computeSlope)
// ============================================================

function computeSlope(elevation: number[][]): number[][] {
  const h = elevation.length;
  const w = elevation[0].length;
  const slope: number[][] = [];

  for (let y = 0; y < h; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) {
      let maxDiff = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const ny = y + dy; const nx = x + dx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
            maxDiff = Math.max(maxDiff, Math.abs(elevation[y][x] - elevation[ny][nx]));
          }
        }
      }
      row.push(maxDiff);
    }
    slope.push(row);
  }

  return slope;
}

// ============================================================
// 6. 地形分类 (参考 classifyBaseTerrains)
// ============================================================

function classifySeaZone(
  elevation: number,
  slope: number,
  seaLevel: number,
  distToIsland: number,
): NavalSeaZoneType {
  // 水下地形
  if (elevation < seaLevel) {
    const depth = seaLevel - elevation;
    if (depth > 0.35) return 'deep_ocean';
    if (depth > 0.20) return 'coastal_water';
    if (depth > 0.08) return 'shallow_water';
    if (distToIsland < 8 && slope < 0.03) return 'reef';
    return 'shallow_water';
  }

  // 陆上
  if (elevation > seaLevel + 0.05) {
    // 检查是否为锚地(靠海小岛内部)
    if (distToIsland < 3) return 'anchorage';
    return 'island';
  }

  // 潮间带
  return distToIsland < 5 ? 'port' : 'coastal_water';
}

// ============================================================
// 7. 主生成函数
// ============================================================

export interface NavalMapResult {
  overlay: NavalCellOverlay[][];
  facilities: NavalFacility[];
  shippingLanes: ShippingLane[];
  islandCenters: typeof centers;
  stats: {
    width: number;
    height: number;
    deepOceanCount: number;
    coastalWaterCount: number;
    islandCount: number;
    portCount: number;
    facilityCount: number;
  };
}

let centers: ReturnType<typeof generateIslandCenters> = [];

export function generateNavalMap(config: Partial<NavalMapConfig> = {}): NavalMapResult {
  const cfg = { ...PACIFIC_MAP_CONFIG, ...config };
  const rng = mulberry32(cfg.seed);
  const perm = buildPermutation(cfg.seed);

  // 1. 生成岛链中心
  centers = generateIslandCenters(cfg.width, cfg.height, rng, cfg);

  // 2. 高程图
  const elevation = generateHeightmap(cfg.width, cfg.height, perm, centers, cfg.seaLevel);

  // 3. 坡度
  const slope = computeSlope(elevation);

  // 4. 海水分类(从四边洪水填充 ocean, 参考 classifyWaterBodies)
  const isOcean = Array.from({ length: cfg.height }, () => Array(cfg.width).fill(false));
  const queue: [number, number][] = [];
  let qHead = 0;

  // 四边入队
  for (let x = 0; x < cfg.width; x++) {
    if (elevation[0][x] <= cfg.seaLevel) { isOcean[0][x] = true; queue.push([x, 0]); }
    if (elevation[cfg.height - 1][x] <= cfg.seaLevel) { isOcean[cfg.height - 1][x] = true; queue.push([x, cfg.height - 1]); }
  }
  for (let y = 0; y < cfg.height; y++) {
    if (elevation[y][0] <= cfg.seaLevel) { isOcean[y][0] = true; queue.push([0, y]); }
    if (elevation[y][cfg.width - 1] <= cfg.seaLevel) { isOcean[y][cfg.width - 1] = true; queue.push([cfg.width - 1, y]); }
  }

  while (qHead < queue.length) {
    const [cx, cy] = queue[qHead++];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx; const ny = cy + dy;
        if (nx >= 0 && nx < cfg.width && ny >= 0 && ny < cfg.height &&
          !isOcean[ny][nx] && elevation[ny][nx] <= cfg.seaLevel) {
          isOcean[ny][nx] = true;
          queue.push([nx, ny]);
        }
      }
    }
  }

  // 5. 距离到最近岛屿的 BFS (用于分类)
  const distToIsland: number[][] = [];
  const islandQueue: [number, number, number][] = [];
  let iqHead = 0;

  for (let y = 0; y < cfg.height; y++) {
    distToIsland[y] = [];
    for (let x = 0; x < cfg.width; x++) {
      if (elevation[y][x] > cfg.seaLevel) {
        distToIsland[y][x] = 0;
        islandQueue.push([x, y, 0]);
      } else {
        distToIsland[y][x] = 9999;
      }
    }
  }

  while (iqHead < islandQueue.length) {
    const [cx, cy, d] = islandQueue[iqHead++];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx; const ny = cy + dy;
        if (nx >= 0 && nx < cfg.width && ny >= 0 && ny < cfg.height && distToIsland[ny][nx] > d + 1) {
          distToIsland[ny][nx] = d + 1;
          islandQueue.push([nx, ny, d + 1]);
        }
      }
    }
  }

  // 6. 设施放置
  const facilities = placeFacilities(cfg, rng, elevation, slope, isOcean, distToIsland, centers);

  // 7. 航道生成
  const shippingLanes = generateShippingLanes(facilities.filter((f) => f.type === 'port' || f.type === 'naval_base'), rng);

  // 8. 构建 overlay
  const overlay = buildOverlay(cfg, elevation, slope, isOcean, distToIsland, cfg.seaLevel, facilities, centers);

  // 9. 统计
  const flat = overlay.flat();
  const stats = {
    width: cfg.width,
    height: cfg.height,
    deepOceanCount: flat.filter((c) => c.seaZoneType === 'deep_ocean').length,
    coastalWaterCount: flat.filter((c) => c.seaZoneType === 'coastal_water' || c.seaZoneType === 'shallow_water').length,
    islandCount: flat.filter((c) => c.seaZoneType === 'island').length,
    portCount: flat.filter((c) => c.seaZoneType === 'port' || c.seaZoneType === 'naval_base').length,
    facilityCount: facilities.length,
  };

  return { overlay, facilities, shippingLanes, islandCenters: centers, stats };
}

// ============================================================
// 8. 设施放置
// ============================================================

function placeFacilities(
  cfg: NavalMapConfig,
  rng: () => number,
  elevation: number[][],
  slope: number[][],
  isOcean: boolean[][],
  distToIsland: number[][],
  centers: ReturnType<typeof generateIslandCenters>,
): NavalFacility[] {
  const facilities: NavalFacility[] = [];
  let facilityId = 0;

  const nextId = (): string => { facilityId++; return `facility_${facilityId}`; };

  for (const center of centers) {
    // 只在大岛上放设施
    if (center.radius < 15) continue;

    // Port: 靠海 + 平坦 + 沿岸
    const portCandidates: Array<{ x: number; y: number; score: number }> = [];
    for (let dy = -center.radius; dy <= center.radius; dy++) {
      for (let dx = -center.radius; dx <= center.radius; dx++) {
        const x = Math.floor(center.x + dx);
        const y = Math.floor(center.y + dy);
        if (x < 0 || x >= cfg.width || y < 0 || y >= cfg.height) continue;

        // Port 要求: 在岛上 + 沿海(<3格到水) + 平缓(slope<0.12)  (参考 placePorts)
        if (elevation[y][x] <= cfg.seaLevel) continue;
        if (distToIsland[y][x] > 3) continue;
        if (slope[y][x] > 0.12) continue;

        const score = (1 - slope[y][x] / 0.12) * 50 + Math.max(0, 3 - distToIsland[y][x]) * 15;
        portCandidates.push({ x, y, score });
      }
    }
    portCandidates.sort((a, b) => b.score - a.score);

    if (portCandidates.length > 0) {
      const { x, y } = portCandidates[0];
      const isNavalBase = center.radius > 30;
      facilities.push({
        id: nextId(),
        type: isNavalBase ? 'naval_base' : 'port',
        name: `${center.name} ${isNavalBase ? 'Naval Base' : 'Port'}`,
        position: { globalX: x, globalY: y },
        islandName: center.name,
        faction: rng() < 0.5 ? 'player' : 'enemy',
      });

      // Airfield: 港口附近 + 平坦 (参考 placeAirfields)
      const afCandidates: Array<{ x: number; y: number; score: number }> = [];
      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          const ax = x + dx; const ay = y + dy;
          if (ax < 0 || ax >= cfg.width || ay < 0 || ay >= cfg.height) continue;
          if (elevation[ay][ax] <= cfg.seaLevel) continue;
          if (slope[ay][ax] > 0.08) continue;
          const flatScore = (1 - slope[ay][ax] / 0.08) * 45;
          const distScore = Math.max(0, 8 - Math.sqrt(dx * dx + dy * dy)) * 3;
          afCandidates.push({ x: ax, y: ay, score: flatScore + distScore });
        }
      }
      afCandidates.sort((a, b) => b.score - a.score);

      const portFaction = facilities[facilities.length - 1].faction;
      if (afCandidates.length > 0) {
        facilities.push({
          id: nextId(),
          type: 'airfield',
          name: `${center.name} Airfield`,
          position: { globalX: afCandidates[0].x, globalY: afCandidates[0].y },
          islandName: center.name,
          faction: portFaction,
        });
      }

      // Supply Depot (参考 placeSupplyDepots)
      if (rng() < cfg.facilityDensity * 1.5) {
        const depotX = x + Math.floor((rng() - 0.5) * 6);
        const depotY = y + Math.floor((rng() - 0.5) * 6);
        if (depotX >= 0 && depotX < cfg.width && depotY >= 0 && depotY < cfg.height && elevation[depotY][depotX] > cfg.seaLevel) {
          facilities.push({
            id: nextId(),
            type: 'supply_depot',
            name: `${center.name} Supply Depot`,
            position: { globalX: depotX, globalY: depotY },
            islandName: center.name,
            faction: portFaction,
          });
        }
      }
    }
  }

  return facilities;
}

// ============================================================
// 9. 航道生成
// ============================================================

function generateShippingLanes(
  ports: NavalFacility[],
  rng: () => number,
): ShippingLane[] {
  const lanes: ShippingLane[] = [];
  let laneId = 0;

  // 简单连接近的港口对
  for (let i = 0; i < ports.length; i++) {
    for (let j = i + 1; j < ports.length; j++) {
      const dx = ports[i].position.globalX - ports[j].position.globalX;
      const dy = ports[i].position.globalY - ports[j].position.globalY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 连接较近的港口，且随机决定是否连接
      if (dist < 250 && rng() < 0.5) {
        lanes.push({
          id: `lane_${laneId++}`,
          fromId: ports[i].id,
          toId: ports[j].id,
          waypoints: [
            ports[i].position,
            { globalX: (ports[i].position.globalX + ports[j].position.globalX) / 2, globalY: (ports[i].position.globalY + ports[j].position.globalY) / 2 },
            ports[j].position,
          ],
        });
      }
    }
  }

  return lanes;
}

// ============================================================
// 10. 构建 Overlay
// ============================================================

function buildOverlay(
  cfg: NavalMapConfig,
  elevation: number[][],
  slope: number[][],
  isOcean: boolean[][],
  distToIsland: number[][],
  seaLevel: number,
  facilities: NavalFacility[],
  centers: ReturnType<typeof generateIslandCenters>,
): NavalCellOverlay[][] {
  const overlay: NavalCellOverlay[][] = [];

  // 设施快速查找
  const facilityMap: Map<string, NavalFacility> = new Map();
  for (const f of facilities) {
    facilityMap.set(`${f.position.globalX}_${f.position.globalY}`, f);
  }

  // 航道单元格标记
  const laneCells = new Set<string>();
  // 简化：航道附近的海域标记
  for (const f of facilities) {
    const px = f.position.globalX; const py = f.position.globalY;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const lx = px + dx * 10; const ly = py + dy * 10;
        if (lx >= 0 && lx < cfg.width && ly >= 0 && ly < cfg.height && elevation[ly]?.[lx] <= seaLevel) {
          laneCells.add(`${lx}_${ly}`);
        }
      }
    }
  }

  for (let y = 0; y < cfg.height; y++) {
    const row: NavalCellOverlay[] = [];
    for (let x = 0; x < cfg.width; x++) {
      const e = elevation[y][x];
      const s = slope[y][x];
      const d2i = distToIsland[y][x];

      let seaZoneType = classifySeaZone(e, s, seaLevel, d2i);

      // 航道覆盖
      if (laneCells.has(`${x}_${y}`) && seaLevel > e) {
        seaZoneType = 'shipping_lane';
      }

      // 设施覆盖
      const fac = facilityMap.get(`${x}_${y}`);
      if (fac) {
        switch (fac.type) {
          case 'port': seaZoneType = 'port'; break;
          case 'naval_base': seaZoneType = 'naval_base'; break;
          case 'airfield': seaZoneType = 'airfield'; break;
          default: break;
        }
      }

      // 海洋深度
      const seaDepth = e < seaLevel ? (seaLevel - e) * 3000 : 0;

      // 海况
      let seaState: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0;
      if (seaZoneType === 'deep_ocean') seaState = isOcean[y][x] ? 3 : 2;
      else if (seaZoneType === 'coastal_water') seaState = 1;
      else if (seaZoneType === 'shallow_water' || seaZoneType === 'reef') seaState = 1;

      // 视野修正
      const visibilityModifier =
        seaZoneType === 'deep_ocean' ? 1.0 :
        seaZoneType === 'coastal_water' ? 0.85 :
        seaZoneType === 'shallow_water' || seaZoneType === 'reef' ? 0.7 :
        seaZoneType === 'island' ? 0.3 : 0.9;

      const isIsland = seaZoneType === 'island';

      row.push({
        globalX: x,
        globalY: y,
        seaZoneType,
        seaDepth: Math.round(seaDepth),
        islandId: isIsland ? `island_${x}_${y}` : undefined,
        portId: fac?.type === 'port' || fac?.type === 'naval_base' ? fac.id : undefined,
        navalBaseId: fac?.type === 'naval_base' ? fac.id : undefined,
        airfieldId: fac?.type === 'airfield' ? fac.id : undefined,
        weatherZone: 'clear',
        visibilityModifier,
        seaState: seaState as 0 | 1 | 2 | 3 | 4 | 5 | 6,
        strategicValue: {
          shipping: seaZoneType === 'shipping_lane' ? 0.8 : seaZoneType === 'coastal_water' ? 0.4 : 0.1,
          base: fac?.type === 'naval_base' ? 1.0 : fac?.type === 'port' ? 0.6 : 0,
          airCoverage: fac?.type === 'airfield' ? 0.5 : 0,
          submarineRisk: seaDepth > 1500 ? 0.6 : seaDepth > 300 ? 0.3 : 0.1,
          invasionValue: isIsland ? 0.7 : seaZoneType === 'port' ? 0.8 : 0,
        },
      });
    }
    overlay.push(row);
  }

  return overlay;
}

// ============================================================
// 11. BattleMap 裁剪
// ============================================================

function clampViewStart(center: number, size: number, maxSize: number): number {
  if (size >= maxSize) return 0;
  const raw = Math.floor(center - size / 2);
  return Math.max(0, Math.min(raw, maxSize - size));
}

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
