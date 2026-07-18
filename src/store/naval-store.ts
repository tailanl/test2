/**
 * 娴峰啗妯″紡鐘舵�佺鐞?(Zustand)
 * 鐙珛娴锋垬绯荤粺 - 涓嶄緷璧?WorldAtlas / RegionTile
 */

import { create } from 'zustand';
import type { NavalCellOverlay, NavalEnvironmentState } from '../game/naval/naval-types';
import type {
  StrategicFleet,
  FleetAutomationPriority,
  FleetAutomationPriorities,
  FleetAutomationWorkType,
  FleetFormationState,
  FleetFormationType,
  FleetNavigationMode,
} from '../game/naval/naval-strategic-types';
import type { NavalShip, NavalShipClass } from '../game/naval/ship/ship-types';
import type { NavalIntelState, NavalContact } from '../game/naval/intel/naval-intel-types';
import type { NavalAIReport, NavalAIAction, NavalReportType } from '../game/naval/ai/naval-ai-types';
import { createDefaultReport } from '../game/naval/ai/naval-ai-types';
import type { NavalOperationView, NavalCombatViewport, NavalBattleMap } from '../game/naval/naval-types';
import type { NavalBattleLogEvent } from '../game/naval/ship/ship-damage';
import { generateStratMap } from '../game/naval/naval-map-adapter';
import type { NavalFacility, ShippingLane, IslandCenter, StratMapResult } from '../game/naval/naval-map-adapter';
import { buildFleetNavigationRoute, buildFleetNavigationRouteThroughWaypoints, clampPointToOverlay } from '../game/naval/naval-route-planner';
import { createDefaultIntelState } from '../game/naval/intel/naval-intel-types';
import { updateNavalIntelState } from '../game/naval/intel/naval-contact-tracker';
import { decayNavalContacts } from '../game/naval/intel/naval-contact-tracker';
import { generateFleetAIActions } from '../game/naval/ai/naval-fleet-ai';
import { generateTacticalAIActions } from '../game/naval/ai/naval-tactical-ai';
import { generateCarrierAIActions } from '../game/naval/ai/naval-carrier-ai';
import { generateNavalReports } from '../game/naval/ai/naval-report-generator';
import { executeNavalAIActions } from '../game/naval/ai/naval-action-executor';
import { updateShipMotion } from '../game/naval/ship/ship-motion';
import { applyNavalDamage } from '../game/naval/ship/ship-damage';
import { createShipForClass } from '../game/naval/naval-debug';
import { createCAPMission, createSearchMission, createStrikeMission, updateAirMissions, type CarrierAirGroup, type NavalAirMission } from '../game/naval/ship/ship-aircraft';
import { getNavalAdvice, parseNaturalCommand, buildNavalLLMContext } from '../ai/provider';
import type { NavalLLMAdvice, NavalLLMCommandResult, AIProviderConfig } from '../ai/types';
import { buildFactionKnowledge, sanitizeKnowledgeForLLM } from '../ai/information-filter';
import { validateLLMCommanderDecision } from '../ai/llm-decision-validator';
import { executeLLMDecisionActions } from '../ai/llm-decision-executor';
import { createRealStoreCalls } from '../ai/ai-turn-pipeline';
import {
  interpretHumanNavalCommand,
  type FleetCommunicationMessage,
  type HumanCommandReceipt,
  type HumanPendingAuthorization,
  type HumanSpecialOrder,
} from '../game/naval/command/human-command';
import type { LLMCommanderDecision } from '../ai/llm-decision-types';

// ===== Store State =====

interface NavalStoreState {
  navalMode: 'strategic' | 'operation' | 'combat';
  localMultiplayer: LocalMultiplayerState;

  overlay?: NavalCellOverlay[][];

  fleets: StrategicFleet[];

  selectedFleetId?: string;

  selectedOperationView?: NavalOperationView;

  selectedCombatViewport?: NavalCombatViewport;

  battleMap?: NavalBattleMap;

  facilities: NavalFacility[];
  shippingLanes: ShippingLane[];
  islands: IslandCenter[];
  tacticalMaps: StratMapResult['tacticalMaps'];
  airOperations: AirOperation[];
  landAirfields: Array<{ id: string; name: string; x: number; y: number; faction: 'player'|'enemy'; fighters: number; bombers: number; }>;
  weather: 'clear'|'rain'|'squall'|'fog'|'storm';
  victory: 'none'|'player'|'enemy';

  intel: NavalIntelState;

  reports: NavalAIReport[];
  commandHistory: HumanCommandReceipt[];
  pendingAuthorizations: HumanPendingAuthorization[];
  fleetCommunications: FleetCommunicationMessage[];

  currentTurn: number;

  environment: NavalEnvironmentState;

  battleLog: NavalBattleLogEvent[];

  // Map generation
  isCreatingScenario: boolean;
  autoTurnEnabled: boolean;
  autoDoctrineEnabled: boolean;
  autoPauseOnCritical: boolean;
  lastAutoPauseKey?: string;

  // LLM Advisor
  aiConfig: AIProviderConfig;
  aiAdvice?: NavalLLMAdvice;
  aiLoading: boolean;
  aiError?: string;

  // Actions
  createNavalScenario: () => void;
  selectFleet: (fleetId: string) => void;
  openNavalOperationView: (fleetId: string) => void;
  openNavalCombatView: (fleetId: string, contactId?: string) => void;
  submitNavalCommand: (text: string, fleetIds: string[]) => HumanCommandReceipt;
  confirmPendingDecision: (authorizationId: string, approved: boolean) => HumanCommandReceipt | undefined;
  splitFleet: (sourceFleetId: string, shipIds: string[], newFleetName?: string) => boolean;
  setShipDirectControl: (fleetId: string, shipId: string, order: { headingDeg?: number; speedKts?: number; targetPosition?: { x: number; y: number }; reason?: string }) => boolean;
  setFleetDestination: (fleetId: string, destination: { x: number; y: number }, options?: { mode?: FleetNavigationMode }) => boolean;
  setFleetWaypoints: (fleetId: string, waypoints: Array<{ x: number; y: number }>, options?: { mode?: FleetNavigationMode }) => boolean;
  clearFleetNavigation: (fleetId: string) => boolean;
  launchDirectionalSearch: (fleetId: string, headingDeg: number, aircraftCount?: number, range?: number) => boolean;
  launchAirSearchSector: (fleetId: string, order: AirSearchSectorOrder) => boolean;
  launchAirStrikeGroup: (fleetId: string, order: AirStrikeGroupOrder) => boolean;
  setFleetFormation: (fleetId: string, formationType: FleetFormationType) => boolean;
  editCarrierAirGroup: (fleetId: string, shipId: string, airGroup: AirGroupEditOrder) => boolean;
  detachShipsToWithdraw: (fleetId: string, shipIds: string[]) => boolean;
  detachDamagedShips: (fleetId: string, hullThreshold?: number) => boolean;
  sendFleetMessage: (fromFleetId: string, toFleetId: string, message: string) => boolean;
  assignFleetObjective: (fleetIds: string[], objective: FleetObjective) => boolean;
  setFleetAutomationPriority: (fleetId: string, workType: FleetAutomationWorkType, priority: FleetAutomationPriority) => boolean;
  resetFleetAutomationPriorities: (fleetId: string) => boolean;
  setAutoTurnEnabled: (enabled: boolean) => void;
  setAutoDoctrineEnabled: (enabled: boolean) => void;
  setAutoPauseOnCritical: (enabled: boolean) => void;
  runPlayerAutomationPulse: () => void;
  setControlMode: (mode: LocalControlMode) => void;
  setActiveLocalPlayer: (playerId: string) => void;
  addLocalPlayer: (name: string, faction: LocalMultiplayerPlayer['faction'], role: LocalPlayerRole, qqUserId?: string) => string;
  setLocalVisibilityMode: (mode: LocalVisibilityMode) => void;
  setLocalCrossControl: (enabled: boolean) => void;
  markLocalPlayerReady: (playerId: string, ready: boolean) => void;
  approveLocalPendingOrder: (orderId: string, approved: boolean) => boolean;
  assignFleetToLocalPlayer: (fleetId: string, playerId: string) => boolean;
  assignShipToLocalPlayer: (fleetId: string, shipId: string, playerId: string) => boolean;
  splitFleetToLocalPlayer: (sourceFleetId: string, shipIds: string[], playerId: string, newFleetName?: string) => boolean;
  directControlShipsAsLocalPlayer: (fleetId: string, shipIds: string[], order: { headingDeg?: number; speedKts?: number; targetPosition?: { x: number; y: number }; reason?: string }) => boolean;
  advanceNavalTurn: () => void;
  requestAIAdvice: () => Promise<void>;
  submitACommand: (userInput: string) => Promise<NavalLLMCommandResult | null>;
}
type FleetObjective =
  | 'annihilate_enemy'
  | NonNullable<NonNullable<StrategicFleet['command']>['commanderIntent']>;

type LocalControlMode = 'llm_commander' | 'human_multiplayer';
type LocalPlayerRole = 'theater_commander' | 'fleet_commander' | 'ship_captain' | 'umpire';
type LocalVisibilityMode = 'role_fog_of_war' | 'shared_map';
type LocalTurnPhase = 'orders' | 'resolution';

interface AirGroupSelection {
  fighters?: number;
  diveBombers?: number;
  torpedoBombers?: number;
  scouts?: number;
}

interface AirSearchSectorOrder extends AirGroupSelection {
  headingDeg: number;
  arcWidthDeg: number;
  range: number;
  teams?: number;
}

interface AirStrikeGroupOrder extends AirGroupSelection {
  contactId: string;
}

interface AirGroupEditOrder {
  fighters?: number;
  diveBombers?: number;
  torpedoBombers?: number;
  readyAircraft?: number;
}

interface AirOperation {
  id: string;
  type: 'search'|'strike'|'cap';
  x: number;
  y: number;
  originX?: number;
  originY?: number;
  originShipId?: string;
  targetX?: number;
  targetY?: number;
  heading: number;
  fleetName: string;
  status: 'preparing' | 'launched' | 'outbound' | 'turning_home' | 'returning' | 'recovered';
  aircraft: number;
  aircraftMix?: AirGroupSelection;
  arcWidthDeg?: number;
  teamIndex?: number;
  teamCount?: number;
  targetContactId?: string;
  missionLabel?: string;
  speed?: number;
  range?: number;
  progress?: number;
  prepTurns?: number;
  readyTurn?: number;
  reportedShipIds?: string[];
  lastScanTurn?: number;
  sweepPoints?: Array<{ x: number; y: number }>;
  sweepRadius?: number;
}

interface LocalMultiplayerPlayer {
  id: string;
  name: string;
  faction: 'player' | 'enemy' | 'neutral';
  role: LocalPlayerRole;
  qqUserId?: string;
}

interface LocalMultiplayerCommandLog {
  id: string;
  turn: number;
  actorPlayerId: string;
  action: string;
  targetId: string;
  summary: string;
}

type LocalPendingOrderPayload =
  | { type: 'assign_fleet'; fleetId: string; playerId: string }
  | { type: 'assign_ship'; fleetId: string; shipId: string; playerId: string }
  | { type: 'split_fleet'; sourceFleetId: string; shipIds: string[]; playerId: string; newFleetName?: string }
  | { type: 'direct_ship_control'; fleetId: string; shipIds: string[]; order: { headingDeg?: number; speedKts?: number; targetPosition?: { x: number; y: number }; reason?: string } }
  | { type: 'delegate_template'; fleetId: string; template: 'search_screen' | 'carrier_strike' | 'withdraw_preserve' | 'surface_intercept' | 'hold_defense' };

interface LocalPendingOrder {
  id: string;
  turn: number;
  actorPlayerId: string;
  approverPlayerId: string;
  title: string;
  summary: string;
  payload: LocalPendingOrderPayload;
}

interface LocalMultiplayerState {
  mode: LocalControlMode;
  players: LocalMultiplayerPlayer[];
  activePlayerId: string;
  fleetOwners: Record<string, string>;
  shipOwners: Record<string, string>;
  allowCrossControl: boolean;
  visibilityMode: LocalVisibilityMode;
  phase: LocalTurnPhase;
  readyPlayerIds: string[];
  pendingOrders: LocalPendingOrder[];
  commandLog: LocalMultiplayerCommandLog[];
}

function createDefaultLocalMultiplayerState(fleets: StrategicFleet[] = []): LocalMultiplayerState {
  return assignDefaultLocalOwners({
    mode: 'llm_commander',
    players: [
      { id: 'blue_command', name: 'Blue Command', faction: 'player', role: 'theater_commander' },
      { id: 'red_command', name: 'Red Command', faction: 'enemy', role: 'theater_commander' },
      { id: 'umpire', name: 'Umpire', faction: 'neutral', role: 'umpire' },
    ],
    activePlayerId: 'blue_command',
    fleetOwners: {},
    shipOwners: {},
    allowCrossControl: true,
    visibilityMode: 'role_fog_of_war',
    phase: 'orders',
    readyPlayerIds: [],
    pendingOrders: [],
    commandLog: [],
  }, fleets);
}

function assignDefaultLocalOwners(multiplayer: LocalMultiplayerState, fleets: StrategicFleet[]): LocalMultiplayerState {
  const fleetOwners = { ...multiplayer.fleetOwners };
  const shipOwners = { ...multiplayer.shipOwners };
  for (const fleet of fleets) {
    const fallbackOwner = defaultOwnerForFaction(fleet.faction);
    fleetOwners[fleet.id] = fleetOwners[fleet.id] || fallbackOwner;
    for (const ship of fleet.ships) {
      shipOwners[ship.id] = shipOwners[ship.id] || fleetOwners[fleet.id] || fallbackOwner;
    }
  }
  return { ...multiplayer, fleetOwners, shipOwners };
}

function resetLocalOwnersForScenario(multiplayer: LocalMultiplayerState, fleets: StrategicFleet[]): LocalMultiplayerState {
  return assignDefaultLocalOwners({
    ...multiplayer,
    fleetOwners: {},
    shipOwners: {},
    readyPlayerIds: [],
    pendingOrders: [],
    commandLog: [],
    phase: 'orders',
  }, fleets);
}

function defaultOwnerForFaction(faction: StrategicFleet['faction']): string {
  if (faction === 'enemy') return 'red_command';
  if (faction === 'neutral') return 'umpire';
  return 'blue_command';
}

// ===== Ship Factory (simple version, used by store) =====

function createShip(
  shipClass: NavalShipClass,
  faction: 'player' | 'enemy',
  name: string,
  x: number,
  y: number,
  headingDeg: number,
  speedKts: number,
  role: 'carrier' | 'screen' | 'picket' | 'surface_combatant' | 'torpedo_attack' | 'transport' | 'submarine' | 'oiler'
): NavalShip {
  const ship = createShipForClass(shipClass, faction, name, x, y, headingDeg, speedKts, role);
  return ship;
}

// ===== Store =====

