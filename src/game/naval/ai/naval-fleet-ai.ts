/**
 * 舰队 AI - 舰队级决策
 * 不读取 enemyShips，只读取 NavalContact
 */

import type { StrategicFleet } from '../naval-strategic-types';
import type { NavalShip } from '../ship/ship-types';
import type { NavalAIInput, NavalAIAction } from './naval-ai-types';

let actionIdCounter = 0;

function nextActionId(): string {
  actionIdCounter++;
  return `action_${actionIdCounter}`;
}

// ===== 舰队 AI 决策 =====

export function generateFleetAIActions(input: NavalAIInput): NavalAIAction[] {
  const { friendlyFleets, contacts } = input;
  const actions: NavalAIAction[] = [];

  for (const fleet of friendlyFleets) {
    const fleetShips = fleet.ships;
    if (fleetShips.length === 0) continue;
    const intent = fleet.command?.commanderIntent ?? input.mission.commanderIntent;
    const decisive = intent === 'seek_decisive_battle' || intent === 'destroy_enemy_carriers';

    // 找出该舰队能探测到的敌方 contacts
    const relevantContacts = contacts.filter((c) => {
      if (c.detectionLevel === 'none' || c.detectionLevel === 'lost') return false;
      // 假设舰队在一定范围内能获取所有探测到的 contacts
      return true;
    });

    const fleetCenter = {
      x: fleet.position.globalX,
      y: fleet.position.globalY,
    };

    switch (fleet.type) {
      case 'carrier_task_force':
        actions.push(...handleCarrierTaskForce(fleet, fleetShips, relevantContacts, fleetCenter, decisive));
        break;
      case 'surface_action_group':
        actions.push(...handleSurfaceActionGroup(fleet, fleetShips, relevantContacts, fleetCenter, decisive));
        break;
      case 'transport_convoy':
      case 'supply_group':
        actions.push(...handleTransportConvoy(fleet, fleetShips, relevantContacts, fleetCenter));
        break;
      case 'submarine_group':
        actions.push(...handleSubmarineGroup(fleet, fleetShips, relevantContacts, fleetCenter));
        break;
      default:
        // 默认搜索
        if (relevantContacts.length === 0) {
          actions.push(...generateSearchActions(fleet, fleetShips, fleetCenter, decisive));
        }
        break;
    }
  }

  return actions;
}

// ===== 航母特混舰队 =====

function handleCarrierTaskForce(
  fleet: StrategicFleet,
  ships: NavalShip[],
  contacts: NavAIActionReference[],
  center: { x: number; y: number },
  decisive: boolean
): NavalAIAction[] {
  const actions: NavalAIAction[] = [];
  const carriers = ships.filter((s) => s.shipClass.includes('carrier'));

  // 如果没有敌接触，发射搜索机
  if (contacts.length === 0) {
    for (const carrier of carriers) {
      if (carrier.aircraft && carrier.aircraft.deckCycleState === 'ready') {
        actions.push({
          id: nextActionId(),
          fleetId: fleet.id,
          shipId: carrier.id,
          type: 'launch_search',
          targetPosition: (fleet as any).targetPosition,
          headingDeg: (fleet as any).targetPosition
            ? bearingTo(center.x, center.y, (fleet as any).targetPosition.x, (fleet as any).targetPosition.y)
            : undefined,
          reason: decisive ? 'Seeking decisive battle - launching battle search' : 'No enemy contacts - launching search aircraft',
          basedOnContactIds: [],
        });
      }
    }
    return actions;
  }

  // 分析接触
  const trackedContacts = contacts.filter((c) => c.detectionLevel === 'tracked' || c.detectionLevel === 'identified' || c.detectionLevel === 'classified');
  const suspectedContacts = contacts.filter((c) => c.detectionLevel === 'suspected' || c.detectionLevel === 'detected');

  // 有已分类接触，尝试打击
  if (trackedContacts.length > 0) {
    const closestContact = findClosestContact(center, trackedContacts);
    if (closestContact) {
      const dist = Math.sqrt(
        (closestContact.lastKnownPosition.x - center.x) ** 2 +
        (closestContact.lastKnownPosition.y - center.y) ** 2
      );

      // 保持距离（避免敌方水面舰接近）
      if (dist < 30) {
        actions.push({
          id: nextActionId(),
          fleetId: fleet.id,
          type: 'change_course',
          headingDeg: 180, // 转向远离
          targetSpeedKts: 30,
          reason: 'Enemy surface force too close - turning away',
          basedOnContactIds: [closestContact.id],
        });
      }

      // 发动打击
      for (const carrier of carriers) {
        if (carrier.aircraft && carrier.aircraft.deckCycleState === 'ready') {
          actions.push({
            id: nextActionId(),
            fleetId: fleet.id,
            shipId: carrier.id,
            type: 'launch_strike',
            targetContactId: closestContact.id,
            targetPosition: closestContact.lastKnownPosition,
            reason: `Launching strike on ${closestContact.estimatedClass} contact`,
            basedOnContactIds: [closestContact.id],
          });
        }
      }
    }
  }

  // 有可疑接触，派搜索机
  if (suspectedContacts.length > 0) {
    for (const carrier of carriers) {
      if (carrier.aircraft && carrier.aircraft.deckCycleState === 'ready') {
        const sc = suspectedContacts[0];
        actions.push({
          id: nextActionId(),
          fleetId: fleet.id,
          shipId: carrier.id,
          type: 'launch_search',
          targetContactId: sc.id,
          targetPosition: sc.lastKnownPosition,
          reason: `Launching search toward suspected contact`,
          basedOnContactIds: [sc.id],
        });
      }
    }
  }

  return actions;
}

