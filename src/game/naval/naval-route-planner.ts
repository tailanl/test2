import type { NavalCellOverlay, NavalSeaZoneType } from './naval-types';
import type {
  FleetNavigationMode,
  FleetNavigationSegment,
  FleetNavigationState,
} from './naval-strategic-types';

export interface BuildFleetRouteOptions {
  mode?: FleetNavigationMode;
  desiredSpeedKts?: number;
}

interface RouteNode {
  cx: number;
  cy: number;
}

interface RouteGrid {
  cell: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  overlay: NavalCellOverlay[][];
}

const DEFAULT_CELL = 60;

export function buildFleetNavigationRoute(
  start: { x: number; y: number },
  destination: { x: number; y: number },
  overlay?: NavalCellOverlay[][],
  options: BuildFleetRouteOptions = {},
): FleetNavigationState {
  const mode = options.mode ?? 'safe_transit';
  if (!overlay?.length || !overlay[0]?.length) {
    return buildDirectRoute(start, destination, mode, options.desiredSpeedKts);
  }

  const grid: RouteGrid = {
    cell: DEFAULT_CELL,
    width: overlay[0].length,
    height: overlay.length,
    cols: Math.ceil(overlay[0].length / DEFAULT_CELL),
    rows: Math.ceil(overlay.length / DEFAULT_CELL),
    overlay,
  };

  const startNode = nearestPassableNode(toNode(start, grid), grid);
  const endNode = nearestPassableNode(toNode(destination, grid), grid);
  if (!startNode || !endNode) {
    return {
      destination,
      path: [],
      pathIndex: 0,
      status: 'blocked',
      mode,
      routeRisk: 'high',
      riskScore: 100,
      currentLegNote: 'No navigable sea room found near start or destination.',
    };
  }

  const routeNodes = findRouteNodes(startNode, endNode, grid, mode);
  if (routeNodes.length === 0) {
    return {
      destination: nodeCenter(endNode, grid),
      path: [],
      pathIndex: 0,
      status: 'blocked',
      mode,
      routeRisk: 'high',
      riskScore: 100,
      currentLegNote: 'Route blocked by land, reef, or harbor approach constraints.',
    };
  }

  const destinationPoint = nodeCenter(endNode, grid);
  const smoothed = smoothRouteNodes(routeNodes, grid);
  const path = smoothed.slice(1).map((node, index, arr) => (
    index === arr.length - 1 ? destinationPoint : nodeCenter(node, grid)
  ));
  const segments = buildRouteSegments(start, path, grid, mode);
  const totalDistance = Math.round(segments.reduce((sum, segment) => sum + segment.distance, 0));
  const riskScore = Math.round(weightedRiskScore(segments, mode));
  const routeRisk = riskScore >= 64 ? 'high' : riskScore >= 36 ? 'medium' : 'low';
  const speed = Math.max(6, options.desiredSpeedKts ?? speedForMode(mode));
  const etaTurns = Math.max(1, Math.ceil(totalDistance / Math.max(1, speed * 0.15)));

  return {
    destination: destinationPoint,
    path,
    pathIndex: 0,
    status: path.length > 0 ? 'en_route' : 'arrived',
    mode,
    etaTurns,
    totalDistance,
    riskScore,
    routeRisk,
    currentLegNote: segments[0]?.note,
    segments,
  };
}

