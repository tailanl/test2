import type { LLMDecisionAction } from '../../../ai/llm-decision-types';
import type { StrategicFleet } from '../naval-strategic-types';
import type { NavalContact } from '../intel/naval-intel-types';

export type HumanCommandInterpretationLevel =
  | 'direct_ship_control'
  | 'fleet_tactical'
  | 'fleet_operational'
  | 'strategic_template';

export type HumanSpecialOrder =
  | {
      type: 'split_fleet';
      sourceFleetId: string;
      shipIds: string[];
      newFleetName?: string;
    }
  | {
      type: 'direct_ship_control';
      fleetId: string;
      shipId: string;
      headingDeg?: number;
      speedKts?: number;
      targetPosition?: { x: number; y: number };
      reason: string;
    }
  | {
      type: 'delegate_ai';
      fleetId: string;
      template: 'search_screen' | 'carrier_strike' | 'withdraw_preserve' | 'surface_intercept' | 'hold_defense';
    }
  | {
      type: 'assign_objective';
      fleetIds: string[];
      objective: 'annihilate_enemy' | 'seek_decisive_battle' | 'destroy_enemy_carriers';
      reason: string;
    }
  | {
      type: 'fleet_message';
      fromFleetId: string;
      toFleetId: string;
      message: string;
    };

type SplitFleetOrder = Extract<HumanSpecialOrder, { type: 'split_fleet' }>;
type DirectShipControlOrder = Extract<HumanSpecialOrder, { type: 'direct_ship_control' }>;
type FleetMessageOrder = Extract<HumanSpecialOrder, { type: 'fleet_message' }>;
type ObjectiveOrder = Extract<HumanSpecialOrder, { type: 'assign_objective' }>;

export interface HumanCommandInterpretation {
  interpretationLevel: HumanCommandInterpretationLevel;
  actions: LLMDecisionAction[];
  specialOrders: HumanSpecialOrder[];
  requiresConfirmation: boolean;
  warnings: string[];
  errors: string[];
  summary: string;
}

export interface HumanCommandReceipt extends HumanCommandInterpretation {
  id: string;
  turn: number;
  text: string;
  fleetIds: string[];
  accepted: boolean;
  resultSummary?: string;
}

export interface HumanPendingAuthorization {
  id: string;
  turn: number;
  title: string;
  question: string;
  yesLabel: string;
  noLabel: string;
  receipt: HumanCommandReceipt;
}

export interface FleetCommunicationMessage {
  id: string;
  turn: number;
  fromFleetId: string;
  toFleetId: string;
  message: string;
  deliveredTurn?: number;
  status: 'queued' | 'delivered';
}

