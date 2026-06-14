import type { NavalAIAction } from '../game/naval/ai/naval-ai-types';
import type { NavalContact } from '../game/naval/intel/naval-intel-types';
import type { StrategicFleet } from '../game/naval/naval-strategic-types';

export type CampaignIntent = 'search' | 'strike' | 'screen' | 'withdraw' | 'hold';

export interface CampaignLLMOrder {
  intent?: CampaignIntent;
  headingDeg?: number;
  speedKts?: number;
  targetContactId?: string;
  reason?: string;
}

export interface CampaignLLMDecision {
  situation: string;
  orders: CampaignLLMOrder[];
  notes?: string;
}

export interface CampaignPolicyState {
  turn: number;
  playerFleet?: StrategicFleet;
  contacts: NavalContact[];
}

const TRACKABLE_LEVELS = new Set(['classified', 'identified', 'tracked']);
const SEARCHABLE_LEVELS = new Set(['suspected', 'detected']);

export const CAMPAIGN_JSON_PROMPT = `You command a WWII carrier task force, but you are only an advisor.
Return JSON only. Do not include markdown.

Allowed JSON:
{
  "situation": "one short assessment",
  "orders": [
    {
      "intent": "search|strike|screen|withdraw|hold",
      "headingDeg": 0,
      "speedKts": 20,
      "targetContactId": "contact id from the input, only if known",
      "reason": "short reason"
    }
  ],
  "notes": "optional"
}

Rules:
- You cannot know hidden enemy fleet positions. Use only contacts listed in the input.
- If there are no contacts, choose search. Do not strike.
- If contacts are only suspected or detected, search toward the contact. Do not strike.
- Strike only contacts whose level is classified, identified, or tracked.
- Carrier task forces avoid surface gun range. If a contact is within 30 map units, withdraw or screen.
- Keep speed between 12 and 30 knots. Keep heading between 0 and 359 degrees.`;

export function parseCampaignDecision(raw: string): CampaignLLMDecision | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as Partial<CampaignLLMDecision>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      situation: typeof parsed.situation === 'string' ? parsed.situation : 'No usable assessment.',
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
    };
  } catch {
    return null;
  }
}

export function getRuleBasedCampaignDecision(state: CampaignPolicyState): CampaignLLMDecision {
  const tracked = state.contacts.filter((c) => TRACKABLE_LEVELS.has(c.detectionLevel));
  const weak = state.contacts.filter((c) => SEARCHABLE_LEVELS.has(c.detectionLevel));

  if (tracked.length > 0) {
    const target = closestContact(state.playerFleet, tracked);
    return {
      situation: `${tracked.length} reliable contact(s). Launch a carrier strike while screening the force.`,
      orders: [{ intent: 'strike', targetContactId: target?.id, reason: 'Reliable contact available for strike.' }],
    };
  }

  if (weak.length > 0) {
    const target = closestContact(state.playerFleet, weak);
    return {
      situation: `${weak.length} uncertain contact(s). Search to improve the track before attacking.`,
      orders: [{ intent: 'search', targetContactId: target?.id, reason: 'Contact is not accurate enough for a strike.' }],
    };
  }

  return {
    situation: 'No enemy contacts. Launch sector search and keep the carrier force at cruising speed.',
    orders: [{ intent: 'search', headingDeg: defaultSearchHeading(state), speedKts: 20, reason: 'No contacts available.' }],
  };
}

export function normalizeCampaignDecision(
  decision: CampaignLLMDecision | null,
  state: CampaignPolicyState
): CampaignLLMDecision {
  const fallback = getRuleBasedCampaignDecision(state);
  const safeOrders = (decision?.orders || [])
    .map((order) => normalizeOrder(order, state))
    .filter((order): order is CampaignLLMOrder => order !== null)
    .slice(0, 4);

  if (safeOrders.length === 0) return fallback;

  return {
    situation: decision?.situation || fallback.situation,
    orders: safeOrders,
    notes: decision?.notes,
  };
}

