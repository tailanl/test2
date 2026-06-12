/**
 * 战术 AI - 每艘舰船的战术决策
 * 只读取 friendlyShips 和 contacts，不读取 enemyShips
 */

import type { NavalShip } from '../ship/ship-types';
import type { NavalAIInput, NavalAIAction } from './naval-ai-types';

let actionIdCounter = 0;
function nextId(): string { actionIdCounter++; return `tactical_${actionIdCounter}`; }

// ===== 核心战术 AI =====

export function generateTacticalAIActions(input: NavalAIInput): NavalAIAction[] {
  const { friendlyShips, contacts, environment } = input;
  const actions: NavalAIAction[] = [];

  for (const ship of friendlyShips) {
    if (ship.damage.status === 'sunk' || ship.damage.status === 'sinking') continue;

    const role = ship.commandState.role;

    switch (role) {
      case 'carrier':
        actions.push(...handleCarrierTactics(ship, contacts));
        break;
      case 'screen':
        actions.push(...handleScreenTactics(ship, contacts));
        break;
      case 'surface_combatant':
        actions.push(...handleSurfaceCombatantTactics(ship, contacts));
        break;
      case 'torpedo_attack':
        actions.push(...handleTorpedoAttackTactics(ship, contacts));
        break;
      case 'submarine':
        actions.push(...handleSubmarineTactics(ship, contacts));
        break;
      default:
        break;
    }

    // 损伤/损管检查
    if (ship.damage.flooding > 50 || ship.damage.fire > 50 || ship.damage.status === 'crippled') {
      actions.push({
        id: nextId(),
        shipId: ship.id,
        type: 'damage_control',
        reason: `Critical damage - prioritizing damage control (fire:${ship.damage.fire}% flood:${ship.damage.flooding}%)`,
        basedOnContactIds: [],
      });
    }

    // 撤退检查
    if (ship.damage.status === 'crippled' || ship.damage.status === 'mission_kill') {
      actions.push({
        id: nextId(),
        shipId: ship.id,
        type: 'withdraw',
        reason: 'Ship too damaged - withdrawing from combat',
        basedOnContactIds: [],
      });
    }
  }

  return actions;
}

// ===== 航母战术 =====

function handleCarrierTactics(
  ship: NavalShip,
  contacts: NavAIActionReference[]
): NavalAIAction[] {
  const actions: NavalAIAction[] = [];

  // 保持距离：远离任何接近的敌方船
  for (const contact of contacts) {
    if (contact.detectionLevel === 'none' || contact.detectionLevel === 'lost') continue;

    const dx = contact.lastKnownPosition.x - ship.position.x;
    const dy = contact.lastKnownPosition.y - ship.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 25 && contact.contactType === 'surface_ship') {
      // 转向远离
      const awayAngle = ((Math.atan2(-dy, -dx) * 180 / Math.PI) + 360) % 360;
      actions.push({
        id: nextId(),
        shipId: ship.id,
        type: 'change_course',
        headingDeg: awayAngle,
        targetSpeedKts: 30,
        reason: 'Enemy surface contact too close - carrier turning away',
        basedOnContactIds: [contact.id],
      });
    }
  }

  return actions;
}

// ===== 屏卫舰战术 =====

function handleScreenTactics(
  ship: NavalShip,
  contacts: NavAIActionReference[]
): NavalAIAction[] {
  const actions: NavalAIAction[] = [];

  for (const contact of contacts) {
    if (contact.detectionLevel === 'none' || contact.detectionLevel === 'lost') continue;

    const dx = contact.lastKnownPosition.x - ship.position.x;
    const dy = contact.lastKnownPosition.y - ship.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 15) {
      const approachAngle = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
      actions.push({
        id: nextId(),
        shipId: ship.id,
        type: 'change_course',
        headingDeg: approachAngle,
        targetSpeedKts: ship.motion.maxSpeedKts,
        reason: 'Screening - engaging enemy approaching carrier',
        basedOnContactIds: [contact.id],
      });
    }
  }

  return actions;
}

// ===== 水面作战舰战术 =====