export function interpretHumanNavalCommand(params: {
  text: string;
  fleetIds: string[];
  fleets: StrategicFleet[];
  contacts: NavalContact[];
  facilities: Array<{ id: string; faction?: string; owner?: string; type?: string; x?: number; y?: number; name?: string }>;
  currentTurn: number;
  allowAnyFaction?: boolean;
}): HumanCommandInterpretation {
  const text = params.text.trim();
  const lower = text.toLowerCase();
  const warnings: string[] = [];
  const errors: string[] = [];
  const actions: LLMDecisionAction[] = [];
  const specialOrders: HumanSpecialOrder[] = [];
  const selectedFleets = params.fleets.filter((fleet) =>
    params.fleetIds.includes(fleet.id) && (params.allowAnyFaction || fleet.faction === 'player')
  );

  if (!text) {
    return {
      interpretationLevel: 'fleet_tactical',
      actions,
      specialOrders,
      requiresConfirmation: false,
      warnings,
      errors: ['Empty command'],
      summary: 'No command text supplied.',
    };
  }

  if (selectedFleets.length === 0) {
    errors.push('No player fleet selected for command.');
  }

  const confirmationRequested = /\b(confirm|execute|yes|now|immediate)\b|确认|执行|立即|同意/.test(lower);
  const headingDeg = parseHeading(text);
  const speedKts = parseSpeed(text);
  const coordinate = parseCoordinate(text);
  const directionHeading = headingDeg ?? parseDirectionHeading(lower);
  const targetContact = findMentionedContact(text, params.contacts) ?? bestKnownContact(params.contacts);
  const nearestFriendlyBase = selectedFleets[0]
    ? findNearestFriendlyBase(params.facilities, selectedFleets[0])
    : undefined;

  const objectiveOrder = tryBuildObjectiveOrder({ text, lower, selectedFleets });
  if (objectiveOrder) {
    specialOrders.push(objectiveOrder);
    return {
      interpretationLevel: 'strategic_template',
      actions,
      specialOrders,
      requiresConfirmation: false,
      warnings,
      errors,
      summary: `Assigned objective ${objectiveOrder.objective} to ${objectiveOrder.fleetIds.length} fleet(s).`,
    };
  }

  const splitOrder = tryBuildSplitOrder({ text, lower, selectedFleets });
  if (splitOrder) {
    specialOrders.push(splitOrder);
    return {
      interpretationLevel: 'fleet_operational',
      actions,
      specialOrders,
      requiresConfirmation: !confirmationRequested,
      warnings,
      errors,
      summary: `Detach ${splitOrder.shipIds.length} ship(s) from ${splitOrder.sourceFleetId}.`,
    };
  }

  const directOrder = tryBuildDirectShipOrder({ text, lower, selectedFleets, headingDeg, speedKts, coordinate, directionHeading });
  if (directOrder) {
    specialOrders.push(directOrder);
    return {
      interpretationLevel: 'direct_ship_control',
      actions,
      specialOrders,
      requiresConfirmation: false,
      warnings,
      errors,
      summary: `Direct control order for ${directOrder.shipId}.`,
    };
  }

  const messageOrder = tryBuildFleetMessage({ text, lower, selectedFleets, fleets: params.fleets });
  if (messageOrder) {
    specialOrders.push(messageOrder);
    return {
      interpretationLevel: 'fleet_operational',
      actions,
      specialOrders,
      requiresConfirmation: false,
      warnings,
      errors,
      summary: 'Fleet communication queued.',
    };
  }

  const template = parseDelegationTemplate(lower);
  if (template && selectedFleets[0]) {
    specialOrders.push({ type: 'delegate_ai', fleetId: selectedFleets[0].id, template });
    return {
      interpretationLevel: 'strategic_template',
      actions,
      specialOrders,
      requiresConfirmation: false,
      warnings,
      errors,
      summary: `Delegated ${template} template to ${selectedFleets[0].name}.`,
    };
  }

  for (const fleet of selectedFleets) {
    const baseAction = {
      fleetId: fleet.id,
      priority: 1,
      reason: text,
    };

    if (/prepare strike|ready strike|deck cycle|rearm strike/.test(lower)) {
      actions.push({
        ...baseAction,
        type: 'prepare_strike',
        aircraftCount: parseAircraftCount(text),
        durationTurns: parseDuration(text) ?? 1,
      });
      continue;
    }

    if (/recover aircraft|recover planes|clear deck|recovery cycle/.test(lower)) {
      actions.push({
        ...baseAction,
        type: 'recover_aircraft',
        durationTurns: parseDuration(text) ?? 1,
      });
      continue;
    }

    if (/vector cap|fighter direction|direct fighters|vector fighters/.test(lower)) {
      actions.push({
        ...baseAction,
        type: 'vector_cap',
        contactId: targetContact?.id,
        targetPosition: coordinate ?? targetContact?.lastKnownPosition ?? projectFromFleet(fleet, directionHeading ?? fleet.ships[0]?.headingDeg ?? 270, parseDistance(text) ?? 120),
        durationTurns: parseDuration(text) ?? 1,
      });
      continue;
    }

    if (/cap|combat air patrol|防空|空中巡逻/.test(lower)) {
      actions.push({
        ...baseAction,
        type: 'launch_cap',
        targetPosition: coordinate ?? { x: fleet.position.globalX, y: fleet.position.globalY },
        aircraftCount: parseAircraftCount(text) ?? 4,
        durationTurns: parseDuration(text) ?? 2,
      });
      continue;
    }

    if (/lay smoke|smoke screen|make smoke|screen with smoke/.test(lower)) {
      actions.push({
        ...baseAction,
        type: 'lay_smoke',
        durationTurns: parseDuration(text) ?? 1,
      });
      continue;
    }

    if (/radio silence|emcon|silent running|hold transmissions/.test(lower)) {
      actions.push({
        ...baseAction,
        type: 'radio_silence',
        durationTurns: parseDuration(text) ?? 2,
      });
      continue;
    }

    if (/surface engage|surface action|gun action|engage surface|close to gun range/.test(lower)) {
      if (!targetContact) {
        errors.push('Surface engagement command needs a known contact.');
        continue;
      }
      actions.push({
        ...baseAction,
        type: 'surface_engage',
        contactId: targetContact.id,
        durationTurns: parseDuration(text) ?? 1,
      });
      continue;
    }

    if (/torpedo attack|launch torpedoes|torpedo run|night torpedo/.test(lower)) {
      if (!targetContact) {
        errors.push('Torpedo attack command needs a known contact.');
        continue;
      }
      actions.push({
        ...baseAction,
        type: 'launch_torpedo_attack',
        contactId: targetContact.id,
        durationTurns: parseDuration(text) ?? 1,
      });
      continue;
    }

    if (/shore bombard|bombard airfield|bombard base|bombard island|naval bombardment/.test(lower)) {
      actions.push({
        ...baseAction,
        type: 'bombard_airfield',
        contactId: targetContact?.id,
        targetPosition: coordinate ?? targetContact?.lastKnownPosition,
        durationTurns: parseDuration(text) ?? 1,
      });
      continue;
    }

    if (/replenish at sea|underway replenishment|replenish|refuel at sea/.test(lower)) {
      actions.push({
        ...baseAction,
        type: 'replenish_at_sea',
        durationTurns: parseDuration(text) ?? 2,
      });
      continue;
    }

    if (/transport run|convoy run|troop run|supply run/.test(lower)) {
      actions.push({
        ...baseAction,
        type: 'run_transport',
        targetPosition: coordinate ?? nearestFriendlyBase,
        baseId: coordinate ? undefined : nearestFriendlyBase?.baseId,
        durationTurns: parseDuration(text) ?? 2,
      });
      continue;
    }

    if (/strike|attack|打击|攻击|空袭/.test(lower)) {
      if (!targetContact) {
        errors.push('Strike command needs a known contact.');
        continue;
      }
      actions.push({
        ...baseAction,
        type: 'launch_strike',
        contactId: targetContact.id,
        aircraftCount: parseAircraftCount(text) ?? 8,
      });
      continue;
    }

    if (/withdraw|retreat|撤退|脱离|返航/.test(lower)) {
      actions.push({
        ...baseAction,
        type: 'withdraw_fleet',
        targetPosition: coordinate ?? nearestFriendlyBase,
      });
      continue;
    }

    if (/repair|resupply|修理|维修|补给/.test(lower)) {
      const base = nearestFriendlyBase;
      if (!base) {
        errors.push('Repair command needs a known friendly base.');
        continue;
      }
      actions.push({
        ...baseAction,
        type: 'repair_fleet',
        baseId: base.baseId,
      });
      continue;
    }

    if (/hold|defend|保持|坚守|原地/.test(lower)) {
      actions.push({
        ...baseAction,
        type: 'hold_position',
      });
      continue;
    }

    const wantsSearch = /search|recon|scout|侦察|搜索|搜寻/.test(lower);
    if (!wantsSearch && (/move|course|heading|proceed|go to|机动|移动|前往|航向|转向/.test(lower) || coordinate || directionHeading !== undefined)) {
      const targetPosition = coordinate ?? projectFromFleet(fleet, directionHeading ?? fleet.ships[0]?.headingDeg ?? 270, parseDistance(text) ?? 140);
      actions.push({
        ...baseAction,
        type: 'move_fleet',
        targetPosition,
        headingDeg: directionHeading,
        speedKts,
      });
      continue;
    }

    if (wantsSearch || actions.length === 0) {
      const searchHeading = directionHeading ?? bearingToContact(fleet, targetContact) ?? fleet.ships[0]?.headingDeg ?? 270;
      const targetPosition = coordinate ?? (targetContact ? targetContact.lastKnownPosition : projectFromFleet(fleet, searchHeading, parseDistance(text) ?? 180));
      actions.push({
        ...baseAction,
        type: 'launch_search',
        targetPosition,
        aircraftCount: parseAircraftCount(text) ?? 4,
        searchArcDeg: {
          centerDeg: normalizeHeading(searchHeading),
          widthDeg: parseArcWidth(text) ?? 70,
          range: parseDistance(text) ?? 180,
        },
      });
    }
  }

  const highRisk = actions.some((action) =>
    action.type === 'launch_strike' ||
    action.type === 'intercept_contact' ||
    action.type === 'surface_engage' ||
    action.type === 'launch_torpedo_attack' ||
    action.type === 'bombard_airfield'
  );
  return {
    interpretationLevel: highRisk ? 'fleet_operational' : 'fleet_tactical',
    actions,
    specialOrders,
    requiresConfirmation: highRisk && !confirmationRequested,
    warnings,
    errors,
    summary: actions.length > 0
      ? `Interpreted ${actions.length} action(s): ${actions.map((action) => action.type).join(', ')}.`
      : 'No executable action found.',
  };
}

