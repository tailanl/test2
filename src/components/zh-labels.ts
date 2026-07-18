import type {
  CommanderIntent,
  EngagementPolicy,
  FleetNavigationMode,
  FleetOperationalPosture,
  FleetFormationType,
  NavalFleetMission,
  NavalFleetType,
} from '@/game/naval/naval-strategic-types';
import type { NavalShipClass } from '@/game/naval/ship/ship-types';

export function zhWeather(value?: string): string {
  switch (value) {
    case 'clear': return '晴朗';
    case 'rain': return '雨';
    case 'squall': return '飑线';
    case 'fog': return '雾';
    case 'storm': return '风暴';
    default: return value || '未知';
  }
}

export function zhRisk(value?: string): string {
  switch (value) {
    case 'low': return '低';
    case 'medium': return '中';
    case 'high': return '高';
    case 'critical': return '危急';
    case 'none': return '无';
    default: return value || '无';
  }
}

export function zhReadiness(value?: string): string {
  switch (value) {
    case 'good': return '良好';
    case 'limited': return '受限';
    case 'critical': return '危急';
    case 'ready': return '就绪';
    case 'recovering': return '整备';
    case 'depleted': return '耗尽';
    default: return value || '未知';
  }
}

export function zhFleetType(value?: NavalFleetType | string): string {
  switch (value) {
    case 'carrier_task_force': return '航母特混舰队';
    case 'surface_action_group': return '水面战斗群';
    case 'submarine_group': return '潜艇群';
    case 'transport_convoy': return '运输船队';
    case 'amphibious_group': return '两栖编队';
    case 'patrol_group': return '巡逻编队';
    case 'supply_group': return '补给编队';
    default: return fallbackLabel(value);
  }
}

export function zhMission(value?: NavalFleetMission | string): string {
  switch (value) {
    case 'patrol': return '巡逻';
    case 'search': return '搜索';
    case 'raid': return '袭扰';
    case 'escort': return '护航';
    case 'invasion_support': return '登陆支援';
    case 'carrier_strike': return '航母打击';
    case 'intercept': return '截击';
    case 'withdraw': return '撤退';
    case 'resupply': return '补给';
    default: return fallbackLabel(value);
  }
}

export function zhPosture(value?: FleetOperationalPosture | string): string {
  switch (value) {
    case 'strike_preparation': return '打击整备';
    case 'aircraft_recovery': return '飞机回收';
    case 'fighter_direction': return '战斗机引导';
    case 'smoke_screen': return '烟幕';
    case 'surface_engagement': return '水面交战';
    case 'torpedo_attack': return '鱼雷攻击';
    case 'radio_silence': return '无线电静默';
    case 'shore_bombardment': return '岸轰';
    case 'underway_replenishment': return '海上补给';
    case 'transport_run': return '运输航渡';
    case 'normal':
    case undefined:
      return '常规';
    default: return fallbackLabel(value);
  }
}

export function zhIntent(value?: CommanderIntent | string): string {
  switch (value) {
    case 'search': return '搜索';
    case 'intercept': return '截击';
    case 'strike': return '打击';
    case 'escort': return '护航';
    case 'avoid_contact': return '避免接触';
    case 'hold_sea_area': return '控制海域';
    case 'support_landing': return '支援登陆';
    case 'withdraw': return '撤退';
    case 'destroy_enemy_carriers': return '歼灭敌航母';
    case 'seek_decisive_battle': return '寻求决战';
    default: return fallbackLabel(value);
  }
}

export function zhEngagementPolicy(value?: EngagementPolicy | string): string {
  switch (value) {
    case 'avoid_unless_attacked': return '受击才战';
    case 'engage_if_advantage': return '有利交战';
    case 'engage_surface_only': return '仅水面战';
    case 'carrier_strike_only': return '仅航母打击';
    case 'free_engagement': return '自由交战';
    default: return fallbackLabel(value);
  }
}

export function zhNavigationMode(value?: FleetNavigationMode | string): string {
  switch (value) {
    case 'direct': return '直航';
    case 'safe_transit': return '安全航渡';
    case 'combat_approach': return '战斗接近';
    case 'night_dash': return '夜间突进';
    case 'withdrawal': return '撤退航线';
    case 'rendezvous': return '会合';
    default: return fallbackLabel(value);
  }
}

export function zhNavigationStatus(value?: string): string {
  switch (value) {
    case 'idle': return '待命';
    case 'en_route': return '航行中';
    case 'arrived': return '已抵达';
    case 'blocked': return '受阻';
    default: return fallbackLabel(value);
  }
}

export function zhFormation(value?: FleetFormationType | string): string {
  switch (value) {
    case 'standard_screen': return '标准警戒';
    case 'line_abreast': return '横队搜索';
    case 'circular_screen': return '环形护卫';
    case 'column': return '纵队航渡';
    case 'scout_line': return '侦察线';
    default: return fallbackLabel(value);
  }
}

export function zhShipClass(value?: NavalShipClass | string): string {
  switch (value) {
    case 'fleet_carrier': return '舰队航母';
    case 'light_carrier': return '轻型航母';
    case 'escort_carrier': return '护航航母';
    case 'battleship': return '战列舰';
    case 'heavy_cruiser': return '重巡洋舰';
    case 'light_cruiser': return '轻巡洋舰';
    case 'destroyer': return '驱逐舰';
    case 'submarine': return '潜艇';
    case 'transport': return '运输舰';
    case 'oiler': return '油船';
    case 'landing_ship': return '登陆舰';
    default: return fallbackLabel(value);
  }
}

