import type { NavalContact } from './naval-intel-types';
import type { NavalAirMission } from '../ship/ship-aircraft';

export type ReconCloudKind = 'search_coverage' | 'contact_probability';
export type ReconCloudRisk = 'low' | 'medium' | 'high';

export interface ReconProbabilityCloud {
  id: string;
  kind: ReconCloudKind;
  sourceId: string;
  label: string;
  center: { x: number; y: number };
  origin?: { x: number; y: number };
  path?: Array<{ x: number; y: number }>;
  radiusX: number;
  radiusY: number;
  bearingDeg?: number;
  arcWidthDeg?: number;
  range?: number;
  probability: number;
  confidence: 'low' | 'medium' | 'high';
  freshness: number;
  ageTurns: number;
  risk: ReconCloudRisk;
  recommendation: string;
  strikeWindowTurns?: number;
}

export interface ReconAirOperationSnapshot {
  id: string;
  type: string;
  x?: number;
  y?: number;
  originX?: number;
  originY?: number;
  targetX?: number;
  targetY?: number;
  heading?: number;
  fleetName?: string;
  status?: string;
  aircraft?: number;
  arcWidthDeg?: number;
  teamIndex?: number;
  teamCount?: number;
  range?: number;
  sweepPoints?: Array<{ x: number; y: number }>;
  sweepRadius?: number;
}

export interface ReconProbabilityInput {
  contacts: NavalContact[];
  airOperations?: ReconAirOperationSnapshot[];
  searchMissions?: NavalAirMission[];
  currentTurn: number;
  weather?: string;
  ownPosition?: { x: number; y: number };
}

export interface ReconCloudAssessment {
  summary: string;
  clouds: ReconProbabilityCloud[];
  recommendedSearches: string[];
  staleContactIds: string[];
}