function handleSurfaceCombatantTactics(
  ship: NavalShip,
  contacts: NavAIActionReference[]
): NavalAIAction[] {
  const actions: NavalAIAction[] = [];

  const engagingContacts = contacts.filter((c) =>
    c.detectionLevel === 'tracked' || c.detectionLevel === 'identified' || c.detectionLevel === 'classified'
  );

  if (engagingContacts.length > 0) {
    const closest = findClosestContact(ship.position, engagingContacts);
    if (closest) {
      const dx = closest.lastKnownPosition.x - ship.position.x;
      const dy = closest.lastKnownPosition.y - ship.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 20) {
        const angle = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
        actions.push({
          id: nextId(),
          shipId: ship.id,
          type: 'change_course',
          headingDeg: angle,
          targetSpeedKts: ship.motion.maxSpeedKts,
          reason: 'Closing to gun range',
          basedOnContactIds: [closest.id],
        });
      }

      // 在射程内开火
      if (dist < 30) {
        actions.push({
          id: nextId(),
          shipId: ship.id,
          type: 'fire_main_guns',
          targetContactId: closest.id,
          targetPosition: closest.lastKnownPosition,
          reason: 'Engaging tracked contact with main guns',
          basedOnContactIds: [closest.id],
        });
      }
    }
  }

  return actions;
}

// ===== 鱼雷攻击战术 =====

function handleTorpedoAttackTactics(
  ship: NavalShip,
  contacts: NavAIActionReference[]
): NavalAIAction[] {
  const actions: NavalAIAction[] = [];

  for (const contact of contacts) {
    if (contact.detectionLevel === 'none' || contact.detectionLevel === 'suspected' || contact.detectionLevel === 'lost') continue;

    const dx = contact.lastKnownPosition.x - ship.position.x;
    const dy = contact.lastKnownPosition.y - ship.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 15) {
      actions.push({
        id: nextId(),
        shipId: ship.id,
        type: 'fire_torpedoes',
        targetContactId: contact.id,
        targetPosition: contact.lastKnownPosition,
        reason: 'Torpedo attack opportunity',
        basedOnContactIds: [contact.id],
      });
    }
  }

  return actions;
}

// ===== 潜艇战术 =====

function handleSubmarineTactics(
  ship: NavalShip,
  contacts: NavAIActionReference[]
): NavalAIAction[] {
  const actions: NavalAIAction[] = [];

  // 优先攻击高价值目标
  const highValue = contacts.filter((c) =>
    c.estimatedClass === 'fleet_carrier' || c.estimatedClass === 'light_carrier' ||
    c.estimatedClass === 'transport' || c.estimatedClass === 'oiler' ||
    c.estimatedClass === 'battleship'
  );

  const targets = highValue.length > 0 ? highValue : contacts;

  if (targets.length > 0) {
    const closest = findClosestContact(ship.position, targets);
    if (closest) {
      const dx = closest.lastKnownPosition.x - ship.position.x;
      const dy = closest.lastKnownPosition.y - ship.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 10) {
        actions.push({
          id: nextId(),
          shipId: ship.id,
          type: 'fire_torpedoes',
          targetContactId: closest.id,
          targetPosition: closest.lastKnownPosition,
          reason: 'Submarine attacking high-value target',
          basedOnContactIds: [closest.id],
        });
      }
    }
  }

  return actions;
}

// ===== 辅助 =====

interface NavAIActionReference {
  id: string;
  contactType?: string;
  lastKnownPosition: { x: number; y: number };
  detectionLevel: string;
  estimatedClass?: string;
}

function findClosestContact(
  pos: { x: number; y: number },
  contacts: NavAIActionReference[]
): NavAIActionReference | null {
  if (contacts.length === 0) return null;
  let minDist = Infinity;
  let closest: NavAIActionReference | null = null;
  for (const c of contacts) {
    const dist = Math.sqrt(
      (c.lastKnownPosition.x - pos.x) ** 2 + (c.lastKnownPosition.y - pos.y) ** 2
    );
    if (dist < minDist) { minDist = dist; closest = c; }
  }
  return closest;
}
