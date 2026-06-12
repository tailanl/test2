/**
 * 模块化损伤系统 - 不是简单HP，而是模块级损伤
 * 支持 side_attack / vertical_attack 方向模型
 */

import type { NavalShip } from './ship-types';
import type { ShipModule, ModuleLocation, ModuleExposure, ModuleArmorProfile } from './ship-modules';

// ===== 损伤类型 =====

export type NavalDamageType =
  | 'shell_hit'
  | 'torpedo_hit'
  | 'bomb_hit'
  | 'near_miss'
  | 'fire'
  | 'flooding'
  | 'magazine_explosion'
  | 'collision'
  | 'grounding';

// ===== 攻击方向 =====

export type NavalAttackDirection =
  | 'side_attack'
  | 'vertical_attack';

export type NavalImpactSurface =
  | 'superstructure'
  | 'deck'
  | 'side_above_waterline'
  | 'waterline'
  | 'below_waterline'
  | 'underwater_hull';

export interface NavalAttackProfile {
  damageType: NavalDamageType;
  attackDirection: NavalAttackDirection;
  impactSurface: NavalImpactSurface;
  penetration: number;
  explosivePower: number;
  armorPiercing: boolean;
  source:
    | 'main_gun'
    | 'secondary_gun'
    | 'torpedo'
    | 'dive_bomber'
    | 'level_bomber'
    | 'torpedo_bomber'
    | 'near_miss'
    | 'fire'
    | 'collision'
    | 'grounding';
}

// ===== 舰船损伤状态 =====

export interface ShipDamageState {
  hullIntegrity: number;
  buoyancy: number;
  stability: number;
  flooding: number;
  fire: number;
  crewEfficiency: number;
  speedPenalty: number;
  turnPenalty: number;
  sensorPenalty: number;
  weaponPenalty: number;
  aircraftOperationPenalty: number;
  status:
    | 'combat_effective'
    | 'damaged'
    | 'mission_kill'
    | 'crippled'
    | 'sinking'
    | 'sunk';
}

// ===== 战斗日志事件（简化版，后续完善） =====

export interface NavalBattleLogEvent {
  id: string;
  turn: number;
  type: string;
  description: string;
  shipId?: string;
  targetId?: string;
  damage?: number;
  moduleId?: string;
  value?: number;
  attackDirection?: NavalAttackDirection;
  impactSurface?: NavalImpactSurface;
  penetrationSucceeded?: boolean;
  effectiveArmor?: number;
  effectiveDamage?: number;
}

// ===== 默认损伤状态 =====

export function createDefaultDamageState(): ShipDamageState {
  return {
    hullIntegrity: 100,
    buoyancy: 100,
    stability: 100,
    flooding: 0,
    fire: 0,
    crewEfficiency: 100,
    speedPenalty: 0,
    turnPenalty: 0,
    sensorPenalty: 0,
    weaponPenalty: 0,
    aircraftOperationPenalty: 0,
    status: 'combat_effective',
  };
}

let logEventIdCounter = 0;

function nextLogId(): string {
  logEventIdCounter++;
  return `log_${logEventIdCounter}`;
}

// ===== 命中位置命中模块 =====

function findModulesAtLocation(modules: ShipModule[], location: ModuleLocation): ShipModule[] {
  return modules.filter((m) => m.location === location && m.status !== 'destroyed');
}

// ===== 旧参数 → AttackProfile 转换（兼容旧调用） =====

export function createAttackProfileFromLegacyDamage(params: {
  damageType: NavalDamageType;
  hitLocation: ModuleLocation;
  penetration: number;
  explosivePower: number;
  underwater: boolean;
}): NavalAttackProfile {
  const { damageType, penetration, explosivePower, underwater } = params;

  if (damageType === 'torpedo_hit') {
    return {
      damageType,
      attackDirection: 'side_attack',
      impactSurface: 'underwater_hull',
      penetration,
      explosivePower,
      armorPiercing: true,
      source: 'torpedo',
    };
  }

  if (damageType === 'bomb_hit') {
    return {
      damageType,
      attackDirection: 'vertical_attack',
      impactSurface: 'deck',
      penetration,
      explosivePower,
      armorPiercing: true,
      source: 'dive_bomber',
    };
  }

  if (damageType === 'shell_hit') {
    return {
      damageType,
      attackDirection: 'side_attack',
      impactSurface: underwater ? 'waterline' : 'side_above_waterline',
      penetration,
      explosivePower,
      armorPiercing: true,
      source: 'main_gun',
    };
  }

  if (damageType === 'near_miss') {
    return {
      damageType,
      attackDirection: underwater ? 'side_attack' : 'vertical_attack',
      impactSurface: underwater ? 'below_waterline' : 'superstructure',
      penetration: Math.round(penetration * 0.3),
      explosivePower: Math.round(explosivePower * 0.5),
      armorPiercing: false,
      source: 'near_miss',
    };
  }

  return {
    damageType,
    attackDirection: 'side_attack',
    impactSurface: 'side_above_waterline',
    penetration,
    explosivePower,
    armorPiercing: false,
    source: damageType === 'fire' ? 'fire' : damageType === 'collision' ? 'collision' : 'grounding',
  };
}