export function buildFleetNavigationRouteThroughWaypoints(
  start: { x: number; y: number },
  waypoints: Array<{ x: number; y: number }>,
  overlay?: NavalCellOverlay[][],
  options: BuildFleetRouteOptions = {},
): FleetNavigationState {
  const mode = options.mode ?? 'safe_transit';
  const manualWaypoints = waypoints.map((point) => clampPointToOverlay(point, overlay));
  if (manualWaypoints.length === 0) {
    return {
      destination: clampPointToOverlay(start, overlay),
      path: [],
      pathIndex: 0,
      status: 'arrived',
      mode,
      routeSource: 'manual_waypoints',
      manualWaypoints: [],
      etaTurns: 0,
      totalDistance: 0,
      riskScore: 0,
      routeRisk: 'low',
      currentLegNote: 'No manual waypoints plotted.',
      segments: [],
    };
  }

  let cursor = clampPointToOverlay(start, overlay);
  const path: Array<{ x: number; y: number }> = [];
  const segments: FleetNavigationSegment[] = [];
  let destination = manualWaypoints[manualWaypoints.length - 1];
  let blockedNote: string | undefined;

  for (const waypoint of manualWaypoints) {
    const leg = buildFleetNavigationRoute(cursor, waypoint, overlay, options);
    destination = leg.destination;
    path.push(...leg.path);
    segments.push(...(leg.segments ?? []));
    cursor = leg.destination;
    if (leg.status === 'blocked') {
      blockedNote = leg.currentLegNote ?? 'Manual waypoint route is blocked.';
      break;
    }
  }

  const totalDistance = Math.round(segments.reduce((sum, segment) => sum + segment.distance, 0));
  const riskScore = Math.round(weightedRiskScore(segments, mode));
  const routeRisk = routeRiskFromScore(riskScore);
  const speed = Math.max(6, options.desiredSpeedKts ?? speedForMode(mode));

  return {
    destination,
    path,
    pathIndex: 0,
    status: blockedNote ? 'blocked' : path.length > 0 ? 'en_route' : 'arrived',
    routeSource: 'manual_waypoints',
    manualWaypoints,
    mode,
    etaTurns: totalDistance > 0 ? Math.max(1, Math.ceil(totalDistance / Math.max(1, speed * 0.15))) : 0,
    totalDistance,
    riskScore,
    routeRisk,
    currentLegNote: blockedNote ?? segments[0]?.note ?? 'Manual waypoint route plotted.',
    segments,
  };
}

export function clampPointToOverlay(point: { x: number; y: number }, overlay?: NavalCellOverlay[][]): { x: number; y: number } {
  const width = overlay?.[0]?.length ?? 3000;
  const height = overlay?.length ?? 2000;
  return {
    x: Math.max(0, Math.min(width - 1, Math.round(point.x))),
    y: Math.max(0, Math.min(height - 1, Math.round(point.y))),
  };
}

function buildDirectRoute(
  start: { x: number; y: number },
  destination: { x: number; y: number },
  mode: FleetNavigationMode,
  desiredSpeedKts?: number,
): FleetNavigationState {
  const distance = Math.round(Math.hypot(destination.x - start.x, destination.y - start.y));
  const segment: FleetNavigationSegment = {
    from: start,
    to: destination,
    bearingDeg: bearing(start.x, start.y, destination.x, destination.y),
    distance,
    seaZone: 'unknown',
    risk: 'medium',
    cost: distance,
    note: 'Direct open-water leg; no chart overlay was available.',
  };
  const speed = Math.max(6, desiredSpeedKts ?? speedForMode(mode));
  return {
    destination,
    path: [destination],
    pathIndex: 0,
    status: distance > 0 ? 'en_route' : 'arrived',
    mode,
    etaTurns: Math.max(1, Math.ceil(distance / Math.max(1, speed * 0.15))),
    totalDistance: distance,
    riskScore: 45,
    routeRisk: 'medium',
    currentLegNote: segment.note,
    segments: [segment],
  };
}

