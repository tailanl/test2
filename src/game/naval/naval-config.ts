/**
 * 海军配置 - 舰队模板、舰船参数
 */

// ===== 舰队模板 =====

export const NAVAL_FLEET_TEMPLATES: Record<string, Record<string, [number, number]>> = {
  carrier_task_force: {
    carriers: [1, 4],
    cruisers: [2, 6],
    destroyers: [6, 16],
    oilers: [0, 1],
  },
  surface_action_group: {
    battleships: [0, 4],
    cruisers: [1, 6],
    destroyers: [4, 12],
  },
  transport_convoy: {
    transports: [4, 20],
    escorts: [2, 8],
    cruisers: [0, 2],
  },
  amphibious_group: {
    transports: [4, 16],
    landingShips: [4, 20],
    fireSupportShips: [1, 6],
    escorts: [4, 12],
  },
  submarine_group: {
    submarines: [1, 6],
  },
  patrol_group: {
    destroyers: [1, 4],
  },
  supply_group: {
    oilers: [1, 4],
    escorts: [1, 3],
  },
};

// ===== 舰船基础参数 =====

export interface ShipClassConfig {
  class: string;
  maxSpeedKts: number;
  accelerationKtsPerTurn: number;
  decelerationKtsPerTurn: number;
  maxRudderDeg: number;
  baseTurnRateDegPerTurn: number;
  stoppingDistanceTurns: number;
  visualRange: number;
  surfaceRadarRange: number;
  airSearchRadarRange: number;
  sonarRange: number;
  surfaceSignature: number;
  radarSignature: number;
  smokeSignature: number;
  acousticSignature: number;
  moduleConfig: {
    hullCompartments: number;
    mainBatteries: number;
    secondaryBatteries: number;
    aaBatteries: number;
    torpedoTubes: number;
    hasFlightDeck: boolean;
    hasHangar: boolean;
    hasCatapult: boolean;
    hasElevator: boolean;
    hasSonar: boolean;
  };
  airGroup?: {
    fighters: number;
    diveBombers: number;
    torpedoBombers: number;
  };
}

