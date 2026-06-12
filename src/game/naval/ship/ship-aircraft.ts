/**
 * 舰载机系统 - 航母航空作业
 */

import type { NavalShip } from './ship-types';
import type { NavalContact } from '../intel/naval-intel-types';
import type { NavalEnvironmentState } from '../naval-types';
import type { NavalBattleLogEvent } from './ship-damage';
import type { NavalAircraft, NavalAircraftClass } from '../air/aircraft-types';
import { createDefaultAircraft } from '../air/aircraft-types';
import { updateAircraftMotion } from '../air/aircraft-motion';

// ===== 航空任务类型 =====

export type NavalAirMissionType =
  | 'search'
  | 'cap'
  | 'strike'
  | 'torpedo_attack'
  | 'dive_bombing'
  | 'recon'
  | 'anti_submarine';

// ===== 航空任务 =====

export interface NavalAirMission {
  id: string;
  type: NavalAirMissionType;
  originShipId: string;
  targetArea?: {
    x: number;
    y: number;
    radius: number;
  };
  targetContactId?: string;
  aircraftCount: number;
  status:
    | 'preparing'
    | 'launched'
    | 'en_route'
    | 'searching'
    | 'attacking'
    | 'returning'
    | 'recovered'
    | 'lost';
  etaTurns: number;
  searchArcDeg?: {
    centerDeg: number;
    widthDeg: number;
    range: number;
  };
}

// ===== 航母航空组 =====

export interface CarrierAirGroup {
  fighters: number;
  diveBombers: number;
  torpedoBombers: number;
  readyAircraft: number;
  damagedAircraft: number;
  lostAircraft: number;
  deckCycleState:
    | 'ready'
    | 'launching'
    | 'recovering'
    | 'rearming'
    | 'deck_damaged';
  sorties: NavalAirMission[];
  aircraft?: NavalAircraft[];
}

// ===== 默认航母航空组 =====

export function createDefaultCarrierAirGroup(shipClass: string): CarrierAirGroup {
  switch (shipClass) {
    case 'fleet_carrier':
      return {
        fighters: 36,
        diveBombers: 36,
        torpedoBombers: 18,
        readyAircraft: 90,
        damagedAircraft: 0,
        lostAircraft: 0,
        deckCycleState: 'ready',
        sorties: [],
      };
    case 'light_carrier':
      return {
        fighters: 18,
        diveBombers: 12,
        torpedoBombers: 9,
        readyAircraft: 39,
        damagedAircraft: 0,
        lostAircraft: 0,
        deckCycleState: 'ready',
        sorties: [],
      };
    case 'escort_carrier':
      return {
        fighters: 12,
        diveBombers: 0,
        torpedoBombers: 6,
        readyAircraft: 18,
        damagedAircraft: 0,
        lostAircraft: 0,
        deckCycleState: 'ready',
        sorties: [],
      };
    default:
      return {
        fighters: 0,
        diveBombers: 0,
        torpedoBombers: 0,
        readyAircraft: 0,
        damagedAircraft: 0,
        lostAircraft: 0,
        deckCycleState: 'ready',
        sorties: [],
      };
  }
}

let missionIdCounter = 0;

function nextMissionId(): string {
  missionIdCounter++;
  return `mission_${missionIdCounter}`;
}

// ===== 创建搜索任务 =====

export function createSearchMission(params: {
  shipId: string;
  airGroup: CarrierAirGroup;
  targetArea: { x: number; y: number; radius: number };
  searchArcDeg: { centerDeg: number; widthDeg: number; range: number };
  aircraftCount: number;
}): { mission: NavalAirMission; airGroup: CarrierAirGroup } {
  const newAirGroup = { ...params.airGroup };
  const planes = Math.min(params.aircraftCount, newAirGroup.diveBombers + newAirGroup.fighters);

  if (planes <= 0 || newAirGroup.deckCycleState === 'deck_damaged') {
    throw new Error('Cannot launch: no aircraft or deck damaged');
  }

  const mission: NavalAirMission = {
    id: nextMissionId(),
    type: 'search',
    originShipId: params.shipId,
    targetArea: params.targetArea,
    aircraftCount: planes,
    status: 'launched',
    etaTurns: 2,
    searchArcDeg: params.searchArcDeg,
  };

  newAirGroup.readyAircraft -= planes;
  newAirGroup.sorties.push(mission);
  newAirGroup.deckCycleState = 'launching';

  return { mission, airGroup: newAirGroup };
}

// ===== 创建打击任务 =====