// ===== 水面舰队 =====

function handleSurfaceActionGroup(
  fleet: StrategicFleet,
  ships: NavalShip[],
  contacts: NavAIActionReference[],
  center: { x: number; y: number },
  decisive: boolean
): NavalAIAction[] {
  const actions: NavalAIAction[] = [];

  const trackedContacts = contacts.filter((c) =>
    c.detectionLevel === 'tracked' || c.detectionLevel === 'identified' || c.detectionLevel === 'classified'
  );

  if (trackedContacts.length > 0) {
    const closest = findClosestContact(center, trackedContacts);
    if (closest) {
      const dist = Math.sqrt(
        (closest.lastKnownPosition.x - center.x) ** 2 +
        (closest.lastKnownPosition.y - center.y) ** 2
      );

      // 接近到炮战距离
      if (dist > 20) {
        actions.push({
          id: nextActionId(),
          fleetId: fleet.id,
          type: 'change_course',
          headingDeg: bearingTo(center.x, center.y, closest.lastKnownPosition.x, closest.lastKnownPosition.y),
          targetSpeedKts: decisive ? 30 : 28,
          reason: `Approaching tracked contact for surface engagement`,
          basedOnContactIds: [closest.id],
        });
      }

      // 驱逐舰鱼雷攻击
      for (const ship of ships) {
        if (ship.shipClass === 'destroyer' && dist < 15) {
          actions.push({
            id: nextActionId(),
            shipId: ship.id,
            fleetId: fleet.id,
            type: 'fire_torpedoes',
            targetContactId: closest.id,
            targetPosition: closest.lastKnownPosition,
            reason: 'Destroyer torpedo attack opportunity',
            basedOnContactIds: [closest.id],
          });
        }

        // 主炮开火
        if ((ship.shipClass === 'battleship' || ship.shipClass === 'heavy_cruiser' || ship.shipClass === 'light_cruiser') && dist < 30) {
          actions.push({
            id: nextActionId(),
            shipId: ship.id,
            fleetId: fleet.id,
            type: 'fire_main_guns',
            targetContactId: closest.id,
            targetPosition: closest.lastKnownPosition,
            reason: 'Main gun engagement',
            basedOnContactIds: [closest.id],
          });
        }
      }
    }
  } else {
    // 搜索
    actions.push(...generateSearchActions(fleet, ships, center, decisive));
  }

  return actions;
}

// ===== 运输船团 =====

function handleTransportConvoy(
  fleet: StrategicFleet,
  _ships: NavalShip[],
  contacts: NavAIActionReference[],
  center: { x: number; y: number },
  decisive = false
): NavalAIAction[] {
  const actions: NavalAIAction[] = [];
  const assignedTarget = (fleet as any).targetPosition as { x: number; y: number } | undefined;

  if (contacts.length > 0) {
    const closest = findClosestContact(center, contacts);
    if (closest) {
      // 转向远离
      const angle = Math.atan2(
        closest.lastKnownPosition.y - center.y,
        closest.lastKnownPosition.x - center.x
      ) * (180 / Math.PI);
      actions.push({
        id: nextActionId(),
        fleetId: fleet.id,
        type: 'change_course',
        headingDeg: (((angle + 180) % 360) + 360) % 360,
        targetSpeedKts: 16,
        reason: 'Enemy contact - convoy turning away',
        basedOnContactIds: [closest.id],
      });
    }
  }

  return actions;
}

