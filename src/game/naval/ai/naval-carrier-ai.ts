/**
 * 航母 AI - 航母特混舰队指挥
 */

import type { NavalShip } from '../ship/ship-types';
import type { NavalAIInput, NavalAIAction } from './naval-ai-types';

let actionIdCounter = 0;
function nextId(): string { actionIdCounter++; return `carrier_${actionIdCounter}`; }

export function generateCarrierAIActions(input: NavalAIInput): NavalAIAction[] {
  const { friendlyShips, contacts, environment } = input;
  const actions: NavalAIAction[] = [];
  const carriers = friendlyShips.filter((s) => s.aircraft != null);

  for (const carrier of carriers) {
    if (!carrier.aircraft) continue;
    if (carrier.damage.aircraftOperationPenalty >= 0.8) continue; // 甲板严重损坏
    if (carrier.aircraft.deckCycleState === 'deck_damaged') continue;
    if (carrier.aircraft.deckCycleState === 'recovering') continue;

    const hasSearchActive = carrier.aircraft.sorties.some((s) =>
      s.type === 'search' && (s.status === 'en_route' || s.status === 'searching')
    );
    const hasCAPActive = carrier.aircraft.sorties.some((s) =>
      s.type === 'cap' && (s.status === 'launched' || s.status === 'en_route')
    );

    // 启动 CAP
    if (!hasCAPActive && carrier.aircraft.fighters >= 4) {
      actions.push({
        id: nextId(),
        shipId: carrier.id,
        type: 'launch_cap',
        reason: 'Launching Combat Air Patrol',
        basedOnContactIds: [],
      });
    }

    // 分析 contact 决定行动
    const trackedContacts = contacts.filter((c) =>
      (c.detectionLevel === 'tracked' || c.detectionLevel === 'identified') && c.factionEstimate === 'enemy'
    );
    const classifiedContacts = contacts.filter((c) =>
      c.detectionLevel === 'classified' && c.factionEstimate === 'enemy'
    );
    const detectedContacts = contacts.filter((c) =>
      (c.detectionLevel === 'detected' || c.detectionLevel === 'suspected') && c.factionEstimate === 'enemy'
    );

    // 优先打击 tracked/identified
    if (trackedContacts.length > 0) {
      for (const contact of trackedContacts.slice(0, 2)) {
        if (carrier.aircraft.readyAircraft >= 8) {
          actions.push({
            id: nextId(),
            shipId: carrier.id,
            type: 'launch_strike',
            targetContactId: contact.id,
            targetPosition: contact.lastKnownPosition,
            reason: `Airstrike on tracked target (${contact.estimatedClass || 'unknown'})`,
            basedOnContactIds: [contact.id],
          });
        }
      }
    }

    // classified 联系可尝试打击
    if (classifiedContacts.length > 0 && trackedContacts.length === 0) {
      const contact = classifiedContacts[0];
      if (carrier.aircraft.readyAircraft >= 12) {
        actions.push({
          id: nextId(),
          shipId: carrier.id,
          type: 'launch_strike',
          targetContactId: contact.id,
          targetPosition: contact.lastKnownPosition,
          reason: `Airstrike on classified target (${contact.estimatedClass || 'unknown'})`,
          basedOnContactIds: [contact.id],
        });
      }
    }

    // 对 detected/suspected 联系搜索
    if (detectedContacts.length > 0 && !hasSearchActive && trackedContacts.length === 0 && classifiedContacts.length === 0) {
      const contact = detectedContacts[0];
      actions.push({
        id: nextId(),
        shipId: carrier.id,
        type: 'launch_search',
        targetContactId: contact.id,
        targetPosition: contact.lastKnownPosition,
        reason: 'Searching toward suspected contact to upgrade detection',
        basedOnContactIds: [contact.id],
      });
    }

    // 如果没有接触，常规搜索
    if (contacts.length === 0 && !hasSearchActive && carrier.aircraft.readyAircraft >= 4) {
      actions.push({
        id: nextId(),
        shipId: carrier.id,
        type: 'launch_search',
        reason: 'Routine search patrol - no enemy contacts',
        basedOnContactIds: [],
      });
    }
  }

  return actions;
}
