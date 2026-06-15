/**
 * Commander Intent - 玩家可选指挥意图
 */

export type CommanderIntentType =
  | 'preserve_carriers'
  | 'destroy_enemy_carriers'
  | 'protect_convoys'
  | 'capture_islands'
  | 'cut_supply_lines'
  | 'avoid_night_battle'
  | 'seek_decisive_battle';

export interface CommanderIntent {
  type: CommanderIntentType;
  label: string;
  description: string;
  forbiddenActions: string[];
  preferredActions: string[];
}

export const COMMANDER_INTENTS: Record<CommanderIntentType, CommanderIntent> = {
  preserve_carriers: {
    type: 'preserve_carriers', label: '保存航母', description: '优先保护航母，避免不必要的损失',
    forbiddenActions: ['launch_strike'], preferredActions: ['withdraw_fleet', 'hold_position'],
  },
  destroy_enemy_carriers: {
    type: 'destroy_enemy_carriers', label: '摧毁敌航母', description: '优先搜索并摧毁敌方航空母舰',
    forbiddenActions: ['withdraw_fleet'], preferredActions: ['launch_search', 'launch_strike', 'intercept_contact'],
  },
  protect_convoys: {
    type: 'protect_convoys', label: '护航运输', description: '保护运输船队安全抵达',
    forbiddenActions: ['launch_strike'], preferredActions: ['protect_supply_line', 'hold_position'],
  },
  capture_islands: {
    type: 'capture_islands', label: '夺岛作战', description: '优先占领敌方岛屿和基地',
    forbiddenActions: ['withdraw_fleet'], preferredActions: ['support_landing', 'protect_base'],
  },
  cut_supply_lines: {
    type: 'cut_supply_lines', label: '切断补给', description: '攻击敌方补给线，孤立敌方基地',
    forbiddenActions: ['protect_supply_line'], preferredActions: ['shadow_contact', 'intercept_contact'],
  },
  avoid_night_battle: {
    type: 'avoid_night_battle', label: '避夜战', description: '避免夜间交战（日军夜战优势）',
    forbiddenActions: [], preferredActions: ['withdraw_fleet', 'hold_position'],
  },
  seek_decisive_battle: {
    type: 'seek_decisive_battle', label: '寻求决战', description: '寻找敌方主力舰队进行决战',
    forbiddenActions: ['withdraw_fleet', 'hold_position'], preferredActions: ['launch_search', 'launch_strike', 'intercept_contact'],
  },
};
