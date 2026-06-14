/**
 * 太平洋海战地图系统 v3
 * 战略图 3000×2000 + 战术图(每岛链独立) + 设施 + 航道
 */
import type { NavalCellOverlay, NavalSeaZoneType, ShippingLane } from './naval-types';

// ========== 配置 ==========
export interface MapConfig {
  width: number; height: number; seed: number;
  islandGroups: number; maxIslandR: number; minIslandR: number;
  seaLevel: number;
}

export const STRATEGIC: MapConfig = { width: 1500, height: 1000, seed: 1942, islandGroups: 12, maxIslandR: 40, minIslandR: 8, seaLevel: 0.42 };
export const TACTICAL: MapConfig = { width: 200, height: 150, seed: 1942, islandGroups: 3, maxIslandR: 40, minIslandR: 8, seaLevel: 0.38 };

const PACIFIC_BASE_WIDTH = 3000;
const PACIFIC_BASE_HEIGHT = 2000;

// ========== 真实太平洋地理 (美东日西, 前线分明) ==========
export const PACIFIC_ISLANDS: Array<{ name: string; x: number; y: number; radius: number; faction: 'player'|'enemy'; baseType: 'naval_base'|'port'|'airfield' }> = [
  // ──── 美军 (东侧/中太平洋) ────
  { name: '珍珠港', x: 2550, y: 1050, radius: 80, faction: 'player', baseType: 'naval_base' },
  { name: '中途岛', x: 2050, y: 750, radius: 25, faction: 'player', baseType: 'airfield' },
  { name: '威克岛', x: 1750, y: 820, radius: 20, faction: 'player', baseType: 'airfield' },
  { name: '夸贾林', x: 1600, y: 920, radius: 30, faction: 'player', baseType: 'airfield' },
  { name: '塔拉瓦', x: 1850, y: 1150, radius: 20, faction: 'player', baseType: 'airfield' },
  { name: '关岛', x: 980, y: 880, radius: 40, faction: 'player', baseType: 'naval_base' },
  { name: '塞班岛', x: 920, y: 840, radius: 35, faction: 'player', baseType: 'airfield' },
  { name: '莱特湾', x: 700, y: 1100, radius: 45, faction: 'player', baseType: 'naval_base' },
  { name: '瓜达尔卡纳尔', x: 1250, y: 1350, radius: 35, faction: 'player', baseType: 'airfield' },
  // ──── 日军 (西侧/北太平洋) ────
  { name: '横须贺', x: 350, y: 480, radius: 70, faction: 'enemy', baseType: 'naval_base' },
  { name: '吴港', x: 280, y: 550, radius: 50, faction: 'enemy', baseType: 'naval_base' },
  { name: '冲绳', x: 480, y: 620, radius: 40, faction: 'enemy', baseType: 'naval_base' },
  { name: '硫磺岛', x: 650, y: 700, radius: 25, faction: 'enemy', baseType: 'airfield' },
  { name: '台北', x: 440, y: 750, radius: 30, faction: 'enemy', baseType: 'airfield' },
  { name: '特鲁克', x: 1080, y: 950, radius: 45, faction: 'enemy', baseType: 'naval_base' },
  { name: '帕劳', x: 1000, y: 1050, radius: 30, faction: 'enemy', baseType: 'port' },
  { name: '拉包尔', x: 1150, y: 1200, radius: 40, faction: 'enemy', baseType: 'naval_base' },
];

function scalePacificIsland(
  island: typeof PACIFIC_ISLANDS[number],
  cfg: MapConfig
): typeof PACIFIC_ISLANDS[number] {
  const sx = cfg.width / PACIFIC_BASE_WIDTH;
  const sy = cfg.height / PACIFIC_BASE_HEIGHT;
  const sr = Math.min(sx, sy);
  return {
    ...island,
    x: Math.round(Math.max(0, Math.min(cfg.width - 1, island.x * sx))),
    y: Math.round(Math.max(0, Math.min(cfg.height - 1, island.y * sy))),
    radius: Math.max(cfg.minIslandR, Math.round(island.radius * sr)),
  };
}

