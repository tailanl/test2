/**
 * 海军模式状态管理 (Zustand)
 * 独立海战系统 - 不依赖 WorldAtlas / RegionTile
 */

import { create } from 'zustand';
import type { NavalCellOverlay, NavalEnvironmentState } from '../game/naval/naval-types';
import type { StrategicFleet } from '../game/naval/naval-strategic-types';
import type { NavalShip, NavalShipClass } from '../game/naval/ship/ship-types';
import type { NavalIntelState, NavalContact } from '../game/naval/intel/naval-intel-types';
import type { NavalAIReport, NavalAIAction } from '../game/naval/ai/naval-ai-types';
import type { NavalOperationView, NavalCombatViewport, NavalBattleMap } from '../game/naval/naval-types';
import type { NavalBattleLogEvent } from '../game/naval/ship/ship-damage';
import { generateNavalMap, createNavalBattleMap } from '../game/naval/naval-map-adapter';
import type { NavalFacility, ShippingLane } from '../game/naval/naval-map-generator';
import { createDefaultIntelState } from '../game/naval/intel/naval-intel-types';
import { updateNavalIntelState } from '../game/naval/intel/naval-contact-tracker';
import { decayNavalContacts } from '../game/naval/intel/naval-contact-tracker';
import { generateFleetAIActions } from '../game/naval/ai/naval-fleet-ai';
import { generateTacticalAIActions } from '../game/naval/ai/naval-tactical-ai';
import { generateCarrierAIActions } from '../game/naval/ai/naval-carrier-ai';
import { generateNavalReports } from '../game/naval/ai/naval-report-generator';
import { executeNavalAIActions } from '../game/naval/ai/naval-action-executor';
import { updateShipMotion } from '../game/naval/ship/ship-motion';
import { createShipForClass } from '../game/naval/naval-debug';
import { updateAirMissions, type CarrierAirGroup, type NavalAirMission } from '../game/naval/ship/ship-aircraft';
import { getNavalAdvice, parseNaturalCommand, buildNavalLLMContext } from '../ai/provider';
import type { NavalLLMAdvice, NavalLLMCommandResult, AIProviderConfig } from '../ai/types';

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

  intel: NavalIntelState;

  reports: NavalAIReport[];

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
  submitNavalCommand: (text: string, fleetIds: string[]) => void;
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
  intel: createDefaultIntelState(),
  reports: [],
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
    kind: 'deepseek',
    model: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: '',
    temperature: 0.7,
    maxTokens: 600,
  },
  aiAdvice: undefined,
  aiLoading: false,
  aiError: undefined,

  createNavalScenario: () => {
    set({ isCreatingScenario: true });
    try {
    // 独立地图生成 (Pacific island chain)
    const mapResult = generateNavalMap({
      width: 1024,
      height: 1024,
      seed: Date.now(),
      islandGroupCount: 8,
      maxIslandRadius: 60,
      minIslandRadius: 8,
      facilityDensity: 0.4,
      seaLevel: 0.40,
    });

    const overlay = mapResult.overlay;
    const tileW = overlay[0]?.length ?? 1024;
    const tileH = overlay.length;

    // 舰队位置：放在 player 和 enemy 的港口附近
    const playerPorts = mapResult.facilities.filter((f) => f.faction === 'player' && (f.type === 'port' || f.type === 'naval_base'));
    const enemyPorts = mapResult.facilities.filter((f) => f.faction === 'enemy' && (f.type === 'port' || f.type === 'naval_base'));

    const playerCX = playerPorts[0]?.position.globalX ?? Math.floor(tileW * 0.35);
    const playerCY = playerPorts[0]?.position.globalY ?? Math.floor(tileH * 0.50);
    const enemyCX = enemyPorts[0]?.position.globalX ?? Math.floor(tileW * 0.60);
    const enemyCY = enemyPorts[0]?.position.globalY ?? Math.floor(tileH * 0.55);

    // Create player fleet
    const playerShips: NavalShip[] = [
      createShip('fleet_carrier', 'player', 'CV Enterprise', playerCX, playerCY, 0, 20, 'carrier'),
      createShip('heavy_cruiser', 'player', 'CA Northampton', playerCX - 10, playerCY - 10, 0, 20, 'screen'),
      createShip('heavy_cruiser', 'player', 'CA Portland', playerCX + 10, playerCY + 10, 0, 20, 'screen'),
      createShip('destroyer', 'player', 'DD Fletcher', playerCX - 15, playerCY + 5, 0, 20, 'screen'),
      createShip('destroyer', 'player', 'DD O\'Bannon', playerCX + 15, playerCY - 5, 0, 20, 'screen'),
      createShip('destroyer', 'player', 'DD Nicholas', playerCX + 5, playerCY - 15, 0, 20, 'picket'),
    ];

    // Create enemy fleet
    const enemyShips: NavalShip[] = [
      createShip('battleship', 'enemy', 'BB Yamato', enemyCX, enemyCY, 180, 15, 'surface_combatant'),
      createShip('heavy_cruiser', 'enemy', 'CA Tone', enemyCX + 10, enemyCY - 10, 180, 15, 'surface_combatant'),
      createShip('light_cruiser', 'enemy', 'CL Sendai', enemyCX - 10, enemyCY + 10, 180, 15, 'screen'),
      createShip('destroyer', 'enemy', 'DD Kagero', enemyCX + 15, enemyCY + 5, 180, 15, 'torpedo_attack'),
      createShip('destroyer', 'enemy', 'DD Shiranui', enemyCX - 15, enemyCY - 5, 180, 15, 'torpedo_attack'),
    ];

    const playerFleet: StrategicFleet = {
      id: 'player_ctf_1',
      name: 'Task Force 16',
      faction: 'player',
      type: 'carrier_task_force',
      position: { regionX: 0, regionY: 0, chunkX: Math.floor(tileW * 0.35 / 32), chunkY: Math.floor(tileH * 0.50 / 32), globalX: playerCX, globalY: playerCY },
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
      position: { regionX: 0, regionY: 0, chunkX: Math.floor(tileW * 0.60 / 32), chunkY: Math.floor(tileH * 0.55 / 32), globalX: enemyCX, globalY: enemyCY },
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

    set({
      overlay,
      facilities: mapResult.facilities,
      shippingLanes: mapResult.shippingLanes,
      fleets: [playerFleet, enemyFleet],
      intel: { ...createDefaultIntelState() },
      reports: [],
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

    const battleMap = createNavalBattleMap({
      overlay: state.overlay,
      centerGlobalX: fleet.position.globalX,
      centerGlobalY: fleet.position.globalY,
      width: 64,
      height: 48,
    });

    set({
      selectedFleetId: fleetId,
      navalMode: 'combat',
      battleMap,
    });
  },

  submitNavalCommand: (_text: string, _fleetIds: string[]) => {
    // Command submission - placeholder
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

    // 1. Update ship motion
    let updatedShipMap: Record<string, NavalShip> = {};
    for (const fleet of fleets) {
      for (const ship of fleet.ships) {
        updatedShipMap[ship.id] = updateShipMotion(ship, 1);
      }
    }

    // 2. Generate AI actions from contacts only (no enemyShips)
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

    // 7. Update fleets with new ship positions
    const updatedFleets = fleets.map((fleet) => {
      return {
        ...fleet,
        ships: fleet.ships.map((s) => updatedShipMap[s.id] || s),
      };
    });

    set({
      fleets: updatedFleets,
      intel,
      reports,
      currentTurn: newTurn,
      battleLog,
    });
  },

  requestAIAdvice: async () => {
    const state = get();
    set({ aiLoading: true, aiError: undefined });

    try {
      const apiKey = getDeepSeekApiKey();
      const config: AIProviderConfig = {
        ...state.aiConfig,
        apiKey,
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
      const apiKey = getDeepSeekApiKey();
      const config: AIProviderConfig = {
        ...state.aiConfig,
        apiKey,
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

      const result = await parseNaturalCommand({ config, userInput, context });
      if (result.parsed && result.fleetId) {
        // Apply the command
        const fleet = state.fleets.find((f) => f.id === result.fleetId);
        if (fleet) {
          set({ selectedFleetId: result.fleetId });
          useNavalStore.getState().openNavalCombatView(result.fleetId);
        }
      }
      return result;
    } catch (e) {
      return null;
    }
  },
}));

// ===== 局部辅助 =====

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
  // Vite exposes env vars via import.meta.env for VITE_ prefixed vars
  // For standalone access, read from the store or localStorage
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('deepseek_api_key');
    if (stored) return stored;
  }
  return 'sk-b895a96126db4365ba217ef5b8d1d795';
}