export const useNavalStore = create<NavalStoreState>((set, get) => ({
  navalMode: 'strategic',
  localMultiplayer: createDefaultLocalMultiplayerState(),
  overlay: undefined,
  fleets: [],
  selectedFleetId: undefined,
  selectedOperationView: undefined,
  selectedCombatViewport: undefined,
  battleMap: undefined,
  facilities: [],
  shippingLanes: [],
  islands: [],
  tacticalMaps: [],
  airOperations: [],
  landAirfields: [],
  weather: 'clear' as const,
  victory: 'none' as const,
  intel: createDefaultIntelState(),
  reports: [],
  commandHistory: [],
  pendingAuthorizations: [],
  fleetCommunications: [],
  currentTurn: 0,
  environment: {
    timeOfDay: 'day',
    weather: 'clear',
    seaState: 1,
    windDirectionDeg: 90,
    windSpeedKts: 10,
    visibilityModifier: 1.0,
  },
  battleLog: [],

  isCreatingScenario: false,
  autoTurnEnabled: true,
  autoDoctrineEnabled: true,
  autoPauseOnCritical: false,
  lastAutoPauseKey: undefined,

  // LLM
  aiConfig: {
    kind: 'rule_based',
    model: 'qwen3.5:0.8b',
    endpoint: 'http://127.0.0.1:11434',
    apiKey: '',
    temperature: 0,
    maxTokens: 900,
  },
  aiAdvice: undefined,
  aiLoading: false,
  aiError: undefined,

  createNavalScenario: () => {
    set({ isCreatingScenario: true });
    try {
    // 鐢熸垚鎴樼暐鍦板浘 + 鎴樻湳鍦板浘
    const mapResult = generateStratMap({
      width: 3000, height: 2000, seed: Date.now(),
      islandGroups: 12, maxIslandR: 80, minIslandR: 12, seaLevel: 0.42,
    });

    const overlay = mapResult.overlay;

    // Fleet spawn ports near friendly bases.
    const pPorts = mapResult.facilities.filter(f => f.faction === 'player' && (f.type === 'port' || f.type === 'naval_base'));
    const ePorts = mapResult.facilities.filter(f => f.faction === 'enemy' && (f.type === 'port' || f.type === 'naval_base'));
    const pcx = pPorts[0]?.x ?? 800, pcy = pPorts[0]?.y ?? 1000;
    const ecx = ePorts[0]?.x ?? 1500, ecy = ePorts[0]?.y ?? 1000;

    // Create player fleet with varied headings and speeds for visible movement
    const playerShips: NavalShip[] = [
      createShip('fleet_carrier', 'player', 'CV Enterprise', pcx, pcy, 270, 25, 'carrier'),  // 鍚戣タ鏈濇棩鏈?      createShip('heavy_cruiser', 'player', 'CA Northampton', pcx - 15, pcy - 8, 270, 28, 'screen'),
      createShip('heavy_cruiser', 'player', 'CA Portland', pcx + 15, pcy + 8, 50, 28, 'screen'),
      createShip('destroyer', 'player', 'DD Fletcher', pcx - 22, pcy + 12, 20, 32, 'screen'),
      createShip('destroyer', 'player', 'DD O\'Bannon', pcx + 25, pcy - 10, 55, 30, 'screen'),
      createShip('destroyer', 'player', 'DD Nicholas', pcx + 8, pcy - 20, 70, 30, 'picket'),
    ];

    // Create enemy fleet
    const enemyShips: NavalShip[] = [
      createShip('battleship', 'enemy', 'BB Yamato', ecx, ecy, 210, 20, 'surface_combatant'),
      createShip('heavy_cruiser', 'enemy', 'CA Tone', ecx + 14, ecy - 8, 195, 22, 'surface_combatant'),
      createShip('light_cruiser', 'enemy', 'CL Sendai', ecx - 12, ecy + 10, 220, 24, 'screen'),
      createShip('destroyer', 'enemy', 'DD Kagero', ecx + 20, ecy + 5, 185, 28, 'torpedo_attack'),
      createShip('destroyer', 'enemy', 'DD Shiranui', ecx - 18, ecy - 8, 215, 28, 'torpedo_attack'),
    ];

    // Set rudder so they gently turn (formation feel)
    for (const ship of [...playerShips]) {
      if (ship.shipClass === 'destroyer') { ship.rudderDeg = -5; ship.targetSpeedKts = 28; }
    }

    const playerFleet: StrategicFleet = {
      id: 'player_ctf_1',
      name: 'Task Force 16',
      faction: 'player',
      type: 'carrier_task_force',
      position: { regionX: 0, regionY: 0, chunkX: Math.floor(overlay[0]?.length * 0.35 / 32), chunkY: Math.floor(overlay.length * 0.50 / 32), globalX: pcx, globalY: pcy },
      ships: playerShips,
      command: {
        controller: 'player_direct',
        riskTolerance: 'medium',
        engagementPolicy: 'carrier_strike_only',
        preserveCapitalShips: true,
        automation: createDefaultFleetAutomationState('carrier_task_force'),
      },
      mission: 'patrol',
      fuelState: 'good',
      ammoState: 'good',
      airGroupState: 'ready',
      detectedByPlayer: true,
    };

    const enemyFleet: StrategicFleet = {
      id: 'enemy_sag_1',
      name: 'Enemy Surface Group',
      faction: 'enemy',
      type: 'surface_action_group',
      position: { regionX: 0, regionY: 0, chunkX: Math.floor(overlay[0]?.length * 0.60 / 32), chunkY: Math.floor(overlay.length * 0.55 / 32), globalX: ecx, globalY: ecy },
      ships: enemyShips,
      command: {
        controller: 'enemy_ai',
        riskTolerance: 'high',
        engagementPolicy: 'engage_surface_only',
        preserveCapitalShips: false,
      },
      mission: 'intercept',
      fuelState: 'good',
      ammoState: 'good',
      detectedByPlayer: false,
    };

    // Create land airfields from map facilities
    const landAfs = mapResult.facilities
      .filter(f => f.type === 'airfield' || f.type === 'naval_base' || f.type === 'port')
      .map(f => ({
        id: `la_${f.id}`, name: f.name, x: f.x, y: f.y, faction: (f.faction === 'neutral' ? 'player' : f.faction) as 'player'|'enemy',
        fighters: f.type === 'naval_base' ? 24 : f.type === 'airfield' ? 12 : 6,
        bombers: f.type === 'naval_base' ? 18 : f.type === 'airfield' ? 8 : 4,
      }));

    set({
      overlay,
      facilities: mapResult.facilities,
      shippingLanes: mapResult.shippingLanes,
      islands: mapResult.islands,
      tacticalMaps: mapResult.tacticalMaps,
      airOperations: [],
      landAirfields: landAfs,
      fleets: [playerFleet, enemyFleet],
      localMultiplayer: resetLocalOwnersForScenario(get().localMultiplayer, [playerFleet, enemyFleet]),
      intel: { ...createDefaultIntelState() },
      reports: [],
      commandHistory: [],
      pendingAuthorizations: [],
      fleetCommunications: [],
      currentTurn: 0,
      battleLog: [],
      isCreatingScenario: false,
      autoTurnEnabled: true,
      autoDoctrineEnabled: true,
      autoPauseOnCritical: false,
      lastAutoPauseKey: undefined,
      navalMode: 'strategic',
    });
    } catch (_e) {
      set({ isCreatingScenario: false });
    }
  },

  selectFleet: (fleetId: string) => {
    set({ selectedFleetId: fleetId });
  },

  openNavalOperationView: (fleetId: string) => {
    const state = get();
    const fleet = state.fleets.find((f) => f.id === fleetId);
    if (!fleet || !state.overlay) return;

    set({
      selectedFleetId: fleetId,
      navalMode: 'operation',
    });
  },

  openNavalCombatView: (fleetId: string, contactId?: string) => {
    const state = get();
    const fleet = state.fleets.find((f) => f.id === fleetId);
    if (!fleet || !state.overlay) return;
    set({ selectedFleetId: fleetId });
  },

  submitNavalCommand: (text: string, fleetIds: string[]) => {
    const state = get();
    const selectedIds = fleetIds.length > 0
      ? fleetIds
      : state.localMultiplayer.mode === 'human_multiplayer'
        ? state.fleets
          .filter((fleet) => state.localMultiplayer.fleetOwners[fleet.id] === state.localMultiplayer.activePlayerId)
          .map((fleet) => fleet.id)
        : state.fleets.filter((fleet) => fleet.faction === 'player').map((fleet) => fleet.id);
    const firstSelected = state.fleets.find((fleet) => selectedIds.includes(fleet.id));
    const interpretation = interpretHumanNavalCommand({
      text,
      fleetIds: selectedIds,
      fleets: state.fleets,
      contacts: firstSelected?.faction === 'enemy' ? state.intel.enemyContacts : state.intel.playerContacts,
      facilities: state.facilities,
      currentTurn: state.currentTurn,
      allowAnyFaction: state.localMultiplayer.mode === 'human_multiplayer',
    });
    const receipt: HumanCommandReceipt = {
      id: `human_cmd_${state.currentTurn}_${Date.now().toString(36)}`,
      turn: state.currentTurn,
      text,
      fleetIds: selectedIds,
      accepted: interpretation.errors.length === 0 && (interpretation.actions.length > 0 || interpretation.specialOrders.length > 0),
      ...interpretation,
    };

    if (!receipt.accepted) {
      set((current) => ({
        commandHistory: [...current.commandHistory, { ...receipt, resultSummary: receipt.errors.join('; ') }],
        reports: [...current.reports, createHumanCommandReport(receipt, 'REQUEST_AUTHORIZATION', receipt.errors.join('; ') || 'Command rejected')],
      }));
      return receipt;
    }

    if (receipt.requiresConfirmation) {
      const pending: HumanPendingAuthorization = {
        id: `auth_${receipt.id}`,
        turn: state.currentTurn,
        title: 'Human authorization required',
        question: receipt.summary,
        yesLabel: 'Yes, execute',
        noLabel: 'No, cancel',
        receipt,
      };
      set((current) => ({
        commandHistory: [...current.commandHistory, { ...receipt, resultSummary: 'Awaiting authorization' }],
        pendingAuthorizations: [...current.pendingAuthorizations, pending],
        reports: [...current.reports, createHumanCommandReport(receipt, 'REQUEST_AUTHORIZATION', receipt.summary)],
      }));
      return { ...receipt, resultSummary: 'Awaiting authorization' };
    }

    return executeHumanCommandReceipt(receipt);
  },

  confirmPendingDecision: (authorizationId: string, approved: boolean) => {
    const state = get();
    const pending = state.pendingAuthorizations.find((item) => item.id === authorizationId);
    if (!pending) return undefined;
    set((current) => ({
      pendingAuthorizations: current.pendingAuthorizations.filter((item) => item.id !== authorizationId),
    }));
    if (!approved) {
      const cancelled = { ...pending.receipt, accepted: false, resultSummary: 'Authorization denied' };
      set((current) => ({
        commandHistory: [...current.commandHistory, cancelled],
        reports: [...current.reports, createHumanCommandReport(cancelled, 'REQUEST_AUTHORIZATION', 'Authorization denied')],
      }));
      return cancelled;
    }
    return executeHumanCommandReceipt({ ...pending.receipt, requiresConfirmation: false });
  },

  splitFleet: (sourceFleetId: string, shipIds: string[], newFleetName?: string) => {
    return applySplitFleetOrder(sourceFleetId, shipIds, newFleetName);
  },

  setShipDirectControl: (fleetId, shipId, order) => {
    return applyDirectShipControlOrder(fleetId, shipId, order);
  },

  setFleetDestination: (fleetId, destination, options) => {
    return applyFleetDestinationOrder(fleetId, destination, options);
  },

  setFleetWaypoints: (fleetId, waypoints, options) => {
    return applyFleetWaypointsOrder(fleetId, waypoints, options);
  },

  clearFleetNavigation: (fleetId) => {
    return applyClearFleetNavigationOrder(fleetId);
  },

  launchDirectionalSearch: (fleetId, headingDeg, aircraftCount = 4, range = 180) => {
    return applyDirectionalSearchOrder(fleetId, headingDeg, aircraftCount, range);
  },

  launchAirSearchSector: (fleetId, order) => {
    return applyAirSearchSectorOrder(fleetId, order);
  },

  launchAirStrikeGroup: (fleetId, order) => {
    return applyAirStrikeGroupOrder(fleetId, order);
  },

  setFleetFormation: (fleetId, formationType) => {
    return applyFleetFormationOrder(fleetId, formationType);
  },

  editCarrierAirGroup: (fleetId, shipId, airGroup) => {
    return applyCarrierAirGroupEditOrder(fleetId, shipId, airGroup);
  },

  detachShipsToWithdraw: (fleetId, shipIds) => {
    return applyDetachShipsWithdrawOrder(fleetId, shipIds);
  },

  detachDamagedShips: (fleetId, hullThreshold = 70) => {
    return applyDetachDamagedShipsOrder(fleetId, hullThreshold);
  },

  sendFleetMessage: (fromFleetId, toFleetId, message) => {
    return applyFleetMessageOrder(fromFleetId, toFleetId, message);
  },

  assignFleetObjective: (fleetIds, objective) => {
    return applyFleetObjectiveOrder(fleetIds, objective);
  },

  setFleetAutomationPriority: (fleetId, workType, priority) => {
    return applyFleetAutomationPriorityOrder(fleetId, workType, priority);
  },

  resetFleetAutomationPriorities: (fleetId) => {
    return applyResetFleetAutomationPrioritiesOrder(fleetId);
  },

  setAutoTurnEnabled: (enabled) => {
    set((state) => ({
      autoTurnEnabled: enabled,
      battleLog: [
        ...state.battleLog,
        humanLogEvent(state.currentTurn, enabled ? 'Automatic turn advance enabled' : 'Automatic turn advance paused'),
      ],
    }));
  },

  setAutoDoctrineEnabled: (enabled) => {
    set((state) => ({
      autoDoctrineEnabled: enabled,
      battleLog: [
        ...state.battleLog,
        humanLogEvent(state.currentTurn, enabled ? 'Routine fleet automation enabled' : 'Routine fleet automation paused'),
      ],
    }));
  },

  setAutoPauseOnCritical: (enabled) => {
    set((state) => ({
      autoPauseOnCritical: enabled,
      battleLog: [
        ...state.battleLog,
        humanLogEvent(state.currentTurn, enabled ? 'Critical event auto-pause enabled' : 'Critical event auto-pause disabled'),
      ],
    }));
  },

  runPlayerAutomationPulse: () => {
    const state = get();
    if (!state.overlay || state.fleets.length === 0 || state.victory !== 'none') return;
    if (!state.autoDoctrineEnabled) return;

    const playerFleets = state.fleets.filter((fleet) => fleet.faction === 'player');
    for (const fleet of playerFleets) {
      const latest = useNavalStore.getState();
      const currentFleet = latest.fleets.find((item) => item.id === fleet.id);
      if (!currentFleet || currentFleet.faction !== 'player') continue;
      applyFleetPriorityDoctrine(currentFleet.id);
    }
  },

  setControlMode: (mode) => {
    set((state) => ({
      localMultiplayer: {
        ...assignDefaultLocalOwners(state.localMultiplayer, state.fleets),
        mode,
      },
      battleLog: [
        ...state.battleLog,
        humanLogEvent(state.currentTurn, mode === 'human_multiplayer'
          ? 'Control mode switched to local human multiplayer; automatic AI orders disabled'
          : 'Control mode switched to LLM commander; automatic AI orders enabled'),
      ],
    }));
  },

  setActiveLocalPlayer: (playerId) => {
    set((state) => state.localMultiplayer.players.some((player) => player.id === playerId)
      ? { localMultiplayer: { ...state.localMultiplayer, activePlayerId: playerId } }
      : state);
  },

  addLocalPlayer: (name, faction, role, qqUserId) => {
    const state = get();
    const cleanName = name.trim() || `Player ${state.localMultiplayer.players.length + 1}`;
    const idBase = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'player';
    let id = idBase;
    let suffix = 2;
    while (state.localMultiplayer.players.some((player) => player.id === id)) {
      id = `${idBase}_${suffix++}`;
    }
    const cleanQq = qqUserId?.trim();
    const player: LocalMultiplayerPlayer = {
      id,
      name: cleanName,
      faction,
      role,
      ...(cleanQq ? { qqUserId: cleanQq } : {}),
    };
    set((current) => ({
      localMultiplayer: {
        ...current.localMultiplayer,
        players: [...current.localMultiplayer.players, player],
        commandLog: appendLocalCommandLog(current, current.localMultiplayer.activePlayerId, 'add_player', id, `${cleanName} joined as ${role}`),
      },
    }));
    return id;
  },

  setLocalVisibilityMode: (mode) => {
    set((state) => ({
      localMultiplayer: {
        ...state.localMultiplayer,
        visibilityMode: mode,
        commandLog: appendLocalCommandLog(state, state.localMultiplayer.activePlayerId, 'visibility_mode', mode, `Visibility mode set to ${mode}`),
      },
    }));
  },

  setLocalCrossControl: (enabled) => {
    set((state) => ({
      localMultiplayer: {
        ...state.localMultiplayer,
        allowCrossControl: enabled,
        commandLog: appendLocalCommandLog(state, state.localMultiplayer.activePlayerId, 'cross_control', String(enabled), `Cross-control ${enabled ? 'enabled' : 'requires approval'}`),
      },
    }));
  },

  markLocalPlayerReady: (playerId, ready) => {
    set((state) => {
      if (!localPlayerExists(state, playerId)) return state;
      const readySet = new Set(state.localMultiplayer.readyPlayerIds);
      if (ready) readySet.add(playerId);
      else readySet.delete(playerId);
      return {
        localMultiplayer: {
          ...state.localMultiplayer,
          readyPlayerIds: [...readySet],
          commandLog: appendLocalCommandLog(state, playerId, ready ? 'ready' : 'not_ready', playerId, `${playerId} marked ${ready ? 'ready' : 'not ready'}`),
        },
      };
    });
  },

  approveLocalPendingOrder: (orderId, approved) => approveLocalPendingOrder(orderId, approved),

  assignFleetToLocalPlayer: (fleetId, playerId) => applyFleetToLocalPlayer(fleetId, playerId),

  assignShipToLocalPlayer: (fleetId, shipId, playerId) => applyShipToLocalPlayer(fleetId, shipId, playerId),

  splitFleetToLocalPlayer: (sourceFleetId, shipIds, playerId, newFleetName) => applySplitFleetOrder(
    sourceFleetId,
    shipIds,
    newFleetName,
    { allowAnyFaction: true, ownerPlayerId: playerId },
  ),

  directControlShipsAsLocalPlayer: (fleetId, shipIds, order) => applyDirectShipsAsLocalPlayer(fleetId, shipIds, order),

  advanceNavalTurn: () => {
    const state = get();
    let {
      fleets,
      intel,
      reports,
      currentTurn,
      environment,
      battleLog,
    } = state;

    const newTurn = currentTurn + 1;

    // Weather rotation
    const weathers: Array<'clear'|'rain'|'squall'|'fog'|'storm'> = ['clear','clear','clear','rain','clear','clear','squall','clear','fog','clear','clear','storm'];
    const weather = weathers[newTurn % weathers.length];

    fleets = fleets.map((fleet) => applyFleetAutopilot(fleet, state.overlay));

    // 1. Update ship motion (4x strategic movement for 3000-wide map)
    let updatedShipMap: Record<string, NavalShip> = {};
    for (const fleet of fleets) {
      for (const ship of fleet.ships) {
        const moved = updateShipMotion(ship, 1);
        moved.position.x = ship.position.x + (moved.position.x - ship.position.x) * 1;
        moved.position.y = ship.position.y + (moved.position.y - ship.position.y) * 1;
        updatedShipMap[ship.id] = moved;
      }
    }

    // Auto-engage enemy if fleets are close: move ships toward each other
    const pFleet = fleets.find(f => f.faction === 'player');
    const eFleet = fleets.find(f => f.faction === 'enemy');
    if (pFleet && eFleet) {
      const pfx = pFleet.position.globalX, pfy = pFleet.position.globalY;
      const efx = eFleet.position.globalX, efy = eFleet.position.globalY;
      const stratDist = Math.sqrt((pfx-efx)**2 + (pfy-efy)**2);

      if (stratDist < 150) {
        // Fleets close: pull ships together for engagement
        const midX = (pfx + efx) / 2, midY = (pfy + efy) / 2;
        for (const ship of pFleet.ships) {
          const s = updatedShipMap[ship.id];
          if (s) {
            s.targetSpeedKts = 30;
            s.position.x += (midX - s.position.x) * 0.3;
            s.position.y += (midY - s.position.y) * 0.3;
            updatedShipMap[ship.id] = s;
          }
        }
        for (const ship of eFleet.ships) {
          const s = updatedShipMap[ship.id];
          if (s) {
            s.targetSpeedKts = 25;
            s.position.x += (midX - s.position.x) * 0.3;
            s.position.y += (midY - s.position.y) * 0.3;
            updatedShipMap[ship.id] = s;
          }
        }
      }
    }

    // Auto-combat: if enemy ships within 25u of player ships, deal damage
    const allShips = Object.values(updatedShipMap);
    const pShips = allShips.filter(s => s.faction === 'player');
    const eShips = allShips.filter(s => s.faction === 'enemy');
    for (const ps of pShips) {
      for (const es of eShips) {
        const dx = ps.position.x - es.position.x, dy = ps.position.y - es.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 25) {
          const torp = ps.shipClass === 'destroyer' && dist < 8 && Math.random() < 0.4;
          const dmg = applyNavalDamage({
            ship: es, hitLocation: 'midships',
            damageType: torp ? 'torpedo_hit' : 'shell_hit',
            penetration: torp ? 60 : 30, explosivePower: torp ? 35 : 10,
            underwater: torp, turn: newTurn,
          });
          es.damage = dmg.ship.damage;
          updatedShipMap[es.id] = es;
          for (const e of dmg.events) {
            battleLog.push({ ...e, turn: newTurn });
          }
        }
      }
    }
    for (const es of eShips) {
      for (const ps of pShips) {
        const dx = es.position.x - ps.position.x, dy = es.position.y - ps.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 25) {
          const torp = es.shipClass === 'destroyer' && dist < 8 && Math.random() < 0.4;
          const dmg = applyNavalDamage({
            ship: ps, hitLocation: 'midships',
            damageType: torp ? 'torpedo_hit' : 'shell_hit',
            penetration: torp ? 60 : 30, explosivePower: torp ? 35 : 10,
            underwater: torp, turn: newTurn,
          });
          ps.damage = dmg.ship.damage;
          updatedShipMap[ps.id] = ps;
          for (const e of dmg.events) {
            battleLog.push({ ...e, turn: newTurn });
          }
        }
      }
    }
    const buildAIInputForFaction = (faction: 'player' | 'enemy', contacts: NavalContact[]) => {
      const friendlyFleets = fleets.filter((f) => f.faction === faction);
      return {
        friendlyFleets,
        friendlyShips: Object.values(updatedShipMap).filter((s) => s.faction === faction),
        contacts,
        intel,
        reports,
        mission: friendlyFleets[0]?.command || {
          controller: faction === 'enemy' ? 'enemy_ai' as const : 'player_direct' as const,
          riskTolerance: 'medium' as const,
          engagementPolicy: 'engage_if_advantage' as const,
          preserveCapitalShips: true,
          commanderIntent: 'hold_sea_area' as const,
        },
        environment,
      };
    };

    const allActions: NavalAIAction[] = [];
    if (state.localMultiplayer.mode !== 'human_multiplayer') {
      const playerAIInput = buildAIInputForFaction('player', intel.playerContacts);
      const enemyAIInput = buildAIInputForFaction('enemy', intel.enemyContacts);
      allActions.push(
        ...generateFleetAIActions(playerAIInput),
        ...generateTacticalAIActions(playerAIInput),
        ...generateCarrierAIActions(playerAIInput),
        ...generateFleetAIActions(enemyAIInput),
        ...generateTacticalAIActions(enemyAIInput),
        ...generateCarrierAIActions(enemyAIInput),
      );
    }

    // 3. Execute AI actions (updates ships, missions, battleLog)
    const execResult = executeNavalAIActions({
      actions: allActions,
      fleets,
      shipMap: updatedShipMap,
      intel,
      environment,
      currentTurn: newTurn,
    });

    // Apply updated ships from execution
    updatedShipMap = execResult.shipMap;
    intel = { ...intel, searchMissions: execResult.updatedSearchMissions };
    battleLog = [...battleLog, ...execResult.events];

    // 4. Update carrier air missions and get contacts
    for (const fleet of fleets) {
      for (const ship of fleet.ships) {
        if (updatedShipMap[ship.id]?.aircraft) {
          const shipObj = updatedShipMap[ship.id];
          if (shipObj.aircraft) {
            const airResult = updateAirMissionsLocal(
              shipObj.aircraft,
              Object.values(updatedShipMap).filter((s) => s.faction !== fleet.faction && s.faction !== 'neutral'),
              environment,
              newTurn
            );
            shipObj.aircraft = airResult.airGroup;
            for (const c of airResult.contacts) {
              if (fleet.faction === 'enemy') {
                intel.enemyContacts = mergeContacts(intel.enemyContacts, c);
              } else {
                intel.playerContacts = mergeContacts(intel.playerContacts, c);
              }
            }
            battleLog = [...battleLog, ...airResult.events];
            updatedShipMap[ship.id] = shipObj;
          }
        }
      }
    }

    // 5. Update intel from ship sensors (鍞竴鍏佽璇诲彇 enemyShips)
    const allUpdatedShips = Object.values(updatedShipMap);
    const playerIntelResult = updateNavalIntelState({
      intel,
      currentTurn: newTurn,
      friendlyShips: allUpdatedShips.filter((s) => s.faction === 'player'),
      enemyShips: allUpdatedShips.filter((s) => s.faction === 'enemy'),
      friendlyAirMissions: intel.searchMissions,
      environment,
      overlay: state.overlay || [],
    });

    intel = playerIntelResult.intel;
    reports = [...reports, ...playerIntelResult.newReports];

    const enemyIntelResult = updateNavalIntelState({
      intel: {
        ...intel,
        playerContacts: intel.enemyContacts,
        enemyContacts: intel.playerContacts,
      },
      currentTurn: newTurn,
      friendlyShips: allUpdatedShips.filter((s) => s.faction === 'enemy'),
      enemyShips: allUpdatedShips.filter((s) => s.faction === 'player'),
      friendlyAirMissions: intel.searchMissions,
      environment,
      overlay: state.overlay || [],
    });
    intel = {
      ...intel,
      enemyContacts: enemyIntelResult.intel.playerContacts,
    };

    // 6. Decay contacts that haven't been updated
    intel = {
      ...intel,
      playerContacts: decayNavalContacts({
        contacts: intel.playerContacts,
        currentTurn: newTurn,
        staleAfterTurns: 2,
      }),
      enemyContacts: decayNavalContacts({
        contacts: intel.enemyContacts,
        currentTurn: newTurn,
        staleAfterTurns: 2,
      }),
    };

    // 7. Generate reports
    const newReports = generateNavalReports({
      turn: newTurn,
      contacts: intel.playerContacts,
      damagedShips: allUpdatedShips.filter((s) => s.damage.status !== 'combat_effective'),
      events: battleLog,
    });
    reports = [...reports, ...newReports];

    // 7. Update fleets with new ship positions AND sync fleet strategic position
    const updatedFleets = fleets.map((fleet) => {
      const newShips = fleet.ships.map((s) => updatedShipMap[s.id] || s);
      // Calculate fleet center from ship average position
      const avgX = newShips.length > 0 ? newShips.reduce((sum, s) => sum + s.position.x, 0) / newShips.length : fleet.position.globalX;
      const avgY = newShips.length > 0 ? newShips.reduce((sum, s) => sum + s.position.y, 0) / newShips.length : fleet.position.globalY;
      return {
        ...fleet,
        ships: newShips,
        position: {
          ...fleet.position,
          globalX: Math.round(avgX),
          globalY: Math.round(avgY),
        },
      };
    });

    // Victory check
    let victory: 'none'|'player'|'enemy' = 'none';
    const pF2 = updatedFleets.find(f => f.faction === 'player');
    const eF2 = updatedFleets.find(f => f.faction === 'enemy');
    if (pF2 && pF2.ships.every(s => s.damage.status === 'sunk' || s.damage.status === 'sinking')) victory = 'enemy';
    if (eF2 && eF2.ships.every(s => s.damage.status === 'sunk' || s.damage.status === 'sinking')) victory = 'player';

    const fleetCommunications = state.fleetCommunications.map((message) => (
      message.status === 'queued' && (message.deliveredTurn ?? Number.POSITIVE_INFINITY) <= newTurn
        ? { ...message, status: 'delivered' as const }
        : message
    ));

    if (newTurn % 3 === 0) {
      reports = [...reports, createPeriodicSitrep(newTurn, updatedFleets, intel.playerContacts)];
    }

    const criticalReport = createCriticalAuthorizationReport(newTurn, updatedFleets, intel.playerContacts);
    if (criticalReport) {
      reports = [...reports, criticalReport];
    }
    const autoPause = state.autoPauseOnCritical
      ? criticalAutoPauseEvent(updatedFleets, intel.playerContacts)
      : undefined;
    const shouldPauseAutoTurn = Boolean(autoPause && autoPause.key !== state.lastAutoPauseKey);
    if (shouldPauseAutoTurn && autoPause) {
      battleLog = [
        ...battleLog,
        humanLogEvent(newTurn, `Automatic pause: ${autoPause.summary}`),
      ];
    }

    const movedAirOperations = updateVisibleAirOperations(state.airOperations, updatedFleets);
    const searchVision = resolveSearchAirOperationVision({
      airOperations: movedAirOperations,
      fleets: updatedFleets,
      intel,
      currentTurn: newTurn,
      environment,
    });
    intel = searchVision.intel;
    battleLog = [...battleLog, ...searchVision.events];

    const strikeResult = resolveStrikeAirOperationImpacts({
      previousOperations: state.airOperations,
      advancedOperations: searchVision.airOperations,
      fleets: updatedFleets,
      contacts: [...intel.playerContacts, ...intel.enemyContacts],
      currentTurn: newTurn,
    });
    const advancedAirOperations = strikeResult.airOperations;
    battleLog = [...battleLog, ...strikeResult.events];
    const strikeResolvedFleets = strikeResult.fleets;
    const recoveredAirOperations = advancedAirOperations.filter((op) => op.status === 'recovered');
    const finalFleets = restoreRecoveredAirOperations(strikeResolvedFleets, recoveredAirOperations);
    if (recoveredAirOperations.length > 0) {
      battleLog = [
        ...battleLog,
        ...recoveredAirOperations.map((op) =>
          humanLogEvent(newTurn, `${op.fleetName} recovered ${op.aircraft} aircraft from ${op.type} mission`),
        ),
      ];
    }
    const airOperations = advancedAirOperations.filter((op) => op.status !== 'recovered');

    set({
      fleets: finalFleets,
      intel,
      reports,
      currentTurn: newTurn,
      battleLog,
      airOperations,
      weather,
      victory,
      autoTurnEnabled: shouldPauseAutoTurn ? false : state.autoTurnEnabled,
      lastAutoPauseKey: shouldPauseAutoTurn ? autoPause?.key : state.lastAutoPauseKey,
      fleetCommunications,
      localMultiplayer: {
        ...state.localMultiplayer,
        phase: 'orders',
        readyPlayerIds: [],
      },
    });
  },

  requestAIAdvice: async () => {
    const state = get();
    set({ aiLoading: true, aiError: undefined });

    try {
      const config: AIProviderConfig = {
        ...state.aiConfig,
      };

      const context = buildNavalLLMContext({
        turn: state.currentTurn,
        fleets: state.fleets.map((f) => ({
          id: f.id, name: f.name, type: f.type, faction: f.faction,
          position: f.position,
          ships: f.ships.map((s) => ({
            id: s.id, name: s.name, shipClass: s.shipClass,
            damage: s.damage,
          })),
          fuelState: f.fuelState, ammoState: f.ammoState, mission: f.mission,
        })),
        contacts: state.intel.playerContacts.map((c) => ({
          id: c.id, detectionLevel: c.detectionLevel, confidence: c.confidence,
          estimatedClass: (c.estimatedClass as string) || 'unknown',
          lastKnownPosition: c.lastKnownPosition,
          uncertaintyRadius: c.uncertaintyRadius, lastDetectedTurn: c.lastDetectedTurn,
        })),
        reports: state.reports.map((r) => ({
          type: r.type, title: r.title, summary: r.summary,
        })),
        environment: state.environment,
      });

      const advice = await getNavalAdvice({ config, context });
      set({ aiAdvice: advice, aiLoading: false });
    } catch (e) {
      set({ aiError: String(e), aiLoading: false });
    }
  },

  submitACommand: async (userInput: string) => {
    const state = get();
    try {
      const context = buildNavalLLMContext({
        turn: state.currentTurn,
        fleets: state.fleets.map((f) => ({
          id: f.id, name: f.name, type: f.type, faction: f.faction,
          position: f.position,
          ships: f.ships.map((s) => ({
            id: s.id, name: s.name, shipClass: s.shipClass,
            damage: s.damage,
          })),
          fuelState: f.fuelState, ammoState: f.ammoState, mission: f.mission,
        })),
        contacts: state.intel.playerContacts.map((c) => ({
          id: c.id, detectionLevel: c.detectionLevel, confidence: c.confidence,
          estimatedClass: (c.estimatedClass as string) || 'unknown',
          lastKnownPosition: c.lastKnownPosition,
          uncertaintyRadius: c.uncertaintyRadius, lastDetectedTurn: c.lastDetectedTurn,
        })),
        reports: state.reports.map((r) => ({
          type: r.type, title: r.title, summary: r.summary,
        })),
        environment: state.environment,
      });

      const result = await parseNaturalCommand({ config: state.aiConfig, userInput, context });
      const fleetId = result.fleetId || state.selectedFleetId || state.fleets.find((fleet) => fleet.faction === 'player')?.id;
      const receipt = useNavalStore.getState().submitNavalCommand(userInput, fleetId ? [fleetId] : []);
      return {
        ...result,
        parsed: receipt.accepted || result.parsed,
        fleetId,
        actionType: receipt.actions[0]?.type || result.actionType,
        explanation: receipt.resultSummary || receipt.summary || result.explanation,
        rawResponse: result.rawResponse || JSON.stringify(receipt),
      };
    } catch (e) {
      return null;
    }
  },
}));

