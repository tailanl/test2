import type { NavalShip } from './ship-types';
import type { FleetFormationState } from '../naval-strategic-types';
import type { ShipModuleType } from './ship-modules';
import type { NavalWeaponType } from './ship-weapons';
import type { NavalSensorType } from '../intel/naval-intel-types';

export type FirepowerDomain =
  | 'antiSurface'
  | 'antiAir'
  | 'antiSubmarine'
  | 'torpedo'
  | 'aviationStrike';

export interface ShipModuleReadinessSummary {
  mobility: number;
  sensors: number;
  command: number;
  firepower: number;
  aviation: number;
  damageControl: number;
  hull: number;
}

export interface ShipFirepowerSummary {
  antiSurface: number;
  antiAir: number;
  antiSubmarine: number;
  torpedo: number;
  aviationStrike: number;
}

export interface ShipCombatProfile {
  shipId: string;
  shipName: string;
  readiness: number;
  modules: ShipModuleReadinessSummary;
  firepower: ShipFirepowerSummary;
  sensors: {
    visual: number;
    surfaceRadar: number;
    airSearchRadar: number;
    sonar: number;
    aircraftSearch: number;
  };
}

export interface FleetFormationEffectSummary {
  label: string;
  searchArcModifier: number;
  searchRangeModifier: number;
  antiAirCenterModifier: number;
  screenCoverageModifier: number;
  effectiveAntiAir: number;
}

export interface FleetCombatProfile {
  fleetId: string;
  readiness: number;
  firepower: ShipFirepowerSummary;
  modules: ShipModuleReadinessSummary;
  ships: ShipCombatProfile[];
  formationEffects?: FleetFormationEffectSummary;
}

const WEAPON_MODULES: Record<NavalWeaponType, ShipModuleType[]> = {
  main_gun: ['main_battery'],
  secondary_gun: ['secondary_battery'],
  aa_gun: ['aa_battery'],
  torpedo: ['torpedo_tubes'],
  depth_charge: ['sonar', 'damage_control'],
  naval_bomber: ['flight_deck', 'hangar', 'catapult', 'elevator'],
  dive_bomber: ['flight_deck', 'hangar', 'catapult', 'elevator'],
  torpedo_bomber: ['flight_deck', 'hangar', 'catapult', 'elevator'],
  fighter: ['flight_deck', 'hangar', 'catapult', 'elevator'],
};

