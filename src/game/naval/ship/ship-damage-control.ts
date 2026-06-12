/**
 * 损管系统 - Damage Control
 */

import type { NavalShip } from './ship-types';
import type { NavalBattleLogEvent } from './ship-damage';

// ===== 损管状态 =====

export interface DamageControlState {
  availableTeams: number;
  assignedTeams: Array<{
    teamId: string;
    targetModuleId: string;
    task:
      | 'fight_fire'
      | 'pump_water'
      | 'repair_module'
      | 'restore_power'
      | 'restore_steering'
      | 'clear_flight_deck';
    progress: number;
  }>;
  fatigue: number;
}

// ===== 默认损管状态 =====

export function createDefaultDamageControlState(shipClass: string): DamageControlState {
  let teams = 2;
  switch (shipClass) {
    case 'fleet_carrier':
    case 'light_carrier':
    case 'battleship':
      teams = 6;
      break;
    case 'heavy_cruiser':
      teams = 4;
      break;
    case 'light_cruiser':
      teams = 3;
      break;
    case 'destroyer':
      teams = 2;
      break;
    case 'escort_carrier':
    case 'submarine':
      teams = 3;
      break;
    default:
      teams = 1;
  }

  return {
    availableTeams: teams,
    assignedTeams: [],
    fatigue: 0,
  };
}

// ===== 更新损管 =====