// ===== 模块选择：根据 exposure 加权随机 =====

function selectCandidateModulesForAttack(params: {
  modules: ShipModule[];
  hitLocation: ModuleLocation;
  attackProfile: NavalAttackProfile;
}): ShipModule[] {
  const { modules, hitLocation, attackProfile } = params;

  const alive = modules.filter((m) => m.status !== 'destroyed');
  if (alive.length === 0) return [];

  const byLocation = alive.filter((m) => m.location === hitLocation);
  return byLocation.length > 0 ? byLocation : alive;
}

function getExposureWeight(module: ShipModule, attackProfile: NavalAttackProfile): number {
  const exp = module.exposure;

  if (!exp) return 1;

  let weight = 1;

  if (attackProfile.attackDirection === 'vertical_attack') {
    weight *= exp.vertical;
  }

  if (
    attackProfile.impactSurface === 'underwater_hull' ||
    attackProfile.impactSurface === 'below_waterline'
  ) {
    weight *= exp.underwater;
  } else if (attackProfile.attackDirection === 'side_attack') {
    weight *= exp.side;
  }

  return Math.max(0.01, weight);
}

function weightedPickModule(
  modules: ShipModule[],
  attackProfile: NavalAttackProfile
): ShipModule | null {
  if (modules.length === 0) return null;

  const weights = modules.map((m) => getExposureWeight(m, attackProfile));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return modules[0];

  let roll = Math.random() * totalWeight;
  for (let i = 0; i < modules.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return modules[i];
  }

  return modules[modules.length - 1];
}

// ===== 装甲计算 =====

function getEffectiveArmor(
  module: ShipModule | null,
  attackProfile: NavalAttackProfile
): number {
  if (!module) return 0;

  const ap = module.armorProfile;
  if (!ap) return module.armor;

  if (
    attackProfile.impactSurface === 'underwater_hull' ||
    attackProfile.impactSurface === 'below_waterline'
  ) {
    return ap.underwaterProtection;
  }

  if (attackProfile.attackDirection === 'vertical_attack') {
    return ap.deckArmor;
  }

  return ap.sideArmor;
}

function calculateEffectiveDamage(params: {
  attackProfile: NavalAttackProfile;
  module: ShipModule | null;
}): {
  effectiveDamage: number;
  penetrationSucceeded: boolean;
  effectiveArmor: number;
} {
  const { attackProfile, module } = params;
  const effectiveArmor = getEffectiveArmor(module, attackProfile);
  const penetrationMargin = attackProfile.penetration - effectiveArmor;
  const penetrationSucceeded = penetrationMargin >= 0;

  let effectiveDamage = attackProfile.explosivePower;

  if (penetrationSucceeded) {
    effectiveDamage += penetrationMargin * 0.5;
  } else {
    effectiveDamage *= 0.35;
  }

  return {
    effectiveDamage: Math.max(1, effectiveDamage),
    penetrationSucceeded,
    effectiveArmor,
  };
}

// ===== 核心：施加海军损伤（重构版，支持方向模型） =====