function tryBuildSplitOrder(params: {
  text: string;
  lower: string;
  selectedFleets: StrategicFleet[];
}): SplitFleetOrder | undefined {
  if (!/split|detach|separate|分离|拆分|分舰队|脱离/.test(params.lower)) return undefined;
  const fleet = params.selectedFleets[0];
  if (!fleet) return undefined;
  const shipIds = matchShipsInText(params.text, fleet);
  const fallback = shipIds.length > 0
    ? shipIds
    : fleet.ships.filter((ship) => /destroyer|dd|驱逐/.test(params.lower) && ship.shipClass === 'destroyer').slice(0, 1).map((ship) => ship.id);
  if (fallback.length === 0) return undefined;
  return {
    type: 'split_fleet',
    sourceFleetId: fleet.id,
    shipIds: fallback,
    newFleetName: 'Detached Element',
  };
}

function tryBuildObjectiveOrder(params: {
  text: string;
  lower: string;
  selectedFleets: StrategicFleet[];
}): ObjectiveOrder | undefined {
  if (!/(annihilate|destroy|decisive battle|seek battle|seek decisive|歼灭|消灭|摧毁|决战|寻求决战)/i.test(params.text)) {
    return undefined;
  }
  const fleetIds = params.selectedFleets.map((fleet) => fleet.id);
  if (fleetIds.length === 0) return undefined;
  const objective = /(carrier|cv|航母|航空母舰)/i.test(params.text)
    ? 'destroy_enemy_carriers'
    : /(decisive battle|seek battle|seek decisive|决战|寻求决战)/i.test(params.text)
      ? 'seek_decisive_battle'
      : 'annihilate_enemy';
  return {
    type: 'assign_objective',
    fleetIds,
    objective,
    reason: params.text,
  };
}