export function updateDamageControl(
  ship: NavalShip,
  deltaTurns: number
): {
  ship: NavalShip;
  events: NavalBattleLogEvent[];
} {
  const newShip = structuredClone(ship);
  const events: NavalBattleLogEvent[] = [];
  const dc = { ...newShip.damageControl };
  const damage = { ...newShip.damage };

  // 疲劳恢复
  if (dc.assignedTeams.length === 0) {
    dc.fatigue = Math.max(0, dc.fatigue - deltaTurns * 5);
  }

  for (const team of dc.assignedTeams) {
    const module = newShip.modules.find((m) => m.id === team.targetModuleId);
    if (!module) continue;

    const progressPerTurn = getTaskProgressPerTurn(team.task, dc.fatigue);

    team.progress += progressPerTurn * deltaTurns;

    switch (team.task) {
      case 'fight_fire':
        if (module.fire > 0) {
          const fireReduction = Math.min(module.fire, team.progress * 10);
          module.fire = Math.max(0, module.fire - fireReduction);
          damage.fire = Math.max(0, damage.fire - fireReduction * 0.5);
          if (module.fire <= 0 && damage.fire <= 0) {
            events.push({
              id: `log_dc_${Date.now()}_${Math.random()}`, turn: 0, type: 'fire_extinguished',
              description: `Fire extinguished in ${module.name}`,
              shipId: ship.id, moduleId: module.id,
            });
          }
        }
        break;

      case 'pump_water':
        if (module.flooding > 0) {
          const waterReduction = Math.min(module.flooding, team.progress * 5);
          module.flooding = Math.max(0, module.flooding - waterReduction);
          damage.flooding = Math.max(0, damage.flooding - waterReduction * 0.3);
          damage.buoyancy = Math.min(100, damage.buoyancy + waterReduction * 0.2);
          if (module.flooding <= 0) {
            events.push({
              id: `log_dc_${Date.now()}_${Math.random()}`, turn: 0, type: 'pumping_complete',
              description: `Pumping complete in ${module.name}`,
              shipId: ship.id, moduleId: module.id,
            });
          }
        }
        break;

      case 'repair_module':
        if (module.status === 'disabled' || module.status === 'damaged') {
          const repairAmount = team.progress;
          module.hp = Math.min(module.maxHp, module.hp + repairAmount);
          if (module.hp >= module.maxHp * 0.7 && module.status === 'disabled') {
            module.status = 'damaged';
          }
          if (module.hp >= module.maxHp * 0.9 && module.status === 'damaged') {
            module.status = 'operational';
            events.push({
              id: `log_dc_${Date.now()}_${Math.random()}`, turn: 0, type: 'module_repaired',
              description: `${module.name} repaired`,
              shipId: ship.id, moduleId: module.id,
            });
          }
        }
        break;

      case 'restore_power':
        if (module.status === 'damaged' || module.status === 'disabled') {
          damage.speedPenalty = Math.max(0, damage.speedPenalty - 0.1 * deltaTurns);
          const repairAmount = team.progress * 0.5;
          module.hp = Math.min(module.maxHp, module.hp + repairAmount);
          if (module.hp >= module.maxHp * 0.8) {
            module.status = 'operational';
            damage.speedPenalty = Math.max(0, damage.speedPenalty - 0.3);
          }
        }
        break;

      case 'restore_steering':
        if (module.status === 'damaged' || module.status === 'disabled') {
          damage.turnPenalty = Math.max(0, damage.turnPenalty - 0.1 * deltaTurns);
          const repairAmount = team.progress * 0.5;
          module.hp = Math.min(module.maxHp, module.hp + repairAmount);
          if (module.hp >= module.maxHp * 0.8) {
            module.status = 'operational';
            damage.turnPenalty = Math.max(0, damage.turnPenalty - 0.3);
          }
        }
        break;

      case 'clear_flight_deck':
        if (module.type === 'flight_deck' && (module.status === 'damaged' || module.status === 'disabled')) {
          damage.aircraftOperationPenalty = Math.max(0, damage.aircraftOperationPenalty - 0.15 * deltaTurns);
          const repairAmount = team.progress * 0.5;
          module.hp = Math.min(module.maxHp, module.hp + repairAmount);
          if (module.hp >= module.maxHp * 0.8) {
            module.status = 'operational';
            damage.aircraftOperationPenalty = Math.max(0, damage.aircraftOperationPenalty - 0.4);
          }
        }
        break;
    }
  }

  // 检查完成任务
  dc.assignedTeams = dc.assignedTeams.filter((t) => {
    const m = newShip.modules.find((mod) => mod.id === t.targetModuleId);
    if (!m) return false;
    const isDone =
      (t.task === 'fight_fire' && m.fire <= 0) ||
      (t.task === 'pump_water' && m.flooding <= 0) ||
      (t.task === 'repair_module' && m.status === 'operational') ||
      (t.task === 'restore_power' && m.status === 'operational') ||
      (t.task === 'restore_steering' && m.status === 'operational') ||
      (t.task === 'clear_flight_deck' && m.status === 'operational');
    if (isDone) dc.availableTeams++;
    return !isDone;
  });

  newShip.damageControl = dc;
  newShip.damage = damage;
  return { ship: newShip, events };
}

function getTaskProgressPerTurn(task: string, fatigue: number): number {
  const base: Record<string, number> = {
    fight_fire: 5,
    pump_water: 3,
    repair_module: 2,
    restore_power: 2,
    restore_steering: 2,
    clear_flight_deck: 3,
  };
  const fatiguePenalty = 1 - fatigue * 0.005;
  return (base[task] ?? 2) * Math.max(0.3, fatiguePenalty);
}

// ===== 分配损管任务 =====

export function assignDamageControlTeam(
  ship: NavalShip,
  moduleId: string,
  task: DamageControlState['assignedTeams'][0]['task']
): NavalShip {
  const newShip = structuredClone(ship);
  const dc = newShip.damageControl;

  if (dc.availableTeams <= 0) return newShip;

  // 检查模块是否存在
  const module = newShip.modules.find((m) => m.id === moduleId);
  if (!module) return newShip;

  // 检查是否已分配到同一模块
  const existing = dc.assignedTeams.find((t) => t.targetModuleId === moduleId && t.task === task);
  if (existing) return newShip;

  dc.availableTeams--;
  dc.assignedTeams.push({
    teamId: `team_${Date.now()}_${Math.random()}`,
    targetModuleId: moduleId,
    task,
    progress: 0,
  });

  return newShip;
}