function theaterFaction(x: number, width: number): 'player' | 'enemy' {
  return x >= width * 0.5 ? 'player' : 'enemy';
}

// ========== PRNG + 噪声 ==========
function mulberry32(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function buildPerm(s: number): number[] {
  const p: number[] = []; for (let i = 0; i < 256; i++) p[i] = i;
  const r = mulberry32(s);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const d: number[] = []; for (let i = 0; i < 512; i++) d[i] = p[i & 255]; return d;
}
function noise2D(x: number, y: number, perm: number[]): number {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, xf = x - Math.floor(x), yf = y - Math.floor(y);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1], ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
  const grad = (h: number, dx: number, dy: number) => { const g = h & 3; return g === 0 ? dx + dy : g === 1 ? -dx + dy : g === 2 ? dx - dy : -dx - dy; };
  return grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf)) + v * (grad(ab, xf, yf - 1) - grad(aa, xf, yf)) + u * v * (grad(bb, xf - 1, yf - 1) + grad(aa, xf, yf) - grad(ab, xf, yf - 1) - grad(ba, xf - 1, yf));
}
function fbm(x: number, y: number, p: number[], o = 4, l = 2, g = 0.5) { let v = 0, a = 1, f = 1, m = 0; for (let i = 0; i < o; i++) { v += a * noise2D(x * f, y * f, p); m += a; a *= g; f *= l; } return v / m; }

// ========== 岛链中心 ==========
export interface IslandCenter { x: number; y: number; radius: number; name: string; }
export interface Fac { id: string; type: 'port'|'naval_base'|'airfield'|'supply_depot'; name: string; x: number; y: number; islandName: string; faction: 'player'|'enemy'|'neutral'; }

const ISLAND_NAMES = ['威克岛','中途岛','瓜达尔卡纳尔','塞班岛','关岛','佩莱利乌','塔拉瓦','夸贾林','特鲁克','硫磺岛','冲绳','莱特岛','拉包尔','马朱罗','埃尼威托克'];

function genIslands(cfg: MapConfig, rng: () => number): IslandCenter[] {
  const c: IslandCenter[] = [];
  for (let i = 0; i < cfg.islandGroups; i++) {
    const angle = rng() * Math.PI * 2, chainR = Math.min(cfg.width, cfg.height) * 0.25 * (0.5 + rng() * 0.5);
    let cx = cfg.width / 2 + Math.cos(angle) * chainR, cy = cfg.height / 2 + Math.sin(angle) * chainR;
    cx = Math.max(cfg.maxIslandR, Math.min(cfg.width - cfg.maxIslandR, cx));
    cy = Math.max(cfg.maxIslandR, Math.min(cfg.height - cfg.maxIslandR, cy));
    const rad = cfg.minIslandR + rng() * (cfg.maxIslandR - cfg.minIslandR);
    c.push({ x: Math.round(cx), y: Math.round(cy), radius: Math.round(rad), name: ISLAND_NAMES[i % ISLAND_NAMES.length] });
    // 卫星小岛
    const sats = Math.floor(rng() * 3);
    for (let s = 0; s < sats; s++) {
      const a = rng() * Math.PI * 2, d = rad * 1.5 + rng() * rad * 1.5;
      const sx = cx + Math.cos(a) * d, sy = cy + Math.sin(a) * d;
      if (sx > 0 && sx < cfg.width && sy > 0 && sy < cfg.height) c.push({ x: Math.round(sx), y: Math.round(sy), radius: Math.round(cfg.minIslandR * (0.4 + rng() * 0.5)), name: `${ISLAND_NAMES[i % ISLAND_NAMES.length]}环礁` });
    }
  }
  return c;
}