function tryBuildDirectShipOrder(params: {
  text: string;
  lower: string;
  selectedFleets: StrategicFleet[];
  headingDeg?: number;
  speedKts?: number;
  coordinate?: { x: number; y: number };
  directionHeading?: number;
}): DirectShipControlOrder | undefined {
  if (!/direct|manual|control ship|接管|单舰|直接控制/.test(params.lower)) return undefined;
  for (const fleet of params.selectedFleets) {
    const shipId = matchShipsInText(params.text, fleet)[0] ?? fleet.ships[0]?.id;
    if (!shipId) continue;
    return {
      type: 'direct_ship_control',
      fleetId: fleet.id,
      shipId,
      headingDeg: params.headingDeg ?? params.directionHeading,
      speedKts: params.speedKts,
      targetPosition: params.coordinate,
      reason: params.text,
    };
  }
  return undefined;
}

function tryBuildFleetMessage(params: {
  text: string;
  lower: string;
  selectedFleets: StrategicFleet[];
  fleets: StrategicFleet[];
}): FleetMessageOrder | undefined {
  if (!/message|signal|communicate|通信|通知|电告/.test(params.lower)) return undefined;
  const from = params.selectedFleets[0];
  if (!from) return undefined;
  const to = params.fleets.find((fleet) => fleet.id !== from.id && fleet.faction === from.faction);
  if (!to) return undefined;
  return {
    type: 'fleet_message',
    fromFleetId: from.id,
    toFleetId: to.id,
    message: params.text,
  };
}

function parseDelegationTemplate(lower: string): 'search_screen' | 'carrier_strike' | 'withdraw_preserve' | 'surface_intercept' | 'hold_defense' | undefined {
  if (!/delegate|template|交给ai|委托|战术模板|战略模板/.test(lower)) return undefined;
  if (/strike|打击|攻击/.test(lower)) return 'carrier_strike';
  if (/withdraw|撤退|保存/.test(lower)) return 'withdraw_preserve';
  if (/intercept|截击|拦截/.test(lower)) return 'surface_intercept';
  if (/hold|defend|防御|坚守/.test(lower)) return 'hold_defense';
  return 'search_screen';
}

function matchShipsInText(text: string, fleet: StrategicFleet): string[] {
  const lower = text.toLowerCase();
  return fleet.ships
    .filter((ship) => lower.includes(ship.name.toLowerCase()) || lower.includes(ship.id.toLowerCase()))
    .map((ship) => ship.id);
}

function findMentionedContact(text: string, contacts: NavalContact[]): NavalContact | undefined {
  const lower = text.toLowerCase();
  return contacts.find((contact) =>
    lower.includes(contact.id.toLowerCase()) ||
    (!!contact.estimatedClass && lower.includes(String(contact.estimatedClass).toLowerCase()))
  );
}

