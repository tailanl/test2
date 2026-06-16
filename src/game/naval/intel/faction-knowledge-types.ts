/**
 * Faction Knowledge Types - 阵营已知情报状态
 * LLM 的唯一输入来源
 */

import type { NavalContact } from '../intel/naval-intel-types';
import type { NavalAIReport } from '../ai/naval-ai-types';
import type { FleetCombatProfile, ShipCombatProfile } from '../ship/ship-combat-profile';

export type FactionId = 'player' | 'enemy';

export interface KnownOwnFleet {
  fleetId: string;
  name: string;
  type: string;
  position: { x: number; y: number };
  readiness: string;
  damageSummary: string;
  fuelState: 'good' | 'limited' | 'critical';
  ammoState: 'good' | 'limited' | 'critical';
  aircraftState?: string;
  currentMission?: string;
  shipCount?: number;
  damagedShipCount?: number;
  carrierAir?: {
    readyAircraft: number;
    fighters: number;
    diveBombers: number;
    torpedoBombers: number;
    maxSearchAircraft: number;
    maxCapFighters: number;
    maxStrikeAircraft: number;
    deckCycleState?: string;
  };
  combatProfile?: FleetCombatProfile;
  ships: KnownOwnShip[];
}

export interface KnownOwnShip {
  shipId: string;
  name: string;
  shipClass: string;
  position: { x: number; y: number };
  headingDeg: number;
  speedKts: number;
  damageStatus: string;
  flooding: number;
  fire: number;
  hullIntegrity: number;
  aircraft?: string;
  readyAircraft?: number;
  fighters?: number;
  diveBombers?: number;
  torpedoBombers?: number;
  deckCycleState?: string;
  sensors: string;
  combatProfile?: ShipCombatProfile;
}

export interface KnownBase {
  baseId: string;
  name: string;
  owner: string;
  type: string;
  level?: number;
  position: { x: number; y: number };
  knownDamage?: number;
  supplyKnown?: string;
}

export interface KnownSupplyLine {
  supplyLineId: string;
  from: string;
  to: string;
  status: 'open' | 'contested' | 'interdicted' | 'cut';
  riskEstimate: 'low' | 'medium' | 'high';
}

export interface KnownAirMission {
  id: string;
  type: string;
  status: string;
  aircraft: number;
  position: { x: number; y: number };
  heading: number;
}

export interface KnownBattleEvent {
  turn: number;
  type: string;
  description: string;
  ownShipInvolved?: string;
}

export interface IntelligenceAssumption {
  topic: string;
  assumption: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface FactionKnowledgeState {
  faction: FactionId;
  turn: number;
  knownOwnFleets: KnownOwnFleet[];
  knownOwnShips: KnownOwnShip[];
  knownContacts: NavalContact[];
  knownBases: KnownBase[];
  knownSupplyLines: KnownSupplyLine[];
  knownAirMissions: KnownAirMission[];
  recentReports: NavalAIReport[];
  recentBattleEvents: KnownBattleEvent[];
  assumptions: IntelligenceAssumption[];
  memory?: any; // CampaignMemory
}
