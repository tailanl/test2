/**
 * Information Filter - 从真实世界状态构建阵营情报，再压缩为 LLM 可读上下文
 */

import type { FactionId, FactionKnowledgeState } from '../game/naval/intel/faction-knowledge-types';
import type { NavalIntelState, NavalContact } from '../game/naval/intel/naval-intel-types';
import type { StrategicFleet } from '../game/naval/naval-strategic-types';
import type { NavalShip } from '../game/naval/ship/ship-types';
import type { NavalAIReport } from '../game/naval/ai/naval-ai-types';
import type { PacificBase } from '../game/naval/campaign/campaign-types';
import type { SupplyLine } from '../game/naval/campaign/campaign-types';
import type { PacificWarPhaseId } from '../game/naval/campaign/campaign-types';
import type { LLMDecisionContext } from './llm-decision-types';
import { getFleetCombatProfile, getShipCombatProfile } from '../game/naval/ship/ship-combat-profile';

// ========== buildFactionKnowledge ==========

export function buildFactionKnowledge(params: {
  faction: FactionId;
  truth: {
    turn: number;
    playerFleets: StrategicFleet[];
    enemyFleets: StrategicFleet[];
    allBases: PacificBase[];
    allSupplyLines: SupplyLine[];
    weather: string;
  };
  intel: NavalIntelState;
  reports: NavalAIReport[];
  memory?: any;
  currentTurn: number;
}): FactionKnowledgeState {
  const { faction, truth, intel, reports, memory, currentTurn } = params;

  const isOwn = (f: StrategicFleet) => (faction === 'player' && f.faction === 'player') || (faction === 'enemy' && f.faction === 'enemy');
  const ownFleets = (faction === 'player' ? truth.playerFleets : truth.enemyFleets);

  const knownOwnFleets = ownFleets.map(f => {
    const carrierAir = summarizeCarrierAir(f);
    const combatProfile = getFleetCombatProfile(f);
    return {
      fleetId: f.id, name: f.name, type: f.type,
      position: { x: f.position.globalX, y: f.position.globalY },
      readiness: determineFleetReadiness(f),
      damageSummary: summarizeDamage(f),
      fuelState: f.fuelState, ammoState: f.ammoState, aircraftState: f.airGroupState,
      currentMission: f.mission,
      shipCount: f.ships.length,
      damagedShipCount: f.ships.filter(s => s.damage.status !== 'combat_effective').length,
      carrierAir,
      combatProfile,
      operation: f.operation,
      navigation: f.navigation,
      automation: f.command?.automation,
      ships: f.ships.map(s => ({
        shipId: s.id, name: s.name, shipClass: s.shipClass,
        position: { x: s.position.x, y: s.position.y },
        headingDeg: s.headingDeg, speedKts: s.speedKts,
        damageStatus: s.damage.status, flooding: s.damage.flooding, fire: s.damage.fire, hullIntegrity: s.damage.hullIntegrity,
        aircraft: s.aircraft ? `F${s.aircraft.fighters}/DB${s.aircraft.diveBombers}/TB${s.aircraft.torpedoBombers}/READY${s.aircraft.readyAircraft}` : undefined,
        readyAircraft: s.aircraft?.readyAircraft,
        fighters: s.aircraft?.fighters,
        diveBombers: s.aircraft?.diveBombers,
        torpedoBombers: s.aircraft?.torpedoBombers,
        deckCycleState: s.aircraft?.deckCycleState,
        sensors: `RDR:${s.sensors.radarOperational ? 'ON' : 'OFF'} SON:${s.sensors.sonarOperational ? 'ON' : 'OFF'}`,
        combatProfile: getShipCombatProfile(s),
      })),
    };
  });

  const knownOwnShips = ownFleets.flatMap(f => f.ships).map(s => ({
    shipId: s.id, name: s.name, shipClass: s.shipClass,
    position: { x: s.position.x, y: s.position.y },
    headingDeg: s.headingDeg, speedKts: s.speedKts,
    damageStatus: s.damage.status, flooding: s.damage.flooding, fire: s.damage.fire, hullIntegrity: s.damage.hullIntegrity,
    aircraft: s.aircraft ? `F${s.aircraft.fighters}/DB${s.aircraft.diveBombers}/TB${s.aircraft.torpedoBombers}/READY${s.aircraft.readyAircraft}` : undefined,
    readyAircraft: s.aircraft?.readyAircraft,
    fighters: s.aircraft?.fighters,
    diveBombers: s.aircraft?.diveBombers,
    torpedoBombers: s.aircraft?.torpedoBombers,
    deckCycleState: s.aircraft?.deckCycleState,
    sensors: `RDR:${s.sensors.radarOperational ? 'ON' : 'OFF'}`,
    combatProfile: getShipCombatProfile(s),
  }));

  // Contacts: ONLY from intel, NEVER from real enemy fleets
  const knownContacts: NavalContact[] = faction === 'player' ? intel.playerContacts : intel.enemyContacts;

  const knownBases = truth.allBases.filter(b => isOwnFaction(b.owner, faction)).map(b => ({
    baseId: b.id, name: b.name, owner: b.owner, type: b.type,
    position: { x: (b as any).x ?? 0, y: (b as any).y ?? 0 }, level: b.level, knownDamage: b.damage,
    supplyKnown: b.isolated ? 'isolated' : 'normal',
  }));

  const knownSupplyLines = truth.allSupplyLines.filter(s => s.owner === faction).map(s => ({
    supplyLineId: s.id, from: s.fromBaseId, to: s.toBaseId,
    status: s.status, riskEstimate: s.status === 'open' ? 'low' as const : s.status === 'contested' ? 'medium' as const : 'high' as const,
  }));

  return {
    faction, turn: currentTurn,
    knownOwnFleets, knownOwnShips, knownContacts,
    knownBases, knownSupplyLines,
    knownAirMissions: [],
    recentReports: reports.slice(-10),
    recentBattleEvents: [],
    assumptions: [],
    memory,
  };
}