export function buildReconProbabilityClouds(input: ReconProbabilityInput): ReconProbabilityCloud[] {
  const clouds: ReconProbabilityCloud[] = [];
  const weatherFactor = weatherSearchFactor(input.weather);

  for (const contact of input.contacts) {
    if (contact.detectionLevel === 'none' || contact.detectionLevel === 'lost') continue;
    const ageTurns = Math.max(0, input.currentTurn - contact.lastDetectedTurn);
    const freshness = clamp01(1 - ageTurns / 7);
    const baseProbability = detectionLevelProbability(contact.detectionLevel);
    const confidenceFactor = contact.confidence === 'high' ? 1 : contact.confidence === 'medium' ? 0.86 : 0.68;
    const probability = clamp01(baseProbability * confidenceFactor * (0.55 + freshness * 0.45) * (0.9 + weatherFactor * 0.1));
    const uncertaintyGrowth = 14 + ageTurns * (contact.confidence === 'high' ? 12 : contact.confidence === 'medium' ? 18 : 26);
    const radius = Math.max(18, contact.uncertaintyRadius + uncertaintyGrowth);
    const strikeLegal = isStrikeLegalLevel(contact.detectionLevel);
    const bearingDeg = input.ownPosition
      ? navalBearing(input.ownPosition.x, input.ownPosition.y, contact.lastKnownPosition.x, contact.lastKnownPosition.y)
      : undefined;

    clouds.push({
      id: `contact_cloud_${contact.id}`,
      kind: 'contact_probability',
      sourceId: contact.id,
      label: `${contact.estimatedClass || 'unknown'} ${Math.round(probability * 100)}%`,
      center: { ...contact.lastKnownPosition },
      radiusX: Math.round(radius * (1.1 + (1 - freshness) * 0.45)),
      radiusY: Math.round(radius * (0.78 + (1 - confidenceFactor) * 0.35)),
      bearingDeg,
      probability,
      confidence: probability >= 0.72 ? 'high' : probability >= 0.48 ? 'medium' : 'low',
      freshness,
      ageTurns,
      risk: probability >= 0.66 && strikeLegal ? 'high' : probability >= 0.42 ? 'medium' : 'low',
      recommendation: strikeLegal
        ? `Strike legal if aircraft and route permit; window ${Math.max(1, 4 - ageTurns)} turn(s) before uncertainty blooms.`
        : `Do not strike yet; shadow or launch a refining search across this cloud.`,
      strikeWindowTurns: strikeLegal ? Math.max(1, 4 - ageTurns) : undefined,
    });
  }

  for (const operation of input.airOperations || []) {
    if (operation.type !== 'search' || operation.status === 'preparing' || operation.status === 'recovered') continue;
    const planePosition = operation.x !== undefined && operation.y !== undefined
      ? { x: operation.x, y: operation.y }
      : operation.originX !== undefined && operation.originY !== undefined
        ? { x: operation.originX, y: operation.originY }
        : undefined;
    if (!planePosition) continue;
    const heading = normalizeHeading(operation.heading ?? 0);
    const routeRange = operation.range ?? (distance(planePosition, { x: operation.targetX ?? planePosition.x, y: operation.targetY ?? planePosition.y }) || 120);
    const range = Math.max(42, Math.min(160, operation.sweepRadius ?? (42 + Math.sqrt(Math.max(1, operation.aircraft ?? 1)) * 16 + routeRange * 0.06)));
    const arcWidth = Math.max(24, Math.min(90, operation.arcWidthDeg ?? 36));
    clouds.push(createSearchCoverageCloud({
      sourceId: operation.id,
      label: `${operation.fleetName || 'Air search'} team ${operation.teamIndex !== undefined ? operation.teamIndex + 1 : 1}/${operation.teamCount ?? 1} ${operation.status || 'outbound'}`,
      origin: planePosition,
      path: operation.sweepPoints && operation.sweepPoints.length > 0 ? operation.sweepPoints : [planePosition],
      heading,
      arcWidth,
      range,
      aircraftCount: operation.aircraft ?? 2,
      weatherFactor,
      status: operation.status,
      ageTurns: 0,
    }));
  }

  const operationIds = new Set((input.airOperations || []).map((operation) => operation.id));
  for (const mission of input.searchMissions || []) {
    if (
      mission.type !== 'search' ||
      operationIds.has(mission.id) ||
      mission.status === 'preparing' ||
      mission.status === 'recovered' ||
      mission.status === 'lost'
    ) continue;
    const origin = mission.originPosition || (mission.targetArea && mission.searchArcDeg
      ? reversePointOnBearing(mission.targetArea, mission.searchArcDeg.centerDeg, mission.searchArcDeg.range)
      : undefined);
    if (!origin || !mission.searchArcDeg) continue;
    clouds.push(createSearchCoverageCloud({
      sourceId: mission.id,
      label: `Mission ${mission.status}`,
      origin,
      heading: normalizeHeading(mission.searchArcDeg.centerDeg),
      arcWidth: Math.max(20, Math.min(180, mission.searchArcDeg.widthDeg)),
      range: Math.max(40, mission.searchArcDeg.range),
      aircraftCount: mission.aircraftCount,
      weatherFactor,
      status: mission.status,
      ageTurns: Math.max(0, 2 - mission.etaTurns),
    }));
  }

  return clouds.sort((a, b) => {
    const kindOrder = a.kind === b.kind ? 0 : a.kind === 'search_coverage' ? -1 : 1;
    return kindOrder || b.probability - a.probability;
  });
}

export function summarizeReconClouds(clouds: ReconProbabilityCloud[]): ReconCloudAssessment {
  const contactClouds = clouds.filter((cloud) => cloud.kind === 'contact_probability');
  const searchClouds = clouds.filter((cloud) => cloud.kind === 'search_coverage');
  const highRisk = contactClouds.filter((cloud) => cloud.risk === 'high');
  const staleContactIds = contactClouds
    .filter((cloud) => cloud.freshness < 0.45 || cloud.radiusX > 130)
    .map((cloud) => cloud.sourceId);
  const recommendedSearches = contactClouds
    .filter((cloud) => cloud.risk !== 'high' || cloud.confidence !== 'high')
    .slice(0, 4)
    .map((cloud) => `refine ${cloud.sourceId} around (${Math.round(cloud.center.x)},${Math.round(cloud.center.y)}) radius ${Math.round(Math.max(cloud.radiusX, cloud.radiusY))}`);

  return {
    summary: `${contactClouds.length} contact probability cloud(s), ${searchClouds.length} active search coverage cloud(s), ${highRisk.length} high-risk strike/shadow candidate(s).`,
    clouds: clouds.slice(0, 10),
    recommendedSearches,
    staleContactIds,
  };
}

