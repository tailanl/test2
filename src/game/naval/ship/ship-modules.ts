/**
 * 舰船模块系统 - 模块化组件定义
 */

export type ShipModuleType =
  | 'bridge'
  | 'cic'
  | 'radar'
  | 'sonar'
  | 'main_battery'
  | 'secondary_battery'
  | 'aa_battery'
  | 'torpedo_tubes'
  | 'engine_room'
  | 'boiler_room'
  | 'rudder'
  | 'propeller'
  | 'magazine'
  | 'fuel_tank'
  | 'flight_deck'
  | 'hangar'
  | 'catapult'
  | 'elevator'
  | 'damage_control'
  | 'hull_compartment';

export type ModuleLocation =
  | 'bow'
  | 'forward'
  | 'midships'
  | 'aft'
  | 'stern'
  | 'port'
  | 'starboard'
  | 'superstructure'
  | 'below_waterline';

export type ModuleStatus =
  | 'operational'
  | 'damaged'
  | 'disabled'
  | 'destroyed';

export interface ModuleExposure {
  side: number;
  vertical: number;
  underwater: number;
}

export interface ModuleArmorProfile {
  sideArmor: number;
  deckArmor: number;
  underwaterProtection: number;
}

export interface ShipModule {
  id: string;
  type: ShipModuleType;
  name: string;
  location: ModuleLocation;
  maxHp: number;
  hp: number;
  armor: number;
  armorProfile: ModuleArmorProfile;
  exposure: ModuleExposure;
  status: ModuleStatus;
  fire: number;
  flooding: number;
  critical: boolean;
}

let moduleIdCounter = 0;

function nextModuleId(): string {
  moduleIdCounter++;
  return `module_${moduleIdCounter}`;
}

function createModule(
  type: ShipModuleType,
  name: string,
  location: ModuleLocation,
  maxHp: number,
  armor: number,
  critical: boolean = false,
  exposureOverride?: Partial<ModuleExposure>,
  armorOverride?: Partial<ModuleArmorProfile>
): ShipModule {
  const defaultExposure: ModuleExposure = getDefaultExposure(type, location);
  const defaultArmorProfile: ModuleArmorProfile = {
    sideArmor: armor,
    deckArmor: Math.round(armor * 0.6),
    underwaterProtection: location === 'below_waterline' ? Math.round(armor * 0.8) : Math.round(armor * 0.3),
  };

  return {
    id: nextModuleId(),
    type,
    name,
    location,
    maxHp,
    hp: maxHp,
    armor,
    armorProfile: { ...defaultArmorProfile, ...(armorOverride || {}) },
    exposure: { ...defaultExposure, ...(exposureOverride || {}) },
    status: 'operational',
    fire: 0,
    flooding: 0,
    critical,
  };
}

// ===== 默认 Exposure 值 =====

function getDefaultExposure(type: ShipModuleType, location: ModuleLocation): ModuleExposure {
  // Below waterline: high underwater exposure
  if (location === 'below_waterline') {
    return { side: 1, vertical: 0, underwater: 3 };
  }

  switch (type) {
    case 'bridge':
    case 'cic':
    case 'radar':
      return { side: 1, vertical: 2, underwater: 0 };
    case 'flight_deck':
      return { side: 0.3, vertical: 3, underwater: 0 };
    case 'hangar':
      return { side: 1, vertical: 2, underwater: 0 };
    case 'main_battery':
      return { side: 1.5, vertical: 1, underwater: 0 };
    case 'secondary_battery':
    case 'aa_battery':
      return { side: 1.2, vertical: 1.2, underwater: 0 };
    case 'engine_room':
    case 'boiler_room':
      return { side: 1, vertical: 0.5, underwater: 2 };
    case 'rudder':
    case 'propeller':
      return { side: 0.5, vertical: 0, underwater: 2.5 };
    case 'magazine':
      return { side: 1, vertical: 1, underwater: 1 };
    case 'fuel_tank':
      return { side: 1, vertical: 1.5, underwater: 1 };
    case 'hull_compartment':
      return { side: 2, vertical: 0.5, underwater: 3 };
    case 'torpedo_tubes':
      return { side: 1, vertical: 0.3, underwater: 0 };
    case 'elevator':
    case 'catapult':
      return { side: 0.3, vertical: 2, underwater: 0 };
    case 'sonar':
      return { side: 0, vertical: 0, underwater: 1.5 };
    case 'damage_control':
      return { side: 0.5, vertical: 0.5, underwater: 0.3 };
    default:
      return { side: 1, vertical: 1, underwater: 0 };
  }
}