function isOwnFaction(owner: string, faction: FactionId): boolean {
  return (faction === 'player' && owner === 'player') || (faction === 'enemy' && owner === 'enemy');
}

// ========== sanitizeKnowledgeForLLM ==========

export function sanitizeKnowledgeForLLM(knowledge: FactionKnowledgeState, phase?: string): LLMDecisionContext {
  const posture = determinePosture(knowledge);
  const objectives = deriveObjectives(knowledge);
  const legalHints = generateLegalActionHints(knowledge);

  return {
    faction: knowledge.faction,
    turn: knowledge.turn,
    currentPhase: phase as any,
    strategicSituation: { posture, currentObjectives: objectives, riskTolerance: 'medium' },
    ownForces: knowledge.knownOwnFleets.map(f => ({
      fleetId: f.fleetId, name: f.name, type: f.type,
      position: f.position, readiness: f.readiness, damageSummary: f.damageSummary,
      fuelState: f.fuelState, ammoState: f.ammoState, aircraftState: f.aircraftState, currentMission: f.currentMission,
      shipCount: f.shipCount,
      damagedShipCount: f.damagedShipCount,
      carrierAir: f.carrierAir,
      combatProfile: f.combatProfile ? {
        readiness: f.combatProfile.readiness,
        firepower: f.combatProfile.firepower,
        modules: f.combatProfile.modules,
      } : undefined,
      operation: f.operation ? {
        posture: f.operation.posture,
        startedTurn: f.operation.startedTurn,
        durationTurns: f.operation.durationTurns,
        targetContactId: f.operation.targetContactId,
        targetBaseId: f.operation.targetBaseId,
        targetPosition: f.operation.targetPosition,
        description: f.operation.description,
        expectedEffect: f.operation.expectedEffect,
      } : undefined,
      navigation: f.navigation ? {
        status: f.navigation.status,
        mode: f.navigation.mode,
        routeSource: f.navigation.routeSource,
        destination: f.navigation.destination,
        manualWaypoints: f.navigation.manualWaypoints,
        nextWaypoint: f.navigation.path[f.navigation.pathIndex],
        etaTurns: f.navigation.etaTurns,
        totalDistance: f.navigation.totalDistance,
        routeRisk: f.navigation.routeRisk,
        riskScore: f.navigation.riskScore,
        currentLegNote: f.navigation.currentLegNote,
        remainingWaypoints: Math.max(0, f.navigation.path.length - f.navigation.pathIndex),
      } : undefined,
      automation: f.automation ? {
        priorities: f.automation.priorities,
        lastTask: f.automation.lastTask,
        lastTaskTurn: f.automation.lastTaskTurn,
      } : undefined,
    })),
    knownContacts: knowledge.knownContacts.map(c => ({
      contactId: c.id, contactType: c.contactType,
      detectionLevel: c.detectionLevel, confidence: c.confidence,
      estimatedClass: (c.estimatedClass as string) || 'unknown', estimatedCount: c.estimatedCount,
      lastKnownPosition: c.lastKnownPosition, uncertaintyRadius: c.uncertaintyRadius,
      lastDetectedTurn: c.lastDetectedTurn, detectedBy: c.detectedBy.map(d => d.sensorType),
    })),
    knownBases: knowledge.knownBases.map(b => ({
      baseId: b.baseId, name: b.name, owner: b.owner, type: b.type, position: b.position,
      level: b.level, knownDamage: b.knownDamage, supplyKnown: b.supplyKnown,
    })),
    knownSupplyLines: knowledge.knownSupplyLines.map(s => ({
      supplyLineId: s.supplyLineId, from: s.from, to: s.to, status: s.status, riskEstimate: s.riskEstimate,
    })),
    recentReports: knowledge.recentReports.map(r => ({
      turn: r.turn, type: r.type, summary: r.summary, facts: r.facts, estimates: r.estimates,
    })),
    memorySummary: {
      previousPlan: knowledge.memory?.plans?.[knowledge.memory.plans.length - 1]?.intendedAction,
      previousOutcome: knowledge.memory?.plans?.[knowledge.memory.plans.length - 1]?.actualResult,
      recurringProblems: knowledge.memory?.recurringProblems || [],
      enemyPatternEstimates: knowledge.memory?.enemyPatternEstimates || [],
    },
    legalActionHints: legalHints,
  };
}

