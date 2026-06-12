/**
 * 损管 AI - 自动分配损管资源
 */

import type { NavalShip } from '../ship/ship-types';
import type { NavalAIAction } from './naval-ai-types';

let actionIdCounter = 0;
function nextId(): string { actionIdCounter++; return `dc_${actionIdCounter}`; }

export function generateDamageControlActions(ship: NavalShip): NavalAIAction[] {
  const actions: NavalAIAction[] = [];
  const dc = ship.damageControl;

  if (dc.availableTeams <= 0) return actions;

  // 优先级排序
  const priorities: Array<{ moduleId: string; task: string; urgency: number }> = [];

  for (const module of ship.modules) {
    // 1. 进水 > 70
    if (module.flooding > 70) {
      priorities.push({ moduleId: module.id, task: 'pump_water', urgency: module.flooding + 100 });
    }

    // 2. 火灾 > 70 且靠近弹药/燃料/机库
    if (module.fire > 70 && (module.type === 'magazine' || module.type === 'fuel_tank' || module.type === 'hangar')) {
      priorities.push({ moduleId: module.id, task: 'fight_fire', urgency: module.fire + 80 });
    } else if (module.fire > 70) {
      priorities.push({ moduleId: module.id, task: 'fight_fire', urgency: module.fire + 50 });
    }

    // 3. 舵机损坏
    if (module.type === 'rudder' && (module.status === 'disabled' || module.status === 'damaged')) {
      priorities.push({ moduleId: module.id, task: 'restore_steering', urgency: 70 });
    }

    // 4. 引擎室损坏
    if ((module.type === 'engine_room' || module.type === 'boiler_room') && (module.status === 'disabled' || module.status === 'damaged')) {
      priorities.push({ moduleId: module.id, task: 'restore_power', urgency: 60 });
    }

    // 5. 飞行甲板损坏（航母）
    if (module.type === 'flight_deck' && (module.status === 'disabled' || module.status === 'damaged')) {
      priorities.push({ moduleId: module.id, task: 'clear_flight_deck', urgency: 55 });
    }

    // 6. 雷达损坏
    if (module.type === 'radar' && (module.status === 'disabled' || module.status === 'damaged')) {
      priorities.push({ moduleId: module.id, task: 'repair_module', urgency: 30 });
    }
  }

  // 按紧急度排序，分配损管队
  priorities.sort((a, b) => b.urgency - a.urgency);

  // 检查已有分配，避免重复
  const assignedModuleTasks = new Set(
    ship.damageControl.assignedTeams.map((t) => `${t.targetModuleId}_${t.task}`)
  );

  for (const p of priorities) {
    if (dc.availableTeams <= 0) break;
    const key = `${p.moduleId}_${p.task}`;
    if (assignedModuleTasks.has(key)) continue;

    actions.push({
      id: nextId(),
      shipId: ship.id,
      type: 'damage_control',
      reason: `DC team assigned to ${p.task} on ${ship.modules.find((m) => m.id === p.moduleId)?.name || p.moduleId}`,
      basedOnContactIds: [],
    });

    assignedModuleTasks.add(key);
    dc.availableTeams--;
  }

  return actions;
}