export const SHIP_CLASS_CONFIGS: Record<string, ShipClassConfig> = {
  fleet_carrier: {
    class: 'fleet_carrier',
    maxSpeedKts: 33,
    accelerationKtsPerTurn: 2,
    decelerationKtsPerTurn: 3,
    maxRudderDeg: 35,
    baseTurnRateDegPerTurn: 3,
    stoppingDistanceTurns: 25,
    visualRange: 25,
    surfaceRadarRange: 30,
    airSearchRadarRange: 150,
    sonarRange: 5,
    surfaceSignature: 90,
    radarSignature: 95,
    smokeSignature: 40,
    acousticSignature: 70,
    moduleConfig: {
      hullCompartments: 8,
      mainBatteries: 0,
      secondaryBatteries: 2,
      aaBatteries: 12,
      torpedoTubes: 0,
      hasFlightDeck: true,
      hasHangar: true,
      hasCatapult: true,
      hasElevator: true,
      hasSonar: false,
    },
    airGroup: {
      fighters: 36,
      diveBombers: 36,
      torpedoBombers: 18,
    },
  },
  light_carrier: {
    class: 'light_carrier',
    maxSpeedKts: 31,
    accelerationKtsPerTurn: 2,
    decelerationKtsPerTurn: 3,
    maxRudderDeg: 35,
    baseTurnRateDegPerTurn: 3,
    stoppingDistanceTurns: 20,
    visualRange: 22,
    surfaceRadarRange: 25,
    airSearchRadarRange: 120,
    sonarRange: 4,
    surfaceSignature: 75,
    radarSignature: 85,
    smokeSignature: 35,
    acousticSignature: 60,
    moduleConfig: {
      hullCompartments: 6,
      mainBatteries: 0,
      secondaryBatteries: 1,
      aaBatteries: 8,
      torpedoTubes: 0,
      hasFlightDeck: true,
      hasHangar: true,
      hasCatapult: true,
      hasElevator: true,
      hasSonar: false,
    },
    airGroup: {
      fighters: 18,
      diveBombers: 12,
      torpedoBombers: 9,
    },
  },
  escort_carrier: {
    class: 'escort_carrier',
    maxSpeedKts: 19,
    accelerationKtsPerTurn: 1,
    decelerationKtsPerTurn: 2,
    maxRudderDeg: 35,
    baseTurnRateDegPerTurn: 2,
    stoppingDistanceTurns: 15,
    visualRange: 18,
    surfaceRadarRange: 20,
    airSearchRadarRange: 80,
    sonarRange: 4,
    surfaceSignature: 60,
    radarSignature: 70,
    smokeSignature: 30,
    acousticSignature: 55,
    moduleConfig: {
      hullCompartments: 4,
      mainBatteries: 0,
      secondaryBatteries: 1,
      aaBatteries: 6,
      torpedoTubes: 0,
      hasFlightDeck: true,
      hasHangar: true,
      hasCatapult: true,
      hasElevator: false,
      hasSonar: false,
    },
    airGroup: {
      fighters: 12,
      diveBombers: 0,
      torpedoBombers: 6,
    },
  },
  battleship: {
    class: 'battleship',
    maxSpeedKts: 28,
    accelerationKtsPerTurn: 1,
    decelerationKtsPerTurn: 2,
    maxRudderDeg: 35,
    baseTurnRateDegPerTurn: 4,
    stoppingDistanceTurns: 20,
    visualRange: 28,
    surfaceRadarRange: 35,
    airSearchRadarRange: 100,
    sonarRange: 3,
    surfaceSignature: 95,
    radarSignature: 98,
    smokeSignature: 60,
    acousticSignature: 75,
    moduleConfig: {
      hullCompartments: 10,
      mainBatteries: 3,
      secondaryBatteries: 4,
      aaBatteries: 10,
      torpedoTubes: 0,
      hasFlightDeck: false,
      hasHangar: false,
      hasCatapult: false,
      hasElevator: false,
      hasSonar: false,
    },
  },
  heavy_cruiser: {
    class: 'heavy_cruiser',
    maxSpeedKts: 32,
    accelerationKtsPerTurn: 2,
    decelerationKtsPerTurn: 3,
    maxRudderDeg: 35,
    baseTurnRateDegPerTurn: 5,
    stoppingDistanceTurns: 15,
    visualRange: 24,
    surfaceRadarRange: 30,
    airSearchRadarRange: 80,
    sonarRange: 5,
    surfaceSignature: 70,
    radarSignature: 75,
    smokeSignature: 35,
    acousticSignature: 65,
    moduleConfig: {
      hullCompartments: 6,
      mainBatteries: 2,
      secondaryBatteries: 3,
      aaBatteries: 8,
      torpedoTubes: 2,
      hasFlightDeck: false,
      hasHangar: false,
      hasCatapult: false,
      hasElevator: false,
      hasSonar: true,
    },
  },
  light_cruiser: {
    class: 'light_cruiser',
    maxSpeedKts: 33,
    accelerationKtsPerTurn: 2,
    decelerationKtsPerTurn: 3,
    maxRudderDeg: 35,
    baseTurnRateDegPerTurn: 6,
    stoppingDistanceTurns: 12,
    visualRange: 22,
    surfaceRadarRange: 25,
    airSearchRadarRange: 70,
    sonarRange: 6,
    surfaceSignature: 55,
    radarSignature: 60,
    smokeSignature: 30,
    acousticSignature: 60,
    moduleConfig: {
      hullCompartments: 5,
      mainBatteries: 1,
      secondaryBatteries: 2,
      aaBatteries: 6,
      torpedoTubes: 2,
      hasFlightDeck: false,
      hasHangar: false,
      hasCatapult: false,
      hasElevator: false,
      hasSonar: true,
    },
  },
  destroyer: {
    class: 'destroyer',
    maxSpeedKts: 35,
    accelerationKtsPerTurn: 3,
    decelerationKtsPerTurn: 4,
    maxRudderDeg: 35,
    baseTurnRateDegPerTurn: 8,
    stoppingDistanceTurns: 8,
    visualRange: 18,
    surfaceRadarRange: 20,
    airSearchRadarRange: 50,
    sonarRange: 10,
    surfaceSignature: 35,
    radarSignature: 40,
    smokeSignature: 20,
    acousticSignature: 55,
    moduleConfig: {
      hullCompartments: 3,
      mainBatteries: 1,
      secondaryBatteries: 1,
      aaBatteries: 4,
      torpedoTubes: 2,
      hasFlightDeck: false,
      hasHangar: false,
      hasCatapult: false,
      hasElevator: false,
      hasSonar: true,
    },
  },
  submarine: {
    class: 'submarine',
    maxSpeedKts: 20,
    accelerationKtsPerTurn: 1,
    decelerationKtsPerTurn: 2,
    maxRudderDeg: 35,
    baseTurnRateDegPerTurn: 4,
    stoppingDistanceTurns: 10,
    visualRange: 5,
    surfaceRadarRange: 8,
    airSearchRadarRange: 0,
    sonarRange: 20,
    surfaceSignature: 20,
    radarSignature: 15,
    smokeSignature: 5,
    acousticSignature: 80,
    moduleConfig: {
      hullCompartments: 3,
      mainBatteries: 0,
      secondaryBatteries: 1,
      aaBatteries: 1,
      torpedoTubes: 4,
      hasFlightDeck: false,
      hasHangar: false,
      hasCatapult: false,
      hasElevator: false,
      hasSonar: true,
    },
  },
  transport: {
    class: 'transport',
    maxSpeedKts: 16,
    accelerationKtsPerTurn: 1,
    decelerationKtsPerTurn: 1,
    maxRudderDeg: 35,
    baseTurnRateDegPerTurn: 2,
    stoppingDistanceTurns: 12,
    visualRange: 12,
    surfaceRadarRange: 10,
    airSearchRadarRange: 30,
    sonarRange: 2,
    surfaceSignature: 70,
    radarSignature: 75,
    smokeSignature: 50,
    acousticSignature: 70,
    moduleConfig: {
      hullCompartments: 5,
      mainBatteries: 0,
      secondaryBatteries: 0,
      aaBatteries: 2,
      torpedoTubes: 0,
      hasFlightDeck: false,
      hasHangar: false,
      hasCatapult: false,
      hasElevator: false,
      hasSonar: false,
    },
  },
  oiler: {
    class: 'oiler',
    maxSpeedKts: 15,
    accelerationKtsPerTurn: 1,
    decelerationKtsPerTurn: 1,
    maxRudderDeg: 35,
    baseTurnRateDegPerTurn: 2,
    stoppingDistanceTurns: 14,
    visualRange: 10,
    surfaceRadarRange: 10,
    airSearchRadarRange: 30,
    sonarRange: 1,
    surfaceSignature: 65,
    radarSignature: 70,
    smokeSignature: 40,
    acousticSignature: 65,
    moduleConfig: {
      hullCompartments: 4,
      mainBatteries: 0,
      secondaryBatteries: 0,
      aaBatteries: 1,
      torpedoTubes: 0,
      hasFlightDeck: false,
      hasHangar: false,
      hasCatapult: false,
      hasElevator: false,
      hasSonar: false,
    },
  },
  landing_ship: {
    class: 'landing_ship',
    maxSpeedKts: 12,
    accelerationKtsPerTurn: 1,
    decelerationKtsPerTurn: 1,
    maxRudderDeg: 35,
    baseTurnRateDegPerTurn: 2,
    stoppingDistanceTurns: 10,
    visualRange: 10,
    surfaceRadarRange: 8,
    airSearchRadarRange: 25,
    sonarRange: 2,
    surfaceSignature: 60,
    radarSignature: 65,
    smokeSignature: 30,
    acousticSignature: 60,
    moduleConfig: {
      hullCompartments: 4,
      mainBatteries: 0,
      secondaryBatteries: 0,
      aaBatteries: 2,
      torpedoTubes: 0,
      hasFlightDeck: false,
      hasHangar: false,
      hasCatapult: false,
      hasElevator: false,
      hasSonar: false,
    },
  },
};