export function createStrikeMission(params: {
  shipId: string;
  airGroup: CarrierAirGroup;
  targetContactId: string;
  targetArea: { x: number; y: number; radius: number };
  aircraftCount: number;
}): { mission: NavalAirMission; airGroup: CarrierAirGroup } {
  const newAirGroup = { ...params.airGroup };
  const planes = Math.min(params.aircraftCount, newAirGroup.readyAircraft);

  if (planes <= 0 || newAirGroup.deckCycleState === 'deck_damaged') {
    throw new Error('Cannot launch: no aircraft or deck damaged');
  }

  const mission: NavalAirMission = {
    id: nextMissionId(),
    type: 'strike',
    originShipId: params.shipId,
    targetContactId: params.targetContactId,
    targetArea: params.targetArea,
    aircraftCount: planes,
    status: 'launched',
    etaTurns: 3,
  };

  newAirGroup.readyAircraft -= planes;
  newAirGroup.sorties.push(mission);
  newAirGroup.deckCycleState = 'launching';

  return { mission, airGroup: newAirGroup };
}

// ===== 创建 CAP 任务 =====

export function createCAPMission(params: {
  shipId: string;
  airGroup: CarrierAirGroup;
  fighterCount: number;
}): { mission: NavalAirMission; airGroup: CarrierAirGroup } {
  const newAirGroup = { ...params.airGroup };
  const planes = Math.min(params.fighterCount, newAirGroup.fighters);

  if (planes <= 0 || newAirGroup.deckCycleState === 'deck_damaged') {
    throw new Error('Cannot launch CAP: no fighters or deck damaged');
  }

  const mission: NavalAirMission = {
    id: nextMissionId(),
    type: 'cap',
    originShipId: params.shipId,
    targetArea: { x: 0, y: 0, radius: 30 },
    aircraftCount: planes,
    status: 'launched',
    etaTurns: 1,
  };

  newAirGroup.readyAircraft -= planes;
  newAirGroup.sorties.push(mission);
  newAirGroup.deckCycleState = 'launching';

  return { mission, airGroup: newAirGroup };
}

// ===== 解析航空搜索任务 =====

export function resolveAirSearchMission(params: {
  mission: NavalAirMission;
  enemyShips: NavalShip[];
  environment: NavalEnvironmentState;
  currentTurn: number;
}): {
  contacts: NavalContact[];
  mission: NavalAirMission;
  events: NavalBattleLogEvent[];
} {
  const { mission, enemyShips, environment, currentTurn } = params;
  const contacts: NavalContact[] = [];
  const events: NavalBattleLogEvent[] = [];
  const newMission = { ...mission };

  if (mission.status !== 'searching' && mission.status !== 'en_route') {
    return { contacts, mission: newMission, events };
  }

  if (!mission.targetArea) {
    return { contacts, mission: newMission, events };
  }

  newMission.etaTurns = Math.max(0, mission.etaTurns - 1);

  if (newMission.etaTurns > 0) {
    newMission.status = 'en_route';
    return { contacts, mission: newMission, events };
  }

  newMission.status = 'searching';

  // 天气修正侦察效率
  const weatherMod = environment.weather === 'clear' ? 1.0 :
    environment.weather === 'rain' ? 0.7 :
    environment.weather === 'squall' ? 0.4 :
    environment.weather === 'fog' ? 0.15 : 0.05;

  if (weatherMod <= 0.1) {
    newMission.status = 'returning';
    return { contacts, mission: newMission, events };
  }

  // 对搜索区域内的每艘敌舰生成 contact
  for (const enemy of enemyShips) {
    const { targetArea } = mission;
    const tx = targetArea.x;
    const ty = targetArea.y;
    const radius = targetArea.radius;

    const dx = enemy.position.x - tx;
    const dy = enemy.position.y - ty;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= radius) {
      const detectionChance = weatherMod * 0.7 * (1 - enemy.stealth.surfaceSignature / 200);

      if (Math.random() < detectionChance) {
        const contact: NavalContact = {
          id: `contact_${enemy.id}_${currentTurn}`,
          originalEntityId: enemy.id,
          contactType: enemy.shipClass === 'submarine' ? 'submarine' : 'surface_ship',
          detectionLevel: 'detected',
          factionEstimate: 'enemy',
          estimatedClass: Math.random() < 0.3 ? enemy.shipClass : 'unknown',
          estimatedCount: 1,
          lastKnownPosition: { x: enemy.position.x + (Math.random() - 0.5) * 5, y: enemy.position.y + (Math.random() - 0.5) * 5 },
          uncertaintyRadius: 5,
          lastDetectedTurn: currentTurn,
          confidence: Math.random() < 0.5 ? 'medium' : 'low',
          detectedBy: [{ sensorPlatformId: mission.originShipId, sensorType: 'aircraft_search', turn: currentTurn }],
          trackHistory: [{ turn: currentTurn, x: enemy.position.x, y: enemy.position.y, uncertaintyRadius: 5, detectionLevel: 'detected' }],
          stale: false,
        };
        contacts.push(contact);
        events.push({
          id: `search_event_${Date.now()}_${Math.random()}`,
          turn: currentTurn,
          type: 'air_search_contact',
          description: `Search aircraft spotted enemy ${enemy.shipClass} at approx position`,
          shipId: mission.originShipId,
          targetId: enemy.id,
        });
      }
    }
  }

  newMission.status = 'returning';
  return { contacts, mission: newMission, events };
}

// ===== 更新所有航空任务 =====