export function zhDetectionLevel(value?: string): string {
  switch (value) {
    case 'suspected': return '疑似';
    case 'detected': return '发现';
    case 'classified': return '已分类';
    case 'identified': return '已识别';
    case 'tracked': return '持续跟踪';
    case 'confirmed': return '确认';
    case 'lost': return '丢失';
    case 'none': return '无';
    default: return fallbackLabel(value);
  }
}

export function zhAirOperationStatus(value?: string): string {
  switch (value) {
    case 'preparing': return '整备中';
    case 'launched': return '已起飞';
    case 'outbound': return '出航';
    case 'turning_home': return '返航转向';
    case 'returning': return '返航';
    case 'recovered': return '已回收';
    default: return fallbackLabel(value);
  }
}

export function zhBattleEventType(value?: string): string {
  switch ((value || '').toLowerCase()) {
    case 'human_command': return '人工命令';
    case 'change_speed': return '航速调整';
    case 'change_course': return '航向调整';
    case 'launch_search': return '侦察起飞';
    case 'air_search_contact': return '空中侦察接触';
    case 'launch_cap': return '战斗空巡';
    case 'launch_strike': return '航空打击';
    case 'air_strike_hit': return '航空命中';
    case 'air_strike_near_miss': return '近失弹';
    case 'air_strike_miss': return '目标丢失';
    case 'fire_main_guns': return '主炮射击';
    case 'fire_torpedoes': return '鱼雷攻击';
    case 'damage': return '损伤';
    default: return fallbackLabel(value);
  }
}

export function zhBattleDescription(value?: string): string {
  if (!value) return '暂无描述';

  const preparingSearch = value.match(/^(.+) preparing sector search: (.+) heading (\d+) arc (\d+) range (\d+); launch in (\d+) turn/);
  if (preparingSearch) {
    return `${preparingSearch[1]} 正在整备扇区侦察：${zhAirMixCode(preparingSearch[2])}，方位 ${preparingSearch[3]}，扇宽 ${preparingSearch[4]}，航程 ${preparingSearch[5]}；${preparingSearch[6]} 回合后起飞`;
  }

  const launchedSearch = value.match(/^(.+) launched sector search: (.+) heading (\d+) arc (\d+) range (\d+); return after sweep/);
  if (launchedSearch) {
    return `${launchedSearch[1]} 发起扇区侦察：${zhAirMixCode(launchedSearch[2])}，方位 ${launchedSearch[3]}，扇宽 ${launchedSearch[4]}，航程 ${launchedSearch[5]}；扫掠后返航`;
  }

  const speed = value.match(/^(.+) speed set to (\d+)kts$/);
  if (speed) return `${speed[1]} 设定航速 ${speed[2]} 节`;

  const recovered = value.match(/^(.+) recovered (\d+) aircraft from (.+) mission$/);
  if (recovered) return `${recovered[1]} 从${zhMission(recovered[3])}任务回收 ${recovered[2]} 架飞机`;

  const strike = value.match(/^(.+) launched strike group against (.+): (.+)$/);
  if (strike) return `${strike[1]} 对 ${strike[2]} 发起打击编队：${zhAirMixCode(strike[3])}`;

  const strikeHit = value.match(/^(.+) strike attacked (.+): (\d+) hit\(s\), hull -(\d+)$/);
  if (strikeHit) return `${strikeHit[1]} 攻击 ${strikeHit[2]}：命中 ${strikeHit[3]} 次，舰体损失 ${strikeHit[4]}`;

  const strikeMiss = value.match(/^(.+) strike reached target area but found no ship to attack$/);
  if (strikeMiss) return `${strikeMiss[1]} 抵达目标海域，但未找到可攻击舰船`;

  const airGroupEdit = value.match(/^(.+) air group edited: F(\d+)\/DB(\d+)\/TB(\d+), ready (\d+)$/);
  if (airGroupEdit) {
    return `${airGroupEdit[1]} 机群调整：战斗机 ${airGroupEdit[2]}，俯冲轰炸机 ${airGroupEdit[3]}，鱼雷机 ${airGroupEdit[4]}，就绪 ${airGroupEdit[5]}`;
  }

  const destination = value.match(/^(.+) destination set to \((\d+),(\d+)\); (.+) route (\d+) waypoint\(s\), ETA ([^ ]+) turn\(s\), risk (.+)$/);
  if (destination) {
    return `${destination[1]} 目标点设为 (${destination[2]},${destination[3]})；${zhNavigationMode(destination[4])}，${destination[5]} 个航路点，ETA ${destination[6]} 回合，风险 ${zhRisk(destination[7])}`;
  }

  return value
    .replace(/heading/g, '方位')
    .replace(/arc/g, '扇宽')
    .replace(/range/g, '航程')
    .replace(/aircraft/g, '飞机')
    .replace(/mission/g, '任务')
    .replace(/turns?/g, '回合')
    .replace(/risk/g, '风险');
}

export function zhFallback(value?: string): string {
  return fallbackLabel(value);
}

function zhAirMixCode(value: string): string {
  return value
    .split('/')
    .map((part) => {
      const match = part.match(/^([A-Z]+)(\d+)$/);
      if (!match) return part;
      const label =
        match[1] === 'F' ? '战斗机' :
        match[1] === 'DB' ? '俯冲轰炸机' :
        match[1] === 'TB' ? '鱼雷机' :
        match[1] === 'SC' ? '侦察机' :
        match[1];
      return `${label}${match[2]}`;
    })
    .join('/');
}

function fallbackLabel(value?: string): string {
  if (!value) return '未知';
  return value.replace(/_/g, ' ');
}