export function createDefaultModulesForShipClass(shipClass: string): ShipModule[] {
  const modules: ShipModule[] = [];

  switch (shipClass) {
    case 'fleet_carrier':
    case 'light_carrier':
      modules.push(
        createModule('bridge', 'Bridge', 'superstructure', 150, 30, true),
        createModule('cic', 'CIC', 'superstructure', 100, 25, true),
        createModule('radar', 'Radar Suite', 'superstructure', 80, 15, true),
        createModule('aa_battery', 'AA Battery Forward', 'forward', 60, 20, false),
        createModule('aa_battery', 'AA Battery Midships Port', 'port', 60, 20, false),
        createModule('aa_battery', 'AA Battery Midships Starboard', 'starboard', 60, 20, false),
        createModule('aa_battery', 'AA Battery Aft', 'aft', 60, 20, false),
        createModule('engine_room', 'Engine Room Port', 'midships', 200, 50, true),
        createModule('engine_room', 'Engine Room Starboard', 'midships', 200, 50, true),
        createModule('boiler_room', 'Boiler Room Port', 'midships', 150, 40, true),
        createModule('boiler_room', 'Boiler Room Starboard', 'midships', 150, 40, true),
        createModule('rudder', 'Rudder', 'stern', 100, 30, true),
        createModule('propeller', 'Propeller Port', 'stern', 80, 20, false),
        createModule('propeller', 'Propeller Starboard', 'stern', 80, 20, false),
        createModule('flight_deck', 'Flight Deck', 'superstructure', 300, 20, true),
        createModule('hangar', 'Hangar Deck', 'midships', 200, 25, true),
        createModule('elevator', 'Aircraft Elevator Forward', 'forward', 80, 15, false),
        createModule('elevator', 'Aircraft Elevator Aft', 'aft', 80, 15, false),
        createModule('catapult', 'Catapult Port', 'port', 50, 10, false),
        createModule('catapult', 'Catapult Starboard', 'starboard', 50, 10, false),
        createModule('fuel_tank', 'Aviation Fuel Tank', 'midships', 150, 25, true),
        createModule('magazine', 'Forward Magazine', 'forward', 120, 30, true),
        createModule('magazine', 'Aft Magazine', 'aft', 120, 30, true),
        createModule('damage_control', 'DC Central', 'midships', 100, 30, false),
      );
      for (let i = 0; i < 8; i++) {
        const locs: ModuleLocation[] = ['bow', 'forward', 'midships', 'aft', 'stern', 'port', 'starboard', 'below_waterline'];
        modules.push(createModule('hull_compartment', `Hull ${i + 1}`, locs[i % locs.length], 80, 15, false));
      }
      break;

    case 'escort_carrier':
      modules.push(
        createModule('bridge', 'Bridge', 'superstructure', 100, 20, true),
        createModule('cic', 'CIC', 'superstructure', 60, 15, false),
        createModule('radar', 'Radar Suite', 'superstructure', 50, 12, false),
        createModule('aa_battery', 'AA Battery Forward', 'forward', 50, 18, false),
        createModule('aa_battery', 'AA Battery Aft', 'aft', 50, 18, false),
        createModule('engine_room', 'Engine Room', 'midships', 150, 40, true),
        createModule('boiler_room', 'Boiler Room', 'midships', 120, 35, true),
        createModule('rudder', 'Rudder', 'stern', 80, 25, true),
        createModule('propeller', 'Propeller', 'stern', 60, 15, false),
        createModule('flight_deck', 'Flight Deck', 'superstructure', 200, 18, true),
        createModule('hangar', 'Hangar Deck', 'midships', 150, 20, true),
        createModule('catapult', 'Catapult', 'forward', 40, 8, false),
        createModule('fuel_tank', 'Aviation Fuel Tank', 'midships', 100, 20, true),
        createModule('magazine', 'Magazine', 'forward', 80, 22, true),
        createModule('damage_control', 'DC Central', 'midships', 70, 25, false),
      );
      for (let i = 0; i < 4; i++) {
        modules.push(createModule('hull_compartment', `Hull ${i + 1}`, 'midships', 60, 12, false));
      }
      break;

    case 'battleship':
      modules.push(
        createModule('bridge', 'Bridge', 'superstructure', 200, 50, true),
        createModule('cic', 'CIC', 'superstructure', 120, 35, true),
        createModule('radar', 'Radar Suite', 'superstructure', 100, 20, true),
        createModule('main_battery', 'Turret A', 'forward', 250, 80, true),
        createModule('main_battery', 'Turret B', 'forward', 250, 80, true),
        createModule('main_battery', 'Turret C', 'aft', 250, 80, true),
        createModule('secondary_battery', 'Secondary Port', 'port', 100, 30, false),
        createModule('secondary_battery', 'Secondary Starboard', 'starboard', 100, 30, false),
        createModule('aa_battery', 'AA Battery Forward', 'forward', 60, 20, false),
        createModule('aa_battery', 'AA Battery Midships', 'midships', 60, 20, false),
        createModule('aa_battery', 'AA Battery Aft', 'aft', 60, 20, false),
        createModule('engine_room', 'Engine Room 1', 'midships', 250, 60, true),
        createModule('engine_room', 'Engine Room 2', 'midships', 250, 60, true),
        createModule('boiler_room', 'Boiler Room 1', 'midships', 200, 50, true),
        createModule('boiler_room', 'Boiler Room 2', 'midships', 200, 50, true),
        createModule('rudder', 'Rudder', 'stern', 150, 40, true),
        createModule('propeller', 'Propeller Port', 'stern', 100, 25, false),
        createModule('propeller', 'Propeller Starboard', 'stern', 100, 25, false),
        createModule('magazine', 'Forward Magazine', 'forward', 150, 50, true),
        createModule('magazine', 'Aft Magazine', 'aft', 150, 50, true),
        createModule('fuel_tank', 'Fuel Tank', 'midships', 180, 30, false),
        createModule('damage_control', 'DC Central', 'midships', 120, 35, false),
      );
      for (let i = 0; i < 10; i++) {
        const locs: ModuleLocation[] = ['bow', 'forward', 'midships', 'midships', 'aft', 'stern', 'port', 'starboard', 'below_waterline', 'below_waterline'];
        modules.push(createModule('hull_compartment', `Hull ${i + 1}`, locs[i], 100, 25, false));
      }
      break;

    case 'heavy_cruiser':
      modules.push(
        createModule('bridge', 'Bridge', 'superstructure', 120, 30, true),
        createModule('cic', 'CIC', 'superstructure', 80, 22, true),
        createModule('radar', 'Radar Suite', 'superstructure', 70, 15, true),
        createModule('main_battery', 'Turret A', 'forward', 150, 50, true),
        createModule('main_battery', 'Turret B', 'aft', 150, 50, true),
        createModule('secondary_battery', 'Secondary Port', 'port', 80, 22, false),
        createModule('secondary_battery', 'Secondary Starboard', 'starboard', 80, 22, false),
        createModule('aa_battery', 'AA Battery Forward', 'forward', 50, 18, false),
        createModule('aa_battery', 'AA Battery Aft', 'aft', 50, 18, false),
        createModule('torpedo_tubes', 'Torpedo Tubes Port', 'port', 60, 15, false),
        createModule('torpedo_tubes', 'Torpedo Tubes Starboard', 'starboard', 60, 15, false),
        createModule('engine_room', 'Engine Room', 'midships', 180, 50, true),
        createModule('boiler_room', 'Boiler Room', 'midships', 150, 40, true),
        createModule('rudder', 'Rudder', 'stern', 100, 30, true),
        createModule('propeller', 'Propeller', 'stern', 70, 18, false),
        createModule('magazine', 'Magazine', 'forward', 100, 35, true),
        createModule('fuel_tank', 'Fuel Tank', 'midships', 120, 22, false),
        createModule('damage_control', 'DC Central', 'midships', 80, 28, false),
        createModule('sonar', 'Sonar Dome', 'below_waterline', 60, 10, false),
      );
      for (let i = 0; i < 6; i++) {
        modules.push(createModule('hull_compartment', `Hull ${i + 1}`, 'midships', 70, 18, false));
      }
      break;

    case 'light_cruiser':
      modules.push(
        createModule('bridge', 'Bridge', 'superstructure', 100, 25, true),
        createModule('cic', 'CIC', 'superstructure', 60, 18, true),
        createModule('radar', 'Radar Suite', 'superstructure', 55, 12, true),
        createModule('main_battery', 'Main Battery Forward', 'forward', 120, 35, true),
        createModule('main_battery', 'Main Battery Aft', 'aft', 120, 35, true),
        createModule('secondary_battery', 'Secondary', 'midships', 60, 18, false),
        createModule('aa_battery', 'AA Battery', 'midships', 45, 15, false),
        createModule('torpedo_tubes', 'Torpedo Tubes Port', 'port', 50, 12, false),
        createModule('torpedo_tubes', 'Torpedo Tubes Starboard', 'starboard', 50, 12, false),
        createModule('engine_room', 'Engine Room', 'midships', 150, 40, true),
        createModule('boiler_room', 'Boiler Room', 'midships', 120, 35, true),
        createModule('rudder', 'Rudder', 'stern', 80, 25, true),
        createModule('propeller', 'Propeller', 'stern', 55, 15, false),
        createModule('magazine', 'Magazine', 'forward', 80, 30, true),
        createModule('fuel_tank', 'Fuel Tank', 'midships', 100, 18, false),
        createModule('damage_control', 'DC Central', 'midships', 60, 22, false),
        createModule('sonar', 'Sonar Dome', 'below_waterline', 50, 8, false),
      );
      for (let i = 0; i < 5; i++) {
        modules.push(createModule('hull_compartment', `Hull ${i + 1}`, 'midships', 55, 14, false));
      }
      break;

    case 'destroyer':
      modules.push(
        createModule('bridge', 'Bridge', 'superstructure', 70, 15, true),
        createModule('radar', 'Radar', 'superstructure', 40, 10, false),
        createModule('sonar', 'Sonar Dome', 'below_waterline', 45, 10, false),
        createModule('main_battery', 'Main Battery Forward', 'forward', 80, 20, true),
        createModule('main_battery', 'Main Battery Aft', 'aft', 80, 20, false),
        createModule('aa_battery', 'AA Battery', 'midships', 40, 12, false),
        createModule('torpedo_tubes', 'Torpedo Tubes Port', 'port', 50, 15, false),
        createModule('torpedo_tubes', 'Torpedo Tubes Starboard', 'starboard', 50, 15, false),
        createModule('engine_room', 'Engine Room', 'midships', 120, 30, true),
        createModule('boiler_room', 'Boiler Room', 'midships', 100, 25, true),
        createModule('rudder', 'Rudder', 'stern', 60, 20, true),
        createModule('propeller', 'Propeller', 'stern', 45, 12, false),
        createModule('damage_control', 'DC Central', 'midships', 50, 15, false),
      );
      for (let i = 0; i < 3; i++) {
        modules.push(createModule('hull_compartment', `Hull ${i + 1}`, 'midships', 45, 10, false));
      }
      break;

    case 'submarine':
      modules.push(
        createModule('bridge', 'Conning Tower', 'superstructure', 60, 15, true),
        createModule('sonar', 'Sonar Array', 'below_waterline', 50, 10, true),
        createModule('torpedo_tubes', 'Torpedo Tubes Forward', 'bow', 70, 20, true),
        createModule('torpedo_tubes', 'Torpedo Tubes Aft', 'stern', 50, 18, false),
        createModule('engine_room', 'Diesel Engine Room', 'midships', 100, 25, true),
        createModule('boiler_room', 'Battery Room', 'midships', 80, 20, true),
        createModule('rudder', 'Rudder', 'stern', 50, 15, true),
        createModule('propeller', 'Propeller', 'stern', 40, 12, false),
        createModule('damage_control', 'DC Central', 'midships', 40, 12, false),
      );
      for (let i = 0; i < 3; i++) {
        modules.push(createModule('hull_compartment', `Pressure Hull ${i + 1}`, 'below_waterline', 60, 15, true));
      }
      break;

    case 'transport':
    case 'oiler':
      modules.push(
        createModule('bridge', 'Bridge', 'superstructure', 80, 12, true),
        createModule('engine_room', 'Engine Room', 'midships', 120, 25, true),
        createModule('boiler_room', 'Boiler Room', 'midships', 100, 20, true),
        createModule('rudder', 'Rudder', 'stern', 60, 15, true),
        createModule('propeller', 'Propeller', 'stern', 40, 10, false),
        createModule('aa_battery', 'AA Battery', 'midships', 30, 10, false),
        createModule('damage_control', 'DC Central', 'midships', 40, 12, false),
      );
      for (let i = 0; i < 5; i++) {
        modules.push(createModule('hull_compartment', `Hull ${i + 1}`, 'midships', 50, 12, false));
      }
      break;

    case 'landing_ship':
    default:
      modules.push(
        createModule('bridge', 'Bridge', 'superstructure', 70, 12, true),
        createModule('engine_room', 'Engine Room', 'midships', 100, 22, true),
        createModule('rudder', 'Rudder', 'stern', 50, 12, true),
        createModule('propeller', 'Propeller', 'stern', 35, 10, false),
        createModule('aa_battery', 'AA Battery', 'midships', 30, 10, false),
        createModule('damage_control', 'DC Central', 'midships', 35, 10, false),
      );
      for (let i = 0; i < 4; i++) {
        modules.push(createModule('hull_compartment', `Hull ${i + 1}`, 'midships', 45, 10, false));
      }
      break;
  }

  return modules;
}
