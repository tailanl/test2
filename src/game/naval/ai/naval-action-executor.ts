/**
 * 海军 AI 行动执行器 - 将 AI 生成的 actions 应用到游戏状态
 */

import type { NavalAIAction } from './naval-ai-types';
import type { StrategicFleet } from '../naval-strategic-types';
import type { NavalShip } from '../ship/ship-types';
import type { NavalIntelState } from '../intel/naval-intel-types';
import type { NavalEnvironmentState } from '../naval-types';
import type { NavalBattleLogEvent } from '../ship/ship-damage';
import type { NavalAirMission } from '../ship/ship-aircraft';
import { clampRudder, setShipTargetSpeed } from '../ship/ship-motion';
import { createSearchMission, createStrikeMission, createCAPMission } from '../ship/ship-aircraft';
import { assignDamageControlTeam } from '../ship/ship-damage-control';

// ===== 执行 AI Actions =====

export function executeNavalAIActions(params: {
  actions: NavalAIAction[];
  fleets: StrategicFleet[];
  shipMap: Record<string, NavalShip>;
  intel: NavalIntelState;
  environment: NavalEnvironmentState;
  currentTurn: number;
}): {
  shipMap: Record<string, NavalShip>;
  updatedSearchMissions: NavalAirMission[];
  events: NavalBattleLogEvent[];
} {
  const { actions, shipMap, intel, environment, currentTurn, fleets } = params;
  const events: NavalBattleLogEvent[] = [];
  const newSearchMissions: NavalAirMission[] = [...intel.searchMissions];

  let eventCounter = 0;
  function nextEventId(): string {
    eventCounter++;
    return `exec_${currentTurn}_${eventCounter}`;
  }

  for (const action of actions) {
    try {
      let targetShips: NavalShip[] = [];

      if (action.shipId && shipMap[action.shipId]) {
        targetShips = [shipMap[action.shipId]];
      } else if (action.fleetId) {
        const fleet = fleets.find((f) => f.id === action.fleetId);
        if (fleet) {
          targetShips = fleet.ships.map((s) => shipMap[s.id] || s).filter(Boolean);
        }
      }

      if (targetShips.length === 0) continue;

      switch (action.type) {
        case 'change_course':
          for (const ship of targetShips) {
            if (action.headingDeg !== undefined) {
              const newShip: NavalShip = { ...ship, headingDeg: action.headingDeg };
              if (action.rudderDeg !== undefined) {
                newShip.rudderDeg = clampRudder(action.rudderDeg, ship.motion.maxRudderDeg);
              }
              shipMap[ship.id] = newShip;
            }
            events.push({
              id: nextEventId(),
              turn: currentTurn,
              type: 'change_course',
              description: `${ship.name} course changed to ${action.headingDeg}deg`,
              shipId: ship.id,
            });
          }
          break;

        case 'change_speed':
          for (const ship of targetShips) {
            if (action.targetSpeedKts !== undefined) {
              shipMap[ship.id] = setShipTargetSpeed(ship, action.targetSpeedKts);
            }
            events.push({
              id: nextEventId(),
              turn: currentTurn,
              type: 'change_speed',
              description: `${ship.name} speed set to ${action.targetSpeedKts}kts`,
              shipId: ship.id,
            });
          }
          break;

        case 'launch_search':
          for (const ship of targetShips) {
            if (ship.aircraft && ship.aircraft.deckCycleState === 'ready' && ship.aircraft.readyAircraft >= 4) {
              const targetArea = action.targetPosition
                ? { x: action.targetPosition.x, y: action.targetPosition.y, radius: 40 }
                : { x: ship.position.x, y: ship.position.y, radius: 40 };
              const centerDeg = action.headingDeg ?? (action.targetPosition
                ? bearingTo(ship.position.x, ship.position.y, action.targetPosition.x, action.targetPosition.y)
                : ship.headingDeg);
              try {
                const result = createSearchMission({
                  shipId: ship.id,
                  airGroup: ship.aircraft,
                  targetArea,
                  originPosition: { x: ship.position.x, y: ship.position.y },
                  searchArcDeg: { centerDeg, widthDeg: 120, range: 40 },
                  aircraftCount: 4,
                  prepTurns: 1,
                });
                shipMap[ship.id] = { ...ship, aircraft: result.airGroup };
                newSearchMissions.push(result.mission);
                events.push({
                  id: nextEventId(),
                  turn: currentTurn,
                  type: 'launch_search',
                  description: `${ship.name} launched search aircraft (4 planes)`,
                  shipId: ship.id,
                });
              } catch (_e) {
                // Deck damaged or no aircraft
              }
            }
          }
          break;

        case 'launch_cap':
          for (const ship of targetShips) {
            if (ship.aircraft && ship.aircraft.deckCycleState === 'ready' && ship.aircraft.fighters >= 4) {
              try {
                const result = createCAPMission({
                  shipId: ship.id,
                  airGroup: ship.aircraft,
                  fighterCount: 4,
                });
                shipMap[ship.id] = { ...ship, aircraft: result.airGroup };
                newSearchMissions.push(result.mission);
                events.push({
                  id: nextEventId(),
                  turn: currentTurn,
                  type: 'launch_cap',
                  description: `${ship.name} launched CAP (4 fighters)`,
                  shipId: ship.id,
                });
              } catch (_e) {
                // Deck damaged or no fighters
              }
            }
          }
          break;

        case 'launch_strike':
          for (const ship of targetShips) {
            const contact = findActionContact(action, ship, fleets, intel);
            if (ship.aircraft && ship.aircraft.deckCycleState === 'ready' && ship.aircraft.readyAircraft >= 8 && contact) {
              if (contact.detectionLevel === 'classified' || contact.detectionLevel === 'identified' || contact.detectionLevel === 'tracked') {
                try {
                  const result = createStrikeMission({
                    shipId: ship.id,
                    airGroup: ship.aircraft,
                    targetContactId: contact.id,
                    targetArea: {
                      x: contact.lastKnownPosition.x,
                      y: contact.lastKnownPosition.y,
                      radius: 10,
                    },
                    aircraftCount: 12,
                  });
                  shipMap[ship.id] = { ...ship, aircraft: result.airGroup };
                  newSearchMissions.push(result.mission);
                  events.push({
                    id: nextEventId(),
                    turn: currentTurn,
                    type: 'launch_strike',
                    description: `${ship.name} launched strike on ${contact.estimatedClass} contact (12 aircraft)`,
                    shipId: ship.id,
                    targetId: contact.originalEntityId,
                  });
                } catch (_e) {
                  // Deck damaged
                }
              }
            }
          }
          break;

        case 'fire_main_guns':
          for (const ship of targetShips) {
            const contact = findActionContact(action, ship, fleets, intel);
            if (contact && (contact.detectionLevel === 'classified' || contact.detectionLevel === 'identified' || contact.detectionLevel === 'tracked')) {
              const weapon = ship.weapons.find((w) => w.type === 'main_gun' && w.ammo > 0 && w.cooldown <= 0);
              if (weapon) {
                weapon.cooldown = weapon.reloadTurns;
                weapon.ammo--;
                events.push({
                  id: nextEventId(),
                  turn: currentTurn,
                  type: 'fire_main_guns',
                  description: `${ship.name} fires main guns at ${contact.estimatedClass} contact`,
                  shipId: ship.id,
                  targetId: contact.originalEntityId,
                });
                shipMap[ship.id] = { ...ship, weapons: [...ship.weapons] };
              }
            }
          }
          break;

        case 'fire_torpedoes':
          for (const ship of targetShips) {
            const contact = findActionContact(action, ship, fleets, intel);
            if (contact && contact.detectionLevel !== 'none' && contact.detectionLevel !== 'suspected') {
              const weapon = ship.weapons.find((w) => w.type === 'torpedo' && w.ammo > 0 && w.cooldown <= 0);
              if (weapon) {
                weapon.cooldown = weapon.reloadTurns;
                weapon.ammo--;
                events.push({
                  id: nextEventId(),
                  turn: currentTurn,
                  type: 'fire_torpedoes',
                  description: `${ship.name} fires torpedoes at ${contact.estimatedClass} contact`,
                  shipId: ship.id,
                  targetId: contact.originalEntityId,
                });
                shipMap[ship.id] = { ...ship, weapons: [...ship.weapons] };
              }
            }
          }
          break;

        case 'withdraw':
          for (const ship of targetShips) {
            const awayHeading = (ship.headingDeg + 180) % 360;
            shipMap[ship.id] = {
              ...ship,
              headingDeg: awayHeading,
              targetSpeedKts: ship.motion.maxSpeedKts * (1 - ship.damage.speedPenalty),
            };
            events.push({
              id: nextEventId(),
              turn: currentTurn,
              type: 'withdraw',
              description: `${ship.name} withdrawing from combat`,
              shipId: ship.id,
            });
          }
          break;

        case 'damage_control':
          for (const ship of targetShips) {
            if (ship.damageControl.availableTeams > 0) {
              // Assign DC team to highest priority
              if (ship.damage.flooding > 30) {
                const floodModule = ship.modules.find((m) => m.flooding > 0);
                if (floodModule) {
                  shipMap[ship.id] = assignDamageControlTeam(ship, floodModule.id, 'pump_water');
                  events.push({
                    id: nextEventId(),
                    turn: currentTurn,
                    type: 'damage_control',
                    description: `${ship.name} DC team assigned to pump water`,
                    shipId: ship.id,
                  });
                }
              } else if (ship.damage.fire > 30) {
                const fireModule = ship.modules.find((m) => m.fire > 0);
                if (fireModule) {
                  shipMap[ship.id] = assignDamageControlTeam(ship, fireModule.id, 'fight_fire');
                  events.push({
                    id: nextEventId(),
                    turn: currentTurn,
                    type: 'damage_control',
                    description: `${ship.name} DC team assigned to fight fire`,
                    shipId: ship.id,
                  });
                }
              }
            }
          }
          break;

        case 'hold_fire':
        case 'deploy_smoke':
          events.push({
            id: nextEventId(),
            turn: currentTurn,
            type: action.type,
            description: `${targetShips[0]?.name || 'Unknown'} ${action.type}`,
            shipId: targetShips[0]?.id,
          });
          break;
      }
    } catch (_e) {
      // Skip failed actions
    }
  }

  return { shipMap, updatedSearchMissions: newSearchMissions, events };
}

function findActionContact(
  action: NavalAIAction,
  ship: NavalShip,
  fleets: StrategicFleet[],
  intel: NavalIntelState,
) {
  if (!action.targetContactId) return undefined;
  const faction = action.fleetId
    ? fleets.find((fleet) => fleet.id === action.fleetId)?.faction
    : fleets.find((fleet) => fleet.ships.some((item) => item.id === ship.id))?.faction ?? ship.faction;
  const contacts = faction === 'enemy' ? intel.enemyContacts : intel.playerContacts;
  return contacts.find((contact) => contact.id === action.targetContactId);
}

function bearingTo(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.round(((Math.atan2(toX - fromX, fromY - toY) * 180 / Math.PI) % 360 + 360) % 360);
}