const SENSOR_MODULES: Record<NavalSensorType, ShipModuleType[]> = {
  visual: ['bridge', 'cic'],
  surface_radar: ['radar', 'cic'],
  air_search_radar: ['radar', 'cic'],
  sonar: ['sonar', 'cic'],
  aircraft_search: ['flight_deck', 'hangar', 'catapult', 'elevator'],
  radio_intercept: ['radar', 'cic'],
  reported_contact: ['bridge', 'cic'],
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function readinessPct(value: number): number {
  return Math.round(clamp01(value) * 100);
}

function statusMultiplier(status: string): number {
  switch (status) {
    case 'operational':
      return 1;
    case 'damaged':
      return 0.55;
    case 'disabled':
      return 0.15;
    case 'destroyed':
      return 0;
    default:
      return 0.5;
  }
}

export function getModuleGroupReadiness(ship: NavalShip, moduleTypes: ShipModuleType[]): number {
  const modules = ship.modules.filter((module) => moduleTypes.includes(module.type));
  if (modules.length === 0) return 1;

  const total = modules.reduce((sum, module) => {
    const hpRatio = module.maxHp > 0 ? module.hp / module.maxHp : 0;
    const firePenalty = 1 - Math.min(0.45, module.fire / 200);
    const floodPenalty = 1 - Math.min(0.45, module.flooding / 200);
    return sum + clamp01(hpRatio * statusMultiplier(module.status) * firePenalty * floodPenalty);
  }, 0);

  return clamp01(total / modules.length);
}

export function getWeaponSystemReadiness(ship: NavalShip, weaponType: NavalWeaponType): number {
  const moduleReadiness = getModuleGroupReadiness(ship, WEAPON_MODULES[weaponType] || []);
  const damagePenalty = 1 - clamp01(ship.damage.weaponPenalty || 0);
  const aviationPenalty = ['naval_bomber', 'dive_bomber', 'torpedo_bomber', 'fighter'].includes(weaponType)
    ? 1 - clamp01(ship.damage.aircraftOperationPenalty || 0)
    : 1;
  return clamp01(moduleReadiness * damagePenalty * aviationPenalty);
}

export function getSensorSystemReadiness(ship: NavalShip, sensorType: NavalSensorType): number {
  const moduleReadiness = getModuleGroupReadiness(ship, SENSOR_MODULES[sensorType] || []);
  const damagePenalty = 1 - clamp01(ship.damage.sensorPenalty || 0);

  if ((sensorType === 'surface_radar' || sensorType === 'air_search_radar' || sensorType === 'radio_intercept') && !ship.sensors.radarOperational) {
    return 0;
  }
  if (sensorType === 'sonar' && !ship.sensors.sonarOperational) {
    return 0;
  }

  return clamp01(moduleReadiness * damagePenalty);
}

export function getShipModuleReadinessSummary(ship: NavalShip): ShipModuleReadinessSummary {
  return {
    mobility: readinessPct(getModuleGroupReadiness(ship, ['engine_room', 'boiler_room', 'rudder', 'propeller'])),
    sensors: readinessPct(getModuleGroupReadiness(ship, ['radar', 'sonar', 'cic', 'bridge']) * (1 - clamp01(ship.damage.sensorPenalty || 0))),
    command: readinessPct(getModuleGroupReadiness(ship, ['bridge', 'cic'])),
    firepower: readinessPct(getModuleGroupReadiness(ship, ['main_battery', 'secondary_battery', 'aa_battery', 'torpedo_tubes']) * (1 - clamp01(ship.damage.weaponPenalty || 0))),
    aviation: readinessPct(getModuleGroupReadiness(ship, ['flight_deck', 'hangar', 'catapult', 'elevator']) * (1 - clamp01(ship.damage.aircraftOperationPenalty || 0))),
    damageControl: readinessPct(getModuleGroupReadiness(ship, ['damage_control'])),
    hull: readinessPct(getModuleGroupReadiness(ship, ['hull_compartment']) * clamp01(ship.damage.hullIntegrity / 100)),
  };
}

export function getShipFirepowerSummary(ship: NavalShip): ShipFirepowerSummary {
  const firepower: ShipFirepowerSummary = {
    antiSurface: 0,
    antiAir: 0,
    antiSubmarine: 0,
    torpedo: 0,
    aviationStrike: 0,
  };

  for (const weapon of ship.weapons) {
    if (weapon.ammo <= 0) continue;
    const readiness = getWeaponSystemReadiness(ship, weapon.type);
    if (readiness <= 0) continue;
    const score = weapon.explosivePower * Math.max(0.05, weapon.accuracy) * Math.max(1, weapon.range) * readiness;

    switch (weapon.type) {
      case 'main_gun':
      case 'secondary_gun':
        firepower.antiSurface += score;
        break;
      case 'aa_gun':
      case 'fighter':
        firepower.antiAir += score;
        break;
      case 'depth_charge':
        firepower.antiSubmarine += score;
        break;
      case 'torpedo':
        firepower.torpedo += score;
        break;
      case 'naval_bomber':
      case 'dive_bomber':
      case 'torpedo_bomber':
        firepower.aviationStrike += score;
        break;
      default: {
        const _exhaustive: never = weapon.type;
        return _exhaustive;
      }
    }
  }

  if (ship.aircraft) {
    const aviationReadiness = getWeaponSystemReadiness(ship, 'dive_bomber');
    firepower.antiAir += ship.aircraft.fighters * 2 * aviationReadiness;
    firepower.aviationStrike += (ship.aircraft.diveBombers * 3 + ship.aircraft.torpedoBombers * 4) * aviationReadiness;
  }

  return {
    antiSurface: Math.round(firepower.antiSurface),
    antiAir: Math.round(firepower.antiAir),
    antiSubmarine: Math.round(firepower.antiSubmarine),
    torpedo: Math.round(firepower.torpedo),
    aviationStrike: Math.round(firepower.aviationStrike),
  };
}

export function getShipCombatProfile(ship: NavalShip): ShipCombatProfile {
  const modules = getShipModuleReadinessSummary(ship);
  const sensors = {
    visual: readinessPct(getSensorSystemReadiness(ship, 'visual')),
    surfaceRadar: readinessPct(getSensorSystemReadiness(ship, 'surface_radar')),
    airSearchRadar: readinessPct(getSensorSystemReadiness(ship, 'air_search_radar')),
    sonar: readinessPct(getSensorSystemReadiness(ship, 'sonar')),
    aircraftSearch: readinessPct(getSensorSystemReadiness(ship, 'aircraft_search')),
  };
  const firepower = getShipFirepowerSummary(ship);
  const readiness = Math.round((
    modules.mobility +
    modules.sensors +
    modules.command +
    modules.firepower +
    modules.hull +
    Math.min(100, ship.damage.crewEfficiency)
  ) / 6);

  return {
    shipId: ship.id,
    shipName: ship.name,
    readiness,
    modules,
    firepower,
    sensors,
  };
}

export function getFleetCombatProfile(fleet: { id: string; ships: NavalShip[]; formation?: FleetFormationState }): FleetCombatProfile {
  const ships = fleet.ships.map(getShipCombatProfile);
  const emptyModules: ShipModuleReadinessSummary = {
    mobility: 0,
    sensors: 0,
    command: 0,
    firepower: 0,
    aviation: 0,
    damageControl: 0,
    hull: 0,
  };
  const emptyFirepower: ShipFirepowerSummary = {
    antiSurface: 0,
    antiAir: 0,
    antiSubmarine: 0,
    torpedo: 0,
    aviationStrike: 0,
  };

  if (ships.length === 0) {
    return { fleetId: fleet.id, readiness: 0, firepower: emptyFirepower, modules: emptyModules, ships };
  }

  const modules = ships.reduce((acc, ship) => ({
    mobility: acc.mobility + ship.modules.mobility,
    sensors: acc.sensors + ship.modules.sensors,
    command: acc.command + ship.modules.command,
    firepower: acc.firepower + ship.modules.firepower,
    aviation: acc.aviation + ship.modules.aviation,
    damageControl: acc.damageControl + ship.modules.damageControl,
    hull: acc.hull + ship.modules.hull,
  }), emptyModules);

  const firepower = ships.reduce((acc, ship) => ({
    antiSurface: acc.antiSurface + ship.firepower.antiSurface,
    antiAir: acc.antiAir + ship.firepower.antiAir,
    antiSubmarine: acc.antiSubmarine + ship.firepower.antiSubmarine,
    torpedo: acc.torpedo + ship.firepower.torpedo,
    aviationStrike: acc.aviationStrike + ship.firepower.aviationStrike,
  }), emptyFirepower);

  const count = ships.length;
  const formationEffects = fleet.formation ? {
    label: fleet.formation.type.replace(/_/g, ' '),
    searchArcModifier: fleet.formation.searchArcModifier,
    searchRangeModifier: fleet.formation.searchRangeModifier,
    antiAirCenterModifier: fleet.formation.antiAirCenterModifier,
    screenCoverageModifier: fleet.formation.screenCoverageModifier,
    effectiveAntiAir: Math.round(firepower.antiAir * fleet.formation.antiAirCenterModifier),
  } : undefined;

  return {
    fleetId: fleet.id,
    readiness: Math.round(ships.reduce((sum, ship) => sum + ship.readiness, 0) / count),
    firepower,
    modules: {
      mobility: Math.round(modules.mobility / count),
      sensors: Math.round(modules.sensors / count),
      command: Math.round(modules.command / count),
      firepower: Math.round(modules.firepower / count),
      aviation: Math.round(modules.aviation / count),
      damageControl: Math.round(modules.damageControl / count),
      hull: Math.round(modules.hull / count),
    },
    ships,
    formationEffects,
  };
}
