/**
 * Fleet Readiness System - 舰队战备状态、维修、补给
 */

export type FleetReadinessStatus = 'ready' | 'limited' | 'exhausted' | 'repairing' | 'refitting';

export interface FleetReadinessState {
  fleetId: string;
  fuel: number;          // 0-100
  ammo: number;          // 0-100
  aircraftReplacement: number;
  crewFatigue: number;   // 0-100
  maintenanceNeed: number; // 0-100
  repairDaysRemaining: number;
  sortieCooldown: number;
  readiness: FleetReadinessStatus;
  atBase: boolean;
  baseName?: string;
}

export function createFleetReadiness(fleetId: string, baseName?: string): FleetReadinessState {
  return {
    fleetId, fuel: 100, ammo: 100,
    aircraftReplacement: 0, crewFatigue: 0, maintenanceNeed: 0,
    repairDaysRemaining: 0, sortieCooldown: 0,
    readiness: 'ready', atBase: !!baseName, baseName,
  };
}

export function updateFleetReadiness(state: FleetReadinessState, deltaTurns: number): FleetReadinessState {
  let { fuel, ammo, crewFatigue, maintenanceNeed, readiness } = state;

  // Fuel drain
  fuel = Math.max(0, fuel - deltaTurns * 2);

  // Crew fatigue increases on sortie
  crewFatigue = Math.min(100, crewFatigue + deltaTurns * 3);

  // Maintenance needs
  maintenanceNeed = Math.min(100, maintenanceNeed + deltaTurns * 2);

  // If at base, recover
  if (state.atBase) {
    fuel = Math.min(100, fuel + deltaTurns * 10);
    ammo = Math.min(100, ammo + deltaTurns * 5);
    crewFatigue = Math.max(0, crewFatigue - deltaTurns * 8);
    maintenanceNeed = Math.max(0, maintenanceNeed - deltaTurns * 5);
  }

  // Determine readiness
  if (fuel < 10 || ammo < 10) readiness = 'exhausted';
  else if (crewFatigue > 70 || maintenanceNeed > 70) readiness = 'limited';
  else if (fuel < 30 || ammo < 30) readiness = 'limited';
  else if (state.repairDaysRemaining > 0) readiness = 'repairing';
  else readiness = 'ready';

  return { ...state, fuel, ammo, crewFatigue, maintenanceNeed, readiness };
}

export function startRepair(state: FleetReadinessState, days: number): FleetReadinessState {
  return { ...state, repairDaysRemaining: days, readiness: 'repairing', atBase: true };
}

export function tickRepair(state: FleetReadinessState): FleetReadinessState {
  if (state.repairDaysRemaining <= 0) return state;
  const remaining = state.repairDaysRemaining - 1;
  return { ...state, repairDaysRemaining: remaining, readiness: remaining <= 0 ? 'ready' : 'repairing' };
}
