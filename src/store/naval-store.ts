/**
 * 海军模式状态管理 (Zustand)
 * 独立海战系统 - 不依赖 WorldAtlas / RegionTile
 */

import { create } from 'zustand';
import type { NavalCellOverlay, NavalEnvironmentState } from '../game/naval/naval-types';
import type { StrategicFleet } from '../game/naval/naval-strategic-types';
import type { NavalShip, NavalShipClass } from '../game/naval/ship/ship-types';
import type { NavalIntelState, NavalContact } from '../game/naval/intel/naval-intel-types';
import type { NavalAIReport, NavalAIAction, NavalReportType } from '../game/naval/ai/naval-ai-types';
import { createDefaultReport } from '../game/naval/ai/naval-ai-types';
import type { NavalOperationView, NavalCombatViewport, NavalBattleMap } from '../game/naval/naval-types';
import type { NavalBattleLogEvent } from '../game/naval/ship/ship-damage';
import { generateStratMap } from '../game/naval/naval-map-adapter';
import type { NavalFacility, ShippingLane, IslandCenter, StratMapResult } from '../game/naval/naval-map-adapter';
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
import { updateAirMissions, type CarrierAirGroup, type NavalAirMission } from '../game/naval/ship/ship-aircraft';
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
  airOperations: Array<{ id: string; type: 'search'|'strike'|'cap'; x: number; y: number; heading: number; fleetName: string; status: string; aircraft: number }>;
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
  sendFleetMessage: (fromFleetId: string, toFleetId: string, message: string) => boolean;
  advanceNavalTurn: () => void;
  requestAIAdvice: () => Promise<void>;
  submitACommand: (userInput: string) => Promise<NavalLLMCommandResult | null>;
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

  // LLM
  aiConfig: {
    kind: 'ollama',
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
    // 生成战略地图 + 战术地图
    const mapResult = generateStratMap({
      width: 3000, height: 2000, seed: Date.now(),
      islandGroups: 12, maxIslandR: 80, minIslandR: 12, seaLevel: 0.42,
    });

    const overlay = mapResult.overlay;

    // 舰队放港口附近
    const pPorts = mapResult.facilities.filter(f => f.faction === 'player' && (f.type === 'port' || f.type === 'naval_base'));
    const ePorts = mapResult.facilities.filter(f => f.faction === 'enemy' && (f.type === 'port' || f.type === 'naval_base'));
    const pcx = pPorts[0]?.x ?? 800, pcy = pPorts[0]?.y ?? 1000;
    const ecx = ePorts[0]?.x ?? 1500, ecy = ePorts[0]?.y ?? 1000;

    // Create player fleet with varied headings and speeds for visible movement
    const playerShips: NavalShip[] = [
      createShip('fleet_carrier', 'player', 'CV Enterprise', pcx, pcy, 270, 25, 'carrier'),  // 向西朝日本
      createShip('heavy_cruiser', 'player', 'CA Northampton', pcx - 15, pcy - 8, 270, 28, 'screen'),
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
      shippingLanes: [],
      islands: mapResult.islands,
      tacticalMaps: mapResult.tacticalMaps,
      airOperations: [],
      landAirfields: landAfs,
      fleets: [playerFleet, enemyFleet],
      intel: { ...createDefaultIntelState() },
      reports: [],
      commandHistory: [],
      pendingAuthorizations: [],
      fleetCommunications: [],
      currentTurn: 0,
      battleLog: [],
      isCreatingScenario: false,
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
      : state.fleets.filter((fleet) => fleet.faction === 'player').map((fleet) => fleet.id);
    const interpretation = interpretHumanNavalCommand({
      text,
      fleetIds: selectedIds,
      fleets: state.fleets,
      contacts: state.intel.playerContacts,
      facilities: state.facilities,
      currentTurn: state.currentTurn,
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

  sendFleetMessage: (fromFleetId, toFleetId, message) => {
    return applyFleetMessageOrder(fromFleetId, toFleetId, message);
  },

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
    const aiInput = {
      friendlyFleets: fleets.filter((f) => f.faction === 'player'),
      friendlyShips: Object.values(updatedShipMap).filter((s) => s.faction === 'player'),
      contacts: intel.playerContacts,
      intel,
      reports,
      mission: fleets.find((f) => f.faction === 'player')?.command || {
        controller: 'player_direct' as const,
        riskTolerance: 'medium' as const,
        engagementPolicy: 'engage_if_advantage' as const,
        preserveCapitalShips: true,
        commanderIntent: 'hold_sea_area' as const,
      },
      environment,
    };

    const allActions = [
      ...generateFleetAIActions(aiInput),
      ...generateTacticalAIActions(aiInput),
      ...generateCarrierAIActions(aiInput),
    ];

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
              Object.values(updatedShipMap).filter((s) => s.faction === 'enemy'),
              environment,
              newTurn
            );
            shipObj.aircraft = airResult.airGroup;
            for (const c of airResult.contacts) {
              intel.playerContacts = mergeContacts(intel.playerContacts, c);
            }
            battleLog = [...battleLog, ...airResult.events];
            updatedShipMap[ship.id] = shipObj;
          }
        }
      }
    }

    // 5. Update intel from ship sensors (唯一允许读取 enemyShips)
    const allUpdatedShips = Object.values(updatedShipMap);
    const intelResult = updateNavalIntelState({
      intel,
      currentTurn: newTurn,
      friendlyShips: allUpdatedShips.filter((s) => s.faction === 'player'),
      enemyShips: allUpdatedShips.filter((s) => s.faction === 'enemy'),
      friendlyAirMissions: intel.searchMissions,
      environment,
      overlay: state.overlay || [],
    });

    intel = intelResult.intel;
    reports = [...reports, ...intelResult.newReports];

    // 6. Decay contacts that haven't been updated
    intel = {
      ...intel,
      playerContacts: decayNavalContacts({
        contacts: intel.playerContacts,
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

    set({
      fleets: updatedFleets,
      intel,
      reports,
      currentTurn: newTurn,
      battleLog,
      weather,
      victory,
      fleetCommunications,
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

// ===== 局部辅助 =====

function executeHumanCommandReceipt(receipt: HumanCommandReceipt): HumanCommandReceipt {
  const state = useNavalStore.getState();
  const messages: string[] = [];

  for (const order of receipt.specialOrders) {
    messages.push(executeSpecialHumanOrder(order));
  }

  if (receipt.actions.length > 0) {
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

function executeSpecialHumanOrder(order: HumanSpecialOrder): string {
  switch (order.type) {
    case 'split_fleet':
      return applySplitFleetOrder(order.sourceFleetId, order.shipIds, order.newFleetName)
        ? `Split fleet ${order.sourceFleetId}`
        : `Failed split fleet ${order.sourceFleetId}`;
    case 'direct_ship_control':
      return applyDirectShipControlOrder(order.fleetId, order.shipId, {
        headingDeg: order.headingDeg,
        speedKts: order.speedKts,
        targetPosition: order.targetPosition,
        reason: order.reason,
      })
        ? `Direct control ${order.shipId}`
        : `Failed direct control ${order.shipId}`;
    case 'delegate_ai':
      return applyDelegateTemplate(order.fleetId, order.template)
        ? `Delegated ${order.template}`
        : `Failed delegate ${order.template}`;
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

function applySplitFleetOrder(sourceFleetId: string, shipIds: string[], newFleetName?: string): boolean {
  const state = useNavalStore.getState();
  const source = state.fleets.find((fleet) => fleet.id === sourceFleetId && fleet.faction === 'player');
  if (!source) return false;
  const selected = source.ships.filter((ship) => shipIds.includes(ship.id));
  if (selected.length === 0 || selected.length >= source.ships.length) return false;

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
      commandState: { ...ship.commandState, controller: 'player_direct', formationId: undefined },
    })),
    command: { ...source.command, controller: 'player_direct', currentOrderId: `split_${state.currentTurn}` },
    detectedByPlayer: true,
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
  const event = humanLogEvent(state.currentTurn, `Detached ${selected.length} ship(s) from ${source.name} as ${newFleet.name}`, selected[0]?.id);
  useNavalStore.setState({
    fleets: state.fleets.map((fleet) => fleet.id === source.id ? updatedSource : fleet).concat(newFleet),
    selectedFleetId: newFleet.id,
    battleLog: [...state.battleLog, event],
  });
  return true;
}

function applyDirectShipControlOrder(
  fleetId: string,
  shipId: string,
  order: { headingDeg?: number; speedKts?: number; targetPosition?: { x: number; y: number }; reason?: string },
): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && item.faction === 'player');
  if (!fleet) return false;
  const ship = fleet.ships.find((item) => item.id === shipId);
  if (!ship) return false;

  const nextShip = {
    ...ship,
    headingDeg: order.targetPosition
      ? navalBearing(ship.position.x, ship.position.y, order.targetPosition.x, order.targetPosition.y)
      : order.headingDeg ?? ship.headingDeg,
    targetSpeedKts: order.speedKts ?? ship.targetSpeedKts,
    commandState: {
      ...ship.commandState,
      controller: 'player_direct' as const,
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
    battleLog: [...state.battleLog, event],
  });
  return true;
}

function applyDelegateTemplate(
  fleetId: string,
  template: 'search_screen' | 'carrier_strike' | 'withdraw_preserve' | 'surface_intercept' | 'hold_defense',
): boolean {
  const state = useNavalStore.getState();
  const fleet = state.fleets.find((item) => item.id === fleetId && item.faction === 'player');
  if (!fleet) return false;
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
      controller: 'ai_delegated',
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
  const item: FleetCommunicationMessage = {
    id: `msg_${state.currentTurn}_${Date.now().toString(36)}`,
    turn: state.currentTurn,
    fromFleetId,
    toFleetId,
    message,
    deliveredTurn: state.currentTurn + 1,
    status: 'queued',
  };
  useNavalStore.setState({
    fleetCommunications: [...state.fleetCommunications, item],
    battleLog: [...state.battleLog, humanLogEvent(state.currentTurn, `${from.name} signaled ${to.name}: ${message}`, from.ships[0]?.id)],
  });
  return true;
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
  return updateAirMissions(airGroup, enemyShips, environment, currentTurn);
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

// ===== 导入 API Key（从 Vite env vars） =====

function getDeepSeekApiKey(): string {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('deepseek_api_key');
    if (stored) return stored;
  }
  return '';
}
