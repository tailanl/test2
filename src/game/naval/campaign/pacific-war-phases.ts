/**
 * Pacific War Phases - 太平洋战争阶段定义
 */
import type { PacificWarPhase, PacificWarPhaseId } from './campaign-types';

export const PACIFIC_WAR_PHASES: Record<PacificWarPhaseId, PacificWarPhase> = {
  japanese_offensive_1941_1942: {
    id: 'japanese_offensive_1941_1942',
    name: '日本攻势 1941-1942',
    startDate: '1941-12-07', endDate: '1942-05-01',
    description: '珍珠港后日本快速扩张。美军处于防御态势，保护关键基地和航线。',
    playerStrategicPosture: 'defense',
    enemyStrategicPosture: 'offensive',
    victoryPressure: { player: 0.3, enemy: 0.8 },
  },
  carrier_turning_point_1942: {
    id: 'carrier_turning_point_1942',
    name: '航母转折 1942',
    startDate: '1942-05-01', endDate: '1942-07-01',
    description: '珊瑚海和中途岛。航母成为决定性力量。搜索和先手打击至关重要。',
    playerStrategicPosture: 'counterattack',
    enemyStrategicPosture: 'expansion',
    victoryPressure: { player: 0.5, enemy: 0.7 },
  },
  solomons_attrition_1942_1943: {
    id: 'solomons_attrition_1942_1943',
    name: '所罗门消耗战 1942-1943',
    startDate: '1942-08-01', endDate: '1943-02-01',
    description: '瓜达尔卡纳尔战役。机场争夺、夜战、补给线战斗。',
    playerStrategicPosture: 'limited_offensive',
    enemyStrategicPosture: 'defensive_perimeter',
    victoryPressure: { player: 0.6, enemy: 0.6 },
  },
  central_pacific_offensive_1943_1944: {
    id: 'central_pacific_offensive_1943_1944',
    name: '中太平洋攻势 1943-1944',
    startDate: '1943-11-01', endDate: '1944-08-01',
    description: '吉尔伯特、马绍尔、马里亚纳。航母掩护登陆，岛屿跳跃。',
    playerStrategicPosture: 'major_offensive',
    enemyStrategicPosture: 'attrition_defense',
    victoryPressure: { player: 0.7, enemy: 0.4 },
  },
  philippines_leyte_1944: {
    id: 'philippines_leyte_1944',
    name: '菲律宾莱特湾 1944',
    startDate: '1944-10-01', endDate: '1944-12-01',
    description: '莱特湾大海战。大规模舰队决战，登陆船队保护。',
    playerStrategicPosture: 'decisive_offensive',
    enemyStrategicPosture: 'desperate_defense',
    victoryPressure: { player: 0.9, enemy: 0.3 },
  },
  iwo_okinawa_1945: {
    id: 'iwo_okinawa_1945',
    name: '硫磺岛冲绳 1945',
    startDate: '1945-02-01', endDate: '1945-06-01',
    description: '逼近日本本土。岸基航空、神风威胁、雷达哨舰。',
    playerStrategicPosture: 'decisive_offensive',
    enemyStrategicPosture: 'desperate_defense',
    victoryPressure: { player: 0.95, enemy: 0.1 },
  },
  home_islands_approach_1945: {
    id: 'home_islands_approach_1945',
    name: '本土决战 1945',
    startDate: '1945-06-01', endDate: '1945-09-01',
    description: '日本本土周边。终极阶段。',
    playerStrategicPosture: 'decisive_offensive',
    enemyStrategicPosture: 'desperate_defense',
    victoryPressure: { player: 1.0, enemy: 0.0 },
  },
};

export const PHASE_ORDER: PacificWarPhaseId[] = [
  'japanese_offensive_1941_1942',
  'carrier_turning_point_1942',
  'solomons_attrition_1942_1943',
  'central_pacific_offensive_1943_1944',
  'philippines_leyte_1944',
  'iwo_okinawa_1945',
  'home_islands_approach_1945',
];

export function getCurrentPhase(turn: number): PacificWarPhase {
  if (turn < 15) return PACIFIC_WAR_PHASES.japanese_offensive_1941_1942;
  if (turn < 30) return PACIFIC_WAR_PHASES.carrier_turning_point_1942;
  if (turn < 45) return PACIFIC_WAR_PHASES.solomons_attrition_1942_1943;
  if (turn < 60) return PACIFIC_WAR_PHASES.central_pacific_offensive_1943_1944;
  if (turn < 75) return PACIFIC_WAR_PHASES.philippines_leyte_1944;
  if (turn < 90) return PACIFIC_WAR_PHASES.iwo_okinawa_1945;
  return PACIFIC_WAR_PHASES.home_islands_approach_1945;
}