// ===== 灞�閮ㄨ緟鍔?=====

interface FleetAutomationCandidate {
  workType: FleetAutomationWorkType;
  priority: FleetAutomationPriority;
  urgency: number;
  summary: string;
  execute: () => boolean;
}

function applyFleetAutomationPriorityOrder(fleetId: string, workType: FleetAutomationWorkType, priority: FleetAutomationPriority): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && item.faction === 'player');
  if (!fleet) return false;
  const nextPriority = normalizeAutomationPriority(priority);
  const automation = normalizeFleetAutomationState(fleet);
  const updatedFleet: StrategicFleet = {
    ...fleet,
    command: {
      riskTolerance: fleet.command?.riskTolerance ?? 'medium',
      engagementPolicy: fleet.command?.engagementPolicy ?? 'engage_if_advantage',
      preserveCapitalShips: fleet.command?.preserveCapitalShips ?? true,
      ...fleet.command,
      controller: fleet.command?.controller ?? 'player_direct',
      automation: {
        ...automation,
        priorities: {
          ...automation.priorities,
          [workType]: nextPriority,
        },
      },
    },
  };
  useNavalStore.setState({
    fleets: state.fleets.map((item) => item.id === fleet.id ? updatedFleet : item),
    battleLog: [
      ...state.battleLog,
      humanLogEvent(state.currentTurn, `${fleet.name} priority doctrine updated: ${automationWorkLabel(workType)} ${nextPriority === 0 ? 'disabled' : `P${nextPriority}`}`, fleet.ships[0]?.id),
    ],
  });
  return true;
}

function applyResetFleetAutomationPrioritiesOrder(fleetId: string): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && item.faction === 'player');
  if (!fleet) return false;
  const automation = createDefaultFleetAutomationState(fleet.type);
  const updatedFleet: StrategicFleet = {
    ...fleet,
    command: {
      riskTolerance: fleet.command?.riskTolerance ?? 'medium',
      engagementPolicy: fleet.command?.engagementPolicy ?? 'engage_if_advantage',
      preserveCapitalShips: fleet.command?.preserveCapitalShips ?? true,
      ...fleet.command,
      controller: fleet.command?.controller ?? 'player_direct',
      automation,
    },
  };
  useNavalStore.setState({
    fleets: state.fleets.map((item) => item.id === fleet.id ? updatedFleet : item),
    battleLog: [
      ...state.battleLog,
      humanLogEvent(state.currentTurn, `${fleet.name} priority doctrine reset to default`, fleet.ships[0]?.id),
    ],
  });
  return true;
}

function applyFleetPriorityDoctrine(fleetId: string): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && item.faction === 'player');
  if (!fleet) return false;
  const candidates = buildFleetAutomationCandidates(state, fleet)
    .filter((candidate) => candidate.priority > 0)
    .sort((a, b) => a.priority - b.priority || b.urgency - a.urgency);

  for (const candidate of candidates) {
    if (candidate.execute()) {
      markFleetAutomationTask(fleet.id, candidate.workType, state.currentTurn);
      return true;
    }
  }
  return false;
}

function buildFleetAutomationCandidates(state: NavalStoreState, fleet: StrategicFleet): FleetAutomationCandidate[] {
  const priorities = normalizeFleetAutomationState(fleet).priorities;
  const contact = bestFleetObjectiveContact(state.intel.playerContacts);
  const desiredFormation = automatedFormation(state, fleet);
  const candidates: FleetAutomationCandidate[] = [];

  if (hasDamagedShipsForDoctrine(fleet)) {
    candidates.push({
      workType: 'damage_control',
      priority: priorities.damage_control,
      urgency: 100,
      summary: 'detach damaged ships',
      execute: () => applyDetachDamagedShipsOrder(fleet.id, 70),
    });
  }

  if (shouldRecoverAircraftByDoctrine(state, fleet)) {
    candidates.push({
      workType: 'air_recovery',
      priority: priorities.air_recovery,
      urgency: 86,
      summary: 'recover aircraft and clear deck',
      execute: () => applyFleetAirRecoveryOrder(fleet.id),
    });
  }

  if (shouldDeploySmokeScreenByDoctrine(state, fleet)) {
    candidates.push({
      workType: 'smoke_screen',
      priority: priorities.smoke_screen,
      urgency: 92,
      summary: 'make smoke and break contact',
      execute: () => applyFleetSmokeScreenOrder(fleet.id),
    });
  }

  if (shouldEvasiveManeuverByDoctrine(state, fleet)) {
    candidates.push({
      workType: 'evasive_maneuver',
      priority: priorities.evasive_maneuver,
      urgency: 84,
      summary: 'plot evasive zig-zag course',
      execute: () => applyFleetEvasiveManeuverOrder(fleet.id),
    });
  }

  if (!fleet.formation || fleet.formation.type !== desiredFormation) {
    candidates.push({
      workType: 'formation',
      priority: priorities.formation,
      urgency: fleet.formation ? 58 : 78,
      summary: `set formation ${desiredFormation}`,
      execute: () => applyFleetFormationOrder(fleet.id, desiredFormation),
    });
  }

  if (shouldLaunchCapByDoctrine(state, fleet)) {
    candidates.push({
      workType: 'combat_air_patrol',
      priority: priorities.combat_air_patrol,
      urgency: contact ? 82 : 66,
      summary: 'launch defensive CAP',
      execute: () => applyFleetCapOrder(fleet.id),
    });
  }

  if (shouldAutoLaunchSearch(state, fleet)) {
    candidates.push({
      workType: 'search',
      priority: priorities.search,
      urgency: contact ? 76 : 64,
      summary: 'launch sector search',
      execute: () => applyAirSearchSectorOrder(fleet.id, automatedSearchOrder(state, fleet)),
    });
  }

  if (shouldUseRadioSilenceByDoctrine(state, fleet)) {
    candidates.push({
      workType: 'radio_silence',
      priority: priorities.radio_silence,
      urgency: 63,
      summary: 'hold radio silence',
      execute: () => applyFleetRadioSilenceOrder(fleet.id),
    });
  }

  if (shouldShadowContactByDoctrine(state, fleet)) {
    candidates.push({
      workType: 'contact_shadow',
      priority: priorities.contact_shadow,
      urgency: 61,
      summary: 'shadow contact at standoff range',
      execute: () => applyFleetShadowContactOrder(fleet.id),
    });
  }

  if (shouldPrepareStrikeByDoctrine(state, fleet)) {
    candidates.push({
      workType: 'strike_ready',
      priority: priorities.strike_ready,
      urgency: 70,
      summary: 'prepare strike deck cycle',
      execute: () => applyFleetStrikeReadyOrder(fleet.id),
    });
  }

  if (shouldRendezvousByDoctrine(state, fleet)) {
    candidates.push({
      workType: 'rendezvous',
      priority: priorities.rendezvous,
      urgency: fleet.fuelState === 'critical' || fleet.ammoState === 'critical' ? 72 : 52,
      summary: 'route to replenishment rendezvous',
      execute: () => applyFleetRendezvousOrder(fleet.id),
    });
  }

  if (shouldAutoPlotFleetRoute(fleet)) {
    candidates.push({
      workType: 'routing',
      priority: priorities.routing,
      urgency: contact ? 62 : 46,
      summary: 'plot patrol route',
      execute: () => {
        const latest = useNavalStore.getState();
        const currentFleet = latest.fleets.find((item) => item.id === fleet.id && item.faction === 'player');
        if (!currentFleet) return false;
        const destination = automatedPatrolDestination(latest, currentFleet);
        return applyFleetDestinationOrder(currentFleet.id, destination, { mode: automatedRouteMode(currentFleet) });
      },
    });
  }

  return candidates;
}

function createDefaultFleetAutomationState(fleetType?: StrategicFleet['type']) {
  return {
    priorities: createDefaultFleetAutomationPriorities(fleetType),
  };
}

function createDefaultFleetAutomationPriorities(fleetType?: StrategicFleet['type']): FleetAutomationPriorities {
  const carrier = fleetType === 'carrier_task_force';
  return {
    damage_control: 1,
    formation: 1,
    combat_air_patrol: carrier ? 2 : 0,
    contact_shadow: 3,
    evasive_maneuver: 2,
    radio_silence: 3,
    smoke_screen: 1,
    rendezvous: 4,
    search: carrier ? 3 : 4,
    air_recovery: carrier ? 2 : 0,
    routing: 4,
    strike_ready: 0,
  };
}

function normalizeFleetAutomationState(fleet: StrategicFleet) {
  const defaults = createDefaultFleetAutomationState(fleet.type);
  return {
    ...defaults,
    ...fleet.command?.automation,
    priorities: {
      ...defaults.priorities,
      ...(fleet.command?.automation?.priorities ?? {}),
    },
  };
}

function normalizeAutomationPriority(priority: number): FleetAutomationPriority {
  const rounded = Math.round(priority);
  if (rounded <= 0) return 0;
  if (rounded >= 4) return 4;
  return rounded as FleetAutomationPriority;
}

function markFleetAutomationTask(fleetId: string, workType: FleetAutomationWorkType, turn: number): void {
  const latest = useNavalStore.getState();
  const fleet = latest.fleets.find((item) => item.id === fleetId);
  if (!fleet) return;
  const automation = normalizeFleetAutomationState(fleet);
  useNavalStore.setState({
    fleets: latest.fleets.map((item) => item.id === fleet.id ? {
      ...item,
      command: {
        riskTolerance: item.command?.riskTolerance ?? 'medium',
        engagementPolicy: item.command?.engagementPolicy ?? 'engage_if_advantage',
        preserveCapitalShips: item.command?.preserveCapitalShips ?? true,
        ...item.command,
        controller: item.command?.controller ?? 'player_direct',
        automation: {
          ...automation,
          lastTask: workType,
          lastTaskTurn: turn,
        },
      },
    } : item),
  });
}

function hasDamagedShipsForDoctrine(fleet: StrategicFleet): boolean {
  if (fleet.ships.length <= 1) return false;
  return fleet.ships.some((ship) =>
    ship.damage.status !== 'combat_effective' ||
    ship.damage.hullIntegrity <= 70 ||
    ship.damage.flooding >= 30 ||
    ship.damage.fire >= 30
  );
}

function shouldRecoverAircraftByDoctrine(state: NavalStoreState, fleet: StrategicFleet): boolean {
  const hasCarrier = fleet.ships.some((ship) => ship.aircraft && ship.aircraft.deckCycleState !== 'deck_damaged');
  if (!hasCarrier) return false;
  const hasReturningAir = state.airOperations.some((operation) =>
    operation.fleetName === fleet.name && ['turning_home', 'returning'].includes(operation.status)
  );
  const deckBusy = fleet.ships.some((ship) =>
    ship.aircraft && ['launching', 'rearming'].includes(ship.aircraft.deckCycleState)
  );
  return hasReturningAir || deckBusy || fleet.airGroupState === 'depleted';
}

function shouldPrepareStrikeByDoctrine(state: NavalStoreState, fleet: StrategicFleet): boolean {
  const contact = bestFleetObjectiveContact(state.intel.playerContacts);
  if (!contact || !['tracked', 'identified', 'classified', 'confirmed'].includes(contact.detectionLevel)) return false;
  if (state.airOperations.some((operation) => operation.fleetName === fleet.name && operation.type === 'strike' && operation.status !== 'recovered')) return false;
  const carrier = carrierWithReadyAir(fleet);
  return Boolean(carrier?.aircraft && carrier.aircraft.readyAircraft >= 12 && carrier.aircraft.deckCycleState === 'ready');
}

function shouldLaunchCapByDoctrine(state: NavalStoreState, fleet: StrategicFleet): boolean {
  const carrier = carrierWithReadyFighters(fleet, 4);
  if (!carrier?.aircraft) return false;
  if (hasActiveFleetAirOperation(state, fleet, 'cap')) return false;
  if (fleet.operation?.posture === 'aircraft_recovery') return false;
  const contact = bestFleetObjectiveContact(state.intel.playerContacts);
  const contactDistance = contact ? contactDistanceFromFleet(fleet, contact) : Number.POSITIVE_INFINITY;
  const lowVisibility = state.weather === 'fog' || state.weather === 'squall' || state.weather === 'storm';
  return contactDistance < 720 || lowVisibility || state.currentTurn <= 1 || state.currentTurn % 5 === 0;
}

function shouldShadowContactByDoctrine(state: NavalStoreState, fleet: StrategicFleet): boolean {
  const contact = bestFleetObjectiveContact(state.intel.playerContacts);
  if (!contact) return false;
  if (fleet.command?.commanderIntent === 'avoid_contact' || fleet.mission === 'withdraw') return false;
  if (fleet.navigation?.routeSource === 'manual_waypoints' && fleet.navigation.status === 'en_route') return false;
  const distance = contactDistanceFromFleet(fleet, contact);
  const minDistance = fleet.type === 'carrier_task_force' ? 380 : 160;
  if (distance < minDistance || distance > 1250) return false;
  const shadowPoint = shadowPointForContact(state, fleet, contact);
  const destination = fleet.navigation?.destination ?? fleet.targetPosition;
  if (destination && Math.hypot(destination.x - shadowPoint.x, destination.y - shadowPoint.y) < 120) return false;
  return true;
}

function shouldEvasiveManeuverByDoctrine(state: NavalStoreState, fleet: StrategicFleet): boolean {
  if (fleet.command?.riskTolerance === 'high' && fleet.command.commanderIntent === 'seek_decisive_battle') return false;
  if (fleet.navigation?.routeSource === 'manual_waypoints' && fleet.navigation.status === 'en_route') return false;
  const contact = bestFleetObjectiveContact(state.intel.playerContacts);
  if (!contact) return false;
  if (!['detected', 'tracked', 'identified', 'classified', 'confirmed'].includes(contact.detectionLevel)) return false;
  const distance = contactDistanceFromFleet(fleet, contact);
  const dangerRange = fleet.type === 'carrier_task_force' ? 460 : 300;
  if (distance > dangerRange) return false;
  return fleet.operation?.posture !== 'smoke_screen' || (state.currentTurn - fleet.operation.startedTurn) > 1;
}

function shouldUseRadioSilenceByDoctrine(state: NavalStoreState, fleet: StrategicFleet): boolean {
  if (fleet.operation?.posture === 'radio_silence' && (state.currentTurn - fleet.operation.startedTurn) < 3) return false;
  const contact = bestFleetObjectiveContact(state.intel.playerContacts);
  const closeContact = contact ? contactDistanceFromFleet(fleet, contact) < 760 : false;
  const lowVisibility = state.weather === 'fog' || state.weather === 'squall' || state.weather === 'storm';
  return closeContact || lowVisibility;
}

function shouldDeploySmokeScreenByDoctrine(state: NavalStoreState, fleet: StrategicFleet): boolean {
  if (fleet.operation?.posture === 'smoke_screen' && (state.currentTurn - fleet.operation.startedTurn) < 2) return false;
  const contact = bestFleetObjectiveContact(state.intel.playerContacts);
  if (!contact || !['tracked', 'identified', 'classified', 'confirmed'].includes(contact.detectionLevel)) return false;
  const distance = contactDistanceFromFleet(fleet, contact);
  const damaged = fleet.ships.some((ship) => ship.damage.hullIntegrity <= 75 || ship.damage.fire >= 20 || ship.damage.flooding >= 20);
  return distance < 240 || (damaged && distance < 380);
}

function shouldRendezvousByDoctrine(state: NavalStoreState, fleet: StrategicFleet): boolean {
  if (fleet.navigation?.routeSource === 'manual_waypoints' && fleet.navigation.status === 'en_route') return false;
  if (fleet.operation?.posture === 'underway_replenishment' && fleet.navigation?.status === 'en_route') return false;
  const needsSupply = fleet.fuelState !== 'good' || fleet.ammoState !== 'good' || fleet.airGroupState === 'depleted';
  if (!needsSupply) return false;
  const contact = bestFleetObjectiveContact(state.intel.playerContacts);
  if (contact && contactDistanceFromFleet(fleet, contact) < 360 && fleet.fuelState !== 'critical' && fleet.ammoState !== 'critical') return false;
  return Boolean(nearestFriendlyBasePoint(state, fleet));
}

function applyFleetCapOrder(fleetId: string): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && item.faction === 'player');
  if (!fleet || hasActiveFleetAirOperation(state, fleet, 'cap')) return false;
  const carrier = carrierWithReadyFighters(fleet, 4);
  if (!carrier?.aircraft) return false;
  const contact = bestFleetObjectiveContact(state.intel.playerContacts);
  const fighterCount = Math.min(carrier.aircraft.readyAircraft, carrier.aircraft.fighters, contact ? 6 : 4);
  if (fighterCount <= 0) return false;

  let result: { mission: NavalAirMission; airGroup: CarrierAirGroup };
  try {
    result = createCAPMission({ shipId: carrier.id, airGroup: carrier.aircraft, fighterCount });
  } catch (_e) {
    return false;
  }

  const targetArea = {
    x: fleet.position.globalX,
    y: fleet.position.globalY,
    radius: contact ? 64 : 48,
  };
  const mission: NavalAirMission = {
    ...result.mission,
    targetArea,
    aircraftMix: { fighters: result.mission.aircraftCount },
  };
  const updatedAirGroup: CarrierAirGroup = {
    ...result.airGroup,
    sorties: result.airGroup.sorties.map((item) => item.id === result.mission.id ? mission : item),
  };
  const updatedCarrier = { ...carrier, aircraft: updatedAirGroup };
  const op: AirOperation = {
    id: mission.id,
    type: 'cap',
    x: fleet.position.globalX,
    y: fleet.position.globalY,
    originX: fleet.position.globalX,
    originY: fleet.position.globalY,
    originShipId: carrier.id,
    targetX: fleet.position.globalX,
    targetY: fleet.position.globalY,
    heading: fleet.ships[0]?.headingDeg ?? carrier.headingDeg,
    fleetName: fleet.name,
    status: 'outbound',
    aircraft: mission.aircraftCount,
    aircraftMix: { fighters: mission.aircraftCount },
    missionLabel: `CAP orbit F${mission.aircraftCount}`,
    speed: 34,
    range: contact ? 240 : 180,
    progress: 0,
  };
  useNavalStore.setState({
    fleets: state.fleets.map((item) => item.id === fleet.id ? {
      ...fleet,
      mission: fleet.mission === 'withdraw' ? fleet.mission : 'escort',
      airGroupState: updatedAirGroup.readyAircraft > 0 ? 'recovering' : 'depleted',
      ships: fleet.ships.map((ship) => ship.id === carrier.id ? updatedCarrier : ship),
      operation: {
        posture: 'fighter_direction',
        startedTurn: state.currentTurn,
        durationTurns: contact ? 5 : 4,
        targetPosition: targetArea,
        description: `Priority doctrine: CAP launched over the formation with F${mission.aircraftCount}`,
        expectedEffect: 'fighters orbit the fleet briefly, then return for deck recovery',
      },
    } : item),
    intel: { ...state.intel, searchMissions: [...state.intel.searchMissions, mission] },
    airOperations: [...state.airOperations, op],
    battleLog: [...state.battleLog, humanLogEvent(state.currentTurn, `${fleet.name} launched automatic CAP: F${mission.aircraftCount}`, carrier.id)],
  });
  return true;
}