function findRouteNodes(startNode: RouteNode, endNode: RouteNode, grid: RouteGrid, mode: FleetNavigationMode): RouteNode[] {
  const key = (node: RouteNode) => `${node.cx},${node.cy}`;
  const open: RouteNode[] = [startNode];
  const came = new Map<string, string>();
  const gScore = new Map<string, number>([[key(startNode), 0]]);
  const closed = new Set<string>();
  const endKey = key(endNode);

  while (open.length > 0) {
    open.sort((a, b) => (
      (gScore.get(key(a)) ?? Number.POSITIVE_INFINITY) + heuristic(a, endNode)
    ) - (
      (gScore.get(key(b)) ?? Number.POSITIVE_INFINITY) + heuristic(b, endNode)
    ));
    const current = open.shift()!;
    const currentKey = key(current);
    if (currentKey === endKey) break;
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);

    for (const next of neighbors(current, grid)) {
      const nextKey = key(next);
      if (closed.has(nextKey) || !isPassableNode(next, grid)) continue;
      if (isDiagonal(current, next) && cutsBlockedCorner(current, next, grid)) continue;
      const stepDistance = current.cx !== next.cx && current.cy !== next.cy ? 1.414 : 1;
      const tentative = (gScore.get(currentKey) ?? 0) + stepDistance * nodeCost(next, grid, mode);
      if (tentative < (gScore.get(nextKey) ?? Number.POSITIVE_INFINITY)) {
        came.set(nextKey, currentKey);
        gScore.set(nextKey, tentative);
        open.push(next);
      }
    }
  }

  if (!came.has(endKey) && key(startNode) !== endKey) return [];
  const nodes: RouteNode[] = [];
  let cursor = endKey;
  while (cursor) {
    const [cx, cy] = cursor.split(',').map(Number);
    nodes.push({ cx, cy });
    const previous = came.get(cursor);
    if (!previous) break;
    cursor = previous;
  }
  return nodes.reverse();
}

function nearestPassableNode(node: RouteNode, grid: RouteGrid): RouteNode | undefined {
  if (isPassableNode(node, grid)) return node;
  for (let radius = 1; radius <= 10; radius++) {
    const candidates: RouteNode[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const candidate = { cx: node.cx + dx, cy: node.cy + dy };
        if (inBounds(candidate, grid) && isPassableNode(candidate, grid)) candidates.push(candidate);
      }
    }
    candidates.sort((a, b) => heuristic(a, node) - heuristic(b, node));
    if (candidates[0]) return candidates[0];
  }
  return undefined;
}

function smoothRouteNodes(nodes: RouteNode[], grid: RouteGrid): RouteNode[] {
  if (nodes.length <= 2) return nodes;
  const result: RouteNode[] = [nodes[0]];
  let anchorIndex = 0;
  while (anchorIndex < nodes.length - 1) {
    let nextIndex = nodes.length - 1;
    while (nextIndex > anchorIndex + 1) {
      if (linePassable(nodes[anchorIndex], nodes[nextIndex], grid)) break;
      nextIndex--;
    }
    result.push(nodes[nextIndex]);
    anchorIndex = nextIndex;
  }
  return result;
}

function buildRouteSegments(
  start: { x: number; y: number },
  path: Array<{ x: number; y: number }>,
  grid: RouteGrid,
  mode: FleetNavigationMode,
): FleetNavigationSegment[] {
  const points = [start, ...path];
  const segments: FleetNavigationSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const samples = sampleSegment(from, to, grid);
    const avgCost = samples.length > 0
      ? samples.reduce((sum, cell) => sum + cellRiskScore(cell, mode), 0) / samples.length
      : 45;
    const dominantZone = dominantSeaZone(samples);
    const distance = Math.round(Math.hypot(to.x - from.x, to.y - from.y));
    const risk: FleetNavigationSegment['risk'] = avgCost >= 64 ? 'high' : avgCost >= 36 ? 'medium' : 'low';
    segments.push({
      from,
      to,
      bearingDeg: bearing(from.x, from.y, to.x, to.y),
      distance,
      seaZone: dominantZone,
      risk,
      cost: Math.round(distance * (1 + avgCost / 100)),
      note: routeNote(dominantZone, risk, mode),
    });
  }
  return segments;
}

