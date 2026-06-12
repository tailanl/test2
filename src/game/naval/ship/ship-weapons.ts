/**
 * 舰船武器系统
 */

import type { NavalContact } from '../intel/naval-intel-types';
import type { NavalIntelState } from '../intel/naval-intel-types';
import type { NavalEnvironmentState } from '../naval-types';
import type { NavalShip } from './ship-types';

// ===== 武器类型 =====

export type NavalWeaponType =
  | 'main_gun'
  | 'secondary_gun'
  | 'aa_gun'
  | 'torpedo'
  | 'depth_charge'
  | 'naval_bomber'
  | 'dive_bomber'
  | 'torpedo_bomber'
  | 'fighter';

// ===== 射界 =====

export type WeaponArc = 'forward' | 'aft' | 'port' | 'starboard' | 'all';

// ===== 武器基座 =====

export interface ShipWeaponMount {
  id: string;
  type: NavalWeaponType;
  name: string;
  arc: WeaponArc;
  range: number;
  reloadTurns: number;
  cooldown: number;
  accuracy: number;
  penetration: number;
  explosivePower: number;
  ammo: number;
  moduleId?: string;
}

// ===== 武器命中结果 =====

export interface WeaponHitResult {
  success: boolean;
  hitLocation?: string;
  penetration: number;
  damage: number;
  reason: string;
}

// ===== 创建默认武器基座 =====

let weaponIdCounter = 0;

function nextWpnId(): string {
  weaponIdCounter++;
  return `wpn_${weaponIdCounter}`;
}