export function campaignDecisionToActions(
  decision: CampaignLLMDecision,
  state: CampaignPolicyState
): NavalAIAction[] {
  const fleet = state.playerFleet;
  if (!fleet) return [];

  const carrier = fleet.ships.find((ship) => ship.shipClass.includes('carrier'));
  const flagship = carrier || fleet.ships[0];
  if (!flagship) return [];

  return decision.orders.flatMap((order, index): NavalAIAction[] => {
    const base = {
      id: `llm_policy_${state.turn}_${index}`,
      shipId: flagship.id,
      fleetId: fleet.id,
      reason: order.reason || `Campaign ${order.intent || 'hold'} order`,
      basedOnContactIds: order.targetContactId ? [order.targetContactId] : [],
    };

    if (order.intent === 'strike') {
      return [{
        ...base,
        type: 'launch_strike',
        targetContactId: order.targetContactId,
      }];
    }

    if (order.intent === 'search') {
      const targetPosition = getOrderTargetPosition(order, state);
      return [{
        ...base,
        type: 'launch_search',
        targetContactId: order.targetContactId,
        targetPosition,
        headingDeg: order.headingDeg,
      }];
    }

    if (order.intent === 'withdraw') {
      return [{
        ...base,
        type: 'withdraw',
      }];
    }

    if (order.intent === 'screen') {
      return [{
        ...base,
        type: 'change_speed',
        targetSpeedKts: clampSpeed(order.speedKts ?? 24),
      }];
    }

    return [{
      ...base,
      type: 'hold_fire',
    }];
  });
}

function normalizeOrder(order: CampaignLLMOrder, state: CampaignPolicyState): CampaignLLMOrder | null {
  const intent = order.intent;
  if (!intent) return null;

  const contact = order.targetContactId
    ? state.contacts.find((c) => c.id === order.targetContactId)
    : undefined;
  const tracked = state.contacts.filter((c) => TRACKABLE_LEVELS.has(c.detectionLevel));
  const weak = state.contacts.filter((c) => SEARCHABLE_LEVELS.has(c.detectionLevel));

  if (intent === 'strike') {
    const target = contact && TRACKABLE_LEVELS.has(contact.detectionLevel)
      ? contact
      : closestContact(state.playerFleet, tracked);
    if (!target) return null;
    return { intent: 'strike', targetContactId: target.id, reason: order.reason || 'Validated tracked contact strike.' };
  }

  if (intent === 'search') {
    const target = contact || closestContact(state.playerFleet, weak) || closestContact(state.playerFleet, tracked);
    return {
      intent: 'search',
      targetContactId: target?.id,
      headingDeg: normalizeHeading(order.headingDeg ?? headingToContact(state.playerFleet, target) ?? defaultSearchHeading(state)),
      speedKts: clampSpeed(order.speedKts ?? 20),
      reason: order.reason || 'Validated search order.',
    };
  }

  if (intent === 'screen' || intent === 'withdraw' || intent === 'hold') {
    return {
      intent,
      headingDeg: order.headingDeg === undefined ? undefined : normalizeHeading(order.headingDeg),
      speedKts: order.speedKts === undefined ? undefined : clampSpeed(order.speedKts),
      reason: order.reason,
    };
  }

  return null;
}

function closestContact(fleet: StrategicFleet | undefined, contacts: NavalContact[]): NavalContact | undefined {
  if (!fleet || contacts.length === 0) return contacts[0];
  return contacts.reduce((best, current) => {
    const bestDistance = distanceToFleet(fleet, best);
    const currentDistance = distanceToFleet(fleet, current);
    return currentDistance < bestDistance ? current : best;
  });
}

function distanceToFleet(fleet: StrategicFleet, contact: NavalContact): number {
  return Math.hypot(
    contact.lastKnownPosition.x - fleet.position.globalX,
    contact.lastKnownPosition.y - fleet.position.globalY
  );
}

function headingToContact(fleet: StrategicFleet | undefined, contact: NavalContact | undefined): number | undefined {
  if (!fleet || !contact) return undefined;
  const angle = Math.atan2(
    contact.lastKnownPosition.y - fleet.position.globalY,
    contact.lastKnownPosition.x - fleet.position.globalX
  ) * 180 / Math.PI;
  return normalizeHeading(angle);
}

function getOrderTargetPosition(
  order: CampaignLLMOrder,
  state: CampaignPolicyState
): { x: number; y: number } | undefined {
  const contact = order.targetContactId
    ? state.contacts.find((c) => c.id === order.targetContactId)
    : undefined;
  if (contact) return { ...contact.lastKnownPosition };

  const fleet = state.playerFleet;
  if (!fleet || order.headingDeg === undefined) return undefined;
  const rad = order.headingDeg * Math.PI / 180;
  return {
    x: Math.round(fleet.position.globalX + Math.cos(rad) * 160),
    y: Math.round(fleet.position.globalY + Math.sin(rad) * 160),
  };
}

function defaultSearchHeading(state: CampaignPolicyState): number {
  const x = state.playerFleet?.position.globalX ?? 0;
  return x > 0 ? 270 : 0;
}

function normalizeHeading(heading: number): number {
  return Math.round(((heading % 360) + 360) % 360);
}

function clampSpeed(speed: number): number {
  return Math.max(12, Math.min(30, Math.round(speed)));
}
