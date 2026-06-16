import type { NavalContact, NavalIntelState } from '../intel/naval-intel-types';
import type { NavalEnvironmentState } from '../naval-types';
import type { NavalShip } from './ship-types';
import { getWeaponSystemReadiness } from './ship-combat-profile';

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

export type WeaponArc = 'forward' | 'aft' | 'port' | 'starboard' | 'all';

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

export interface WeaponHitResult {
  success: boolean;
  hitLocation?: string;
  penetration: number;
  damage: number;
  reason: string;
}

let weaponIdCounter = 0;

function nextWpnId(): string {
  weaponIdCounter++;
  return `wpn_${weaponIdCounter}`;
}

function mount(
  type: NavalWeaponType,
  name: string,
  arc: WeaponArc,
  range: number,
  reloadTurns: number,
  accuracy: number,
  penetration: number,
  explosivePower: number,
  ammo: number,
): ShipWeaponMount {
  return {
    id: nextWpnId(),
    type,
    name,
    arc,
    range,
    reloadTurns,
    cooldown: 0,
    accuracy,
    penetration,
    explosivePower,
    ammo,
  };
}

export function createDefaultWeaponMounts(shipClass: string): ShipWeaponMount[] {
  const weapons: ShipWeaponMount[] = [];

  switch (shipClass) {
    case 'fleet_carrier':
    case 'light_carrier':
    case 'escort_carrier':
      weapons.push(
        mount('aa_gun', 'AA Battery Forward', 'forward', 8, 1, 0.5, 1, 3, 9999),
        mount('aa_gun', 'AA Battery Midships Port', 'port', 8, 1, 0.5, 1, 3, 9999),
        mount('aa_gun', 'AA Battery Midships Starboard', 'starboard', 8, 1, 0.5, 1, 3, 9999),
        mount('aa_gun', 'AA Battery Aft', 'aft', 8, 1, 0.5, 1, 3, 9999),
      );
      break;

    case 'battleship':
      weapons.push(
        mount('main_gun', 'Main Battery Forward', 'forward', 35, 3, 0.15, 80, 20, 100),
        mount('main_gun', 'Main Battery Aft', 'aft', 35, 3, 0.15, 80, 20, 100),
        mount('secondary_gun', 'Secondary Port', 'port', 20, 2, 0.25, 30, 8, 200),
        mount('secondary_gun', 'Secondary Starboard', 'starboard', 20, 2, 0.25, 30, 8, 200),
        mount('aa_gun', 'AA Battery Forward', 'forward', 8, 1, 0.45, 1, 3, 9999),
        mount('aa_gun', 'AA Battery Midships', 'all', 8, 1, 0.45, 1, 3, 9999),
        mount('aa_gun', 'AA Battery Aft', 'aft', 8, 1, 0.45, 1, 3, 9999),
      );
      break;

    case 'heavy_cruiser':
      weapons.push(
        mount('main_gun', '8-inch Forward', 'forward', 28, 3, 0.18, 50, 12, 120),
        mount('main_gun', '8-inch Aft', 'aft', 28, 3, 0.18, 50, 12, 120),
        mount('secondary_gun', '5-inch Port', 'port', 18, 2, 0.25, 20, 6, 200),
        mount('secondary_gun', '5-inch Starboard', 'starboard', 18, 2, 0.25, 20, 6, 200),
        mount('torpedo', 'Torpedo Tubes Port', 'port', 15, 8, 0.15, 60, 35, 8),
        mount('torpedo', 'Torpedo Tubes Starboard', 'starboard', 15, 8, 0.15, 60, 35, 8),
        mount('aa_gun', 'AA Battery', 'all', 8, 1, 0.4, 1, 3, 9999),
      );
      break;

    case 'light_cruiser':
      weapons.push(
        mount('main_gun', '6-inch Forward', 'forward', 24, 2, 0.2, 30, 8, 150),
        mount('main_gun', '6-inch Aft', 'aft', 24, 2, 0.2, 30, 8, 150),
        mount('torpedo', 'Torpedo Tubes Port', 'port', 15, 8, 0.15, 60, 35, 8),
        mount('torpedo', 'Torpedo Tubes Starboard', 'starboard', 15, 8, 0.15, 60, 35, 8),
        mount('aa_gun', 'AA Battery', 'all', 8, 1, 0.4, 1, 3, 9999),
      );
      break;

    case 'destroyer':
      weapons.push(
        mount('main_gun', '5-inch Forward', 'forward', 18, 2, 0.22, 20, 6, 150),
        mount('main_gun', '5-inch Aft', 'aft', 18, 2, 0.22, 20, 6, 150),
        mount('torpedo', 'Torpedo Tubes Port', 'port', 12, 6, 0.18, 60, 35, 5),
        mount('torpedo', 'Torpedo Tubes Starboard', 'starboard', 12, 6, 0.18, 60, 35, 5),
        mount('torpedo', 'Torpedo Tubes Center', 'all', 12, 6, 0.18, 60, 35, 5),
        mount('depth_charge', 'Depth Charge Rack', 'aft', 5, 2, 0.2, 30, 25, 30),
        mount('aa_gun', 'AA Battery', 'all', 7, 1, 0.35, 1, 3, 9999),
      );
      break;

    case 'submarine':
      weapons.push(
        mount('torpedo', 'Torpedo Tubes Forward', 'forward', 10, 10, 0.2, 60, 40, 12),
        mount('torpedo', 'Torpedo Tubes Aft', 'aft', 10, 10, 0.18, 60, 40, 6),
      );
      break;

    case 'transport':
    case 'oiler':
    case 'landing_ship':
    default:
      weapons.push(mount('aa_gun', 'AA Battery', 'all', 6, 1, 0.25, 1, 2, 9999));
      break;
  }

  return weapons;
}

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
  const { attacker, weapon, targetContact } = params;

  if (weapon.ammo <= 0) {
    return { canFire: false, reason: 'Out of ammunition' };
  }

  if (weapon.cooldown > 0) {
    return { canFire: false, reason: 'Weapon reloading' };
  }

  if (weapon.moduleId) {
    const module = attacker.modules.find((m) => m.id === weapon.moduleId);
    if (module && (module.status === 'disabled' || module.status === 'destroyed')) {
      return { canFire: false, reason: `Weapon module ${module.status}` };
    }
  }

  if (attacker.damage.weaponPenalty >= 1) {
    return { canFire: false, reason: 'All weapons disabled' };
  }

  const systemReadiness = getWeaponSystemReadiness(attacker, weapon.type);
  if (systemReadiness <= 0.05) {
    return { canFire: false, reason: `${weapon.type} system disabled by module damage` };
  }

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
      if (targetContact.detectionLevel === 'none') return { canFire: false, reason: 'No contact' };
      break;

    case 'naval_bomber':
    case 'dive_bomber':
    case 'torpedo_bomber':
      if (targetContact.detectionLevel === 'none') return { canFire: false, reason: 'No contact' };
      if (targetContact.detectionLevel === 'suspected') return { canFire: false, reason: 'Cannot launch air attack at suspected contact' };
      break;

    default: {
      const _exhaustive: never = weapon.type;
      return { canFire: false, reason: `Unhandled weapon type ${String(_exhaustive)}` };
    }
  }

  const dx = targetContact.lastKnownPosition.x - attacker.position.x;
  const dy = targetContact.lastKnownPosition.y - attacker.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance > weapon.range) {
    return { canFire: false, reason: 'Target out of range' };
  }

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