export function updateAirMissions(
  airGroup: CarrierAirGroup,
  enemyShips: NavalShip[],
  environment: NavalEnvironmentState,
  currentTurn: number
): {
  airGroup: CarrierAirGroup;
  contacts: NavalContact[];
  events: NavalBattleLogEvent[];
} {
  const newAirGroup = { ...airGroup };
  const allContacts: NavalContact[] = [];
  const allEvents: NavalBattleLogEvent[] = [];

  newAirGroup.sorties = newAirGroup.sorties.map((m) => {
    const resolved = resolveAirSearchMission({ mission: m, enemyShips, environment, currentTurn });
    allContacts.push(...resolved.contacts);
    allEvents.push(...resolved.events);
    return resolved.mission;
  });

  // 恢复已返回的飞机
  const returned = newAirGroup.sorties.filter((m) => m.status === 'recovered');
  for (const m of returned) {
    newAirGroup.readyAircraft = Math.min(
      newAirGroup.fighters + newAirGroup.diveBombers + newAirGroup.torpedoBombers,
      newAirGroup.readyAircraft + m.aircraftCount
    );
  }

  // 清理已完成/丢失的任务
  newAirGroup.sorties = newAirGroup.sorties.filter(
    (m) => m.status !== 'recovered' && m.status !== 'lost'
  );

  // 恢复甲板状态
  if (newAirGroup.sorties.length === 0 && newAirGroup.deckCycleState !== 'deck_damaged') {
    newAirGroup.deckCycleState = 'ready';
  }

  // 更新具体飞机运动
  if (newAirGroup.aircraft && newAirGroup.aircraft.length > 0) {
    newAirGroup.aircraft = newAirGroup.aircraft
      .filter((ac) => ac.status !== 'lost' && ac.status !== 'landed')
      .map((ac) => {
        let updated = updateAircraftMotion({ aircraft: ac, deltaTurns: 1 });
        // 返回航母的飞机回收
        if (updated.fuel <= 5 && updated.status !== 'landed') {
          updated = { ...updated, status: 'returning', targetSpeedKts: updated.motion.cruiseSpeedKts };
        }
        if (updated.status === 'returning') {
          // 简单回收逻辑
          const originShip = enemyShips.find((_s) => false); // placeholder
          if (!originShip) {
            // 模拟回收
            if (updated.fuel <= 0) {
              updated.status = 'landed';
            }
          }
        }
        return updated;
      });

    // 回收已着陆的飞机
    const landedCount = newAirGroup.aircraft.filter((ac) => ac.status === 'landed').length;
    if (landedCount > 0) {
      newAirGroup.readyAircraft += landedCount;
      newAirGroup.aircraft = newAirGroup.aircraft.filter((ac) => ac.status !== 'landed');
    }

    // 处理丢失的飞机
    const lostCount = newAirGroup.aircraft.filter((ac) => ac.status === 'lost').length;
    if (lostCount > 0) {
      newAirGroup.lostAircraft += lostCount;
      newAirGroup.aircraft = newAirGroup.aircraft.filter((ac) => ac.status !== 'lost');
    }
  }

  return { airGroup: newAirGroup, contacts: allContacts, events: allEvents };
}

// ===== 根据 mission 创建具体飞机 =====

export function createAircraftForMission(params: {
  mission: NavalAirMission;
  originShip: NavalShip;
  count: number;
}): NavalAircraft[] {
  const { mission, originShip, count } = params;
  const aircraft: NavalAircraft[] = [];
  const faction = originShip.faction as 'player' | 'enemy' | 'neutral';

  let aircraftClass: NavalAircraftClass;
  switch (mission.type) {
    case 'search':
    case 'recon':
      aircraftClass = 'scout';
      break;
    case 'cap':
      aircraftClass = 'fighter';
      break;
    case 'torpedo_attack':
      aircraftClass = 'torpedo_bomber';
      break;
    case 'dive_bombing':
      aircraftClass = 'dive_bomber';
      break;
    case 'strike':
    default:
      aircraftClass = 'dive_bomber';
      break;
  }

  const baseX = originShip.position.x;
  const baseY = originShip.position.y;

  for (let i = 0; i < count; i++) {
    const heading = ((mission.searchArcDeg?.centerDeg || originShip.headingDeg) + (i - count / 2) * 15 + 360) % 360;
    const ac = createDefaultAircraft(
      aircraftClass, faction,
      `${aircraftClass}_${i + 1}`, baseX, baseY,
      heading, 0, originShip.id, mission.id
    );
    ac.targetSpeedKts = ac.motion.cruiseSpeedKts;
    if (mission.targetContactId) {
      ac.status = 'attack_run';
      ac.attackState = {
        targetContactId: mission.targetContactId,
        attackType: mission.type === 'torpedo_attack' ? 'torpedo_drop' : 'dive_bombing',
        attackRunStartedTurn: 0,
        committed: true,
        weaponReleased: false,
      };
    }
    aircraft.push(ac);
  }

  return aircraft;
}