function sampleSegment(from: { x: number; y: number }, to: { x: number; y: number }, grid: RouteGrid): NavalCellOverlay[] {
  const distance = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
  const steps = Math.max(1, Math.ceil(distance / (grid.cell * 0.5)));
  const samples: NavalCellOverlay[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(from.x + (to.x - from.x) * t);
    const y = Math.round(from.y + (to.y - from.y) * t);
    const cell = grid.overlay[Math.max(0, Math.min(grid.height - 1, y))]?.[Math.max(0, Math.min(grid.width - 1, x))];
    if (cell) samples.push(cell);
  }
  return samples;
}

function nodeCost(node: RouteNode, grid: RouteGrid, mode: FleetNavigationMode): number {
  const cell = cellForNode(node, grid);
  if (!cell || !isNavigableZone(cell.seaZoneType)) return Number.POSITIVE_INFINITY;
  const clearancePenalty = blockedNeighborCount(node, grid) * 0.22;
  const modeRisk = mode === 'safe_transit' || mode === 'withdrawal' ? 1.4 : mode === 'night_dash' ? 0.8 : 1;
  return seaZoneCost(cell.seaZoneType)
    + clearancePenalty
    + (cell.seaState * 0.08)
    + ((1 - cell.visibilityModifier) * 0.32)
    + (cell.strategicValue.submarineRisk * 0.38 * modeRisk);
}

function seaZoneCost(zone: NavalSeaZoneType): number {
  switch (zone) {
    case 'deep_ocean':
      return 1;
    case 'shipping_lane':
      return 0.72;
    case 'port':
    case 'naval_base':
    case 'anchorage':
      return 0.85;
    case 'coastal_water':
      return 1.12;
    case 'shallow_water':
      return 1.42;
    case 'reef':
    case 'island':
    case 'airfield':
      return Number.POSITIVE_INFINITY;
    default:
      return 1.25;
  }
}

function cellRiskScore(cell: NavalCellOverlay, mode: FleetNavigationMode): number {
  const zoneRisk = cell.seaZoneType === 'shallow_water' ? 54
    : cell.seaZoneType === 'coastal_water' ? 38
      : cell.seaZoneType === 'deep_ocean' ? 24
        : cell.seaZoneType === 'port' || cell.seaZoneType === 'naval_base' ? 18
          : 72;
  const modeDelta = mode === 'night_dash' ? 12
    : mode === 'combat_approach' ? 8
      : mode === 'safe_transit' ? -6
        : mode === 'withdrawal' ? -4
          : 0;
  return Math.max(0, Math.min(100,
    zoneRisk
    + modeDelta
    + cell.seaState * 4
    + (1 - cell.visibilityModifier) * 22
    + cell.strategicValue.submarineRisk * 22,
  ));
}

function weightedRiskScore(segments: FleetNavigationSegment[], mode: FleetNavigationMode): number {
  if (segments.length === 0) return 0;
  const totalDistance = Math.max(1, segments.reduce((sum, segment) => sum + segment.distance, 0));
  const base = segments.reduce((sum, segment) => {
    const risk = segment.risk === 'high' ? 76 : segment.risk === 'medium' ? 48 : 22;
    return sum + risk * (segment.distance / totalDistance);
  }, 0);
  return Math.max(0, Math.min(100, base + (mode === 'night_dash' ? 10 : 0)));
}

function routeNote(zone: string, risk: FleetNavigationSegment['risk'], mode: FleetNavigationMode): string {
  const modeText = mode === 'safe_transit' ? 'screened transit'
    : mode === 'combat_approach' ? 'combat approach'
      : mode === 'night_dash' ? 'high-speed night dash'
        : mode === 'withdrawal' ? 'withdrawal lane'
          : mode === 'rendezvous' ? 'rendezvous approach'
            : 'direct leg';
  if (risk === 'high') return `${modeText}; high-risk ${zone} leg, watch shoals and ambush arcs`;
  if (risk === 'medium') return `${modeText}; moderate-risk ${zone} leg`;
  return `${modeText}; low-risk ${zone} leg`;
}