function applyFleetRadioSilenceOrder(fleetId: string): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && item.faction === 'player');
  if (!fleet) return false;
  if (fleet.operation?.posture === 'radio_silence' && (state.currentTurn - fleet.operation.startedTurn) < 3) return false;
  useNavalStore.setState({
    fleets: state.fleets.map((item) => item.id === fleet.id ? {
      ...fleet,
      command: {
        riskTolerance: fleet.command?.riskTolerance ?? 'medium',
        engagementPolicy: fleet.command?.engagementPolicy ?? 'engage_if_advantage',
        preserveCapitalShips: fleet.command?.preserveCapitalShips ?? true,
        ...fleet.command,
        controller: 'player_direct',
        currentOrderId: `priority_radio_silence_${state.currentTurn}`,
      },
      operation: {
        posture: 'radio_silence',
        startedTurn: state.currentTurn,
        durationTurns: 3,
        description: 'Priority doctrine: hold radio silence and visual signaling discipline',
        expectedEffect: 'reduces emissions and delays nonessential fleet communications',
      },
    } : item),
    battleLog: [...state.battleLog, humanLogEvent(state.currentTurn, `${fleet.name} entered radio silence`, fleet.ships[0]?.id)],
  });
  return true;
}

function applyFleetSmokeScreenOrder(fleetId: string): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && item.faction === 'player');
  const contact = fleet ? bestFleetObjectiveContact(state.intel.playerContacts) : undefined;
  if (!fleet || !contact) return false;
  const bearingToContact = navalBearing(fleet.position.globalX, fleet.position.globalY, contact.lastKnownPosition.x, contact.lastKnownPosition.y);
  const smokeHeading = normalizeAngle(bearingToContact + 90);
  useNavalStore.setState({
    fleets: state.fleets.map((item) => item.id === fleet.id ? {
      ...fleet,
      command: {
        riskTolerance: fleet.command?.riskTolerance ?? 'medium',
        engagementPolicy: fleet.command?.engagementPolicy ?? 'engage_if_advantage',
        preserveCapitalShips: true,
        ...fleet.command,
        controller: 'player_direct',
        commanderIntent: 'avoid_contact',
        currentOrderId: `priority_smoke_${state.currentTurn}`,
      },
      ships: fleet.ships.map((ship) => ({
        ...ship,
        headingDeg: normalizeAngle(smokeHeading + (ship.role === 'screen' || ship.role === 'picket' ? 8 : 0)),
        targetSpeedKts: Math.min(ship.motion.maxSpeedKts, Math.max(16, Math.min(ship.targetSpeedKts, 24))),
      })),
      operation: {
        posture: 'smoke_screen',
        startedTurn: state.currentTurn,
        durationTurns: 2,
        targetContactId: contact.id,
        targetPosition: { ...contact.lastKnownPosition },
        description: `Priority doctrine: smoke screen against ${contact.id}`,
        expectedEffect: 'screening ships turn across the threat bearing and mask the carrier/body from gunfire',
      },
    } : item),
    battleLog: [...state.battleLog, humanLogEvent(state.currentTurn, `${fleet.name} made smoke against contact ${contact.id}`, fleet.ships[0]?.id)],
  });
  return true;
}

function applyFleetShadowContactOrder(fleetId: string): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && item.faction === 'player');
  const contact = fleet ? bestFleetObjectiveContact(state.intel.playerContacts) : undefined;
  if (!fleet || !contact) return false;
  const destination = shadowPointForContact(state, fleet, contact);
  const routeMode: FleetNavigationMode = fleet.type === 'carrier_task_force' || fleet.command?.preserveCapitalShips !== false
    ? 'safe_transit'
    : 'combat_approach';
  if (!applyFleetDestinationOrder(fleet.id, destination, { mode: routeMode })) return false;

  const latest = useNavalStore.getState();
  const currentFleet = latest.fleets.find((item) => item.id === fleet.id);
  if (!currentFleet) return true;
  useNavalStore.setState({
    fleets: latest.fleets.map((item) => item.id === currentFleet.id ? {
      ...currentFleet,
      mission: 'search',
      command: {
        riskTolerance: currentFleet.command?.riskTolerance ?? 'medium',
        engagementPolicy: currentFleet.command?.engagementPolicy ?? 'engage_if_advantage',
        preserveCapitalShips: currentFleet.command?.preserveCapitalShips ?? true,
        ...currentFleet.command,
        controller: 'player_direct',
        commanderIntent: 'search',
        currentOrderId: `priority_shadow_${latest.currentTurn}`,
      },
      operation: {
        posture: 'fighter_direction',
        startedTurn: latest.currentTurn,
        targetContactId: contact.id,
        targetPosition: destination,
        description: `Priority doctrine: shadow ${contact.id} from standoff`,
        expectedEffect: 'maintains contact without driving the main body into surface range',
      },
    } : item),
    battleLog: [...latest.battleLog, humanLogEvent(latest.currentTurn, `${currentFleet.name} shadowing ${contact.id} at standoff`, currentFleet.ships[0]?.id)],
  });
  return true;
}

function applyFleetEvasiveManeuverOrder(fleetId: string): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && item.faction === 'player');
  const contact = fleet ? bestFleetObjectiveContact(state.intel.playerContacts) : undefined;
  if (!fleet || !contact) return false;
  const destination = evasionDestinationFromContact(state, fleet, contact);
  const routeMode: FleetNavigationMode = state.weather === 'fog' || state.weather === 'squall' || state.weather === 'storm'
    ? 'night_dash'
    : 'safe_transit';
  if (!applyFleetDestinationOrder(fleet.id, destination, { mode: routeMode })) return false;

  const latest = useNavalStore.getState();
  const currentFleet = latest.fleets.find((item) => item.id === fleet.id);
  if (!currentFleet) return true;
  useNavalStore.setState({
    fleets: latest.fleets.map((item) => item.id === currentFleet.id ? {
      ...currentFleet,
      command: {
        riskTolerance: currentFleet.command?.riskTolerance ?? 'medium',
        engagementPolicy: currentFleet.command?.engagementPolicy ?? 'engage_if_advantage',
        preserveCapitalShips: true,
        ...currentFleet.command,
        controller: 'player_direct',
        commanderIntent: 'avoid_contact',
        currentOrderId: `priority_evasion_${latest.currentTurn}`,
      },
      operation: {
        posture: 'normal',
        startedTurn: latest.currentTurn,
        durationTurns: 2,
        targetContactId: contact.id,
        targetPosition: destination,
        description: `Priority doctrine: evasive dog-leg away from ${contact.id}`,
        expectedEffect: 'changes bearing and speed to complicate interception and air/surface attack setup',
      },
    } : item),
    battleLog: [...latest.battleLog, humanLogEvent(latest.currentTurn, `${currentFleet.name} plotted evasive maneuver away from ${contact.id}`, currentFleet.ships[0]?.id)],
  });
  return true;
}

function applyFleetRendezvousOrder(fleetId: string): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && item.faction === 'player');
  if (!fleet) return false;
  const base = nearestFriendlyBasePoint(state, fleet);
  if (!base) return false;
  const destination = clampToMap(base, state.overlay);
  if (!applyFleetDestinationOrder(fleet.id, destination, { mode: 'rendezvous' })) return false;

  const latest = useNavalStore.getState();
  const currentFleet = latest.fleets.find((item) => item.id === fleet.id);
  if (!currentFleet) return true;
  useNavalStore.setState({
    fleets: latest.fleets.map((item) => item.id === currentFleet.id ? {
      ...currentFleet,
      mission: 'resupply',
      command: {
        riskTolerance: currentFleet.command?.riskTolerance ?? 'medium',
        engagementPolicy: currentFleet.command?.engagementPolicy ?? 'avoid_unless_attacked',
        preserveCapitalShips: true,
        ...currentFleet.command,
        controller: 'player_direct',
        commanderIntent: currentFleet.command?.commanderIntent ?? 'hold_sea_area',
        currentOrderId: `priority_rendezvous_${latest.currentTurn}`,
      },
      operation: {
        posture: 'underway_replenishment',
        startedTurn: latest.currentTurn,
        targetPosition: destination,
        description: 'Priority doctrine: route to friendly replenishment rendezvous',
        expectedEffect: 'restores tempo by moving low-fuel, low-ammunition, or depleted air groups toward support',
      },
    } : item),
    battleLog: [...latest.battleLog, humanLogEvent(latest.currentTurn, `${currentFleet.name} routing to replenishment rendezvous (${destination.x},${destination.y})`, currentFleet.ships[0]?.id)],
  });
  return true;
}

function applyFleetAirRecoveryOrder(fleetId: string): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && item.faction === 'player');
  if (!fleet) return false;
  let changed = false;
  const ships = fleet.ships.map((ship) => {
    if (!ship.aircraft || ship.aircraft.deckCycleState === 'deck_damaged') return ship;
    if (ship.aircraft.deckCycleState !== 'recovering') changed = true;
    return {
      ...ship,
      aircraft: {
        ...ship.aircraft,
        deckCycleState: 'recovering' as const,
      },
    };
  });
  if (!changed && fleet.operation?.posture === 'aircraft_recovery') return false;
  useNavalStore.setState({
    fleets: state.fleets.map((item) => item.id === fleet.id ? {
      ...fleet,
      airGroupState: 'recovering',
      ships,
      operation: {
        posture: 'aircraft_recovery',
        startedTurn: state.currentTurn,
        durationTurns: 1,
        description: 'Priority doctrine: recovering aircraft and clearing carrier deck cycle',
        expectedEffect: 'returning aircraft and deck cycle are prioritized before new launches',
      },
    } : item),
    battleLog: [...state.battleLog, humanLogEvent(state.currentTurn, `${fleet.name} priority doctrine ordered aircraft recovery`, fleet.ships[0]?.id)],
  });
  return true;
}

function applyFleetStrikeReadyOrder(fleetId: string): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && item.faction === 'player');
  if (!fleet) return false;
  const carrier = carrierWithReadyAir(fleet);
  if (!carrier?.aircraft || carrier.aircraft.readyAircraft < 12 || carrier.aircraft.deckCycleState !== 'ready') return false;
  const updatedCarrier = {
    ...carrier,
    aircraft: {
      ...carrier.aircraft,
      deckCycleState: 'rearming' as const,
    },
  };
  useNavalStore.setState({
    fleets: state.fleets.map((item) => item.id === fleet.id ? {
      ...fleet,
      mission: 'carrier_strike',
      airGroupState: 'recovering',
      ships: fleet.ships.map((ship) => ship.id === carrier.id ? updatedCarrier : ship),
      command: {
        riskTolerance: fleet.command?.riskTolerance ?? 'medium',
        engagementPolicy: fleet.command?.engagementPolicy ?? 'carrier_strike_only',
        preserveCapitalShips: fleet.command?.preserveCapitalShips ?? true,
        ...fleet.command,
        controller: 'player_direct',
        commanderIntent: 'strike',
        currentOrderId: `priority_strike_ready_${state.currentTurn}`,
      },
      operation: {
        posture: 'strike_preparation',
        startedTurn: state.currentTurn,
        durationTurns: 1,
        description: 'Priority doctrine: preparing carrier deck for strike, no strike launched without explicit order',
        expectedEffect: 'air group is reserved for a confirmed strike decision',
      },
    } : item),
    battleLog: [...state.battleLog, humanLogEvent(state.currentTurn, `${fleet.name} priority doctrine prepared strike deck; strike still requires explicit order`, carrier.id)],
  });
  return true;
}

function automationWorkLabel(workType: FleetAutomationWorkType): string {
  switch (workType) {
    case 'damage_control': return 'damage control';
    case 'formation': return 'formation';
    case 'routing': return 'routing';
    case 'search': return 'search';
    case 'combat_air_patrol': return 'combat air patrol';
    case 'contact_shadow': return 'contact shadowing';
    case 'evasive_maneuver': return 'evasive maneuver';
    case 'radio_silence': return 'radio silence';
    case 'smoke_screen': return 'smoke screen';
    case 'rendezvous': return 'rendezvous';
    case 'air_recovery': return 'air recovery';
    case 'strike_ready': return 'strike readiness';
    default: {
      const _exhaustive: never = workType;
      return _exhaustive;
    }
  }
}

function shouldAutoPlotFleetRoute(fleet: StrategicFleet): boolean {
  if (!fleet.targetPosition && !fleet.navigation) return true;
  return fleet.navigation?.status === 'arrived' || fleet.navigation?.status === 'blocked';
}

function shouldAutoLaunchSearch(state: NavalStoreState, fleet: StrategicFleet): boolean {
  const activeSearch = state.airOperations.some((operation) =>
    operation.type === 'search' && operation.fleetName === fleet.name && operation.status !== 'recovered'
  );
  if (activeSearch) return false;
  const carrier = fleet.ships.find((ship) =>
    ship.aircraft &&
    ship.aircraft.readyAircraft >= 4 &&
    ship.aircraft.deckCycleState === 'ready'
  );
  return Boolean(carrier);
}

function automatedRouteMode(fleet: StrategicFleet): FleetNavigationMode {
  if (fleet.command?.commanderIntent === 'withdraw' || fleet.mission === 'withdraw') return 'withdrawal';
  if (fleet.command?.riskTolerance === 'low' || fleet.command?.preserveCapitalShips !== false) return 'safe_transit';
  if (fleet.command?.commanderIntent === 'destroy_enemy_carriers' || fleet.command?.commanderIntent === 'seek_decisive_battle') return 'combat_approach';
  return 'safe_transit';
}

function automatedPatrolDestination(state: NavalStoreState, fleet: StrategicFleet): { x: number; y: number } {
  const width = state.overlay?.[0]?.length ?? 3000;
  const height = state.overlay?.length ?? 2000;
  const contact = bestFleetObjectiveContact(state.intel.playerContacts);
  if (contact) {
    const dx = contact.lastKnownPosition.x - fleet.position.globalX;
    const dy = contact.lastKnownPosition.y - fleet.position.globalY;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const standOff = fleet.type === 'carrier_task_force' ? 520 : 220;
    return clampToMap({
      x: Math.round(contact.lastKnownPosition.x - (dx / distance) * standOff),
      y: Math.round(contact.lastKnownPosition.y - (dy / distance) * standOff),
    }, state.overlay);
  }

  const patrolPoints = [
    { x: width * 0.56, y: height * 0.56 },
    { x: width * 0.62, y: height * 0.42 },
    { x: width * 0.48, y: height * 0.36 },
    { x: width * 0.68, y: height * 0.6 },
  ];
  const index = Math.abs((state.currentTurn + fleet.id.length) % patrolPoints.length);
  const point = patrolPoints[index];
  return clampToMap({ x: Math.round(point.x), y: Math.round(point.y) }, state.overlay);
}

function automatedSearchOrder(state: NavalStoreState, fleet: StrategicFleet): AirSearchSectorOrder {
  const width = state.overlay?.[0]?.length ?? 3000;
  const height = state.overlay?.length ?? 2000;
  const contact = bestFleetObjectiveContact(state.intel.playerContacts);
  const target = contact?.lastKnownPosition ?? { x: width * 0.64, y: height * 0.5 };
  const headingDeg = navalBearing(fleet.position.globalX, fleet.position.globalY, target.x, target.y);
  const readiness = fleet.ships.reduce((sum, ship) => sum + (ship.aircraft?.readyAircraft ?? 0), 0);
  const scouts = readiness >= 18 ? 6 : 4;
  const fighters = contact ? 2 : 1;
  return {
    headingDeg,
    arcWidthDeg: contact ? 54 : 82,
    range: contact ? 460 : 390,
    scouts,
    fighters,
  };
}

function automatedFormation(state: NavalStoreState, fleet: StrategicFleet): FleetFormationType {
  const contact = bestFleetObjectiveContact(state.intel.playerContacts);
  if (contact && ['tracked', 'identified', 'classified', 'confirmed'].includes(contact.detectionLevel)) {
    return fleet.type === 'carrier_task_force' ? 'circular_screen' : 'line_abreast';
  }
  if (fleet.mission === 'search' || fleet.type === 'carrier_task_force') return 'scout_line';
  if (fleet.mission === 'withdraw') return 'column';
  return 'standard_screen';
}

function criticalAutoPauseEvent(fleets: StrategicFleet[], contacts: NavalContact[]): { key: string; summary: string } | undefined {
  const severeShip = fleets
    .filter((fleet) => fleet.faction === 'player')
    .flatMap((fleet) => fleet.ships)
    .find((ship) =>
      ship.damage.status === 'crippled' ||
      ship.damage.status === 'sinking' ||
      ship.damage.flooding >= 60 ||
      ship.damage.hullIntegrity <= 35
    );
  if (severeShip) {
    return {
      key: `ship_${severeShip.id}_${severeShip.damage.status}_${Math.floor(severeShip.damage.hullIntegrity / 5)}`,
      summary: `${severeShip.name} requires damage decision`,
    };
  }

  const contact = contacts.find((item) =>
    item.factionEstimate === 'enemy' &&
    ['tracked', 'identified', 'classified', 'confirmed'].includes(item.detectionLevel)
  );
  if (!contact) return undefined;
  return {
    key: `contact_${contact.originalEntityId || contact.id}_${contact.detectionLevel}`,
    summary: `high-confidence enemy contact ${contact.estimatedClass || contact.id}`,
  };
}

function executeHumanCommandReceipt(receipt: HumanCommandReceipt): HumanCommandReceipt {
  const state = useNavalStore.getState();
  const messages: string[] = [];

  for (const order of receipt.specialOrders) {
    messages.push(executeSpecialHumanOrder(order));
  }

  if (receipt.actions.length > 0) {
    if (state.localMultiplayer.mode === 'human_multiplayer') {
      messages.push(...executeLocalMultiplayerDecisionActions(receipt));
    } else {
      const { knowledge, context } = buildHumanCommandValidationContext(state);
      const decision = humanReceiptToDecision(receipt);
      const validation = validateLLMCommanderDecision({ decision, context, knowledge });
      const execution = validation.acceptedActions.length > 0
        ? executeLLMDecisionActions({
            actions: validation.acceptedActions,
            storeCalls: createRealStoreCalls({ state: useNavalStore, faction: 'player', currentTurn: state.currentTurn }),
            currentTurn: state.currentTurn,
          })
        : undefined;

      messages.push(...validation.rejectedActions.map((item) => `Rejected ${item.action.type}: ${item.reason}`));
      messages.push(...(execution?.executed.map((item) => item.result || `${item.action.type} executed`) || []));
      messages.push(...(execution?.failed.map((item) => `Failed ${item.action.type}: ${item.reason}`) || []));
    }
  }

  const finalReceipt: HumanCommandReceipt = {
    ...receipt,
    accepted: messages.length > 0 && !messages.every((message) => message.startsWith('Rejected') || message.startsWith('Failed')),
    resultSummary: messages.join('; ') || 'No state change',
  };
  const latest = useNavalStore.getState();
  useNavalStore.setState({
    commandHistory: [...latest.commandHistory, finalReceipt],
    reports: [...latest.reports, createHumanCommandReport(finalReceipt, 'REQUEST_AUTHORIZATION', finalReceipt.resultSummary || receipt.summary)],
  });
  return finalReceipt;
}

function executeLocalMultiplayerDecisionActions(receipt: HumanCommandReceipt): string[] {
  const messages: string[] = [];
  for (const action of receipt.actions) {
    const state = useNavalStore.getState();
    const fleet = state.fleets.find((item) => item.id === action.fleetId);
    if (!fleet || (fleet.faction !== 'player' && fleet.faction !== 'enemy')) {
      messages.push(`Failed ${action.type}: fleet ${action.fleetId || 'unknown'} unavailable for local multiplayer`);
      continue;
    }
    const execution = executeLLMDecisionActions({
      actions: [action],
      storeCalls: createRealStoreCalls({
        state: useNavalStore,
        faction: fleet.faction,
        currentTurn: state.currentTurn,
      }),
      currentTurn: state.currentTurn,
    });
    messages.push(...execution.executed.map((item) => item.result || `${item.action.type} executed`));
    messages.push(...execution.failed.map((item) => `Failed ${item.action.type}: ${item.reason}`));
  }
  return messages;
}

function executeSpecialHumanOrder(order: HumanSpecialOrder): string {
  const state = useNavalStore.getState();
  const localHumanMode = state.localMultiplayer.mode === 'human_multiplayer';
  switch (order.type) {
    case 'split_fleet':
      return applySplitFleetOrder(order.sourceFleetId, order.shipIds, order.newFleetName, {
        allowAnyFaction: localHumanMode,
        ownerPlayerId: localHumanMode ? state.localMultiplayer.activePlayerId : undefined,
      })
        ? `Split fleet ${order.sourceFleetId}`
        : `Failed split fleet ${order.sourceFleetId}`;
    case 'direct_ship_control':
      return applyDirectShipControlOrder(order.fleetId, order.shipId, {
        headingDeg: order.headingDeg,
        speedKts: order.speedKts,
        targetPosition: order.targetPosition,
        reason: order.reason,
      }, { allowAnyFaction: localHumanMode, actorPlayerId: state.localMultiplayer.activePlayerId })
        ? `Direct control ${order.shipId}`
        : `Failed direct control ${order.shipId}`;
    case 'delegate_ai':
      return applyDelegateTemplate(order.fleetId, order.template)
        ? `Delegated ${order.template}`
        : `Failed delegate ${order.template}`;
    case 'assign_objective':
      return applyFleetObjectiveOrder(order.fleetIds, order.objective)
        ? `Assigned objective ${order.objective}`
        : `Failed objective ${order.objective}`;
    case 'fleet_message':
      return applyFleetMessageOrder(order.fromFleetId, order.toFleetId, order.message)
        ? `Message ${order.fromFleetId}->${order.toFleetId}`
        : `Failed message ${order.fromFleetId}->${order.toFleetId}`;
    default: {
      const _exhaustive: never = order;
      return `Unhandled special order ${String(_exhaustive)}`;
    }
  }
}