export function applyNavalDamage(params: {
  ship: NavalShip;
  hitLocation: ModuleLocation;
  damageType: NavalDamageType;
  penetration: number;
  explosivePower: number;
  underwater: boolean;
  turn: number;
}): {
  ship: NavalShip;
  events: NavalBattleLogEvent[];
} {
  const { ship, hitLocation, damageType, penetration, explosivePower, underwater, turn } = params;
  const events: NavalBattleLogEvent[] = [];
  const newShip = structuredClone(ship);
  const modules = newShip.modules;
  const damage = { ...newShip.damage };

  // 创建 AttackProfile
  const attackProfile = createAttackProfileFromLegacyDamage({
    damageType, hitLocation, penetration, explosivePower, underwater,
  });

  // 加权选择命中模块
  const candidates = selectCandidateModulesForAttack({ modules, hitLocation, attackProfile });
  let hitModule = weightedPickModule(candidates, attackProfile);

  // Fallback: 如果没有候选，选第一个 hull_compartment
  if (!hitModule) {
    hitModule = modules.find((m) => m.type === 'hull_compartment' && m.status !== 'destroyed') || modules[0] || null;
  }

  // 计算有效伤害
  const { effectiveDamage, penetrationSucceeded, effectiveArmor } = calculateEffectiveDamage({
    attackProfile, module: hitModule,
  });

  // 应用损伤
  if (hitModule) {
    hitModule.hp = Math.max(0, hitModule.hp - effectiveDamage);

    if (hitModule.hp <= 0) {
      hitModule.status = 'destroyed';
    } else if (hitModule.hp <= hitModule.maxHp * 0.5) {
      if (hitModule.status === 'operational') hitModule.status = 'damaged';
    }

    // Fire from explosive
    if (attackProfile.explosivePower > 5 && hitModule.type !== 'hull_compartment') {
      const fireChance = attackProfile.explosivePower * 0.05;
      if (Math.random() < fireChance) {
        hitModule.fire = Math.min(100, hitModule.fire + attackProfile.explosivePower * 3);
        damage.fire = Math.min(100, damage.fire + attackProfile.explosivePower * 1.5);
      }
    }
  }

  // 根据 damageType + attackDirection 施加额外效果
  switch (damageType) {
    case 'shell_hit':
      damage.hullIntegrity = Math.max(0, damage.hullIntegrity - effectiveDamage * 0.15);
      if (hitModule && hitModule.status === 'destroyed') {
        events.push({
          id: nextLogId(), turn, type: 'module_destroyed',
          description: `Shell side attack: ${hitModule.name} destroyed`,
          shipId: ship.id, moduleId: hitModule.id,
          attackDirection: 'side_attack', impactSurface: attackProfile.impactSurface,
          penetrationSucceeded, effectiveArmor, effectiveDamage,
        });
      } else if (hitModule && hitModule.status === 'damaged') {
        events.push({
          id: nextLogId(), turn, type: 'module_damaged',
          description: `Shell side attack damaged ${hitModule.name}`,
          shipId: ship.id, moduleId: hitModule.id,
          attackDirection: 'side_attack', impactSurface: attackProfile.impactSurface,
          penetrationSucceeded, effectiveArmor, effectiveDamage,
        });
      }
      break;

    case 'torpedo_hit':
      if (hitModule) {
        hitModule.flooding = Math.min(100, hitModule.flooding + attackProfile.explosivePower * 8);
        hitModule.hp = Math.max(0, hitModule.hp - effectiveDamage * 1.5);
        if (hitModule.hp <= 0) hitModule.status = 'destroyed';
        else if (hitModule.hp <= hitModule.maxHp * 0.5) hitModule.status = 'damaged';
      }
      damage.flooding = Math.min(100, damage.flooding + attackProfile.explosivePower * 5);
      damage.buoyancy = Math.max(0, damage.buoyancy - attackProfile.explosivePower * 3);
      damage.stability = Math.max(0, damage.stability - attackProfile.explosivePower * 2);
      damage.speedPenalty = Math.min(1, damage.speedPenalty + attackProfile.explosivePower * 0.03);
      damage.hullIntegrity = Math.max(0, damage.hullIntegrity - effectiveDamage * 0.5);
      events.push({
        id: nextLogId(), turn, type: 'torpedo_hit',
        description: `Torpedo side attack struck ${attackProfile.impactSurface}: ${hitModule?.name || 'hull'} flooding ${damage.flooding.toFixed(0)}%`,
        shipId: ship.id, moduleId: hitModule?.id, damage: effectiveDamage,
        attackDirection: 'side_attack', impactSurface: attackProfile.impactSurface,
        penetrationSucceeded: true, effectiveArmor, effectiveDamage,
      });
      break;

    case 'bomb_hit':
      if (hitModule) {
        hitModule.hp = Math.max(0, hitModule.hp - effectiveDamage * 1.5);
        if (hitModule.hp <= 0) hitModule.status = 'destroyed';
        else if (hitModule.hp <= hitModule.maxHp * 0.5) hitModule.status = 'damaged';
        hitModule.fire = Math.min(100, hitModule.fire + attackProfile.explosivePower * 5);
        damage.fire = Math.min(100, damage.fire + attackProfile.explosivePower * 2);
      }
      if (hitModule && (hitModule.type === 'flight_deck' || hitModule.type === 'hangar')) {
        damage.aircraftOperationPenalty = Math.min(1, damage.aircraftOperationPenalty + 0.3);
        events.push({
          id: nextLogId(), turn, type: 'flight_deck_damage',
          description: `Vertical bomb hit damaged Flight Deck; aircraft operations reduced`,
          shipId: ship.id, moduleId: hitModule.id,
          attackDirection: 'vertical_attack', impactSurface: 'deck',
          penetrationSucceeded, effectiveArmor, effectiveDamage,
        });
      }
      if (hitModule && hitModule.type === 'magazine') {
        if (Math.random() < 0.3) {
          damage.status = 'sinking';
          events.push({
            id: nextLogId(), turn, type: 'magazine_explosion',
            description: `Magazine explosion on ${ship.name}! Ship is sinking!`,
            shipId: ship.id, moduleId: hitModule.id,
            attackDirection: 'vertical_attack', impactSurface: 'deck',
            penetrationSucceeded: true, effectiveArmor, effectiveDamage,
          });
        }
      }
      damage.hullIntegrity = Math.max(0, damage.hullIntegrity - effectiveDamage * 0.3);
      break;

    case 'near_miss':
      if (underwater) {
        damage.flooding = Math.min(100, damage.flooding + attackProfile.explosivePower * 0.5);
        damage.buoyancy = Math.max(0, damage.buoyancy - attackProfile.explosivePower * 0.3);
      }
      damage.hullIntegrity = Math.max(0, damage.hullIntegrity - effectiveDamage * 0.05);
      break;

    case 'magazine_explosion':
      damage.status = 'sinking';
      damage.hullIntegrity = Math.max(0, damage.hullIntegrity - 80);
      damage.buoyancy = Math.max(0, damage.buoyancy - 80);
      damage.flooding = Math.min(100, damage.flooding + 80);
      events.push({
        id: nextLogId(), turn, type: 'magazine_explosion',
        description: `Catastrophic magazine explosion on ${ship.name}!`,
        shipId: ship.id, attackDirection: attackProfile.attackDirection,
        effectiveDamage: 999,
      });
      break;

    case 'fire':
      damage.fire = Math.min(100, damage.fire + explosivePower);
      damage.crewEfficiency = Math.max(0, damage.crewEfficiency - explosivePower * 0.5);
      break;

    case 'flooding':
      damage.flooding = Math.min(100, damage.flooding + explosivePower);
      damage.buoyancy = Math.max(0, damage.buoyancy - explosivePower * 0.3);
      break;

    case 'collision':
    case 'grounding':
      damage.hullIntegrity = Math.max(0, damage.hullIntegrity - penetration * 0.1);
      damage.speedPenalty = Math.min(1, damage.speedPenalty + 0.1);
      break;
  }

  // 重新计算损伤状态
  if (damage.hullIntegrity <= 0 || damage.flooding >= 95 || damage.buoyancy <= 0) {
    damage.status = 'sinking';
  } else if (damage.hullIntegrity <= 20 || damage.flooding >= 70) {
    damage.status = 'crippled';
  } else if (damage.flooding >= 40 || damage.hullIntegrity <= 40) {
    damage.status = 'mission_kill';
  } else if (damage.hullIntegrity <= 60 || damage.flooding >= 15 || damage.fire >= 30) {
    damage.status = 'damaged';
  }

  // 更新传感器惩罚（基于模块状态）
  const radarModule = modules.find((m) => m.type === 'radar');
  if (radarModule && radarModule.status !== 'operational') {
    damage.sensorPenalty = Math.max(damage.sensorPenalty, radarModule.status === 'destroyed' ? 1 : 0.5);
  }
  const sonarModule = modules.find((m) => m.type === 'sonar');
  if (sonarModule && sonarModule.status !== 'operational') {
    damage.sensorPenalty = Math.max(damage.sensorPenalty, sonarModule.status === 'destroyed' ? 1 : 0.3);
  }

  newShip.damage = damage;
  return { ship: newShip, events };
}