// ===== 海军战斗环境配置 =====

export const NAVAL_WEATHER_MODIFIERS: Record<string, { visibility: number; aircraft: number; radar: number; sonar: number }> = {
  clear: { visibility: 1.0, aircraft: 1.0, radar: 1.0, sonar: 1.0 },
  rain: { visibility: 0.6, aircraft: 0.7, radar: 0.9, sonar: 0.95 },
  squall: { visibility: 0.3, aircraft: 0.3, radar: 0.7, sonar: 0.9 },
  fog: { visibility: 0.15, aircraft: 0.1, radar: 0.8, sonar: 0.95 },
  storm: { visibility: 0.05, aircraft: 0.0, radar: 0.5, sonar: 0.7 },
};

export const NAVAL_SEA_STATE_MODIFIERS: Record<number, { speed: number; sonar: number; aircraft: number; gunnery: number }> = {
  0: { speed: 1.0, sonar: 1.0, aircraft: 1.0, gunnery: 1.0 },
  1: { speed: 1.0, sonar: 0.95, aircraft: 1.0, gunnery: 0.98 },
  2: { speed: 0.95, sonar: 0.9, aircraft: 0.95, gunnery: 0.95 },
  3: { speed: 0.9, sonar: 0.8, aircraft: 0.85, gunnery: 0.88 },
  4: { speed: 0.8, sonar: 0.65, aircraft: 0.7, gunnery: 0.75 },
  5: { speed: 0.6, sonar: 0.5, aircraft: 0.4, gunnery: 0.5 },
  6: { speed: 0.4, sonar: 0.3, aircraft: 0.1, gunnery: 0.3 },
};

export const NAVAL_TIME_OF_DAY_MODIFIERS: Record<string, { visual: number; aircraft: number }> = {
  day: { visual: 1.0, aircraft: 1.0 },
  dusk: { visual: 0.5, aircraft: 0.7 },
  night: { visual: 0.1, aircraft: 0.3 },
};