function dominantSeaZone(samples: NavalCellOverlay[]): string {
  const counts = new Map<string, number>();
  for (const cell of samples) counts.set(cell.seaZoneType, (counts.get(cell.seaZoneType) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
}

function speedForMode(mode: FleetNavigationMode): number {
  switch (mode) {
    case 'night_dash':
      return 30;
    case 'combat_approach':
      return 24;
    case 'withdrawal':
      return 22;
    case 'rendezvous':
      return 18;
    case 'safe_transit':
      return 20;
    case 'direct':
    default:
      return 24;
  }
}

function routeRiskFromScore(riskScore: number): FleetNavigationState['routeRisk'] {
  return riskScore >= 64 ? 'high' : riskScore >= 36 ? 'medium' : 'low';
}

function toNode(point: { x: number; y: number }, grid: RouteGrid): RouteNode {
  const clamped = clampPointToOverlay(point, grid.overlay);
  return {
    cx: Math.max(0, Math.min(grid.cols - 1, Math.floor(clamped.x / grid.cell))),
    cy: Math.max(0, Math.min(grid.rows - 1, Math.floor(clamped.y / grid.cell))),
  };
}

function nodeCenter(node: RouteNode, grid: RouteGrid): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(grid.width - 1, Math.round((node.cx + 0.5) * grid.cell))),
    y: Math.max(0, Math.min(grid.height - 1, Math.round((node.cy + 0.5) * grid.cell))),
  };
}

function cellForNode(node: RouteNode, grid: RouteGrid): NavalCellOverlay | undefined {
  const point = nodeCenter(node, grid);
  return grid.overlay[point.y]?.[point.x];
}

function isPassableNode(node: RouteNode, grid: RouteGrid): boolean {
  const cell = cellForNode(node, grid);
  return !!cell && isNavigableZone(cell.seaZoneType);
}

function isNavigableZone(zone: NavalSeaZoneType): boolean {
  return zone !== 'island' && zone !== 'reef' && zone !== 'airfield';
}

function neighbors(node: RouteNode, grid: RouteGrid): RouteNode[] {
  const result: RouteNode[] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const next = { cx: node.cx + dx, cy: node.cy + dy };
    if (inBounds(next, grid)) result.push(next);
  }
  return result;
}

function inBounds(node: RouteNode, grid: RouteGrid): boolean {
  return node.cx >= 0 && node.cy >= 0 && node.cx < grid.cols && node.cy < grid.rows;
}

function isDiagonal(a: RouteNode, b: RouteNode): boolean {
  return a.cx !== b.cx && a.cy !== b.cy;
}

function cutsBlockedCorner(a: RouteNode, b: RouteNode, grid: RouteGrid): boolean {
  return !isPassableNode({ cx: b.cx, cy: a.cy }, grid) || !isPassableNode({ cx: a.cx, cy: b.cy }, grid);
}

function blockedNeighborCount(node: RouteNode, grid: RouteGrid): number {
  let blocked = 0;
  for (const next of neighbors(node, grid)) {
    if (!isPassableNode(next, grid)) blocked++;
  }
  return blocked;
}

function linePassable(from: RouteNode, to: RouteNode, grid: RouteGrid): boolean {
  const a = nodeCenter(from, grid);
  const b = nodeCenter(to, grid);
  const samples = sampleSegment(a, b, grid);
  return samples.every((cell) => isNavigableZone(cell.seaZoneType));
}

function heuristic(a: RouteNode, b: RouteNode): number {
  return Math.hypot(a.cx - b.cx, a.cy - b.cy);
}

function bearing(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.round(((Math.atan2(toX - fromX, fromY - toY) * 180 / Math.PI) % 360 + 360) % 360);
}
