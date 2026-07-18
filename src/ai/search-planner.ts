/**
 * SearchPlanner - builds fleet-scale carrier search sectors from known intel.
 */

export interface SearchSector {
  heading: number;
  widthDeg: number;
  range: number;
  expectedValue: number;
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

  if (contacts.length > 0) {
    const nearest = contacts.reduce((a, b) => {
      const da = Math.hypot(a.lastKnownPosition.x - ownPosition.x, a.lastKnownPosition.y - ownPosition.y);
      const db = Math.hypot(b.lastKnownPosition.x - ownPosition.x, b.lastKnownPosition.y - ownPosition.y);
      return da < db ? a : b;
    });
    const bearingToContact = navalBearing(ownPosition.x, ownPosition.y, nearest.lastKnownPosition.x, nearest.lastKnownPosition.y);
    const rangeToContact = Math.hypot(nearest.lastKnownPosition.x - ownPosition.x, nearest.lastKnownPosition.y - ownPosition.y);
    const contactAge = Math.max(0, currentTurn - lastContactTurn);
    const uncertaintyWidth = Math.max(36, Math.min(110, nearest.uncertaintyRadius * 0.72 + contactAge * 12));
    const searchRange = Math.max(120, Math.min(650, rangeToContact + nearest.uncertaintyRadius + contactAge * 35));

    const sectors: SearchSector[] = [-uncertaintyWidth * 0.75, 0, uncertaintyWidth * 0.75].map((offset) => ({
      heading: normalizeHeading(bearingToContact + offset),
      widthDeg: Math.round(Math.max(30, Math.min(80, uncertaintyWidth))),
      range: Math.round(searchRange),
      expectedValue: offset === 0 ? 0.86 : 0.62,
      priority: offset === 0 ? 1 : 2,
      reason: `Refine contact uncertainty (+/-${nearest.uncertaintyRadius}, age ${contactAge})`,
    }));
    return {
      sectors,
      aircraftAllocation: sectors.length * 2,
      rationale: `Contact bearing ${bearingToContact.toFixed(0)} deg, uncertainty fan ${uncertaintyWidth.toFixed(0)} deg`,
    };
  }

  return {
    sectors: [
      { heading: 270, widthDeg: 55, range: 240, expectedValue: 0.56, priority: 1, reason: 'Standard search west toward likely enemy approach' },
      { heading: 315, widthDeg: 50, range: 220, expectedValue: 0.48, priority: 1, reason: 'Standard search northwest flank' },
      { heading: 225, widthDeg: 50, range: 220, expectedValue: 0.44, priority: 2, reason: 'Standard search southwest flank' },
    ],
    aircraftAllocation: 6,
    rationale: 'Default Western Pacific search pattern',
  };
}

function navalBearing(fromX: number, fromY: number, toX: number, toY: number): number {
  return normalizeHeading(Math.atan2(toX - fromX, fromY - toY) * 180 / Math.PI);
}

function normalizeHeading(heading: number): number {
  return ((heading % 360) + 360) % 360;
}