export function createDefaultWeaponMounts(shipClass: string): ShipWeaponMount[] {
  const weapons: ShipWeaponMount[] = [];

  switch (shipClass) {
    case 'fleet_carrier':
    case 'light_carrier':
    case 'escort_carrier':
      weapons.push(
        { id: nextWpnId(), type: 'aa_gun', name: 'AA Battery Forward', arc: 'forward', range: 8, reloadTurns: 1, cooldown: 0, accuracy: 0.5, penetration: 1, explosivePower: 3, ammo: 9999 },
        { id: nextWpnId(), type: 'aa_gun', name: 'AA Battery Midships Port', arc: 'port', range: 8, reloadTurns: 1, cooldown: 0, accuracy: 0.5, penetration: 1, explosivePower: 3, ammo: 9999 },
        { id: nextWpnId(), type: 'aa_gun', name: 'AA Battery Midships Starboard', arc: 'starboard', range: 8, reloadTurns: 1, cooldown: 0, accuracy: 0.5, penetration: 1, explosivePower: 3, ammo: 9999 },
        { id: nextWpnId(), type: 'aa_gun', name: 'AA Battery Aft', arc: 'aft', range: 8, reloadTurns: 1, cooldown: 0, accuracy: 0.5, penetration: 1, explosivePower: 3, ammo: 9999 },
      );
      break;

    case 'battleship':
      weapons.push(
        { id: nextWpnId(), type: 'main_gun', name: 'Main Battery Forward', arc: 'forward', range: 35, reloadTurns: 3, cooldown: 0, accuracy: 0.15, penetration: 80, explosivePower: 20, ammo: 100 },
        { id: nextWpnId(), type: 'main_gun', name: 'Main Battery Aft', arc: 'aft', range: 35, reloadTurns: 3, cooldown: 0, accuracy: 0.15, penetration: 80, explosivePower: 20, ammo: 100 },
        { id: nextWpnId(), type: 'secondary_gun', name: 'Secondary Port', arc: 'port', range: 20, reloadTurns: 2, cooldown: 0, accuracy: 0.25, penetration: 30, explosivePower: 8, ammo: 200 },
        { id: nextWpnId(), type: 'secondary_gun', name: 'Secondary Starboard', arc: 'starboard', range: 20, reloadTurns: 2, cooldown: 0, accuracy: 0.25, penetration: 30, explosivePower: 8, ammo: 200 },
        { id: nextWpnId(), type: 'aa_gun', name: 'AA Battery Forward', arc: 'forward', range: 8, reloadTurns: 1, cooldown: 0, accuracy: 0.45, penetration: 1, explosivePower: 3, ammo: 9999 },
        { id: nextWpnId(), type: 'aa_gun', name: 'AA Battery Midships', arc: 'all', range: 8, reloadTurns: 1, cooldown: 0, accuracy: 0.45, penetration: 1, explosivePower: 3, ammo: 9999 },
        { id: nextWpnId(), type: 'aa_gun', name: 'AA Battery Aft', arc: 'aft', range: 8, reloadTurns: 1, cooldown: 0, accuracy: 0.45, penetration: 1, explosivePower: 3, ammo: 9999 },
      );
      break;

    case 'heavy_cruiser':
      weapons.push(
        { id: nextWpnId(), type: 'main_gun', name: '8-inch Forward', arc: 'forward', range: 28, reloadTurns: 3, cooldown: 0, accuracy: 0.18, penetration: 50, explosivePower: 12, ammo: 120 },
        { id: nextWpnId(), type: 'main_gun', name: '8-inch Aft', arc: 'aft', range: 28, reloadTurns: 3, cooldown: 0, accuracy: 0.18, penetration: 50, explosivePower: 12, ammo: 120 },
        { id: nextWpnId(), type: 'secondary_gun', name: '5-inch Port', arc: 'port', range: 18, reloadTurns: 2, cooldown: 0, accuracy: 0.25, penetration: 20, explosivePower: 6, ammo: 200 },
        { id: nextWpnId(), type: 'secondary_gun', name: '5-inch Starboard', arc: 'starboard', range: 18, reloadTurns: 2, cooldown: 0, accuracy: 0.25, penetration: 20, explosivePower: 6, ammo: 200 },
        { id: nextWpnId(), type: 'torpedo', name: 'Torpedo Tubes Port', arc: 'port', range: 15, reloadTurns: 8, cooldown: 0, accuracy: 0.15, penetration: 60, explosivePower: 35, ammo: 8 },
        { id: nextWpnId(), type: 'torpedo', name: 'Torpedo Tubes Starboard', arc: 'starboard', range: 15, reloadTurns: 8, cooldown: 0, accuracy: 0.15, penetration: 60, explosivePower: 35, ammo: 8 },
        { id: nextWpnId(), type: 'aa_gun', name: 'AA Battery', arc: 'all', range: 8, reloadTurns: 1, cooldown: 0, accuracy: 0.4, penetration: 1, explosivePower: 3, ammo: 9999 },
      );
      break;

    case 'light_cruiser':
      weapons.push(
        { id: nextWpnId(), type: 'main_gun', name: '6-inch Forward', arc: 'forward', range: 24, reloadTurns: 2, cooldown: 0, accuracy: 0.2, penetration: 30, explosivePower: 8, ammo: 150 },
        { id: nextWpnId(), type: 'main_gun', name: '6-inch Aft', arc: 'aft', range: 24, reloadTurns: 2, cooldown: 0, accuracy: 0.2, penetration: 30, explosivePower: 8, ammo: 150 },
        { id: nextWpnId(), type: 'torpedo', name: 'Torpedo Tubes Port', arc: 'port', range: 15, reloadTurns: 8, cooldown: 0, accuracy: 0.15, penetration: 60, explosivePower: 35, ammo: 8 },
        { id: nextWpnId(), type: 'torpedo', name: 'Torpedo Tubes Starboard', arc: 'starboard', range: 15, reloadTurns: 8, cooldown: 0, accuracy: 0.15, penetration: 60, explosivePower: 35, ammo: 8 },
        { id: nextWpnId(), type: 'aa_gun', name: 'AA Battery', arc: 'all', range: 8, reloadTurns: 1, cooldown: 0, accuracy: 0.4, penetration: 1, explosivePower: 3, ammo: 9999 },
      );
      break;

    case 'destroyer':
      weapons.push(
        { id: nextWpnId(), type: 'main_gun', name: '5-inch Forward', arc: 'forward', range: 18, reloadTurns: 2, cooldown: 0, accuracy: 0.22, penetration: 20, explosivePower: 6, ammo: 150 },
        { id: nextWpnId(), type: 'main_gun', name: '5-inch Aft', arc: 'aft', range: 18, reloadTurns: 2, cooldown: 0, accuracy: 0.22, penetration: 20, explosivePower: 6, ammo: 150 },
        { id: nextWpnId(), type: 'torpedo', name: 'Torpedo Tubes Port', arc: 'port', range: 12, reloadTurns: 6, cooldown: 0, accuracy: 0.18, penetration: 60, explosivePower: 35, ammo: 5 },
        { id: nextWpnId(), type: 'torpedo', name: 'Torpedo Tubes Starboard', arc: 'starboard', range: 12, reloadTurns: 6, cooldown: 0, accuracy: 0.18, penetration: 60, explosivePower: 35, ammo: 5 },
        { id: nextWpnId(), type: 'torpedo', name: 'Torpedo Tubes Center', arc: 'all', range: 12, reloadTurns: 6, cooldown: 0, accuracy: 0.18, penetration: 60, explosivePower: 35, ammo: 5 },
        { id: nextWpnId(), type: 'depth_charge', name: 'Depth Charge Rack', arc: 'aft', range: 5, reloadTurns: 2, cooldown: 0, accuracy: 0.2, penetration: 30, explosivePower: 25, ammo: 30 },
        { id: nextWpnId(), type: 'aa_gun', name: 'AA Battery', arc: 'all', range: 7, reloadTurns: 1, cooldown: 0, accuracy: 0.35, penetration: 1, explosivePower: 3, ammo: 9999 },
      );
      break;

    case 'submarine':
      weapons.push(
        { id: nextWpnId(), type: 'torpedo', name: 'Torpedo Tubes Forward', arc: 'forward', range: 10, reloadTurns: 10, cooldown: 0, accuracy: 0.2, penetration: 60, explosivePower: 40, ammo: 12 },
        { id: nextWpnId(), type: 'torpedo', name: 'Torpedo Tubes Aft', arc: 'aft', range: 10, reloadTurns: 10, cooldown: 0, accuracy: 0.18, penetration: 60, explosivePower: 40, ammo: 6 },
      );
      break;

    case 'transport':
    case 'oiler':
    case 'landing_ship':
    default:
      weapons.push(
        { id: nextWpnId(), type: 'aa_gun', name: 'AA Battery', arc: 'all', range: 6, reloadTurns: 1, cooldown: 0, accuracy: 0.25, penetration: 1, explosivePower: 2, ammo: 9999 },
      );
      break;
  }

  return weapons;
}