function applyFleetDestinationOrder(fleetId: string, destination: { x: number; y: number }, options: { mode?: FleetNavigationMode } = {}): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && item.faction === 'player');
  if (!fleet) return false;
  const clamped = clampToMap(destination, state.overlay);
  const route = buildFleetNavigationRoute(
    { x: fleet.position.globalX, y: fleet.position.globalY },
    clamped,
    state.overlay,
    { mode: options.mode ?? navigationModeForFleet(fleet), desiredSpeedKts: fleetCruiseSpeed(fleet) },
  );
  const heading = navalBearing(
    fleet.position.globalX,
    fleet.position.globalY,
    route.path[0]?.x ?? route.destination.x,
    route.path[0]?.y ?? route.destination.y,
  );
  const updatedFleet: StrategicFleet = {
    ...fleet,
    targetPosition: route.destination,
    navigation: route,
    mission: 'patrol',
    command: {
      riskTolerance: fleet.command?.riskTolerance ?? 'medium',
      engagementPolicy: fleet.command?.engagementPolicy ?? 'engage_if_advantage',
      preserveCapitalShips: fleet.command?.preserveCapitalShips ?? true,
      ...fleet.command,
      controller: 'player_direct',
      currentOrderId: `destination_${state.currentTurn}`,
    },
    ships: fleet.ships.map((ship) => ({
      ...ship,
      headingDeg: heading,
      rudderDeg: 0,
      targetSpeedKts: Math.min(ship.motion.maxSpeedKts, Math.max(ship.targetSpeedKts, 22)),
    })),
  };
  useNavalStore.setState({
    fleets: state.fleets.map((item) => item.id === fleet.id ? updatedFleet : item),
    battleLog: [
      ...state.battleLog,
      humanLogEvent(
        state.currentTurn,
        `${fleet.name} destination set to (${route.destination.x},${route.destination.y}); ${route.mode} route ${route.path.length} waypoint(s), ETA ${route.etaTurns ?? '?'} turn(s), risk ${route.routeRisk ?? 'unknown'}`,
        fleet.ships[0]?.id,
      ),
    ],
  });
  return true;
}

function applyFleetWaypointsOrder(fleetId: string, waypoints: Array<{ x: number; y: number }>, options: { mode?: FleetNavigationMode } = {}): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && item.faction === 'player');
  if (!fleet) return false;
  const manualWaypoints = normalizeManualWaypoints(
    { x: fleet.position.globalX, y: fleet.position.globalY },
    waypoints,
    state.overlay,
  );
  if (manualWaypoints.length === 0) return false;
  const route = buildFleetNavigationRouteThroughWaypoints(
    { x: fleet.position.globalX, y: fleet.position.globalY },
    manualWaypoints,
    state.overlay,
    { mode: options.mode ?? navigationModeForFleet(fleet), desiredSpeedKts: fleetCruiseSpeed(fleet) },
  );
  const heading = navalBearing(
    fleet.position.globalX,
    fleet.position.globalY,
    route.path[0]?.x ?? route.destination.x,
    route.path[0]?.y ?? route.destination.y,
  );
  const moving = route.status !== 'blocked' && route.status !== 'arrived';
  const updatedFleet: StrategicFleet = {
    ...fleet,
    targetPosition: route.destination,
    navigation: route,
    mission: 'patrol',
    command: {
      riskTolerance: fleet.command?.riskTolerance ?? 'medium',
      engagementPolicy: fleet.command?.engagementPolicy ?? 'engage_if_advantage',
      preserveCapitalShips: fleet.command?.preserveCapitalShips ?? true,
      ...fleet.command,
      controller: 'player_direct',
      currentOrderId: `waypoints_${state.currentTurn}`,
    },
    ships: fleet.ships.map((ship) => ({
      ...ship,
      headingDeg: moving ? heading : ship.headingDeg,
      rudderDeg: 0,
      targetSpeedKts: moving
        ? Math.min(ship.motion.maxSpeedKts, Math.max(ship.targetSpeedKts, 22))
        : Math.min(ship.targetSpeedKts, 6),
    })),
  };
  useNavalStore.setState({
    fleets: state.fleets.map((item) => item.id === fleet.id ? updatedFleet : item),
    battleLog: [
      ...state.battleLog,
      humanLogEvent(
        state.currentTurn,
        `${fleet.name} manual waypoint route set: ${manualWaypoints.length} control point(s), ${route.path.length} plotted leg waypoint(s), ETA ${route.etaTurns ?? '?'} turn(s), risk ${route.routeRisk ?? 'unknown'}`,
        fleet.ships[0]?.id,
      ),
    ],
  });
  return true;
}

function applyClearFleetNavigationOrder(fleetId: string): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && item.faction === 'player');
  if (!fleet) return false;
  useNavalStore.setState({
    fleets: state.fleets.map((item) => item.id === fleet.id ? {
      ...item,
      targetPosition: undefined,
      navigation: undefined,
      ships: item.ships.map((ship) => ({
        ...ship,
        rudderDeg: 0,
        targetSpeedKts: Math.min(ship.targetSpeedKts, 6),
      })),
      command: item.command ? {
        ...item.command,
        controller: 'player_direct',
        currentOrderId: `clear_route_${state.currentTurn}`,
      } : item.command,
    } : item),
    battleLog: [
      ...state.battleLog,
      humanLogEvent(state.currentTurn, `${fleet.name} navigation route cleared`, fleet.ships[0]?.id),
    ],
  });
  return true;
}

function applyDirectionalSearchOrder(fleetId: string, headingDeg: number, aircraftCount: number, range: number): boolean {
  return applyAirSearchSectorOrder(fleetId, {
    headingDeg,
    arcWidthDeg: 30,
    range,
    diveBombers: aircraftCount,
  });
}

function applyAirSearchSectorOrder(fleetId: string, order: AirSearchSectorOrder): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && (state.localMultiplayer.mode === 'human_multiplayer' || item.faction === 'player'));
  if (!fleet) return false;
  const carrier = carrierWithReadyAir(fleet);
  if (!carrier?.aircraft) return false;

  const formation = fleet.formation || createFleetFormation('standard_screen', state.currentTurn);
  const heading = normalizeAngle(Math.round(order.headingDeg));
  const requestedRange = Math.max(40, Math.min(700, order.range));
  const effectiveRange = Math.round(requestedRange * formation.searchRangeModifier);
  const effectiveArc = Math.max(20, Math.min(180, Math.round(order.arcWidthDeg * formation.searchArcModifier)));
  const mix = normalizeAirSelection(order, { diveBombers: 4 });
  const allocation = allocateAirGroup(carrier.aircraft, mix, 'search');
  if (!allocation) return false;
  const prepTurns = 1;
  const teamCount = clampSearchTeamCount(order.teams ?? 1, allocation.total);
  const teamMixes = splitAirSelectionIntoTeams(allocation.mix, teamCount);
  if (teamMixes.length === 0) return false;

  let workingAirGroup = carrier.aircraft;
  const missions: NavalAirMission[] = [];
  const airOperations: AirOperation[] = [];
  const targetPoints: Array<{ x: number; y: number }> = [];
  teamMixes.forEach((teamMix, index) => {
    const teamHeading = searchTeamHeading(heading, effectiveArc, index, teamMixes.length);
    const rad = teamHeading * Math.PI / 180;
    const target = clampToMap({
      x: Math.round(carrier.position.x + Math.sin(rad) * effectiveRange),
      y: Math.round(carrier.position.y - Math.cos(rad) * effectiveRange),
    }, state.overlay);
    const teamAircraft = airSelectionTotal(teamMix);
    if (teamAircraft <= 0) return;
    let result: { mission: NavalAirMission; airGroup: CarrierAirGroup };
    try {
      result = createSearchMission({
        shipId: carrier.id,
        airGroup: workingAirGroup,
        targetArea: { x: target.x, y: target.y, radius: Math.max(28, Math.round(effectiveRange * 0.12)) },
        originPosition: { x: carrier.position.x, y: carrier.position.y },
        searchArcDeg: { centerDeg: teamHeading, widthDeg: Math.max(18, Math.round(effectiveArc / Math.max(1, teamMixes.length))), range: effectiveRange },
        aircraftCount: teamAircraft,
        prepTurns,
      });
    } catch (_error) {
      return;
    }
    const mission: NavalAirMission = {
      ...result.mission,
      aircraftMix: teamMix,
    };
    workingAirGroup = {
      ...result.airGroup,
      sorties: result.airGroup.sorties.map((item) => item.id === result.mission.id ? mission : item),
    };
    missions.push(mission);
    targetPoints.push(target);
    airOperations.push({
      id: mission.id,
      type: 'search',
      x: carrier.position.x,
      y: carrier.position.y,
      originX: carrier.position.x,
      originY: carrier.position.y,
      originShipId: carrier.id,
      targetX: target.x,
      targetY: target.y,
      heading: teamHeading,
      fleetName: fleet.name,
      status: 'preparing',
      aircraft: mission.aircraftCount,
      aircraftMix: teamMix,
      arcWidthDeg: Math.max(18, Math.round(effectiveArc / Math.max(1, teamMixes.length))),
      teamIndex: index,
      teamCount: teamMixes.length,
      missionLabel: `Preparing search team ${index + 1}/${teamMixes.length} ${teamHeading}deg`,
      speed: 34,
      range: effectiveRange,
      progress: 0,
      prepTurns,
      readyTurn: state.currentTurn + prepTurns,
      reportedShipIds: [],
      sweepPoints: [{ x: carrier.position.x, y: carrier.position.y }],
      sweepRadius: searchTeamSweepRadius(teamAircraft, effectiveRange),
    });
  });
  if (missions.length === 0 || airOperations.length === 0) return false;
  const updatedAirGroup = workingAirGroup;
  const updatedCarrier = { ...carrier, aircraft: updatedAirGroup };
  const target = targetPoints[Math.floor(targetPoints.length / 2)] ?? targetPoints[0];
  useNavalStore.setState({
    fleets: state.fleets.map((item) => item.id === fleet.id
      ? {
          ...fleet,
          mission: 'search',
          airGroupState: updatedAirGroup.readyAircraft > 0 ? 'recovering' : 'depleted',
          ships: fleet.ships.map((ship) => ship.id === carrier.id ? updatedCarrier : ship),
          operation: {
            posture: 'aircraft_recovery',
            startedTurn: state.currentTurn,
            durationTurns: prepTurns,
            targetPosition: target,
            description: `Air search fan preparing: ${missions.length} team(s), ${airMixText(allocation.mix)} heading ${heading} arc ${effectiveArc} range ${effectiveRange}`,
            expectedEffect: 'selected aircraft split into equal fan headings, sweep along their tracks, and return to the carrier',
          },
        }
      : item),
    intel: { ...state.intel, searchMissions: [...state.intel.searchMissions, ...missions] },
    airOperations: [...state.airOperations, ...airOperations],
    battleLog: [
      ...state.battleLog,
      humanLogEvent(state.currentTurn, `${fleet.name} preparing fan search: ${missions.length} team(s), ${airMixText(allocation.mix)} heading ${heading} arc ${effectiveArc} range ${effectiveRange}; launch in ${prepTurns} turn`, carrier.id),
    ],
  });
  return true;
}

function applyAirStrikeGroupOrder(fleetId: string, order: AirStrikeGroupOrder): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && (state.localMultiplayer.mode === 'human_multiplayer' || item.faction === 'player'));
  if (!fleet) return false;
  const contacts = fleet.faction === 'enemy' ? state.intel.enemyContacts : state.intel.playerContacts;
  const contact = contacts.find((item) => item.id === order.contactId);
  if (!contact || !['tracked', 'identified', 'classified', 'confirmed'].includes(contact.detectionLevel)) return false;
  const carrier = carrierWithReadyAir(fleet);
  if (!carrier?.aircraft) return false;
  const mix = normalizeAirSelection(order, { fighters: 2, diveBombers: 6, torpedoBombers: 2 });
  const allocation = allocateAirGroup(carrier.aircraft, mix, 'strike');
  if (!allocation) return false;
  const result = createStrikeMission({
    shipId: carrier.id,
    airGroup: carrier.aircraft,
    targetContactId: contact.id,
    targetArea: { x: contact.lastKnownPosition.x, y: contact.lastKnownPosition.y, radius: Math.max(12, contact.uncertaintyRadius) },
    aircraftCount: allocation.total,
  });
  const mission: NavalAirMission = {
    ...result.mission,
    aircraftMix: allocation.mix,
  };
  const updatedAirGroup: CarrierAirGroup = {
    ...result.airGroup,
    sorties: result.airGroup.sorties.map((item) => item.id === result.mission.id ? mission : item),
  };
  const updatedCarrier = { ...carrier, aircraft: updatedAirGroup };
  const heading = navalBearing(carrier.position.x, carrier.position.y, contact.lastKnownPosition.x, contact.lastKnownPosition.y);
  const op: AirOperation = {
    id: mission.id,
    type: 'strike',
    x: carrier.position.x,
    y: carrier.position.y,
    originX: carrier.position.x,
    originY: carrier.position.y,
    originShipId: carrier.id,
    targetX: contact.lastKnownPosition.x,
    targetY: contact.lastKnownPosition.y,
    heading,
    fleetName: fleet.name,
    status: 'outbound',
    aircraft: mission.aircraftCount,
    aircraftMix: allocation.mix,
    targetContactId: contact.id,
    missionLabel: `Strike group ${airMixText(allocation.mix)}`,
    speed: 34,
    range: Math.round(Math.hypot(contact.lastKnownPosition.x - carrier.position.x, contact.lastKnownPosition.y - carrier.position.y)),
    progress: 0,
  };
  useNavalStore.setState({
    fleets: state.fleets.map((item) => item.id === fleet.id
      ? {
          ...fleet,
          mission: 'carrier_strike',
          airGroupState: updatedAirGroup.readyAircraft > 0 ? 'recovering' : 'depleted',
          ships: fleet.ships.map((ship) => ship.id === carrier.id ? updatedCarrier : ship),
          operation: {
            posture: 'strike_preparation',
            startedTurn: state.currentTurn,
            durationTurns: 1,
            targetContactId: contact.id,
            targetPosition: { ...contact.lastKnownPosition },
            description: `Strike group launched against ${contact.id}: ${airMixText(allocation.mix)}`,
            expectedEffect: 'strike aircraft attack high-confidence contact and return',
          },
        }
      : item),
    intel: { ...state.intel, searchMissions: [...state.intel.searchMissions, mission] },
    airOperations: [...state.airOperations, op],
    battleLog: [
      ...state.battleLog,
      humanLogEvent(state.currentTurn, `${fleet.name} launched strike group against ${contact.id}: ${airMixText(allocation.mix)}`, carrier.id),
    ],
  });
  return true;
}

function applyCarrierAirGroupEditOrder(fleetId: string, shipId: string, order: AirGroupEditOrder): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && (state.localMultiplayer.mode === 'human_multiplayer' || item.faction === 'player'));
  if (!fleet) return false;
  const carrier = fleet.ships.find((ship) => ship.id === shipId && ship.aircraft);
  if (!carrier?.aircraft) return false;

  const fighters = clampAirGroupCount(order.fighters ?? carrier.aircraft.fighters, 96);
  const diveBombers = clampAirGroupCount(order.diveBombers ?? carrier.aircraft.diveBombers, 96);
  const torpedoBombers = clampAirGroupCount(order.torpedoBombers ?? carrier.aircraft.torpedoBombers, 72);
  const total = fighters + diveBombers + torpedoBombers;
  const readyAircraft = clampAirGroupCount(order.readyAircraft ?? carrier.aircraft.readyAircraft, total);
  const nextAirGroup: CarrierAirGroup = {
    ...carrier.aircraft,
    fighters,
    diveBombers,
    torpedoBombers,
    readyAircraft,
    deckCycleState: carrier.aircraft.deckCycleState === 'deck_damaged'
      ? 'deck_damaged'
      : readyAircraft > 0 ? 'ready' : carrier.aircraft.deckCycleState,
  };
  const changed =
    nextAirGroup.fighters !== carrier.aircraft.fighters ||
    nextAirGroup.diveBombers !== carrier.aircraft.diveBombers ||
    nextAirGroup.torpedoBombers !== carrier.aircraft.torpedoBombers ||
    nextAirGroup.readyAircraft !== carrier.aircraft.readyAircraft;
  if (!changed) return false;

  useNavalStore.setState({
    fleets: state.fleets.map((item) => item.id === fleet.id ? {
      ...fleet,
      airGroupState: readyAircraft > 0 ? 'ready' : 'depleted',
      ships: fleet.ships.map((ship) => ship.id === carrier.id ? { ...carrier, aircraft: nextAirGroup } : ship),
    } : item),
    battleLog: [
      ...state.battleLog,
      humanLogEvent(state.currentTurn, `${carrier.name} air group edited: F${fighters}/DB${diveBombers}/TB${torpedoBombers}, ready ${readyAircraft}`, carrier.id),
    ],
  });
  return true;
}

function applyFleetFormationOrder(fleetId: string, formationType: FleetFormationType): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && (state.localMultiplayer.mode === 'human_multiplayer' || item.faction === 'player'));
  if (!fleet) return false;
  const formation = createFleetFormation(formationType, state.currentTurn);
  const updatedFleet: StrategicFleet = {
    ...fleet,
    formation,
    ships: applyFormationToShips(fleet, formation),
    operation: {
      posture: formationType === 'scout_line' || formationType === 'line_abreast' ? 'fighter_direction' : 'normal',
      startedTurn: state.currentTurn,
      description: `Formation set: ${formation.description}`,
      expectedEffect: `search x${formation.searchArcModifier.toFixed(2)}, AA center x${formation.antiAirCenterModifier.toFixed(2)}`,
    },
  };
  useNavalStore.setState({
    fleets: state.fleets.map((item) => item.id === fleet.id ? updatedFleet : item),
    battleLog: [...state.battleLog, humanLogEvent(state.currentTurn, `${fleet.name} changed formation to ${formation.description}`, fleet.ships[0]?.id)],
  });
  return true;
}

function applyDetachDamagedShipsOrder(fleetId: string, hullThreshold: number): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && (state.localMultiplayer.mode === 'human_multiplayer' || item.faction === 'player'));
  if (!fleet) return false;
  const threshold = Math.max(5, Math.min(95, hullThreshold));
  const shipIds = fleet.ships
    .filter((ship) => ship.damage.status !== 'combat_effective' || ship.damage.hullIntegrity <= threshold || ship.damage.flooding >= 30 || ship.damage.fire >= 30)
    .map((ship) => ship.id);
  return applyDetachShipsWithdrawOrder(fleetId, shipIds);
}

function applyDetachShipsWithdrawOrder(fleetId: string, shipIds: string[]): boolean {
  const before = useNavalStore.getState();
  const source = before.fleets.find((fleet) => fleet.id === fleetId && (before.localMultiplayer.mode === 'human_multiplayer' || fleet.faction === 'player'));
  if (!source) return false;
  const uniqueShipIds = [...new Set(shipIds)].filter((id) => source.ships.some((ship) => ship.id === id));
  if (uniqueShipIds.length === 0 || uniqueShipIds.length >= source.ships.length) return false;
  const ownerPlayerId = before.localMultiplayer.fleetOwners[source.id] || defaultOwnerForFaction(source.faction);
  const ok = applySplitFleetOrder(fleetId, uniqueShipIds, `${source.name} Withdrawal Element`, {
    allowAnyFaction: before.localMultiplayer.mode === 'human_multiplayer',
    ownerPlayerId,
    actorPlayerId: before.localMultiplayer.activePlayerId,
  });
  if (!ok) return false;
  const state = useNavalStore.getState();
  const detached = state.fleets.find((fleet) => uniqueShipIds.every((id) => fleet.ships.some((ship) => ship.id === id)));
  if (!detached) return true;
  const fallback = nearestFriendlyBasePoint(state, detached) || { x: Math.max(0, detached.position.globalX - 180), y: detached.position.globalY };
  const target = clampToMap(fallback, state.overlay);
  const route = buildFleetNavigationRoute(
    { x: detached.position.globalX, y: detached.position.globalY },
    target,
    state.overlay,
    { mode: 'withdrawal', desiredSpeedKts: fleetCruiseSpeed(detached) },
  );
  const heading = navalBearing(
    detached.position.globalX,
    detached.position.globalY,
    route.path[0]?.x ?? route.destination.x,
    route.path[0]?.y ?? route.destination.y,
  );
  useNavalStore.setState({
    fleets: state.fleets.map((fleet) => fleet.id === detached.id ? {
      ...fleet,
      mission: 'withdraw',
      targetPosition: route.destination,
      navigation: route,
      command: {
        ...fleet.command,
        controller: fleet.faction === 'enemy' ? 'enemy_ai' as const : 'player_direct' as const,
        commanderIntent: 'withdraw' as const,
        currentOrderId: `damage_withdraw_${state.currentTurn}`,
      },
      ships: fleet.ships.map((ship) => ({
        ...ship,
        headingDeg: heading,
        targetSpeedKts: Math.min(ship.motion.maxSpeedKts, Math.max(12, ship.targetSpeedKts)),
      })),
      operation: {
        posture: 'underway_replenishment',
        startedTurn: state.currentTurn,
        targetPosition: route.destination,
        description: `Damaged ships detached on ${route.routeRisk ?? 'unknown'}-risk withdrawal route`,
        expectedEffect: `preserve damaged ships; ETA ${route.etaTurns ?? '?'} turn(s) to repair/supply point`,
      },
    } : fleet),
    battleLog: [...state.battleLog, humanLogEvent(state.currentTurn, `${detached.name} ordered to withdraw damaged ships toward (${route.destination.x},${route.destination.y}); ETA ${route.etaTurns ?? '?'} risk ${route.routeRisk ?? 'unknown'}`, detached.ships[0]?.id)],
  });
  return true;
}
function carrierWithReadyAir(fleet: StrategicFleet): NavalShip | undefined {
  return fleet.ships.find((ship) => ship.aircraft && ship.aircraft.readyAircraft > 0 && ship.aircraft.deckCycleState !== 'deck_damaged');
}

function carrierWithReadyFighters(fleet: StrategicFleet, minimumFighters: number): NavalShip | undefined {
  return fleet.ships.find((ship) =>
    ship.aircraft &&
    ship.aircraft.deckCycleState === 'ready' &&
    ship.aircraft.readyAircraft >= minimumFighters &&
    ship.aircraft.fighters >= minimumFighters
  );
}

function hasActiveFleetAirOperation(state: NavalStoreState, fleet: StrategicFleet, type: AirOperation['type']): boolean {
  return state.airOperations.some((operation) =>
    operation.fleetName === fleet.name &&
    operation.type === type &&
    operation.status !== 'recovered'
  );
}

function normalizeAirSelection(input: AirGroupSelection, fallback: AirGroupSelection): AirGroupSelection {
  const selection = {
    fighters: clampAircraft(input.fighters ?? 0),
    diveBombers: clampAircraft(input.diveBombers ?? 0),
    torpedoBombers: clampAircraft(input.torpedoBombers ?? 0),
    scouts: clampAircraft(input.scouts ?? 0),
  };
  if (airSelectionTotal(selection) > 0) return selection;
  return {
    fighters: clampAircraft(fallback.fighters ?? 0),
    diveBombers: clampAircraft(fallback.diveBombers ?? 0),
    torpedoBombers: clampAircraft(fallback.torpedoBombers ?? 0),
    scouts: clampAircraft(fallback.scouts ?? 0),
  };
}

function clampAircraft(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(48, Math.round(value)));
}

function clampSearchTeamCount(value: number, aircraftCount: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(9, Math.max(1, aircraftCount), Math.round(value)));
}

function clampAirGroupCount(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.max(0, Math.round(max)), Math.round(value)));
}

function airSelectionTotal(selection: AirGroupSelection): number {
  return (selection.fighters || 0) + (selection.diveBombers || 0) + (selection.torpedoBombers || 0) + (selection.scouts || 0);
}