function summarizeCarrierAir(fleet: StrategicFleet) {
  const totals = fleet.ships.reduce((acc, ship) => {
    if (!ship.aircraft || ship.aircraft.deckCycleState === 'deck_damaged') return acc;
    acc.readyAircraft += ship.aircraft.readyAircraft;
    acc.fighters += ship.aircraft.fighters;
    acc.diveBombers += ship.aircraft.diveBombers;
    acc.torpedoBombers += ship.aircraft.torpedoBombers;
    acc.deckCycleState = acc.deckCycleState || ship.aircraft.deckCycleState;
    return acc;
  }, {
    readyAircraft: 0,
    fighters: 0,
    diveBombers: 0,
    torpedoBombers: 0,
    deckCycleState: undefined as string | undefined,
  });

  const strikeAircraft = totals.diveBombers + totals.torpedoBombers;
  return {
    ...totals,
    maxSearchAircraft: Math.min(totals.readyAircraft, totals.fighters + totals.diveBombers),
    maxCapFighters: Math.min(totals.readyAircraft, totals.fighters),
    maxStrikeAircraft: Math.min(totals.readyAircraft, strikeAircraft),
  };
}

function determineFleetReadiness(fleet: StrategicFleet): string {
  if ((fleet as any).repairStatus === 'repairing') return 'repairing';
  if (fleet.fuelState === 'critical' || fleet.ammoState === 'critical') return 'exhausted';
  if (fleet.fuelState === 'limited' || fleet.ammoState === 'limited') return 'limited';
  if (fleet.ships.some(s => s.damage.status === 'sinking' || s.damage.status === 'sunk' || s.damage.hullIntegrity < 35)) return 'limited';
  return 'ready';
}