// ===== 武器开火判定 =====

export function canFireNavalWeapon(params: {
  attacker: NavalShip;
  weapon: ShipWeaponMount;
  targetContact: NavalContact;
  intel: NavalIntelState;
  environment: NavalEnvironmentState;
}): {
  canFire: boolean;
  reason: string;
} {
  const { attacker, weapon, targetContact, environment } = params;

  if (weapon.ammo <= 0) {
    return { canFire: false, reason: 'Out of ammunition' };
  }

  if (weapon.cooldown > 0) {
    return { canFire: false, reason: 'Weapon reloading' };
  }

  // 检查武器对应模块
  if (weapon.moduleId) {
    const module = attacker.modules.find((m) => m.id === weapon.moduleId);
    if (module && (module.status === 'disabled' || module.status === 'destroyed')) {
      return { canFire: false, reason: `Weapon module ${module.status}` };
    }
  }

  // 检查损伤惩罚
  if (attacker.damage.weaponPenalty >= 1) {
    return { canFire: false, reason: 'All weapons disabled' };
  }

  // 检查目标侦测等级
  switch (weapon.type) {
    case 'main_gun':
    case 'secondary_gun':
      if (targetContact.detectionLevel === 'none') return { canFire: false, reason: 'No contact' };
      if (targetContact.detectionLevel === 'suspected') return { canFire: false, reason: 'Cannot fire at suspected contact' };
      if (targetContact.detectionLevel === 'detected') return { canFire: false, reason: 'Need classified contact for gunnery' };
      break;

    case 'torpedo':
      if (targetContact.detectionLevel === 'none') return { canFire: false, reason: 'No contact' };
      if (targetContact.detectionLevel === 'suspected') return { canFire: false, reason: 'Cannot fire torpedoes at suspected contact' };
      break;

    case 'depth_charge':
      if (targetContact.detectionLevel === 'none' || targetContact.detectionLevel === 'lost') {
        return { canFire: false, reason: 'No sonar contact' };
      }
      break;

    case 'aa_gun':
    case 'fighter':
      // AA 可以更宽松
      if (targetContact.detectionLevel === 'none') return { canFire: false, reason: 'No contact' };
      break;

    default:
      if (targetContact.detectionLevel === 'none') return { canFire: false, reason: 'No contact' };
  }

  // 检查射程
  const dx = targetContact.lastKnownPosition.x - attacker.position.x;
  const dy = targetContact.lastKnownPosition.y - attacker.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance > weapon.range) {
    return { canFire: false, reason: 'Target out of range' };
  }

  // 检查射界
  if (weapon.arc !== 'all') {
    const targetAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const relativeAngle = ((targetAngle - attacker.headingDeg) + 360) % 360;
    const inArc = 
      (weapon.arc === 'forward' && (relativeAngle <= 45 || relativeAngle >= 315)) ||
      (weapon.arc === 'aft' && relativeAngle >= 135 && relativeAngle <= 225) ||
      (weapon.arc === 'port' && relativeAngle > 45 && relativeAngle < 135) ||
      (weapon.arc === 'starboard' && relativeAngle > 225 && relativeAngle < 315);

    if (!inArc) {
      return { canFire: false, reason: 'Target not in firing arc' };
    }
  }

  return { canFire: true, reason: 'Ready to fire' };
}