function createSearchCoverageCloud(params: {
  sourceId: string;
  label: string;
  origin: { x: number; y: number };
  path?: Array<{ x: number; y: number }>;
  heading: number;
  arcWidth: number;
  range: number;
  aircraftCount: number;
  weatherFactor: number;
  status?: string;
  ageTurns: number;
}): ReconProbabilityCloud {
  const statusFactor =
    params.status === 'searching' ? 0.88 :
    params.status === 'turning_home' || params.status === 'returning' ? 0.58 :
    params.status === 'en_route' || params.status === 'outbound' || params.status === 'launched' ? 0.62 :
    0.5;
  const aircraftFactor = clamp01(0.36 + params.aircraftCount * 0.08);
  const arcEfficiency = clamp01(1.08 - params.arcWidth / 240);
  const probability = clamp01(statusFactor * aircraftFactor * arcEfficiency * params.weatherFactor);
  const path = params.path && params.path.length > 0 ? params.path : [params.origin];
  const center = path[path.length - 1] ?? pointOnBearing(params.origin, params.heading, params.range * 0.58);
  const lateralSpread = Math.max(24, Math.sin((params.arcWidth / 2) * Math.PI / 180) * params.range * 0.55);

  return {
    id: `search_cloud_${params.sourceId}`,
    kind: 'search_coverage',
    sourceId: params.sourceId,
    label: `${Math.round(probability * 100)}% coverage`,
    center,
    origin: params.origin,
    path,
    radiusX: Math.round(Math.max(34, params.range)),
    radiusY: Math.round(lateralSpread),
    bearingDeg: params.heading,
    arcWidthDeg: params.arcWidth,
    range: params.range,
    probability,
    confidence: probability >= 0.62 ? 'high' : probability >= 0.38 ? 'medium' : 'low',
    freshness: params.status === 'turning_home' || params.status === 'returning' ? 0.65 : 0.9,
    ageTurns: params.ageTurns,
    risk: 'low',
    recommendation: `Aircraft-local sensor footprint; coverage moves with the search group until it returns or reports negative.`,
  };
}

function detectionLevelProbability(level: NavalContact['detectionLevel']): number {
  switch (level) {
    case 'tracked': return 0.94;
    case 'identified': return 0.88;
    case 'classified': return 0.78;
    case 'detected': return 0.62;
    case 'suspected': return 0.42;
    default: return 0.16;
  }
}

function isStrikeLegalLevel(level: NavalContact['detectionLevel'] | string): boolean {
  return level === 'tracked' || level === 'identified' || level === 'classified' || level === 'confirmed';
}

function weatherSearchFactor(weather?: string): number {
  switch (weather) {
    case 'clear': return 1;
    case 'rain': return 0.74;
    case 'squall': return 0.52;
    case 'fog': return 0.28;
    case 'storm': return 0.18;
    default: return 0.86;
  }
}

function pointOnBearing(origin: { x: number; y: number }, heading: number, range: number): { x: number; y: number } {
  const rad = heading * Math.PI / 180;
  return {
    x: Math.round(origin.x + Math.sin(rad) * range),
    y: Math.round(origin.y - Math.cos(rad) * range),
  };
}

function reversePointOnBearing(point: { x: number; y: number }, heading: number, range: number): { x: number; y: number } {
  const rad = heading * Math.PI / 180;
  return {
    x: Math.round(point.x - Math.sin(rad) * range),
    y: Math.round(point.y + Math.cos(rad) * range),
  };
}

function navalBearing(fromX: number, fromY: number, toX: number, toY: number): number {
  return normalizeHeading(Math.atan2(toX - fromX, fromY - toY) * 180 / Math.PI);
}

function normalizeHeading(heading: number): number {
  return ((heading % 360) + 360) % 360;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
