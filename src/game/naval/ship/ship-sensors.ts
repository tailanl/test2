/**
 * 舰船传感器配置
 */

export interface ShipSensorProfile {
  visualRange: number;
  surfaceRadarRange: number;
  airSearchRadarRange: number;
  sonarRange: number;
  radarOperational: boolean;
  sonarOperational: boolean;
  cicOperational: boolean;
  nightFightingBonus: number;
  airSearchBonus: number;
  surfaceSearchBonus: number;
  crewQuality: 'poor' | 'average' | 'veteran' | 'elite';
}

export function createDefaultSensorProfile(shipClass: string): ShipSensorProfile {
  switch (shipClass) {
    case 'fleet_carrier':
      return {
        visualRange: 25,
        surfaceRadarRange: 30,
        airSearchRadarRange: 150,
        sonarRange: 5,
        radarOperational: true,
        sonarOperational: false,
        cicOperational: true,
        nightFightingBonus: 0,
        airSearchBonus: 15,
        surfaceSearchBonus: 5,
        crewQuality: 'veteran',
      };
    case 'light_carrier':
      return {
        visualRange: 22,
        surfaceRadarRange: 25,
        airSearchRadarRange: 120,
        sonarRange: 4,
        radarOperational: true,
        sonarOperational: false,
        cicOperational: true,
        nightFightingBonus: 0,
        airSearchBonus: 10,
        surfaceSearchBonus: 3,
        crewQuality: 'veteran',
      };
    case 'escort_carrier':
      return {
        visualRange: 18,
        surfaceRadarRange: 20,
        airSearchRadarRange: 80,
        sonarRange: 4,
        radarOperational: true,
        sonarOperational: false,
        cicOperational: false,
        nightFightingBonus: 0,
        airSearchBonus: 5,
        surfaceSearchBonus: 2,
        crewQuality: 'average',
      };
    case 'battleship':
      return {
        visualRange: 28,
        surfaceRadarRange: 35,
        airSearchRadarRange: 100,
        sonarRange: 3,
        radarOperational: true,
        sonarOperational: false,
        cicOperational: true,
        nightFightingBonus: 5,
        airSearchBonus: 5,
        surfaceSearchBonus: 10,
        crewQuality: 'veteran',
      };
    case 'heavy_cruiser':
      return {
        visualRange: 24,
        surfaceRadarRange: 30,
        airSearchRadarRange: 80,
        sonarRange: 5,
        radarOperational: true,
        sonarOperational: true,
        cicOperational: true,
        nightFightingBonus: 3,
        airSearchBonus: 3,
        surfaceSearchBonus: 5,
        crewQuality: 'veteran',
      };
    case 'light_cruiser':
      return {
        visualRange: 22,
        surfaceRadarRange: 25,
        airSearchRadarRange: 70,
        sonarRange: 6,
        radarOperational: true,
        sonarOperational: true,
        cicOperational: true,
        nightFightingBonus: 2,
        airSearchBonus: 2,
        surfaceSearchBonus: 4,
        crewQuality: 'veteran',
      };
    case 'destroyer':
      return {
        visualRange: 18,
        surfaceRadarRange: 20,
        airSearchRadarRange: 50,
        sonarRange: 10,
        radarOperational: true,
        sonarOperational: true,
        cicOperational: true,
        nightFightingBonus: 2,
        airSearchBonus: 2,
        surfaceSearchBonus: 3,
        crewQuality: 'average',
      };
    case 'submarine':
      return {
        visualRange: 5,
        surfaceRadarRange: 8,
        airSearchRadarRange: 0,
        sonarRange: 20,
        radarOperational: true,
        sonarOperational: true,
        cicOperational: false,
        nightFightingBonus: 0,
        airSearchBonus: 0,
        surfaceSearchBonus: 0,
        crewQuality: 'veteran',
      };
    case 'transport':
    case 'oiler':
      return {
        visualRange: 12,
        surfaceRadarRange: 10,
        airSearchRadarRange: 30,
        sonarRange: 2,
        radarOperational: false,
        sonarOperational: false,
        cicOperational: false,
        nightFightingBonus: 0,
        airSearchBonus: 0,
        surfaceSearchBonus: 0,
        crewQuality: 'average',
      };
    case 'landing_ship':
    default:
      return {
        visualRange: 10,
        surfaceRadarRange: 8,
        airSearchRadarRange: 25,
        sonarRange: 2,
        radarOperational: false,
        sonarOperational: false,
        cicOperational: false,
        nightFightingBonus: 0,
        airSearchBonus: 0,
        surfaceSearchBonus: 0,
        crewQuality: 'average',
      };
  }
}
