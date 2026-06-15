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
  islands: [],
  tacticalMaps: [],
  airOperations: [],
  landAirfields: [],
  weather: 'clear' as const,
  victory: 'none' as const,
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

    set({
      fleets: updatedFleets,
      intel,
      reports,
      currentTurn: newTurn,
      battleLog,
      weather,
      victory,
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
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('deepseek_api_key');
    if (stored) return stored;
  }
  return '';
}