function splitAirSelectionIntoTeams(selection: AirGroupSelection, teamCount: number): AirGroupSelection[] {
  const count = Math.max(1, Math.min(teamCount, airSelectionTotal(selection)));
  const teams = Array.from({ length: count }, () => ({ fighters: 0, diveBombers: 0, torpedoBombers: 0, scouts: 0 } satisfies AirGroupSelection));
  const fields: Array<keyof AirGroupSelection> = ['scouts', 'fighters', 'diveBombers', 'torpedoBombers'];
  for (const field of fields) {
    const amount = Math.max(0, Math.round(selection[field] ?? 0));
    for (let index = 0; index < amount; index++) {
      const team = teams[index % count];
      team[field] = (team[field] ?? 0) + 1;
    }
  }
  return teams.filter((team) => airSelectionTotal(team) > 0);
}

function searchTeamHeading(centerDeg: number, arcWidthDeg: number, teamIndex: number, teamCount: number): number {
  if (teamCount <= 1) return normalizeAngle(centerDeg);
  const start = centerDeg - arcWidthDeg / 2;
  const step = arcWidthDeg / Math.max(1, teamCount - 1);
  return normalizeAngle(Math.round(start + step * teamIndex));
}

function searchTeamSweepRadius(aircraftCount: number, range: number): number {
  return Math.round(Math.max(42, Math.min(150, 42 + Math.sqrt(Math.max(1, aircraftCount)) * 16 + range * 0.06)));
}

function allocateAirGroup(
  airGroup: CarrierAirGroup,
  requested: AirGroupSelection,
  mission: 'search' | 'strike',
): { mix: AirGroupSelection; total: number } | undefined {
  const mix = normalizeAirSelection(requested, mission === 'search' ? { diveBombers: 4 } : { fighters: 2, diveBombers: 6, torpedoBombers: 2 });
  const fighters = Math.min(mix.fighters || 0, airGroup.fighters);
  const diveBombers = Math.min(mix.diveBombers || 0, airGroup.diveBombers);
  const torpedoBombers = Math.min(mix.torpedoBombers || 0, airGroup.torpedoBombers);
  const scouts = Math.min(mix.scouts || 0, Math.max(0, airGroup.diveBombers + airGroup.fighters - diveBombers - fighters));
  let total = fighters + diveBombers + torpedoBombers + scouts;
  if (total <= 0 || airGroup.readyAircraft <= 0 || airGroup.deckCycleState === 'deck_damaged') return undefined;
  if (total > airGroup.readyAircraft) {
    const scale = airGroup.readyAircraft / total;
    const scaled = {
      fighters: Math.floor(fighters * scale),
      diveBombers: Math.floor(diveBombers * scale),
      torpedoBombers: Math.floor(torpedoBombers * scale),
      scouts: Math.floor(scouts * scale),
    };
    total = airSelectionTotal(scaled);
    if (total <= 0) return undefined;
    return { mix: scaled, total };
  }
  return { mix: { fighters, diveBombers, torpedoBombers, scouts }, total };
}

function airMixText(selection: AirGroupSelection): string {
  const parts = [
    selection.fighters ? `F${selection.fighters}` : '',
    selection.diveBombers ? `DB${selection.diveBombers}` : '',
    selection.torpedoBombers ? `TB${selection.torpedoBombers}` : '',
    selection.scouts ? `SC${selection.scouts}` : '',
  ].filter(Boolean);
  return parts.join('/') || 'no aircraft';
}

function createFleetFormation(type: FleetFormationType, turn: number): FleetFormationState {
  switch (type) {
    case 'line_abreast':
      return {
        type,
        assignedTurn: turn,
        spacing: 46,
        searchArcModifier: 1.45,
        searchRangeModifier: 1.05,
        antiAirCenterModifier: 0.9,
        screenCoverageModifier: 1.25,
        description: 'line abreast: wide scouting front, weaker concentrated AA',
      };
    case 'circular_screen':
      return {
        type,
        assignedTurn: turn,
        spacing: 38,
        searchArcModifier: 0.85,
        searchRangeModifier: 0.95,
        antiAirCenterModifier: 1.35,
        screenCoverageModifier: 1.4,
        description: 'circular screen: carriers/transports centered under strongest AA umbrella',
      };
    case 'column':
      return {
        type,
        assignedTurn: turn,
        spacing: 34,
        searchArcModifier: 0.75,
        searchRangeModifier: 1,
        antiAirCenterModifier: 0.95,
        screenCoverageModifier: 0.85,
        description: 'column: compact movement formation with narrow scouting front',
      };
    case 'scout_line':
      return {
        type,
        assignedTurn: turn,
        spacing: 70,
        searchArcModifier: 1.8,
        searchRangeModifier: 1.15,
        antiAirCenterModifier: 0.7,
        screenCoverageModifier: 1.1,
        description: 'scout line: maximum search width at the cost of mutual AA support',
      };
    case 'standard_screen':
      return {
        type,
        assignedTurn: turn,
        spacing: 32,
        searchArcModifier: 1,
        searchRangeModifier: 1,
        antiAirCenterModifier: 1,
        screenCoverageModifier: 1,
        description: 'standard screen: balanced scouting and air defense',
      };
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

function applyFormationToShips(fleet: StrategicFleet, formation: FleetFormationState): NavalShip[] {
  const heading = fleet.ships[0]?.headingDeg ?? 270;
  const headingRad = heading * Math.PI / 180;
  const lateralRad = headingRad + Math.PI / 2;
  const centerX = fleet.position.globalX;
  const centerY = fleet.position.globalY;
  const count = Math.max(1, fleet.ships.length);
  return fleet.ships.map((ship, index) => {
    let x = centerX;
    let y = centerY;
    if (formation.type === 'circular_screen') {
      const capital = ship.shipClass.includes('carrier') || ship.shipClass === 'transport' || ship.shipClass === 'oiler' || ship.shipClass === 'landing_ship';
      if (!capital && count > 1) {
        const angle = (index / Math.max(1, count - 1)) * Math.PI * 2;
        x += Math.round(Math.sin(angle) * formation.spacing);
        y -= Math.round(Math.cos(angle) * formation.spacing);
      }
    } else if (formation.type === 'column') {
      const offset = (index - (count - 1) / 2) * formation.spacing;
      x += Math.round(Math.sin(headingRad) * offset);
      y -= Math.round(Math.cos(headingRad) * offset);
    } else {
      const offset = (index - (count - 1) / 2) * formation.spacing;
      x += Math.round(Math.sin(lateralRad) * offset);
      y -= Math.round(Math.cos(lateralRad) * offset);
    }
    return {
      ...ship,
      position: { x, y },
      headingDeg: heading,
      commandState: {
        ...ship.commandState,
        formationId: formation.type,
      },
    };
  });
}

function nearestFriendlyBasePoint(state: NavalStoreState, fleet: StrategicFleet): { x: number; y: number } | undefined {
  const bases = state.facilities.filter((base) => base.faction === fleet.faction || (base as any).owner === fleet.faction);
  if (bases.length === 0) return undefined;
  const nearest = bases.reduce((best, current) => {
    const bestDist = Math.hypot(best.x - fleet.position.globalX, best.y - fleet.position.globalY);
    const currentDist = Math.hypot(current.x - fleet.position.globalX, current.y - fleet.position.globalY);
    return currentDist < bestDist ? current : best;
  });
  return { x: nearest.x, y: nearest.y };
}

function restoreRecoveredAirOperations(fleets: StrategicFleet[], recovered: AirOperation[]): StrategicFleet[] {
  if (recovered.length === 0) return fleets;
  const byFleet = new Map<string, number>();
  const recoveredIdsByFleet = new Map<string, Set<string>>();
  for (const op of recovered) byFleet.set(op.fleetName, (byFleet.get(op.fleetName) || 0) + op.aircraft);
  for (const op of recovered) {
    const ids = recoveredIdsByFleet.get(op.fleetName) ?? new Set<string>();
    ids.add(op.id);
    recoveredIdsByFleet.set(op.fleetName, ids);
  }
  return fleets.map((fleet) => {
    const recoveredAircraft = byFleet.get(fleet.name) || 0;
    if (recoveredAircraft <= 0) return fleet;
    let remaining = recoveredAircraft;
    const recoveredIds = recoveredIdsByFleet.get(fleet.name) ?? new Set<string>();
    const ships = fleet.ships.map((ship) => {
      if (!ship.aircraft) return ship;
      const maxAircraft = ship.aircraft.fighters + ship.aircraft.diveBombers + ship.aircraft.torpedoBombers;
      const room = Math.max(0, maxAircraft - ship.aircraft.readyAircraft);
      const restored = remaining > 0 ? Math.min(room, remaining) : 0;
      remaining -= restored;
      return {
        ...ship,
        aircraft: {
          ...ship.aircraft,
          readyAircraft: ship.aircraft.readyAircraft + restored,
          deckCycleState: ship.aircraft.deckCycleState === 'deck_damaged' ? 'deck_damaged' as const : 'ready' as const,
          sorties: ship.aircraft.sorties.filter((sortie) => !recoveredIds.has(sortie.id)),
        },
      };
    });
    return {
      ...fleet,
      airGroupState: ships.some((ship) => ship.aircraft && ship.aircraft.readyAircraft > 0) ? 'ready' : fleet.airGroupState,
      ships,
    };
  });
}
function applyFleetAutopilot(fleet: StrategicFleet, overlay?: NavalCellOverlay[][]): StrategicFleet {
  const navigation = fleet.navigation;
  const target = navigation?.path[navigation.pathIndex] || fleet.targetPosition;
  if (!target || navigation?.status === 'arrived' || navigation?.status === 'blocked') return fleet;

  const distance = Math.hypot(target.x - fleet.position.globalX, target.y - fleet.position.globalY);
  let nextNavigation = navigation;
  let nextTarget = target;
  if (navigation && distance < 28) {
    const nextIndex = navigation.pathIndex + 1;
    if (nextIndex >= navigation.path.length) {
      return {
        ...fleet,
        navigation: { ...navigation, pathIndex: navigation.path.length, status: 'arrived', currentLegNote: 'Arrived at plotted destination.' },
        ships: fleet.ships.map((ship) => ({ ...ship, rudderDeg: 0, targetSpeedKts: Math.min(ship.targetSpeedKts, 6) })),
      };
    }
    nextNavigation = {
      ...navigation,
      pathIndex: nextIndex,
      currentLegNote: navigation.segments?.[nextIndex]?.note ?? navigation.currentLegNote,
    };
    nextTarget = navigation.path[nextIndex];
  }

  const heading = navalBearing(fleet.position.globalX, fleet.position.globalY, nextTarget.x, nextTarget.y);
  const finalDistance = Math.hypot((fleet.targetPosition?.x ?? nextTarget.x) - fleet.position.globalX, (fleet.targetPosition?.y ?? nextTarget.y) - fleet.position.globalY);
  const cruiseSpeed = navigation ? speedForNavigationMode(navigation.mode) : 24;
  const riskBrake = navigation?.routeRisk === 'high' ? 4 : navigation?.routeRisk === 'medium' ? 2 : 0;
  const targetSpeed = finalDistance < 70 ? 10 : Math.max(8, cruiseSpeed - riskBrake);
  return {
    ...fleet,
    navigation: nextNavigation,
    ships: fleet.ships.map((ship) => {
      const diff = headingDelta(ship.headingDeg, heading);
      return {
        ...ship,
        headingDeg: normalizeAngle(ship.headingDeg + Math.max(-12, Math.min(12, diff))),
        rudderDeg: 0,
        targetSpeedKts: Math.min(ship.motion.maxSpeedKts, Math.max(8, targetSpeed)),
      };
    }),
  };
}

function updateVisibleAirOperations(operations: AirOperation[], fleets: StrategicFleet[]): AirOperation[] {
  return operations.flatMap((op) => {
    if (op.status === 'recovered') return [];
    const speed = op.speed ?? 30;
    const home = airOperationHomePosition(op, fleets);
    const originX = op.originX ?? home.x;
    const originY = op.originY ?? home.y;
    if (op.status === 'preparing') {
      const remainingPrep = Math.max(0, (op.prepTurns ?? 1) - 1);
      if (remainingPrep > 0) {
        return [withSearchSweepPoint({ ...op, x: home.x, y: home.y, originX, originY, prepTurns: remainingPrep }, home)];
      }
      return [withSearchSweepPoint({
        ...op,
        x: home.x,
        y: home.y,
        originX,
        originY,
        status: 'outbound',
        missionLabel: op.missionLabel?.replace(/^Preparing /, '') ?? op.missionLabel,
        prepTurns: 0,
      }, home)];
    }
    if (op.type === 'cap' && op.status !== 'turning_home' && op.status !== 'returning') {
      const orbitTurns = (op.progress ?? 0) + 1;
      const enduranceTurns = Math.max(4, Math.round((op.range ?? 180) / 45));
      if (orbitTurns >= enduranceTurns) {
        return [{
          ...op,
          heading: navalBearing(op.x, op.y, home.x, home.y),
          status: 'returning',
          progress: orbitTurns,
          missionLabel: `${op.missionLabel ?? 'CAP'} returning`,
        }];
      }
      const angle = normalizeAngle(op.heading + 35);
      const rad = angle * Math.PI / 180;
      return [{ ...op, heading: angle, x: op.x + Math.sin(rad) * 6, y: op.y - Math.cos(rad) * 6, status: 'outbound', progress: orbitTurns }];
    }
    if (op.status === 'outbound' || op.status === 'launched') {
      const targetX = op.targetX ?? op.x;
      const targetY = op.targetY ?? op.y;
      const dist = Math.hypot(targetX - op.x, targetY - op.y);
      if (dist <= speed) {
        return [withSearchSweepPoint({
          ...op,
          x: targetX,
          y: targetY,
          heading: navalBearing(targetX, targetY, home.x, home.y),
          status: 'turning_home',
          progress: op.range,
        }, { x: targetX, y: targetY })];
      }
      const heading = navalBearing(op.x, op.y, targetX, targetY);
      const rad = heading * Math.PI / 180;
      const next = { x: op.x + Math.sin(rad) * speed, y: op.y - Math.cos(rad) * speed };
      return [withSearchSweepPoint({ ...op, heading, x: next.x, y: next.y, status: 'outbound' }, next)];
    }
    if (op.status === 'turning_home' || op.status === 'returning') {
      const dist = Math.hypot(home.x - op.x, home.y - op.y);
      if (dist <= speed) return [withSearchSweepPoint({ ...op, x: home.x, y: home.y, status: 'recovered' }, home)];
      const heading = navalBearing(op.x, op.y, home.x, home.y);
      const rad = heading * Math.PI / 180;
      const next = { x: op.x + Math.sin(rad) * speed, y: op.y - Math.cos(rad) * speed };
      return [withSearchSweepPoint({ ...op, heading, x: next.x, y: next.y, status: 'returning' }, next)];
    }
    return [op];
  });
}

function airOperationHomePosition(op: AirOperation, fleets: StrategicFleet[]): { x: number; y: number } {
  const originFleet = fleets.find((fleet) => fleet.name === op.fleetName);
  const homeShip = originFleet?.ships.find((ship) => ship.id === op.originShipId)
    ?? originFleet?.ships.find((ship) => ship.aircraft);
  if (homeShip) return { x: homeShip.position.x, y: homeShip.position.y };
  if (originFleet) return { x: originFleet.position.globalX, y: originFleet.position.globalY };
  return { x: op.originX ?? op.x, y: op.originY ?? op.y };
}

function withSearchSweepPoint(op: AirOperation, point: { x: number; y: number }): AirOperation {
  if (op.type !== 'search') return op;
  const previous = op.sweepPoints ?? [];
  const rounded = { x: Math.round(point.x), y: Math.round(point.y) };
  const last = previous[previous.length - 1];
  const sweepPoints = !last || Math.hypot(last.x - rounded.x, last.y - rounded.y) >= 8
    ? [...previous, rounded].slice(-18)
    : previous;
  return {
    ...op,
    sweepPoints: sweepPoints.length > 0 ? sweepPoints : [rounded],
    sweepRadius: op.sweepRadius ?? searchTeamSweepRadius(op.aircraft, op.range ?? 160),
  };
}

function resolveSearchAirOperationVision(params: {
  airOperations: AirOperation[];
  fleets: StrategicFleet[];
  intel: NavalIntelState;
  currentTurn: number;
  environment: NavalEnvironmentState;
}): { airOperations: AirOperation[]; intel: NavalIntelState; events: NavalBattleLogEvent[] } {
  let intel = params.intel;
  const events: NavalBattleLogEvent[] = [];
  const airOperations = params.airOperations.map((operation) => {
    if (
      operation.type !== 'search' ||
      operation.status === 'preparing' ||
      operation.status === 'recovered' ||
      operation.lastScanTurn === params.currentTurn
    ) {
      return operation;
    }

    const originFleet = params.fleets.find((fleet) => fleet.name === operation.fleetName);
    if (!originFleet) return operation;
    const reportedShipIds = new Set(operation.reportedShipIds ?? []);
    const targetShips = params.fleets
      .filter((fleet) => fleet.faction !== originFleet.faction && fleet.faction !== 'neutral')
      .flatMap((fleet) => fleet.ships);

    for (const target of targetShips) {
      const quality = estimateAirOperationSearchQuality(operation, target, params.environment.weather);
      if (!quality || Math.random() >= quality.detectionChance) continue;

      const contact: NavalContact = {
        id: `air_contact_${target.id}_${params.currentTurn}`,
        originalEntityId: target.id,
        contactType: target.shipClass === 'submarine' ? 'submarine' : 'surface_ship',
        detectionLevel: quality.detectionLevel,
        factionEstimate: 'enemy',
        estimatedClass: Math.random() < quality.classificationChance ? target.shipClass : 'unknown',
        estimatedCount: 1,
        lastKnownPosition: {
          x: Math.round(target.position.x + (Math.random() - 0.5) * quality.positionErrorRadius),
          y: Math.round(target.position.y + (Math.random() - 0.5) * quality.positionErrorRadius),
        },
        uncertaintyRadius: quality.positionErrorRadius,
        lastDetectedTurn: params.currentTurn,
        confidence: quality.confidence,
        detectedBy: [{
          sensorPlatformId: operation.originShipId ?? operation.id,
          sensorType: 'aircraft_search',
          turn: params.currentTurn,
        }],
        trackHistory: [{
          turn: params.currentTurn,
          x: target.position.x,
          y: target.position.y,
          uncertaintyRadius: quality.positionErrorRadius,
          detectionLevel: quality.detectionLevel,
        }],
        stale: false,
      };

      intel = originFleet.faction === 'enemy'
        ? { ...intel, enemyContacts: mergeContacts(intel.enemyContacts, contact) }
        : { ...intel, playerContacts: mergeContacts(intel.playerContacts, contact) };

      if (!reportedShipIds.has(target.id)) {
        events.push({
          id: `air_search_contact_${params.currentTurn}_${operation.id}_${target.id}`,
          turn: params.currentTurn,
          type: 'air_search_contact',
          description: `${operation.fleetName} search aircraft sighted ${target.shipClass} from (${Math.round(operation.x)},${Math.round(operation.y)}); confidence ${quality.confidence}`,
          shipId: operation.originShipId,
          targetId: target.id,
        });
      }
      reportedShipIds.add(target.id);
    }

    return {
      ...operation,
      reportedShipIds: [...reportedShipIds],
      lastScanTurn: params.currentTurn,
    };
  });

  return { airOperations, intel, events };
}

function estimateAirOperationSearchQuality(
  operation: AirOperation,
  target: NavalShip,
  weather: NavalEnvironmentState['weather'],
): {
  detectionChance: number;
  classificationChance: number;
  positionErrorRadius: number;
  detectionLevel: NavalContact['detectionLevel'];
  confidence: NavalContact['confidence'];
} | undefined {
  const sweepRadius = operation.sweepRadius ?? airOperationVisionRange(operation, weather);
  const scanPath = operation.sweepPoints && operation.sweepPoints.length >= 2
    ? operation.sweepPoints.slice(-3)
    : [{ x: operation.x, y: operation.y }];
  const distance = distanceToPolyline(target.position, scanPath);
  if (distance > sweepRadius) return undefined;

  const weatherFactor = airSearchWeatherFactor(weather);
  const aircraftFactor = clamp01(0.34 + (operation.aircraft ?? 1) * 0.07);
  const targetSignatureFactor = Math.max(0.32, Math.min(1.08, 0.42 + target.stealth.surfaceSignature / 120));
  const radiusFactor = 1 - Math.min(0.52, (distance / Math.max(1, sweepRadius)) * 0.46);
  const statusFactor =
    operation.status === 'returning' ? 0.68 :
    operation.status === 'turning_home' ? 0.84 :
    0.8;
  const detectionChance = clamp01(weatherFactor * aircraftFactor * targetSignatureFactor * radiusFactor * statusFactor);
  const quality = detectionChance * (1 - Math.min(0.28, distance / Math.max(1, sweepRadius) * 0.24));
  const confidence: NavalContact['confidence'] = quality >= 0.5 ? 'high' : quality >= 0.3 ? 'medium' : 'low';
  const detectionLevel: NavalContact['detectionLevel'] =
    confidence === 'high' ? 'classified' :
    confidence === 'medium' ? 'detected' :
    'suspected';
  const positionErrorRadius = Math.round(Math.max(
    8,
    10 + distance * 0.065 + (1 - weatherFactor) * 32 + (1 - aircraftFactor) * 18,
  ));

  return {
    detectionChance,
    classificationChance: clamp01(0.16 + quality * 0.76),
    positionErrorRadius,
    detectionLevel,
    confidence,
  };
}

function airOperationVisionRange(operation: AirOperation, weather: NavalEnvironmentState['weather']): number {
  const aircraft = Math.max(1, operation.aircraft ?? 1);
  const missionRangeBonus = Math.min(60, (operation.range ?? 160) * 0.12);
  const baseRange = 56 + Math.sqrt(aircraft) * 18 + missionRangeBonus;
  const statusFactor = operation.status === 'returning' ? 0.84 : 1;
  return Math.max(45, Math.min(190, baseRange * airSearchRangeFactor(weather) * statusFactor));
}

function distanceToPolyline(point: { x: number; y: number }, path: Array<{ x: number; y: number }>): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return Math.hypot(point.x - path[0].x, point.y - path[0].y);
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.length; index++) {
    best = Math.min(best, distanceToSegment(point, path[index - 1], path[index]));
  }
  return best;
}

function distanceToSegment(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const projection = { x: start.x + dx * t, y: start.y + dy * t };
  return Math.hypot(point.x - projection.x, point.y - projection.y);
}

function airSearchWeatherFactor(weather: NavalEnvironmentState['weather']): number {
  switch (weather) {
    case 'clear': return 1;
    case 'rain': return 0.72;
    case 'squall': return 0.48;
    case 'fog': return 0.22;
    case 'storm': return 0.14;
    default: return 0.82;
  }
}

