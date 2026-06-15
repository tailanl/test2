/**
 * SearchPlanner - 根据已知情报规划最优搜索扇区
 */

export interface SearchSector {
  heading: number;
  widthDeg: number;
  priority: number;
  reason: string;
}

export interface SearchPlan {
  sectors: SearchSector[];
  aircraftAllocation: number;
  rationale: string;
}

export function generateSearchPlan(params: {
  contacts: Array<{ detectionLevel: string; lastKnownPosition: { x: number; y: number }; uncertaintyRadius: number }>;
  ownPosition: { x: number; y: number };
  lastContactTurn: number;
  currentTurn: number;
}): SearchPlan {
  const { contacts, ownPosition, currentTurn, lastContactTurn } = params;

  // 1. If we have contacts, search toward nearest contact
  if (contacts.length > 0) {
    const nearest = contacts.reduce((a, b) => {
      const da = Math.hypot(a.lastKnownPosition.x - ownPosition.x, a.lastKnownPosition.y - ownPosition.y);
      const db = Math.hypot(b.lastKnownPosition.x - ownPosition.x, b.lastKnownPosition.y - ownPosition.y);
      return da < db ? a : b;
    });
    const baseAngle = Math.atan2(nearest.lastKnownPosition.y - ownPosition.y, nearest.lastKnownPosition.x - ownPosition.x) * 180 / Math.PI;
    const adjustedAngle = ((baseAngle % 360) + 360) % 360;

    // Fan search toward contact
    const sectors: SearchSector[] = [];
    for (let offset = -45; offset <= 45; offset += 22.5) {
      sectors.push({
        heading: ((adjustedAngle + offset) % 360 + 360) % 360,
        widthDeg: 30,
        priority: Math.abs(offset) < 15 ? 1 : 2,
        reason: `Covering contact uncertainty (±${nearest.uncertaintyRadius})`,
      });
    }
    return { sectors, aircraftAllocation: sectors.length * 2, rationale: `Contact at ${adjustedAngle.toFixed(0)}°` };
  }

  // 2. No contacts - search based on doctrine: western Pacific for US
  return {
    sectors: [
      { heading: 270, widthDeg: 45, priority: 1, reason: 'Standard search west (toward Japan)' },
      { heading: 315, widthDeg: 45, priority: 1, reason: 'Standard search northwest' },
      { heading: 225, widthDeg: 45, priority: 2, reason: 'Standard search southwest' },
    ],
    aircraftAllocation: 6,
    rationale: 'Default Western Pacific search pattern',
  };
}