// ========== 高程 + 地形分类 ==========
function genElevation(cfg: MapConfig, perm: number[], islands: IslandCenter[]): number[][] {
  const e: number[][] = [];
  for (let y = 0; y < cfg.height; y++) {
    const row: number[] = [];
    for (let x = 0; x < cfg.width; x++) {
      const cont = fbm(x / cfg.width * 3, y / cfg.height * 3, perm, 4, 2, 0.5);
      const mtn = fbm(x / cfg.width * 5, y / cfg.height * 5, perm, 5, 2.1, 0.45);
      const loc = fbm(x / cfg.width * 10, y / cfg.height * 10, perm, 3, 2, 0.5);
      let el = cont * 0.55 + mtn * 0.30 + loc * 0.15;
      for (const ic of islands) {
        const dx = (x - ic.x) / ic.radius, dy = (y - ic.y) / ic.radius, d = Math.sqrt(dx * dx + dy * dy);
        if (d <= 1) el += (1 - Math.pow(d, 1.8)) * 0.40 - d * 0.15;
      }
      row.push(Math.max(0, Math.min(1, el)));
    }
    e.push(row);
  }
  return e;
}

function classify(el: number, seaLvl: number): NavalSeaZoneType {
  if (el > seaLvl + 0.06) return 'island';
  if (el > seaLvl + 0.02) return 'shallow_water';
  if (el > seaLvl - 0.05) return 'coastal_water';
  if (el > seaLvl - 0.20) return 'shallow_water';
  return 'deep_ocean';
}

// ========== 设施放置 ==========
function placeFacilities(cfg: MapConfig, rng: () => number, elevation: number[][], islands: IslandCenter[], realData?: typeof PACIFIC_ISLANDS): Fac[] {
  const facs: Fac[] = [];
  let fid = 0;

  if (realData) {
    const scaledRealData = realData.map((rd) => scalePacificIsland(rd, cfg));
    // Use scaled geography data for facilities. Match by index because names may be localized.
    for (let i = 0; i < scaledRealData.length; i++) {
      const rd = scaledRealData[i];
      const ic = islands[i] || islands.find(item => item.name === rd.name);
      if (!ic) continue;
      const bestX = Math.round(Math.max(0, Math.min(cfg.width - 1, rd.x)));
      const bestY = Math.round(Math.max(0, Math.min(cfg.height - 1, rd.y)));
      const faction = theaterFaction(bestX, cfg.width);

      // Port / Naval Base
      const isBase = rd.baseType === 'naval_base';
      if (rd.baseType === 'naval_base' || rd.baseType === 'port') {
        facs.push({ id: `f${++fid}`, type: isBase ? 'naval_base' : 'port', name: `${rd.name}${isBase ? '基地' : '港'}`, x: bestX, y: bestY, islandName: rd.name, faction });
        // Airfield near base
        facs.push({ id: `f${++fid}`, type: 'airfield', name: `${rd.name}机场`, x: bestX + 8, y: bestY + 6, islandName: rd.name, faction });
        // Supply depot
        if (isBase) facs.push({ id: `f${++fid}`, type: 'supply_depot', name: `${rd.name}补给站`, x: bestX + 5, y: bestY - 5, islandName: rd.name, faction });
      } else if (rd.baseType === 'airfield') {
        facs.push({ id: `f${++fid}`, type: 'airfield', name: `${rd.name}机场`, x: bestX, y: bestY, islandName: rd.name, faction });
      }
    }
    return facs;
  }

  // Procedural facility placement (original code)
  for (const ic of islands) {
    if (ic.radius < 15) continue;
    // Port at coastal edge
    let bestX = ic.x, bestY = ic.y, bestScore = -1;
    for (let dy = -ic.radius; dy <= ic.radius; dy++) {
      for (let dx = -ic.radius; dx <= ic.radius; dx++) {
        const x = ic.x + dx, y = ic.y + dy;
        if (x < 0 || x >= cfg.width || y < 0 || y >= cfg.height) continue;
        const el = elevation[y][x];
        if (el <= cfg.seaLevel) continue;
        // Check proximity to water
        let nearWater = false;
        for (let wy = -1; wy <= 1; wy++) for (let wx = -1; wx <= 1; wx++) {
          const nx = x + wx, ny = y + wy;
          if (nx >= 0 && nx < cfg.width && ny >= 0 && ny < cfg.height && elevation[ny][nx] <= cfg.seaLevel) { nearWater = true; break; }
        }
        if (!nearWater) continue;
        const score = el - cfg.seaLevel + (1 - Math.sqrt(dx * dx + dy * dy) / ic.radius) * 0.5;
        if (score > bestScore) { bestScore = score; bestX = x; bestY = y; }
      }
    }
    const isBase = ic.radius > 30;
    facs.push({ id: `f${++fid}`, type: isBase ? 'naval_base' : 'port', name: `${ic.name}${isBase ? '海军基地' : '港口'}`, x: bestX, y: bestY, islandName: ic.name, faction: theaterFaction(bestX, cfg.width) });
    const faction = facs[facs.length - 1].faction;
    // Airfield close to port
    let afX = bestX, afY = bestY;
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
      const x = bestX + dx, y = bestY + dy;
      if (x < 0 || x >= cfg.width || y < 0 || y >= cfg.height) continue;
      if (elevation[y][x] > cfg.seaLevel + 0.03) { afX = x; afY = y; break; }
    }
    facs.push({ id: `f${++fid}`, type: 'airfield', name: `${ic.name}机场`, x: afX, y: afY, islandName: ic.name, faction });
    // Supply depot
    if (rng() < 0.6 && isBase) facs.push({ id: `f${++fid}`, type: 'supply_depot', name: `${ic.name}补给站`, x: bestX + Math.round(rng() * 6 - 3), y: bestY + Math.round(rng() * 6 - 3), islandName: ic.name, faction });
  }
  return facs;
}