function bestKnownContact(contacts: NavalContact[]): NavalContact | undefined {
  const ranked = ['tracked', 'identified', 'classified', 'detected', 'suspected'];
  return [...contacts].sort((a, b) => ranked.indexOf(a.detectionLevel) - ranked.indexOf(b.detectionLevel))[0];
}

function parseHeading(text: string): number | undefined {
  const match = text.match(/(?:heading|course|hdg|航向|转向)\s*([0-9]{1,3})/i);
  if (!match) return undefined;
  return normalizeHeading(Number(match[1]));
}

function parseSpeed(text: string): number | undefined {
  const match = text.match(/(?:speed|kts|knots|航速|速度)\s*([0-9]{1,2})/i);
  if (!match) return undefined;
  return Math.max(0, Math.min(40, Number(match[1])));
}

function parseDistance(text: string): number | undefined {
  const match = text.match(/(?:range|distance|dist|距离|推进)\s*([0-9]{1,4})/i);
  if (!match) return undefined;
  return Math.max(10, Math.min(600, Number(match[1])));
}

function parseAircraftCount(text: string): number | undefined {
  const match = text.match(/([0-9]{1,2})\s*(?:aircraft|planes|fighters|bombers|架|机)/i);
  if (!match) return undefined;
  return Math.max(1, Math.min(36, Number(match[1])));
}

function parseDuration(text: string): number | undefined {
  const match = text.match(/([0-9]{1,2})\s*(?:turns|turn|回合)/i);
  if (!match) return undefined;
  return Math.max(1, Math.min(12, Number(match[1])));
}

function parseArcWidth(text: string): number | undefined {
  const match = text.match(/(?:arc|width|扇面|扇区)\s*([0-9]{1,3})/i);
  if (!match) return undefined;
  return Math.max(20, Math.min(180, Number(match[1])));
}

function parseCoordinate(text: string): { x: number; y: number } | undefined {
  const match = text.match(/(?:\(|\[)?\s*([0-9]{2,5})\s*[,，]\s*([0-9]{2,5})\s*(?:\)|\])?/);
  if (!match) return undefined;
  return { x: Number(match[1]), y: Number(match[2]) };
}

function parseDirectionHeading(lower: string): number | undefined {
  if (/north|北/.test(lower)) {
    if (/east|东/.test(lower)) return 45;
    if (/west|西/.test(lower)) return 315;
    return 0;
  }
  if (/south|南/.test(lower)) {
    if (/east|东/.test(lower)) return 135;
    if (/west|西/.test(lower)) return 225;
    return 180;
  }
  if (/east|东/.test(lower)) return 90;
  if (/west|西/.test(lower)) return 270;
  return undefined;
}

function projectFromFleet(fleet: StrategicFleet, headingDeg: number, distance: number): { x: number; y: number } {
  const rad = normalizeHeading(headingDeg) * Math.PI / 180;
  return {
    x: Math.round(fleet.position.globalX + Math.sin(rad) * distance),
    y: Math.round(fleet.position.globalY - Math.cos(rad) * distance),
  };
}

function bearingToContact(fleet: StrategicFleet, contact?: NavalContact): number | undefined {
  if (!contact) return undefined;
  return normalizeHeading(Math.atan2(
    contact.lastKnownPosition.x - fleet.position.globalX,
    fleet.position.globalY - contact.lastKnownPosition.y,
  ) * 180 / Math.PI);
}

function findNearestFriendlyBase(
  facilities: Array<{ id: string; faction?: string; owner?: string; x?: number; y?: number }>,
  fleet: StrategicFleet,
): { x: number; y: number; baseId: string } | undefined {
  const bases = facilities.filter((base) => base.faction === fleet.faction || base.owner === fleet.faction);
  if (bases.length === 0) return undefined;
  const nearest = bases.reduce((best, current) => {
    const bestDist = Math.hypot((best.x ?? 0) - fleet.position.globalX, (best.y ?? 0) - fleet.position.globalY);
    const currentDist = Math.hypot((current.x ?? 0) - fleet.position.globalX, (current.y ?? 0) - fleet.position.globalY);
    return currentDist < bestDist ? current : best;
  });
  return { x: nearest.x ?? fleet.position.globalX, y: nearest.y ?? fleet.position.globalY, baseId: nearest.id };
}

function normalizeHeading(value: number): number {
  return Math.round(((value % 360) + 360) % 360);
}