// ===== 潜艇群 =====

function handleSubmarineGroup(
  fleet: StrategicFleet,
  ships: NavalShip[],
  contacts: NavAIActionReference[],
  center: { x: number; y: number }
): NavalAIAction[] {
  const actions: NavalAIAction[] = [];

  // 优先攻击运输船/航母/油船
  const highValueTargets = contacts.filter((c) =>
    c.estimatedClass === 'fleet_carrier' || c.estimatedClass === 'light_carrier' ||
    c.estimatedClass === 'transport' || c.estimatedClass === 'oiler'
  );

  const targets = highValueTargets.length > 0 ? highValueTargets : contacts;

  if (targets.length > 0) {
    const closest = findClosestContact(center, targets);
    if (closest) {
      const dist = Math.sqrt(
        (closest.lastKnownPosition.x - center.x) ** 2 +
        (closest.lastKnownPosition.y - center.y) ** 2
      );

      if (dist < 12) {
        for (const sub of ships) {
          actions.push({
            id: nextActionId(),
            shipId: sub.id,
            fleetId: fleet.id,
            type: 'fire_torpedoes',
            targetContactId: closest.id,
            targetPosition: closest.lastKnownPosition,
            reason: 'Submarine torpedo attack',
            basedOnContactIds: [closest.id],
          });
        }
      }
    }
  }

  return actions;
}

// ===== 搜索行动 =====

function generateSearchActions(
  fleet: StrategicFleet,
  ships: NavalShip[],
  center: { x: number; y: number },
  decisive = false
): NavalAIAction[] {
  const actions: NavalAIAction[] = [];
  const assignedTarget = (fleet as any).targetPosition as { x: number; y: number } | undefined;

  for (const ship of ships) {
    if (ship.shipClass.includes('carrier') && ship.aircraft && ship.aircraft.deckCycleState === 'ready') {
      actions.push({
        id: nextActionId(),
        fleetId: fleet.id,
        shipId: ship.id,
        type: 'launch_search',
        targetPosition: assignedTarget,
        headingDeg: assignedTarget ? bearingTo(center.x, center.y, assignedTarget.x, assignedTarget.y) : undefined,
        reason: decisive ? 'Seeking decisive battle - launching battle search' : 'Routine search patrol',
        basedOnContactIds: [],
      });
    }
  }

  // 如果没有任何 carrier，舰队移动搜索
  if (!ships.some((s) => s.shipClass.includes('carrier'))) {
    actions.push({
      id: nextActionId(),
      fleetId: fleet.id,
      type: assignedTarget ? 'change_course' : 'change_speed',
      headingDeg: assignedTarget ? bearingTo(center.x, center.y, assignedTarget.x, assignedTarget.y) : undefined,
      targetSpeedKts: assignedTarget ? (decisive ? 28 : 18) : (decisive ? 24 : 18),
      reason: assignedTarget
        ? (decisive ? 'Seeking decisive battle toward assigned sea area' : 'Searching toward assigned sea area')
        : (decisive ? 'Battle search speed while seeking decisive engagement' : 'Cruising speed for search patrol'),
      basedOnContactIds: [],
    });
  }

  return actions;
}

// ===== 辅助函数 =====

interface NavAIActionReference {
  id: string;
  lastKnownPosition: { x: number; y: number };
  detectionLevel: string;
  estimatedClass?: string;
}

function findClosestContact(
  center: { x: number; y: number },
  contacts: NavAIActionReference[]
): NavAIActionReference | null {
  if (contacts.length === 0) return null;

  let minDist = Infinity;
  let closest: NavAIActionReference | null = null;

  for (const c of contacts) {
    const dist = Math.sqrt(
      (c.lastKnownPosition.x - center.x) ** 2 +
      (c.lastKnownPosition.y - center.y) ** 2
    );
    if (dist < minDist) {
      minDist = dist;
      closest = c;
    }
  }

  return closest;
}

function bearingTo(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.round(((Math.atan2(toX - fromX, fromY - toY) * 180 / Math.PI) % 360 + 360) % 360);
}