// ========== 主生成函数 ==========
function generateShippingLanes(facilities: Fac[]): ShippingLane[] {
  const ports = facilities
    .filter((f) => f.type === 'port' || f.type === 'naval_base')
    .sort((a, b) => a.x - b.x);
  const lanes: ShippingLane[] = [];

  for (let i = 1; i < ports.length; i++) {
    const from = ports[i - 1];
    const to = ports[i];
    lanes.push({
      id: `lane_${from.id}_${to.id}`,
      fromId: from.id,
      toId: to.id,
      waypoints: [
        { globalX: from.x, globalY: from.y },
        { globalX: Math.round((from.x + to.x) / 2), globalY: Math.round((from.y + to.y) / 2) },
        { globalX: to.x, globalY: to.y },
      ],
    });
  }

  return lanes;
}

export interface StratMapResult {
  overlay: NavalCellOverlay[][];
  islands: IslandCenter[];
  facilities: Fac[];
  shippingLanes: ShippingLane[];
  tacticalMaps: Array<{ island: IslandCenter; overlay: NavalCellOverlay[][]; facilities: Fac[] }>;
  stats: { w: number; h: number; deepOcean: number; islands: number; ports: number; facilities: number };
}

export function generateStratMap(cfg: MapConfig = STRATEGIC, useRealGeo = true): StratMapResult {
  const rng = mulberry32(cfg.seed);
  const perm = buildPerm(cfg.seed);

  // Use real Pacific geography or procedural
  let islands: IslandCenter[];
  if (useRealGeo) {
    islands = PACIFIC_ISLANDS.map(pi => {
      const scaled = scalePacificIsland(pi, cfg);
      return { x: scaled.x, y: scaled.y, radius: scaled.radius, name: scaled.name };
    });
  } else {
    islands = genIslands(cfg, rng);
  }
  const elevation = genElevation(cfg, perm, islands);
  const facilityData = useRealGeo ? PACIFIC_ISLANDS : undefined;
  const facilities = placeFacilities(cfg, rng, elevation, islands, facilityData);

  // Build strategic overlay
  const overlay: NavalCellOverlay[][] = [];
  const facMap = new Map<string, Fac>();
  for (const f of facilities) facMap.set(`${f.x}_${f.y}`, f);

  for (let y = 0; y < cfg.height; y++) {
    const row: NavalCellOverlay[] = [];
    for (let x = 0; x < cfg.width; x++) {
      const el = elevation[y][x];
      const zone = classify(el, cfg.seaLevel);
      const fac = facMap.get(`${x}_${y}`);
      const seaDepth = el < cfg.seaLevel ? (cfg.seaLevel - el) * 3000 : 0;
      const isIsle = zone === 'island';
      row.push({
        globalX: x, globalY: y,
        seaZoneType: fac ? (fac.type === 'naval_base' ? 'naval_base' : fac.type === 'airfield' ? 'airfield' : 'port') : zone,
        seaDepth: Math.round(seaDepth),
        islandId: isIsle ? `isle_${x}_${y}` : undefined,
        portId: fac?.type === 'port' || fac?.type === 'naval_base' ? fac.id : undefined,
        navalBaseId: fac?.type === 'naval_base' ? fac.id : undefined,
        airfieldId: fac?.type === 'airfield' ? fac.id : undefined,
        weatherZone: 'clear', visibilityModifier: zone === 'deep_ocean' ? 1 : zone === 'coastal_water' ? 0.85 : zone === 'shallow_water' ? 0.7 : 0.5,
        seaState: (zone === 'deep_ocean' ? 3 : zone === 'coastal_water' ? 1 : 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
        strategicValue: { shipping: zone === 'coastal_water' ? 0.4 : 0.1, base: fac?.type === 'naval_base' ? 1 : fac?.type === 'port' ? 0.6 : 0, airCoverage: fac?.type === 'airfield' ? 0.5 : 0, submarineRisk: seaDepth > 1500 ? 0.6 : 0.3, invasionValue: isIsle ? 0.7 : zone === 'port' ? 0.8 : 0 },
      });
    }
    overlay.push(row);
  }

  // Generate tactical maps for major islands
  const tacticalMaps: StratMapResult['tacticalMaps'] = [];
  for (const ic of islands.filter(i => i.radius >= 20)) {
    const tCfg: MapConfig = { ...TACTICAL, seed: cfg.seed + ic.x + ic.y, width: 200, height: 150 };
    const tRng = mulberry32(tCfg.seed);
    const tPerm = buildPerm(tCfg.seed);
    const tIslands = [{ ...ic, radius: Math.min(40, ic.radius) }];
    const tElevation = genElevation(tCfg, tPerm, tIslands);
    const tFacs = placeFacilities(tCfg, tRng, tElevation, tIslands);
    const tOverlay: NavalCellOverlay[][] = [];
    const tFacMap = new Map<string, Fac>();
    for (const f of tFacs) tFacMap.set(`${f.x}_${f.y}`, f);
    for (let y = 0; y < tCfg.height; y++) {
      const row: NavalCellOverlay[] = [];
      for (let x = 0; x < tCfg.width; x++) {
        const el = tElevation[y][x], zone = classify(el, tCfg.seaLevel);
        const fac = tFacMap.get(`${x}_${y}`);
        row.push({ globalX: x, globalY: y, seaZoneType: fac?.type === 'naval_base' ? 'naval_base' : fac?.type === 'airfield' ? 'airfield' : zone, seaDepth: Math.round(el < tCfg.seaLevel ? (tCfg.seaLevel - el) * 2000 : 0), islandId: zone === 'island' ? `tac_isle_${x}_${y}` : undefined, portId: fac?.type === 'port' || fac?.type === 'naval_base' ? fac.id : undefined, navalBaseId: fac?.type === 'naval_base' ? fac.id : undefined, airfieldId: fac?.type === 'airfield' ? fac.id : undefined, weatherZone: 'clear', visibilityModifier: 1, seaState: 1 as const, strategicValue: { shipping: 0, base: 0, airCoverage: 0, submarineRisk: 0, invasionValue: 0 } });
      }
      tOverlay.push(row);
    }
    tacticalMaps.push({ island: ic, overlay: tOverlay, facilities: tFacs });
  }

  const flat = overlay.flat();
  const shippingLanes = generateShippingLanes(facilities);
  return {
    overlay, islands, facilities, shippingLanes, tacticalMaps,
    stats: { w: cfg.width, h: cfg.height, deepOcean: flat.filter(c => c.seaZoneType === 'deep_ocean').length, islands: flat.filter(c => c.seaZoneType === 'island').length, ports: flat.filter(c => c.seaZoneType === 'port' || c.seaZoneType === 'naval_base').length, facilities: facilities.length },
  };
}

export const generateNavalMap = generateStratMap;