function summarizeDamage(fleet: StrategicFleet): string {
  if (fleet.ships.some(s => s.damage.status === 'sinking' || s.damage.status === 'sunk' || s.damage.hullIntegrity < 30)) return 'severe';
  if (fleet.ships.some(s => s.damage.status !== 'combat_effective')) return 'damaged';
  return 'intact';
}

function determinePosture(knowledge: FactionKnowledgeState): LLMDecisionContext['strategicSituation']['posture'] {
  const hasContacts = knowledge.knownContacts.length > 0;
  const hasTracked = knowledge.knownContacts.some(c => c.detectionLevel === 'tracked' || c.detectionLevel === 'identified');
  const hasDamaged = knowledge.knownOwnShips.some(s => s.damageStatus !== 'combat_effective');
  if (hasDamaged) return 'withdraw';
  if (hasTracked) return 'offensive';
  if (hasContacts) return 'search';
  return 'search';
}

function deriveObjectives(knowledge: FactionKnowledgeState): string[] {
  const objs: string[] = [];
  if (knowledge.knownContacts.length === 0) objs.push('locate enemy fleet');
  if (knowledge.knownContacts.some(c => c.detectionLevel === 'tracked' || c.detectionLevel === 'identified')) objs.push('engage tracked contacts');
  if (knowledge.knownOwnShips.some(s => s.damageStatus !== 'combat_effective')) objs.push('protect damaged ships');
  if (knowledge.knownSupplyLines.some(s => s.status === 'cut')) objs.push('restore supply lines');
  return objs.length > 0 ? objs : ['patrol'];
}

function generateLegalActionHints(knowledge: FactionKnowledgeState): string[] {
  const hints: string[] = [];
  const hasContacts = knowledge.knownContacts.length > 0;
  const hasTracked = knowledge.knownContacts.some(c => c.detectionLevel === 'tracked' || c.detectionLevel === 'identified' || c.detectionLevel === 'classified');
  const hasSuspected = knowledge.knownContacts.some(c => c.detectionLevel === 'suspected' || c.detectionLevel === 'detected');
  const hasDamaged = knowledge.knownOwnFleets.some(f => f.damageSummary !== 'intact');

  hints.push('launch_search');
  hints.push('hold_position');
  hints.push('radio_silence');
  hints.push('lay_smoke');
  if (hasSuspected) { hints.push('shadow_contact'); hints.push('launch_search_toward_contact'); }
  const hasCarrierAir = knowledge.knownOwnFleets.some(f => (f.carrierAir?.readyAircraft ?? 0) > 0);
  const hasSurfaceFire = knowledge.knownOwnFleets.some(f => (f.combatProfile?.firepower.antiSurface ?? 0) > 0);
  const hasTorpedoes = knowledge.knownOwnFleets.some(f => (f.combatProfile?.firepower.torpedo ?? 0) > 0);
  const hasTransport = knowledge.knownOwnFleets.some(f => f.type === 'transport_convoy' || f.type === 'amphibious_group' || f.type === 'supply_group');
  if (hasCarrierAir) { hints.push('prepare_strike'); hints.push('recover_aircraft'); hints.push('vector_cap'); }
  if (hasTracked) { hints.push('launch_strike'); hints.push('intercept_contact'); hints.push('surface_engage'); }
  if (hasTracked && hasTorpedoes) hints.push('launch_torpedo_attack');
  if (hasSurfaceFire) hints.push('bombard_airfield');
  if (hasTransport) { hints.push('run_transport'); hints.push('replenish_at_sea'); }
  if (hasDamaged) { hints.push('repair_fleet'); hints.push('withdraw_fleet'); }
  hints.push('protect_supply_line');
  return hints;
}