function airSearchRangeFactor(weather: NavalEnvironmentState['weather']): number {
  switch (weather) {
    case 'clear': return 1;
    case 'rain': return 0.84;
    case 'squall': return 0.68;
    case 'fog': return 0.46;
    case 'storm': return 0.36;
    default: return 0.82;
  }
}

function angularDistance(a: number, b: number): number {
  const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return diff > 180 ? 360 - diff : diff;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function resolveStrikeAirOperationImpacts(params: {
  previousOperations: AirOperation[];
  advancedOperations: AirOperation[];
  fleets: StrategicFleet[];
  contacts: NavalContact[];
  currentTurn: number;
}): { fleets: StrategicFleet[]; airOperations: AirOperation[]; events: NavalBattleLogEvent[] } {
  let fleets = params.fleets;
  const events: NavalBattleLogEvent[] = [];
  const previousById = new Map(params.previousOperations.map((operation) => [operation.id, operation]));
  const airOperations = params.advancedOperations.map((operation) => {
    if (operation.type !== 'strike' || operation.status !== 'turning_home') return operation;
    const previous = previousById.get(operation.id);
    if (!previous || previous.status === 'turning_home' || previous.status === 'returning' || previous.status === 'recovered') return operation;
    const originFleet = fleets.find((fleet) => fleet.name === operation.fleetName);
    const contact = params.contacts.find((item) => item.id === operation.targetContactId);
    const target = findStrikeTarget(fleets, operation, contact, originFleet?.faction);
    if (!target) {
      events.push({
        id: `air_strike_miss_${params.currentTurn}_${operation.id}`,
        turn: params.currentTurn,
        type: 'air_strike_miss',
        description: `${operation.fleetName} strike reached target area but found no ship to attack`,
        targetId: operation.targetContactId,
      });
      return { ...operation, missionLabel: `${operation.missionLabel ?? 'Strike'} no target` };
    }

    const beforeHull = target.ship.damage.hullIntegrity;
    const hitPlan = buildStrikeHitPlan(operation);
    let damagedShip = target.ship;
    let hitCount = 0;
    for (let i = 0; i < hitPlan.torpedoHits; i++) {
      const damage = applyNavalDamage({
        ship: damagedShip,
        hitLocation: 'midships',
        damageType: 'torpedo_hit',
        penetration: 60,
        explosivePower: 35,
        underwater: true,
        turn: params.currentTurn,
      });
      damagedShip = damage.ship;
      hitCount++;
      events.push(...damage.events.map((event) => ({ ...event, targetId: damagedShip.id })));
    }
    for (let i = 0; i < hitPlan.bombHits; i++) {
      const damage = applyNavalDamage({
        ship: damagedShip,
        hitLocation: 'superstructure',
        damageType: 'bomb_hit',
        penetration: 42,
        explosivePower: 26,
        underwater: false,
        turn: params.currentTurn,
      });
      damagedShip = damage.ship;
      hitCount++;
      events.push(...damage.events.map((event) => ({ ...event, targetId: damagedShip.id })));
    }

    const hullLoss = Math.max(0, Math.round(beforeHull - damagedShip.damage.hullIntegrity));
    events.push({
      id: `air_strike_hit_${params.currentTurn}_${operation.id}`,
      turn: params.currentTurn,
      type: hitCount > 0 ? 'air_strike_hit' : 'air_strike_near_miss',
      description: `${operation.fleetName} strike attacked ${damagedShip.name}: ${hitCount} hit(s), hull -${hullLoss}`,
      targetId: damagedShip.id,
      damage: hullLoss,
    });

    fleets = fleets.map((fleet) => fleet.id === target.fleet.id
      ? {
          ...fleet,
          ships: fleet.ships.map((ship) => ship.id === damagedShip.id ? damagedShip : ship),
        }
      : fleet);
    return { ...operation, missionLabel: `${operation.missionLabel ?? 'Strike'} attacked ${damagedShip.name}` };
  });
  return { fleets, airOperations, events };
}

function findStrikeTarget(
  fleets: StrategicFleet[],
  operation: AirOperation,
  contact?: NavalContact,
  originFaction?: StrategicFleet['faction'],
): { fleet: StrategicFleet; ship: NavalShip } | undefined {
  const enemyFleets = fleets.filter((fleet) =>
    !originFaction || (fleet.faction !== originFaction && fleet.faction !== 'neutral')
  );
  if (contact?.originalEntityId) {
    for (const fleet of enemyFleets) {
      const ship = fleet.ships.find((item) => item.id === contact.originalEntityId);
      if (ship) return { fleet, ship };
    }
  }
  const targetX = operation.targetX ?? contact?.lastKnownPosition.x ?? operation.x;
  const targetY = operation.targetY ?? contact?.lastKnownPosition.y ?? operation.y;
  let best: { fleet: StrategicFleet; ship: NavalShip; distance: number } | undefined;
  for (const fleet of enemyFleets) {
    for (const ship of fleet.ships) {
      const distance = Math.hypot(ship.position.x - targetX, ship.position.y - targetY);
      if (!best || distance < best.distance) best = { fleet, ship, distance };
    }
  }
  const radius = Math.max(80, contact?.uncertaintyRadius ?? 40, operation.range ? operation.range * 0.12 : 40);
  return best && best.distance <= radius ? { fleet: best.fleet, ship: best.ship } : undefined;
}

function buildStrikeHitPlan(operation: AirOperation): { bombHits: number; torpedoHits: number } {
  const diveBombers = operation.aircraftMix?.diveBombers ?? Math.floor(operation.aircraft * 0.5);
  const torpedoBombers = operation.aircraftMix?.torpedoBombers ?? Math.floor(operation.aircraft * 0.25);
  const torpedoHits = Math.min(2, Math.floor(torpedoBombers / 4));
  let bombHits = Math.min(3, Math.floor(diveBombers / 4));
  if (torpedoHits + bombHits === 0 && operation.aircraft > 0) bombHits = 1;
  return { bombHits, torpedoHits };
}

function buildCoarseSeaPath(start: { x: number; y: number }, destination: { x: number; y: number }, overlay?: NavalCellOverlay[][]): Array<{ x: number; y: number }> {
  if (!overlay?.length || !overlay[0]?.length) return [destination];
  const cell = 80;
  const width = overlay[0].length;
  const height = overlay.length;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const toNode = (point: { x: number; y: number }) => ({
    cx: Math.max(0, Math.min(cols - 1, Math.floor(point.x / cell))),
    cy: Math.max(0, Math.min(rows - 1, Math.floor(point.y / cell))),
  });
  const startNode = toNode(start);
  const endNode = toNode(destination);
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const passable = (cx: number, cy: number) => {
    const sampleX = Math.max(0, Math.min(width - 1, Math.round((cx + 0.5) * cell)));
    const sampleY = Math.max(0, Math.min(height - 1, Math.round((cy + 0.5) * cell)));
    const type = overlay[sampleY]?.[sampleX]?.seaZoneType;
    return type !== 'island' && type !== 'reef';
  };
  const open = [startNode];
  const came = new Map<string, string>();
  const g = new Map<string, number>([[key(startNode.cx, startNode.cy), 0]]);
  const h = (cx: number, cy: number) => Math.hypot(cx - endNode.cx, cy - endNode.cy);
  const seen = new Set<string>();
  while (open.length > 0) {
    open.sort((a, b) => ((g.get(key(a.cx, a.cy)) ?? 0) + h(a.cx, a.cy)) - ((g.get(key(b.cx, b.cy)) ?? 0) + h(b.cx, b.cy)));
    const current = open.shift()!;
    const currentKey = key(current.cx, current.cy);
    if (current.cx === endNode.cx && current.cy === endNode.cy) break;
    if (seen.has(currentKey)) continue;
    seen.add(currentKey);
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const nx = current.cx + dx;
      const ny = current.cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !passable(nx, ny)) continue;
      const nextKey = key(nx, ny);
      const cost = (g.get(currentKey) ?? 0) + (dx && dy ? 1.4 : 1);
      if (cost < (g.get(nextKey) ?? Number.POSITIVE_INFINITY)) {
        came.set(nextKey, currentKey);
        g.set(nextKey, cost);
        open.push({ cx: nx, cy: ny });
      }
    }
  }
  const endKey = key(endNode.cx, endNode.cy);
  if (!came.has(endKey) && endKey !== key(startNode.cx, startNode.cy)) return [destination];
  const nodes: Array<{ cx: number; cy: number }> = [];
  let cursor = endKey;
  while (cursor) {
    const [cx, cy] = cursor.split(',').map(Number);
    nodes.push({ cx, cy });
    const prev = came.get(cursor);
    if (!prev) break;
    cursor = prev;
  }
  return nodes.reverse().slice(1).map((node, index, arr) => (
    index === arr.length - 1
      ? destination
      : { x: Math.round((node.cx + 0.5) * cell), y: Math.round((node.cy + 0.5) * cell) }
  ));
}

function clampToMap(point: { x: number; y: number }, overlay?: NavalCellOverlay[][]): { x: number; y: number } {
  return clampPointToOverlay(point, overlay);
}

function normalizeManualWaypoints(start: { x: number; y: number }, waypoints: Array<{ x: number; y: number }>, overlay?: NavalCellOverlay[][]): Array<{ x: number; y: number }> {
  const result: Array<{ x: number; y: number }> = [];
  let cursor = clampToMap(start, overlay);
  for (const point of waypoints) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const clamped = clampToMap(point, overlay);
    if (Math.hypot(clamped.x - cursor.x, clamped.y - cursor.y) < 12) continue;
    result.push(clamped);
    cursor = clamped;
  }
  return result.slice(0, 12);
}

function headingDelta(from: number, to: number): number {
  let diff = normalizeAngle(to - from);
  if (diff > 180) diff -= 360;
  return diff;
}

function normalizeAngle(value: number): number {
  return ((value % 360) + 360) % 360;
}

function buildHumanCommandValidationContext(state: NavalStoreState) {
  const knowledge = buildFactionKnowledge({
    faction: 'player',
    truth: {
      turn: state.currentTurn,
      playerFleets: state.fleets.filter((fleet) => fleet.faction === 'player'),
      enemyFleets: state.fleets.filter((fleet) => fleet.faction === 'enemy'),
      allBases: state.facilities.map((facility) => ({
        ...facility,
        owner: facility.faction,
        level: facility.type === 'naval_base' ? 3 : facility.type === 'airfield' ? 2 : 1,
        damage: 0,
      })) as any,
      allSupplyLines: state.shippingLanes as any,
      weather: state.weather,
    },
    intel: state.intel,
    reports: state.reports,
    currentTurn: state.currentTurn,
  });
  return { knowledge, context: sanitizeKnowledgeForLLM(knowledge) };
}

function humanReceiptToDecision(receipt: HumanCommandReceipt): LLMCommanderDecision {
  return {
    situationAssessment: {
      enemy: 'Human command uses known contact board only.',
      friendly: 'Human player selected friendly fleet command.',
      self: receipt.summary,
      battlefield: 'Command parsed through tactical templates.',
    },
    missionAnalysis: {
      primaryTask: receipt.summary,
      constraints: ['validate command before execution', 'do not use hidden enemy state'],
      desiredEffect: receipt.summary,
      riskTolerance: receipt.requiresConfirmation ? 'high' : 'medium',
    },
    availableDecisionReview: receipt.actions.map((action) => ({
      actionType: action.type,
      feasible: true,
      method: receipt.interpretationLevel,
      quantity: action.aircraftCount,
      constraints: [],
      estimatedSuccess: action.successEstimate || 'medium',
      reason: action.reason,
    })),
    courseOfActionAnalysis: [{
      option: 'human order',
      actionTypes: receipt.actions.map((action) => action.type),
      successEstimate: 'medium',
      risk: receipt.requiresConfirmation ? 'high' : 'medium',
      resourceUse: 'player directed',
      reason: receipt.summary,
    }],
    selectedDecisionRationale: receipt.summary,
    assessment: receipt.summary,
    intent: inferHumanIntent(receipt),
    confidence: 'high',
    risk: receipt.requiresConfirmation ? 'high' : 'medium',
    decisions: receipt.actions,
    assumptions: [],
    informationGaps: [],
    abortConditions: ['validator rejects action', 'player cancels authorization'],
    nextReviewTurn: receipt.turn + 1,
  };
}

function inferHumanIntent(receipt: HumanCommandReceipt): LLMCommanderDecision['intent'] {
  const action = receipt.actions[0]?.type;
  if (action === 'launch_search') return 'search';
  if (action === 'launch_strike') return 'strike';
  if (action === 'withdraw_fleet') return 'withdraw';
  if (action === 'repair_fleet') return 'repair';
  if (action === 'launch_cap' || action === 'protect_base' || action === 'protect_supply_line') return 'protect';
  if (action === 'intercept_contact' || action === 'move_fleet') return 'intercept';
  return 'hold';
}

function createHumanCommandReport(receipt: HumanCommandReceipt, type: NavalReportType, summary: string): NavalAIReport {
  const report = createDefaultReport(type, receipt.turn, 'Human Command', summary);
  report.fromFleetId = receipt.fleetIds[0];
  report.facts = [
    `Command: ${receipt.text}`,
    `Level: ${receipt.interpretationLevel}`,
    `Actions: ${receipt.actions.map((action) => action.type).join(', ') || 'none'}`,
    `Special: ${receipt.specialOrders.map((order) => order.type).join(', ') || 'none'}`,
  ];
  report.estimates = [...receipt.warnings, ...receipt.errors];
  report.recommendations = receipt.requiresConfirmation
    ? [{ text: 'Player authorization required before execution', urgency: 'high' }]
    : [];
  return report;
}

function appendLocalCommandLog(
  state: NavalStoreState,
  actorPlayerId: string,
  action: string,
  targetId: string,
  summary: string,
): LocalMultiplayerCommandLog[] {
  return [
    ...state.localMultiplayer.commandLog.slice(-80),
    {
      id: `local_cmd_${state.currentTurn}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      turn: state.currentTurn,
      actorPlayerId,
      action,
      targetId,
      summary,
    },
  ];
}

function localPlayerExists(state: NavalStoreState, playerId: string): boolean {
  return state.localMultiplayer.players.some((player) => player.id === playerId);
}

function localPlayer(state: NavalStoreState, playerId: string): LocalMultiplayerPlayer | undefined {
  return state.localMultiplayer.players.find((player) => player.id === playerId);
}

function localIsUmpire(player: LocalMultiplayerPlayer | undefined): boolean {
  return player?.role === 'umpire' || player?.faction === 'neutral';
}

function localOwnerFaction(state: NavalStoreState, ownerId: string | undefined): LocalMultiplayerPlayer['faction'] | undefined {
  return state.localMultiplayer.players.find((player) => player.id === ownerId)?.faction;
}

function localFleetOwner(state: NavalStoreState, fleet: StrategicFleet): string {
  return state.localMultiplayer.fleetOwners[fleet.id] || defaultOwnerForFaction(fleet.faction);
}

function localPlayerCanControlFleet(state: NavalStoreState, actorPlayerId: string, fleet: StrategicFleet): boolean {
  if (state.localMultiplayer.mode !== 'human_multiplayer') return fleet.faction === 'player';
  const actor = localPlayer(state, actorPlayerId);
  if (localIsUmpire(actor)) return true;
  const ownerId = localFleetOwner(state, fleet);
  if (ownerId === actorPlayerId) return true;
  if (actor?.role === 'theater_commander' && actor.faction === fleet.faction) return true;
  if (state.localMultiplayer.allowCrossControl) return true;
  return false;
}

function localPlayerCanControlShip(state: NavalStoreState, actorPlayerId: string, fleet: StrategicFleet, shipId: string): boolean {
  if (localPlayerCanControlFleet(state, actorPlayerId, fleet)) return true;
  const actor = localPlayer(state, actorPlayerId);
  if (localIsUmpire(actor)) return true;
  const ownerId = state.localMultiplayer.shipOwners[shipId] || localFleetOwner(state, fleet);
  if (ownerId === actorPlayerId) return true;
  if (state.localMultiplayer.allowCrossControl) return true;
  return false;
}

function localApproverForFleet(state: NavalStoreState, fleet: StrategicFleet, shipId?: string): string {
  const ownerId = shipId
    ? state.localMultiplayer.shipOwners[shipId] || localFleetOwner(state, fleet)
    : localFleetOwner(state, fleet);
  return localPlayerExists(state, ownerId) ? ownerId : 'umpire';
}

function queueLocalPendingOrder(
  state: NavalStoreState,
  actorPlayerId: string,
  approverPlayerId: string,
  title: string,
  summary: string,
  payload: LocalPendingOrderPayload,
): boolean {
  const pending: LocalPendingOrder = {
    id: `local_pending_${state.currentTurn}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    turn: state.currentTurn,
    actorPlayerId,
    approverPlayerId,
    title,
    summary,
    payload,
  };
  useNavalStore.setState({
    localMultiplayer: {
      ...state.localMultiplayer,
      pendingOrders: [...state.localMultiplayer.pendingOrders.slice(-40), pending],
      commandLog: appendLocalCommandLog(state, actorPlayerId, 'request_approval', pending.id, summary),
    },
    battleLog: [...state.battleLog, humanLogEvent(state.currentTurn, `Approval requested: ${summary}`)],
  });
  return true;
}

function approveLocalPendingOrder(orderId: string, approved: boolean): boolean {
  const state = useNavalStore.getState();
  const pending = state.localMultiplayer.pendingOrders.find((order) => order.id === orderId);
  if (!pending) return false;
  useNavalStore.setState({
    localMultiplayer: {
      ...state.localMultiplayer,
      pendingOrders: state.localMultiplayer.pendingOrders.filter((order) => order.id !== orderId),
      commandLog: appendLocalCommandLog(state, state.localMultiplayer.activePlayerId, approved ? 'approve_order' : 'reject_order', orderId, pending.summary),
    },
    battleLog: [...state.battleLog, humanLogEvent(state.currentTurn, `${approved ? 'Approved' : 'Rejected'} local order: ${pending.summary}`)],
  });
  if (!approved) return true;
  const latest = useNavalStore.getState();
  switch (pending.payload.type) {
    case 'assign_fleet':
      return applyFleetToLocalPlayer(pending.payload.fleetId, pending.payload.playerId, { actorPlayerId: pending.actorPlayerId, force: true });
    case 'assign_ship':
      return applyShipToLocalPlayer(pending.payload.fleetId, pending.payload.shipId, pending.payload.playerId, { actorPlayerId: pending.actorPlayerId, force: true });
    case 'split_fleet':
      return applySplitFleetOrder(pending.payload.sourceFleetId, pending.payload.shipIds, pending.payload.newFleetName, {
        allowAnyFaction: true,
        ownerPlayerId: pending.payload.playerId,
        actorPlayerId: pending.actorPlayerId,
        force: true,
      });
    case 'direct_ship_control': {
      let changed = false;
      for (const shipId of pending.payload.shipIds) {
        changed = applyDirectShipControlOrder(pending.payload.fleetId, shipId, pending.payload.order, {
          allowAnyFaction: true,
          actorPlayerId: pending.actorPlayerId,
          force: true,
        }) || changed;
      }
      return changed || latest.localMultiplayer.pendingOrders.length < state.localMultiplayer.pendingOrders.length;
    }
    case 'delegate_template':
      return applyDelegateTemplate(pending.payload.fleetId, pending.payload.template, { actorPlayerId: pending.actorPlayerId, force: true });
    default:
      return false;
  }
}

function applyFleetToLocalPlayer(fleetId: string, playerId: string, options: { actorPlayerId?: string; force?: boolean } = {}): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId);
  if (!fleet || !localPlayerExists(state, playerId)) return false;
  const actorPlayerId = options.actorPlayerId || state.localMultiplayer.activePlayerId;
  if (!options.force && !localPlayerCanControlFleet(state, actorPlayerId, fleet)) {
    return queueLocalPendingOrder(
      state,
      actorPlayerId,
      localApproverForFleet(state, fleet),
      'Approve fleet transfer',
      `${actorPlayerId} requests transfer of ${fleet.name} to ${playerId}`,
      { type: 'assign_fleet', fleetId, playerId },
    );
  }
  const fleetOwners = { ...state.localMultiplayer.fleetOwners, [fleet.id]: playerId };
  const shipOwners = { ...state.localMultiplayer.shipOwners };
  for (const ship of fleet.ships) shipOwners[ship.id] = playerId;
  useNavalStore.setState({
    localMultiplayer: {
      ...state.localMultiplayer,
      fleetOwners,
      shipOwners,
      commandLog: appendLocalCommandLog(state, actorPlayerId, 'assign_fleet', fleetId, `${fleet.name} assigned to ${playerId}`),
    },
    battleLog: [...state.battleLog, humanLogEvent(state.currentTurn, `${fleet.name} assigned to ${playerId}`, fleet.ships[0]?.id)],
  });
  return true;
}

function applyShipToLocalPlayer(fleetId: string, shipId: string, playerId: string, options: { actorPlayerId?: string; force?: boolean } = {}): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId);
  const ship = fleet?.ships.find((item) => item.id === shipId);
  if (!fleet || !ship || !localPlayerExists(state, playerId)) return false;
  const actorPlayerId = options.actorPlayerId || state.localMultiplayer.activePlayerId;
  if (!options.force && !localPlayerCanControlShip(state, actorPlayerId, fleet, shipId)) {
    return queueLocalPendingOrder(
      state,
      actorPlayerId,
      localApproverForFleet(state, fleet, shipId),
      'Approve ship transfer',
      `${actorPlayerId} requests transfer of ${ship.name} to ${playerId}`,
      { type: 'assign_ship', fleetId, shipId, playerId },
    );
  }
  useNavalStore.setState({
    localMultiplayer: {
      ...state.localMultiplayer,
      shipOwners: { ...state.localMultiplayer.shipOwners, [shipId]: playerId },
      commandLog: appendLocalCommandLog(state, actorPlayerId, 'assign_ship', shipId, `${ship.name} assigned to ${playerId}`),
    },
    battleLog: [...state.battleLog, humanLogEvent(state.currentTurn, `${ship.name} assigned to ${playerId}`, ship.id)],
  });
  return true;
}

function applyDirectShipsAsLocalPlayer(
  fleetId: string,
  shipIds: string[],
  order: { headingDeg?: number; speedKts?: number; targetPosition?: { x: number; y: number }; reason?: string },
): boolean {
  const state = useNavalStore.getState();
  const actorPlayerId = state.localMultiplayer.activePlayerId;
  let changed = false;
  for (const shipId of shipIds) {
    changed = applyDirectShipControlOrder(fleetId, shipId, {
      ...order,
      reason: order.reason || `local multiplayer direct control by ${actorPlayerId}`,
    }, { allowAnyFaction: true, actorPlayerId }) || changed;
  }
  return changed;
}