// ===== 更新火灾和进水（每回合） =====

export function updateDamageOverTime(
  ship: NavalShip,
  deltaTurns: number
): {
  ship: NavalShip;
  events: NavalBattleLogEvent[];
} {
  const newShip = structuredClone(ship);
  const events: NavalBattleLogEvent[] = [];
  const damage = { ...newShip.damage };

  for (let t = 0; t < deltaTurns; t++) {
    // 火灾扩散
    if (damage.fire > 0) {
      damage.fire = Math.min(100, damage.fire + 2); // 火灾自然增长
      damage.crewEfficiency = Math.max(0, damage.crewEfficiency - 1);
    }

    // 进水影响
    if (damage.flooding > 0) {
      damage.buoyancy = Math.max(0, damage.buoyancy - damage.flooding * 0.02);
      damage.stability = Math.max(0, damage.stability - damage.flooding * 0.01);
    }

    // 结构损失
    if (damage.hullIntegrity < 20 && damage.flooding > 50) {
      damage.hullIntegrity = Math.max(0, damage.hullIntegrity - 1);
    }
  }

  // 重新评估状态
  if (damage.hullIntegrity <= 0 || damage.flooding >= 95 || damage.buoyancy <= 0) {
    damage.status = 'sinking';
  }

  newShip.damage = damage;
  return { ship: newShip, events };
}