function applySplitFleetOrder(
  sourceFleetId: string,
  shipIds: string[],
  newFleetName?: string,
  options: { allowAnyFaction?: boolean; ownerPlayerId?: string; actorPlayerId?: string; force?: boolean } = {},
): boolean {
  const state = useNavalStore.getState();
  const source = state.fleets.find((fleet) =>
    fleet.id === sourceFleetId && (options.allowAnyFaction || fleet.faction === 'player')
  );
  if (!source) return false;
  const selected = source.ships.filter((ship) => shipIds.includes(ship.id));
  if (selected.length === 0 || selected.length >= source.ships.length) return false;
  const actorPlayerId = options.actorPlayerId || state.localMultiplayer.activePlayerId;
  const ownerPlayerId = options.ownerPlayerId || state.localMultiplayer.fleetOwners[source.id] || defaultOwnerForFaction(source.faction);
  if (!options.force && !localPlayerCanControlFleet(state, actorPlayerId, source)) {
    return queueLocalPendingOrder(
      state,
      actorPlayerId,
      localApproverForFleet(state, source),
      'Approve detachment',
      `${actorPlayerId} requests detachment of ${selected.length} ship(s) from ${source.name} to ${ownerPlayerId}`,
      { type: 'split_fleet', sourceFleetId, shipIds, playerId: ownerPlayerId, newFleetName },
    );
  }

  const remaining = source.ships.filter((ship) => !shipIds.includes(ship.id));
  const avgX = Math.round(selected.reduce((sum, ship) => sum + ship.position.x, 0) / selected.length);
  const avgY = Math.round(selected.reduce((sum, ship) => sum + ship.position.y, 0) / selected.length);
  const newFleet: StrategicFleet = {
    ...source,
    id: `${source.id}_det_${Date.now().toString(36)}`,
    name: newFleetName || `${source.name} Detached Element`,
    type: selected.some((ship) => ship.shipClass.includes('carrier')) ? source.type : 'surface_action_group',
    position: { ...source.position, globalX: avgX, globalY: avgY },
    ships: selected.map((ship) => ({
      ...ship,
      commandState: {
        ...ship.commandState,
        controller: source.faction === 'enemy' ? 'enemy_ai' : 'player_direct',
        formationId: undefined,
      },
    })),
    command: {
      ...source.command,
      controller: source.faction === 'enemy' ? 'enemy_ai' : 'player_direct',
      currentOrderId: `split_${state.currentTurn}`,
    },
    detectedByPlayer: source.faction === 'player' ? true : source.detectedByPlayer,
  };

  const updatedSource: StrategicFleet = {
    ...source,
    ships: remaining,
    position: {
      ...source.position,
      globalX: Math.round(remaining.reduce((sum, ship) => sum + ship.position.x, 0) / remaining.length),
      globalY: Math.round(remaining.reduce((sum, ship) => sum + ship.position.y, 0) / remaining.length),
    },
  };
  const fleetOwners = {
    ...state.localMultiplayer.fleetOwners,
    [source.id]: state.localMultiplayer.fleetOwners[source.id] || defaultOwnerForFaction(source.faction),
    [newFleet.id]: ownerPlayerId,
  };
  const shipOwners = { ...state.localMultiplayer.shipOwners };
  for (const ship of selected) shipOwners[ship.id] = ownerPlayerId;
  for (const ship of remaining) shipOwners[ship.id] = shipOwners[ship.id] || fleetOwners[source.id];
  const event = humanLogEvent(state.currentTurn, `Detached ${selected.length} ship(s) from ${source.name} as ${newFleet.name}`, selected[0]?.id);
  useNavalStore.setState({
    fleets: state.fleets.map((fleet) => fleet.id === source.id ? updatedSource : fleet).concat(newFleet),
    localMultiplayer: {
      ...state.localMultiplayer,
      fleetOwners,
      shipOwners,
      commandLog: appendLocalCommandLog(state, actorPlayerId, 'split_fleet', newFleet.id, `Detached ${selected.length} ship(s) to ${ownerPlayerId}`),
    },
    selectedFleetId: newFleet.id,
    battleLog: [...state.battleLog, event],
  });
  return true;
}

function applyDirectShipControlOrder(
  fleetId: string,
  shipId: string,
  order: { headingDeg?: number; speedKts?: number; targetPosition?: { x: number; y: number }; reason?: string },
  options: { allowAnyFaction?: boolean; actorPlayerId?: string; force?: boolean } = {},
): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) =>
    item.id === fleetId && (options.allowAnyFaction || item.faction === 'player')
  );
  if (!fleet) return false;
  const ship = fleet.ships.find((item) => item.id === shipId);
  if (!ship) return false;
  const actorPlayerId = options.actorPlayerId || state.localMultiplayer.activePlayerId;
  if (!options.force && !localPlayerCanControlShip(state, actorPlayerId, fleet, shipId)) {
    return queueLocalPendingOrder(
      state,
      actorPlayerId,
      localApproverForFleet(state, fleet, shipId),
      'Approve direct control',
      `${actorPlayerId} requests direct control of ${ship.name}`,
      { type: 'direct_ship_control', fleetId, shipIds: [shipId], order },
    );
  }

  const nextShip = {
    ...ship,
    headingDeg: order.targetPosition
      ? navalBearing(ship.position.x, ship.position.y, order.targetPosition.x, order.targetPosition.y)
      : order.headingDeg ?? ship.headingDeg,
    targetSpeedKts: order.speedKts ?? ship.targetSpeedKts,
    commandState: {
      ...ship.commandState,
      controller: fleet.faction === 'enemy' ? 'enemy_ai' as const : 'player_direct' as const,
      currentOrderId: `direct_${state.currentTurn}`,
    },
  };
  (nextShip as any).targetPosition = order.targetPosition;

  const updatedFleet = {
    ...fleet,
    ships: fleet.ships.map((item) => item.id === shipId ? nextShip : item),
  };
  const event = humanLogEvent(state.currentTurn, `${ship.name} direct order: ${order.reason || 'manual control'}`, ship.id);
  useNavalStore.setState({
    fleets: state.fleets.map((item) => item.id === fleet.id ? updatedFleet : item),
    localMultiplayer: {
      ...state.localMultiplayer,
      commandLog: appendLocalCommandLog(state, actorPlayerId, 'direct_ship_control', ship.id, `${ship.name} direct control`),
    },
    battleLog: [...state.battleLog, event],
  });
  return true;
}

function applyDelegateTemplate(
  fleetId: string,
  template: 'search_screen' | 'carrier_strike' | 'withdraw_preserve' | 'surface_intercept' | 'hold_defense',
  options: { actorPlayerId?: string; force?: boolean } = {},
): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) =>
    item.id === fleetId && (state.localMultiplayer.mode === 'human_multiplayer' || item.faction === 'player')
  );
  if (!fleet) return false;
  const actorPlayerId = options.actorPlayerId || state.localMultiplayer.activePlayerId;
  if (!options.force && state.localMultiplayer.mode === 'human_multiplayer' && !localPlayerCanControlFleet(state, actorPlayerId, fleet)) {
    return queueLocalPendingOrder(
      state,
      actorPlayerId,
      localApproverForFleet(state, fleet),
      'Approve delegated template',
      `${actorPlayerId} requests template ${template} for ${fleet.name}`,
      { type: 'delegate_template', fleetId, template },
    );
  }
  type DelegationTemplate = 'search_screen' | 'carrier_strike' | 'withdraw_preserve' | 'surface_intercept' | 'hold_defense';
  const missionByTemplate: Record<DelegationTemplate, StrategicFleet['mission']> = {
    search_screen: 'search',
    carrier_strike: 'carrier_strike',
    withdraw_preserve: 'withdraw',
    surface_intercept: 'intercept',
    hold_defense: 'patrol',
  };
  const intentByTemplate: Record<DelegationTemplate, NonNullable<StrategicFleet['command']>['commanderIntent']> = {
    search_screen: 'search',
    carrier_strike: 'strike',
    withdraw_preserve: 'withdraw',
    surface_intercept: 'intercept',
    hold_defense: 'hold_sea_area',
  };
  const updatedFleet: StrategicFleet = {
    ...fleet,
    mission: missionByTemplate[template],
    command: {
      riskTolerance: fleet.command?.riskTolerance ?? 'medium',
      engagementPolicy: fleet.command?.engagementPolicy ?? 'engage_if_advantage',
      preserveCapitalShips: fleet.command?.preserveCapitalShips ?? true,
      ...fleet.command,
      controller: fleet.faction === 'enemy' ? 'enemy_ai' : 'ai_delegated',
      commanderIntent: intentByTemplate[template],
      currentOrderId: `template_${state.currentTurn}_${template}`,
    },
  };
  const event = humanLogEvent(state.currentTurn, `${fleet.name} delegated template ${template}`, fleet.ships[0]?.id);
  useNavalStore.setState({
    fleets: state.fleets.map((item) => item.id === fleet.id ? updatedFleet : item),
    battleLog: [...state.battleLog, event],
  });
  return true;
}

function applyFleetMessageOrder(fromFleetId: string, toFleetId: string, message: string): boolean {
  const state = useNavalStore.getState();
  const from = state.fleets.find((fleet) => fleet.id === fromFleetId);
  const to = state.fleets.find((fleet) => fleet.id === toFleetId);
  if (!from || !to || from.faction !== to.faction) return false;
  const actorPlayerId = state.localMultiplayer.activePlayerId;
  if (state.localMultiplayer.mode === 'human_multiplayer' && !localPlayerCanControlFleet(state, actorPlayerId, from)) {
    return false;
  }
  const delay = calculateCommunicationDelayTurns(state, from, to);
  const item: FleetCommunicationMessage = {
    id: `msg_${state.currentTurn}_${Date.now().toString(36)}`,
    turn: state.currentTurn,
    fromFleetId,
    toFleetId,
    message,
    deliveredTurn: state.currentTurn + delay,
    status: 'queued',
  };
  useNavalStore.setState({
    fleetCommunications: [...state.fleetCommunications, item],
    localMultiplayer: {
      ...state.localMultiplayer,
      commandLog: appendLocalCommandLog(state, actorPlayerId, 'send_message', item.id, `${from.name} to ${to.name}, delivery T${item.deliveredTurn}`),
    },
    battleLog: [...state.battleLog, humanLogEvent(state.currentTurn, `${from.name} signaled ${to.name}; delivery T${item.deliveredTurn}: ${message}`, from.ships[0]?.id)],
  });
  return true;
}

function calculateCommunicationDelayTurns(state: NavalStoreState, from: StrategicFleet, to: StrategicFleet): number {
  const distance = Math.hypot(from.position.globalX - to.position.globalX, from.position.globalY - to.position.globalY);
  const weatherPenalty = state.weather === 'storm' ? 2 : state.weather === 'fog' || state.weather === 'squall' ? 1 : 0;
  return Math.max(1, Math.min(6, 1 + Math.floor(distance / 700) + weatherPenalty));
}

function applyFleetObjectiveOrder(fleetIds: string[], objective: FleetObjective): boolean {
  const state = useNavalStore.getState();
  const normalized = objective === 'annihilate_enemy' ? 'seek_decisive_battle' : objective;
  const targetIds = new Set(fleetIds);
  let changed = false;
  const events: NavalBattleLogEvent[] = [];

  const fleets = state.fleets.map((fleet) => {
    if (!targetIds.has(fleet.id)) return fleet;
    const contacts = fleet.faction === 'enemy' ? state.intel.enemyContacts : state.intel.playerContacts;
    const targetContact = bestFleetObjectiveContact(contacts);
    const targetPosition = targetContact?.lastKnownPosition ?? (fleet as any).targetPosition;
    const mission = objectiveToMission(normalized);
    const riskTolerance = normalized === 'seek_decisive_battle' || normalized === 'destroy_enemy_carriers'
      ? 'high' as const
      : fleet.command?.riskTolerance ?? 'medium' as const;
    const engagementPolicy = normalized === 'destroy_enemy_carriers'
      ? 'carrier_strike_only' as const
      : normalized === 'seek_decisive_battle'
        ? 'free_engagement' as const
        : fleet.command?.engagementPolicy ?? 'engage_if_advantage' as const;
    const preserveCapitalShips = normalized === 'seek_decisive_battle'
      ? false
      : fleet.command?.preserveCapitalShips ?? true;
    const command = {
      ...fleet.command,
      controller: fleet.faction === 'enemy' ? 'enemy_ai' as const : 'ai_delegated' as const,
      commanderIntent: normalized,
      riskTolerance,
      engagementPolicy,
      preserveCapitalShips,
      currentOrderId: `objective_${state.currentTurn}_${normalized}`,
    };
    changed = true;
    events.push(humanLogEvent(
      state.currentTurn,
      `${fleet.name} objective assigned: ${objective} (${normalized})`,
      fleet.ships[0]?.id,
    ));
    return {
      ...fleet,
      mission,
      command,
      ...(targetPosition ? { targetPosition: { ...targetPosition } } : {}),
    } as StrategicFleet;
  });

  if (!changed) return false;
  useNavalStore.setState({
    fleets,
    battleLog: [...state.battleLog, ...events],
  });
  return true;
}

function bestFleetObjectiveContact(contacts: NavalContact[]): NavalContact | undefined {
  const rank: Record<string, number> = {
    tracked: 5,
    identified: 4,
    classified: 3,
    detected: 2,
    suspected: 1,
    lost: 0,
    none: 0,
  };
  return [...contacts]
    .filter((contact) => contact.factionEstimate === 'enemy' && contact.detectionLevel !== 'lost' && contact.detectionLevel !== 'none')
    .sort((a, b) => (rank[b.detectionLevel] ?? 0) - (rank[a.detectionLevel] ?? 0))[0];
}

function contactDistanceFromFleet(fleet: StrategicFleet, contact: NavalContact): number {
  return Math.hypot(
    contact.lastKnownPosition.x - fleet.position.globalX,
    contact.lastKnownPosition.y - fleet.position.globalY,
  );
}

function shadowPointForContact(state: NavalStoreState, fleet: StrategicFleet, contact: NavalContact): { x: number; y: number } {
  const dx = contact.lastKnownPosition.x - fleet.position.globalX;
  const dy = contact.lastKnownPosition.y - fleet.position.globalY;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const standOff = fleet.type === 'carrier_task_force' ? 560 : 240;
  return clampToMap({
    x: Math.round(contact.lastKnownPosition.x - (dx / distance) * standOff),
    y: Math.round(contact.lastKnownPosition.y - (dy / distance) * standOff),
  }, state.overlay);
}

function evasionDestinationFromContact(state: NavalStoreState, fleet: StrategicFleet, contact: NavalContact): { x: number; y: number } {
  const fromContactX = fleet.position.globalX - contact.lastKnownPosition.x;
  const fromContactY = fleet.position.globalY - contact.lastKnownPosition.y;
  const distance = Math.max(1, Math.hypot(fromContactX, fromContactY));
  const side = (state.currentTurn + fleet.id.length) % 2 === 0 ? 1 : -1;
  const legDistance = fleet.type === 'carrier_task_force' ? 360 : 260;
  const doglegX = (fromContactX / distance) * 0.72 + (-fromContactY / distance) * 0.28 * side;
  const doglegY = (fromContactY / distance) * 0.72 + (fromContactX / distance) * 0.28 * side;
  return clampToMap({
    x: Math.round(fleet.position.globalX + doglegX * legDistance),
    y: Math.round(fleet.position.globalY + doglegY * legDistance),
  }, state.overlay);
}

function objectiveToMission(objective: NonNullable<NonNullable<StrategicFleet['command']>['commanderIntent']>): StrategicFleet['mission'] {
  switch (objective) {
    case 'search':
      return 'search';
    case 'strike':
    case 'destroy_enemy_carriers':
      return 'carrier_strike';
    case 'escort':
      return 'escort';
    case 'withdraw':
      return 'withdraw';
    case 'support_landing':
      return 'invasion_support';
    case 'intercept':
    case 'seek_decisive_battle':
      return 'intercept';
    case 'avoid_contact':
    case 'hold_sea_area':
      return 'patrol';
    default: {
      const _exhaustive: never = objective;
      return _exhaustive;
    }
  }
}

function humanLogEvent(turn: number, description: string, shipId?: string): NavalBattleLogEvent {
  return {
    id: `human_${turn}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    turn,
    type: 'human_command',
    description,
    shipId,
  };
}

function navalBearing(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.round(((Math.atan2(toX - fromX, fromY - toY) * 180 / Math.PI) % 360 + 360) % 360);
}

function createPeriodicSitrep(turn: number, fleets: StrategicFleet[], contacts: NavalContact[]): NavalAIReport {
  const playerFleets = fleets.filter((fleet) => fleet.faction === 'player');
  const damagedShips = playerFleets.flatMap((fleet) => fleet.ships).filter((ship) => ship.damage.status !== 'combat_effective');
  const report = createDefaultReport(
    'CONTACT_REPORT',
    turn,
    'Periodic Situation Report',
    `${playerFleets.length} friendly fleet(s), ${contacts.length} known contact(s), ${damagedShips.length} damaged ship(s).`,
  );
  report.facts = [
    ...playerFleets.map((fleet) => `${fleet.name}: ${fleet.mission}, ships ${fleet.ships.length}, pos (${fleet.position.globalX},${fleet.position.globalY})`),
    ...contacts.slice(0, 4).map((contact) => `Contact ${contact.id}: ${contact.detectionLevel}/${contact.confidence} at (${contact.lastKnownPosition.x.toFixed(0)},${contact.lastKnownPosition.y.toFixed(0)})`),
  ];
  report.damagedShips = damagedShips.map((ship) => ({
    shipId: ship.id,
    shipName: ship.name,
    damageSummary: `${ship.damage.status}: hull ${ship.damage.hullIntegrity.toFixed(0)} flood ${ship.damage.flooding.toFixed(0)} fire ${ship.damage.fire.toFixed(0)}`,
    status: ship.damage.status,
  }));
  report.recommendations = contacts.some((contact) => ['tracked', 'identified', 'classified'].includes(contact.detectionLevel))
    ? [{ text: 'Consider authorizing strike or shadowing order for high-confidence contact', urgency: 'high' }]
    : [{ text: 'Continue search coverage and preserve carrier readiness', urgency: 'medium' }];
  return report;
}

function createCriticalAuthorizationReport(turn: number, fleets: StrategicFleet[], contacts: NavalContact[]): NavalAIReport | undefined {
  const severeShip = fleets
    .filter((fleet) => fleet.faction === 'player')
    .flatMap((fleet) => fleet.ships)
    .find((ship) => ship.damage.status === 'crippled' || ship.damage.status === 'sinking' || ship.damage.flooding >= 60 || ship.damage.hullIntegrity <= 35);
  const trackedContact = contacts.find((contact) => ['tracked', 'identified', 'classified'].includes(contact.detectionLevel));

  if (!severeShip && !trackedContact) return undefined;
  const title = severeShip ? 'Authorization Requested: Preserve Damaged Ship' : 'Authorization Requested: High Confidence Contact';
  const summary = severeShip
    ? `${severeShip.name} is ${severeShip.damage.status}; player should approve withdrawal, repair, or continue mission.`
    : `Contact ${trackedContact?.id} is ${trackedContact?.detectionLevel}; player should approve strike, shadow, or hold.`;
  const report = createDefaultReport('REQUEST_AUTHORIZATION', turn, title, summary);
  report.facts = severeShip
    ? [`${severeShip.name} hull ${severeShip.damage.hullIntegrity.toFixed(0)} flooding ${severeShip.damage.flooding.toFixed(0)} fire ${severeShip.damage.fire.toFixed(0)}`]
    : [`Contact ${trackedContact?.id} confidence ${trackedContact?.confidence} uncertainty ${trackedContact?.uncertaintyRadius.toFixed(0)}`];
  report.recommendations = severeShip
    ? [
        { text: 'YES: order withdrawal/repair posture', urgency: 'critical' },
        { text: 'NO: keep current mission and accept risk', urgency: 'high' },
      ]
    : [
        { text: 'YES: authorize strike planning through validator', urgency: 'high' },
        { text: 'NO: shadow and refine contact', urgency: 'medium' },
      ];
  return report;
}

function updateAirMissionsLocal(
  airGroup: CarrierAirGroup,
  enemyShips: NavalShip[],
  environment: NavalEnvironmentState,
  currentTurn: number
): { airGroup: CarrierAirGroup; contacts: NavalContact[]; events: NavalBattleLogEvent[] } {
  void enemyShips;
  return updateAirMissions(airGroup, [], environment, currentTurn);
}

function navigationModeForFleet(fleet: StrategicFleet): NonNullable<StrategicFleet['navigation']>['mode'] {
  if (fleet.mission === 'withdraw') return 'withdrawal';
  if (fleet.mission === 'resupply') return 'rendezvous';
  if (fleet.operation?.posture === 'torpedo_attack') return 'night_dash';
  if (fleet.mission === 'intercept' || fleet.mission === 'carrier_strike' || fleet.operation?.posture === 'surface_engagement') {
    return 'combat_approach';
  }
  return fleet.command?.preserveCapitalShips === false ? 'direct' : 'safe_transit';
}

function fleetCruiseSpeed(fleet: StrategicFleet): number {
  if (fleet.ships.length === 0) return 18;
  const slowest = Math.min(...fleet.ships.map((ship) => ship.motion.maxSpeedKts * (1 - ship.damage.speedPenalty)));
  if (fleet.mission === 'withdraw') return Math.max(10, Math.round(slowest * 0.82));
  if (fleet.operation?.posture === 'torpedo_attack') return Math.max(18, Math.round(slowest * 0.95));
  if (fleet.type === 'transport_convoy' || fleet.type === 'supply_group') return Math.min(18, Math.max(10, Math.round(slowest * 0.8)));
  return Math.min(26, Math.max(14, Math.round(slowest * 0.78)));
}

function speedForNavigationMode(mode?: NonNullable<StrategicFleet['navigation']>['mode']): number {
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

function mergeContacts(existing: NavalContact[], newContact: NavalContact): NavalContact[] {
  const idx = existing.findIndex((c) => c.originalEntityId === newContact.originalEntityId);
  if (idx >= 0) {
    const updated = { ...existing[idx] };
    if (newContact.lastDetectedTurn >= updated.lastDetectedTurn) {
      updated.lastKnownPosition = newContact.lastKnownPosition;
      updated.lastDetectedTurn = newContact.lastDetectedTurn;
      updated.detectionLevel = newContact.detectionLevel;
      updated.confidence = newContact.confidence;
      updated.uncertaintyRadius = newContact.uncertaintyRadius;
      updated.detectedBy = [...updated.detectedBy, ...newContact.detectedBy];
      updated.trackHistory = [...updated.trackHistory, ...newContact.trackHistory];
      updated.stale = false;
    }
    const copy = [...existing];
    copy[idx] = updated;
    return copy;
  }
  return [...existing, newContact];
}

// ===== 瀵煎叆 API Key锛堜粠 Vite env vars锛?=====

function getDeepSeekApiKey(): string {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('deepseek_api_key');
    if (stored) return stored;
  }
  return '';
}
