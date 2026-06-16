/**
 * AI Turn Pipeline
 * buildKnowledge -> sanitize -> LLM -> validate -> execute -> memory/report
 */

import { buildFactionKnowledge, sanitizeKnowledgeForLLM } from './information-filter';
import { requestLLMCommanderDecisionWithTrace } from './llm-commander-provider';
import { validateLLMCommanderDecision } from './llm-decision-validator';
import {
  executeLLMDecisionActions,
  type AIExecutionReport,
  type LLMDecisionStoreCalls,
} from './llm-decision-executor';
import { updateCampaignMemory, type CampaignMemory } from './campaign-memory';
import { generateSearchPlan } from './search-planner';
import { assessThreat } from './threat-assessment';
import { getDoctrineForPhase } from './naval-doctrine';
import { requestGLMVisualAssessment, shouldRunGLMVisualAssessment, bearingAndDist } from './glm-provider';
import { getGLMKey } from './api-key';
import { GLM_DEFAULTS } from './glm-config';
import { createDefaultReport, type NavalAIReport, type NavalReportType } from '../game/naval/ai/naval-ai-types';
import { createCAPMission, createSearchMission, createStrikeMission } from '../game/naval/ship/ship-aircraft';
import type { LLMDecisionAction, LLMDecisionContext, LLMCommanderDecision, LLMDecisionFramework, LLMAvailableDecisionOption } from './llm-decision-types';
import { createTraceId, isLLMDecisionProviderResult, type LLMDecisionProviderResult, type LLMOutputTrace } from './llm-output-trace';
import type { FactionKnowledgeState } from '../game/naval/intel/faction-knowledge-types';
import type { StrategicFleet, NavalFleetMission, CommanderIntent } from '../game/naval/naval-strategic-types';
import type { NavalBattleLogEvent } from '../game/naval/ship/ship-damage';

export interface AIStateDiff {
  before: AIStateSnapshot;
  after: AIStateSnapshot;
  affectedFleetIds: string[];
  affectedContactIds: string[];
  changes: string[];
  logMessages: string[];
}

export interface AIStateSnapshot {
  turn: number;
  date?: string;
  fleets: Record<string, {
    mission: string;
    position: { x: number; y: number };
    targetPosition?: { x: number; y: number };
    aircraftReady: number;
    damage: string;
    fuelState?: string;
    ammoState?: string;
    repairStatus?: string;
  }>;
  searchMissionCount: number;
  airOperationCount: number;
  reportCount: number;
  battleLogCount: number;
}

export interface AITurnExecutionReport {
  turn: number;
  date?: string;
  acceptedActions: LLMDecisionAction[];
  rejectedActions: Array<{ action: LLMDecisionAction; reason: string }>;
  executedActions: AIExecutionReport['executed'];
  failedActions: AIExecutionReport['failed'];
  affectedFleetIds: string[];
  affectedContactIds: string[];
  stateDiff: AIStateDiff;
  logMessages: string[];
  decisionProcess?: {
    situationAssessment?: LLMCommanderDecision['situationAssessment'];
    missionAnalysis?: LLMCommanderDecision['missionAnalysis'];
    availableDecisionReview?: LLMCommanderDecision['availableDecisionReview'];
    courseOfActionAnalysis?: LLMCommanderDecision['courseOfActionAnalysis'];
    selectedDecisionRationale?: string;
  };
}

export interface AITurnPipelineResult {
  knowledge: FactionKnowledgeState;
  context: LLMDecisionContext;
  decision: LLMCommanderDecision | null;
  validation: ReturnType<typeof validateLLMCommanderDecision> | null;
  execution: AIExecutionReport | null;
  executionReport: AITurnExecutionReport | null;
  stateDiff: AIStateDiff | null;
  llmTraces: LLMOutputTrace[];
  memory: CampaignMemory;
}

export async function runAITurnPipeline(params: {
  faction: 'player' | 'enemy';
  mode: 'advisor' | 'commander';
  state: any;
  memory: CampaignMemory;
  decisionProvider?: (context: LLMDecisionContext) => Promise<LLMCommanderDecision | LLMDecisionProviderResult | null> | LLMCommanderDecision | LLMDecisionProviderResult | null;
  llmTraceSink?: (trace: LLMOutputTrace) => Promise<void> | void;
  skipVisualAssessment?: boolean;
  fleetId?: string;
}): Promise<AITurnPipelineResult> {
  const { faction, mode, state, memory } = params;
  const current = readState(state);

  const truth = {
    turn: current.currentTurn,
    playerFleets: current.fleets?.filter((f: any) => f.faction === 'player') || [],
    enemyFleets: current.fleets?.filter((f: any) => f.faction === 'enemy') || [],
    allBases: normalizeBasesForKnowledge(current.bases || current.facilities || []),
    allSupplyLines: current.supplyLines || current.shippingLanes || [],
    weather: current.weather || 'clear',
  };

  const knowledge = buildFactionKnowledge({
    faction,
    truth,
    intel: current.intel,
    reports: current.reports || [],
    currentTurn: current.currentTurn,
    memory,
  });

  const context = sanitizeKnowledgeForLLM(knowledge, current.currentPhase);
  if (params.fleetId) {
    context.ownForces = context.ownForces.filter((fleet) => fleet.fleetId === params.fleetId);
    if (context.ownForces.length === 0) {
      context.legalActionHints.push(`blocked:fleet ${params.fleetId} not in sanitized own forces`);
    }
  }
  enrichContext(context, current);
  const llmTraces: LLMOutputTrace[] = [];
  const recordTrace = async (trace?: LLMOutputTrace) => {
    if (!trace) return;
    llmTraces.push(trace);
    await params.llmTraceSink?.(trace);
  };

  if (!params.skipVisualAssessment) {
    await recordTrace(await maybeAttachVisualAssessment(context, current, faction));
  }

  let decision: LLMCommanderDecision | null = null;
  let validation: ReturnType<typeof validateLLMCommanderDecision> | null = null;
  let execution: AIExecutionReport | null = null;
  let executionReport: AITurnExecutionReport | null = null;
  let stateDiff: AIStateDiff | null = null;
  const before = snapshotAIState(readState(state));

  try {
    if (params.decisionProvider) {
      const provided = await params.decisionProvider(context);
      if (isLLMDecisionProviderResult(provided)) {
        decision = provided.decision;
        await recordTrace(provided.trace);
      } else {
        decision = provided;
        await recordTrace(createSyntheticDecisionTrace({
          context,
          role: mode === 'commander' ? 'enemy_commander' : 'player_advisor',
          decision,
          provider: 'custom',
          model: 'decisionProvider',
        }));
      }
    } else {
      const result = await requestLLMCommanderDecisionWithTrace({ context, role: mode === 'commander' ? 'enemy_commander' : 'player_advisor' });
      decision = result.decision;
      await recordTrace(result.trace);
    }
  } catch (error) {
    decision = null;
    await recordTrace(createSyntheticDecisionTrace({
      context,
      role: mode === 'commander' ? 'enemy_commander' : 'player_advisor',
      decision: null,
      provider: 'pipeline',
      model: 'decisionProvider',
      requestError: error instanceof Error ? error.message : String(error),
    }));
  }

  if (decision) {
    validation = validateLLMCommanderDecision({ decision, context, knowledge });

    if (mode === 'commander' && validation.acceptedActions.length > 0) {
      const storeCalls = createRealStoreCalls({ state, faction, currentTurn: current.currentTurn });
      execution = executeLLMDecisionActions({
        actions: validation.acceptedActions,
        storeCalls,
        currentTurn: current.currentTurn,
      });
    }
  }

  const after = snapshotAIState(readState(state));
  stateDiff = createStateDiff({
    before,
    after,
    validation,
    execution,
    state: readState(state),
  });

  if (decision && validation) {
    executionReport = {
      turn: current.currentTurn,
      date: current.date,
      acceptedActions: validation.acceptedActions,
      rejectedActions: validation.rejectedActions,
      executedActions: execution?.executed || [],
      failedActions: execution?.failed || [],
      affectedFleetIds: stateDiff.affectedFleetIds,
      affectedContactIds: stateDiff.affectedContactIds,
      stateDiff,
      logMessages: stateDiff.logMessages,
      decisionProcess: {
        situationAssessment: decision.situationAssessment,
        missionAnalysis: decision.missionAnalysis,
        availableDecisionReview: decision.availableDecisionReview,
        courseOfActionAnalysis: decision.courseOfActionAnalysis,
        selectedDecisionRationale: decision.selectedDecisionRationale,
      },
    };
  }

  const updatedMemory = decision
    ? updateCampaignMemory({
        memory,
        previousDecision: decision,
        acceptedActions: validation?.acceptedActions.map((a) => a.type) || [],
        rejectedActions: validation?.rejectedActions.map((a) => a.reason) || [],
        reportsAfterTurn: readState(state).reports || [],
        turn: current.currentTurn,
      })
    : memory;

  return { knowledge, context, decision, validation, execution, executionReport, stateDiff, llmTraces, memory: updatedMemory };
}

function enrichContext(context: LLMDecisionContext, state: any): void {
  const searchPlan = generateSearchPlan({
    contacts: context.knownContacts.map(c => ({
      detectionLevel: c.detectionLevel,
      lastKnownPosition: c.lastKnownPosition,
      uncertaintyRadius: c.uncertaintyRadius,
    })),
    ownPosition: context.ownForces[0]?.position || { x: 0, y: 0 },
    lastContactTurn: Math.max(...context.knownContacts.map(c => c.lastDetectedTurn), 0),
    currentTurn: state.currentTurn,
  });
  context.legalActionHints.push(...searchPlan.sectors.map(s => `search_${s.heading}deg@P${s.priority}`));

  const threat = assessThreat({
    contacts: context.knownContacts.map(c => ({ detectionLevel: c.detectionLevel, estimatedClass: c.estimatedClass, confidence: c.confidence })),
    ownDamage: state.fleets?.flatMap((f: any) => f.ships.map((s: any) => ({
      flooding: s.damage?.flooding || 0,
      fire: s.damage?.fire || 0,
      hullIntegrity: s.damage?.hullIntegrity || 100,
    }))) || [],
    supplyStatus: state.fleets?.map((f: any) => ({ fuelState: f.fuelState || 'good', ammoState: f.ammoState || 'good' })) || [],
    weather: state.weather || 'clear',
  });
  if (threat.overallThreat === 'high' || threat.overallThreat === 'critical') {
    context.strategicSituation.riskTolerance = 'low';
  }

  const doctrine = getDoctrineForPhase(state.currentPhase || '');
  context.legalActionHints.push(`doctrine:${doctrine.type}`);
  context.decisionFramework = createDecisionFramework({ context, state, searchPlan, threat });
}

function createDecisionFramework(params: {
  context: LLMDecisionContext;
  state: any;
  searchPlan: ReturnType<typeof generateSearchPlan>;
  threat: ReturnType<typeof assessThreat>;
}): LLMDecisionFramework {
  const { context, state, searchPlan, threat } = params;
  const ownFleet = context.ownForces[0];
  const tracked = context.knownContacts.filter(c => ['tracked', 'identified', 'classified', 'confirmed'].includes(c.detectionLevel));
  const weakContacts = context.knownContacts.filter(c => ['suspected', 'detected', 'unknown'].includes(c.detectionLevel));
  const nearestContact = ownFleet ? nearestKnownContact(context, ownFleet.position) : undefined;
  const nearestBase = ownFleet ? nearestKnownBase(context, ownFleet.position) : undefined;
  const constraints = [
    'use sanitized known information only',
    context.knownContacts.length === 0 ? 'no known enemy contact' : '',
    tracked.length === 0 ? 'no strike-legal tracked/identified/classified contact' : '',
    ownFleet?.damageSummary && ownFleet.damageSummary !== 'intact' ? `fleet damage ${ownFleet.damageSummary}` : '',
    ownFleet?.carrierAir?.readyAircraft === 0 ? 'no ready carrier aircraft' : '',
    state.weather && state.weather !== 'clear' ? `weather ${state.weather}` : '',
  ].filter(Boolean);

  return {
    mission: {
      primaryTask: context.strategicSituation.currentObjectives[0] || context.strategicSituation.posture,
      secondaryTasks: context.strategicSituation.currentObjectives.slice(1),
      constraints,
      riskTolerance: context.strategicSituation.riskTolerance,
    },
    situation: {
      enemy: context.knownContacts.length === 0
        ? 'No enemy contact is known; enemy position must remain unknown.'
        : `${context.knownContacts.length} known contacts; ${tracked.length} strike-legal; ${weakContacts.length} low-confidence.`,
      friendly: `${context.knownBases.length} friendly bases, ${context.knownSupplyLines.length} known supply lines, recent reports ${context.recentReports.length}.`,
      self: ownFleet
        ? `${ownFleet.name} mission ${ownFleet.currentMission || 'unknown'}, readiness ${ownFleet.readiness}, damage ${ownFleet.damageSummary}, fuel ${ownFleet.fuelState}, ammo ${ownFleet.ammoState}, ready aircraft ${ownFleet.carrierAir?.readyAircraft ?? 0}, firepower AA ${ownFleet.combatProfile?.firepower.antiAir ?? 0}/surface ${ownFleet.combatProfile?.firepower.antiSurface ?? 0}/torpedo ${ownFleet.combatProfile?.firepower.torpedo ?? 0}/strike ${ownFleet.combatProfile?.firepower.aviationStrike ?? 0}.`
        : 'No own fleet available.',
      battlefield: `Weather ${state.weather || 'unknown'}; threat ${threat.overallThreat}; search plan ${searchPlan.rationale}; nearest contact ${nearestContact?.contactId || 'none'}; nearest base ${nearestBase?.baseId || 'none'}.`,
    },
    availableOptions: buildAvailableOptions({ context, searchPlan, threat, nearestBase }),
  };
}

function buildAvailableOptions(params: {
  context: LLMDecisionContext;
  searchPlan: ReturnType<typeof generateSearchPlan>;
  threat: ReturnType<typeof assessThreat>;
  nearestBase?: LLMDecisionContext['knownBases'][number];
}): LLMAvailableDecisionOption[] {
  const { context, searchPlan, threat, nearestBase } = params;
  const options: LLMAvailableDecisionOption[] = [];
  const fleet = context.ownForces[0];
  if (!fleet) return options;
  const air = fleet.carrierAir;
  const firstSector = searchPlan.sectors[0];

  if ((air?.maxSearchAircraft ?? 0) > 0 && firstSector) {
    options.push({
      actionType: 'launch_search',
      fleetId: fleet.fleetId,
      method: `air search heading ${Math.round(firstSector.heading)} width ${firstSector.widthDeg}`,
      maxQuantity: Math.min(6, air?.maxSearchAircraft ?? 0),
      estimatedSuccess: estimateSearchSuccess(context, threat),
      constraints: ['requires ready aircraft', 'will not identify hidden fleets automatically'],
      reason: firstSector.reason,
    });
  }

  if ((air?.maxCapFighters ?? 0) > 0) {
    options.push({
      actionType: 'launch_cap',
      fleetId: fleet.fleetId,
      method: 'fighter CAP over own task force',
      maxQuantity: Math.min(6, air?.maxCapFighters ?? 0),
      estimatedSuccess: threat.air.level === 'high' ? 'medium' : 'high',
      constraints: ['requires ready fighters'],
      reason: 'Protect carrier force against air threat or uncertainty.',
    });
  }

  for (const contact of context.knownContacts) {
    const strikeLegal = ['tracked', 'identified', 'classified', 'confirmed'].includes(contact.detectionLevel);
    options.push({
      actionType: strikeLegal ? 'launch_strike' : 'shadow_contact',
      fleetId: fleet.fleetId,
      targetId: contact.contactId,
      method: strikeLegal ? 'carrier strike package' : 'shadow and refine contact',
      maxQuantity: strikeLegal ? Math.min(18, air?.maxStrikeAircraft ?? 0) : undefined,
      estimatedSuccess: strikeLegal ? estimateStrikeSuccess(contact, fleet, threat) : 'medium',
      constraints: strikeLegal ? ['requires tracked/identified/classified contact', 'requires strike aircraft'] : ['do not strike low-confidence contact'],
      reason: `${contact.detectionLevel} contact ${contact.contactId} at uncertainty ${contact.uncertaintyRadius}.`,
    });
  }

  options.push({
    actionType: 'hold_position',
    fleetId: fleet.fleetId,
    method: 'hold current position and preserve readiness',
    estimatedSuccess: 'high',
    constraints: [],
    reason: 'Useful when action risk exceeds information value.',
  });

  if (nearestBase && (fleet.damageSummary !== 'intact' || fleet.readiness === 'repairing')) {
    options.push({
      actionType: 'repair_fleet',
      fleetId: fleet.fleetId,
      targetId: nearestBase.baseId,
      method: `repair at ${nearestBase.name}`,
      estimatedSuccess: 'medium',
      constraints: ['requires known friendly base and proximity or withdrawal posture'],
      reason: `Nearest known base is ${nearestBase.name}.`,
    });
  }

  if (fleet.damageSummary !== 'intact' || threat.overallThreat === 'critical') {
    options.push({
      actionType: 'withdraw_fleet',
      fleetId: fleet.fleetId,
      targetId: nearestBase?.baseId,
      method: nearestBase ? `withdraw toward ${nearestBase.name}` : 'withdraw away from threat',
      estimatedSuccess: 'medium',
      constraints: ['cedes initiative'],
      reason: 'Preserve damaged or overmatched force.',
    });
  }

  return options.slice(0, 8);
}

function estimateSearchSuccess(context: LLMDecisionContext, threat: ReturnType<typeof assessThreat>): 'low' | 'medium' | 'high' {
  if (threat.overallThreat === 'critical') return 'low';
  if (context.knownContacts.some(c => c.detectionLevel === 'detected' || c.detectionLevel === 'suspected')) return 'medium';
  return 'medium';
}

function estimateStrikeSuccess(
  contact: LLMDecisionContext['knownContacts'][number],
  fleet: LLMDecisionContext['ownForces'][number],
  threat: ReturnType<typeof assessThreat>
): 'low' | 'medium' | 'high' {
  if ((fleet.carrierAir?.maxStrikeAircraft ?? 0) <= 0 || fleet.damageSummary !== 'intact') return 'low';
  if (contact.uncertaintyRadius <= 15 && contact.confidence === 'high' && threat.air.level !== 'high') return 'high';
  if (contact.uncertaintyRadius <= 40) return 'medium';
  return 'low';
}

function nearestKnownContact(context: LLMDecisionContext, position: { x: number; y: number }) {
  if (context.knownContacts.length === 0) return undefined;
  return context.knownContacts.reduce((best, current) => {
    const bestDist = Math.hypot(best.lastKnownPosition.x - position.x, best.lastKnownPosition.y - position.y);
    const currentDist = Math.hypot(current.lastKnownPosition.x - position.x, current.lastKnownPosition.y - position.y);
    return currentDist < bestDist ? current : best;
  });
}

function nearestKnownBase(context: LLMDecisionContext, position: { x: number; y: number }) {
  const bases = context.knownBases.filter(base => base.position);
  if (bases.length === 0) return undefined;
  return bases.reduce((best, current) => {
    const bestDist = Math.hypot((best.position?.x ?? 0) - position.x, (best.position?.y ?? 0) - position.y);
    const currentDist = Math.hypot((current.position?.x ?? 0) - position.x, (current.position?.y ?? 0) - position.y);
    return currentDist < bestDist ? current : best;
  });
}

function normalizeBasesForKnowledge(bases: any[]): any[] {
  return bases.map((base) => ({
    ...base,
    owner: base.owner || base.faction,
    level: base.level ?? (base.type === 'naval_base' ? 3 : base.type === 'airfield' ? 2 : 1),
    damage: base.damage ?? 0,
    isolated: base.isolated ?? false,
  }));
}

async function maybeAttachVisualAssessment(context: LLMDecisionContext, state: any, faction: 'player' | 'enemy'): Promise<LLMOutputTrace | undefined> {
  const shouldRunGLM = shouldRunGLMVisualAssessment({
    strategy: GLM_DEFAULTS.strategy,
    turn: state.currentTurn,
    newContactThisTurn: context.knownContacts.some(c => c.lastDetectedTurn === state.currentTurn),
    contactUpgraded: context.knownContacts.some(c => c.detectionLevel === 'classified' || c.detectionLevel === 'identified' || c.detectionLevel === 'tracked'),
    carrierDamaged: (state.fleets?.find((f: any) => f.faction === faction)?.ships || []).some((s: any) => s.shipClass?.includes('carrier') && s.damage?.status !== 'combat_effective'),
    strikePlanned: false,
    manualRequest: false,
  });
  if (!shouldRunGLM) return undefined;

  const started = Date.now();
  const ownPos = context.ownForces[0];
  const textualCtx = context.knownContacts.map(c => {
    const bd = bearingAndDist(ownPos?.position?.x || 0, ownPos?.position?.y || 0, c.lastKnownPosition.x, c.lastKnownPosition.y);
    return `[${c.detectionLevel}] ${c.estimatedClass || '?'} bearing:${bd.bearing}(${bd.bearingLabel}) distance:${bd.dist}`;
  }).join('\n');
  const textualContext = `Own fleet:${ownPos?.name || 'Fleet'} (${ownPos?.position?.x},${ownPos?.position?.y}) weather:${state.weather || 'clear'}\n${textualCtx}`;
  const finish = (partial: Partial<LLMOutputTrace>): LLMOutputTrace => {
    const ended = Date.now();
    return {
      id: createTraceId('glm_visual', context.turn),
      source: 'visual_assessment',
      provider: 'z.ai',
      model: partial.model || GLM_DEFAULTS.flashModel,
      role: 'visual_assessor',
      faction,
      turn: context.turn,
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(ended).toISOString(),
      durationMs: ended - started,
      prompt: { user: textualContext },
      rawOutput: partial.rawOutput ?? null,
      parsedOutput: partial.parsedOutput,
      requestError: partial.requestError,
      metadata: partial.metadata,
    };
  };

  try {
    const glmResult = await requestGLMVisualAssessment({
      config: { apiKey: getGLMKey() },
      textualContext,
    });
    if (glmResult.success) {
      context.visualAssessment = {
        assessment: glmResult.assessment,
        bearingSummary: glmResult.bearingSummary,
        threatRanking: glmResult.threatRanking,
        recommendation: glmResult.recommendation,
        model: glmResult.model,
      };
    }
    return finish({
      model: glmResult.model,
      rawOutput: glmResult.rawText,
      parsedOutput: {
        success: glmResult.success,
        assessment: glmResult.assessment,
        bearingSummary: glmResult.bearingSummary,
        threatRanking: glmResult.threatRanking,
        recommendation: glmResult.recommendation,
      },
      requestError: glmResult.success ? undefined : glmResult.recommendation,
    });
  } catch (error) {
    return finish({ requestError: error instanceof Error ? error.message : String(error) });
  }
}

function createSyntheticDecisionTrace(params: {
  context: LLMDecisionContext;
  role: 'player_advisor' | 'enemy_commander';
  decision: LLMCommanderDecision | null;
  provider: string;
  model: string;
  requestError?: string;
}): LLMOutputTrace {
  const now = new Date().toISOString();
  const rawOutput = params.decision ? JSON.stringify(params.decision, null, 2) : null;
  return {
    id: createTraceId('synthetic_commander', params.context.turn),
    source: 'commander_decision',
    provider: params.provider,
    model: params.model,
    role: params.role,
    faction: params.context.faction,
    turn: params.context.turn,
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    rawOutput,
    parsedDecision: params.decision,
    requestError: params.requestError,
    metadata: {
      synthetic: true,
      ownForces: params.context.ownForces.length,
      knownContacts: params.context.knownContacts.length,
    },
  };
}

export function createRealStoreCalls(params: { state: any; faction: 'player' | 'enemy'; currentTurn: number }): LLMDecisionStoreCalls {
  const { state, faction, currentTurn } = params;

  const updateFleet = (action: LLMDecisionAction, updater: (fleet: StrategicFleet, draft: any) => string): string => {
    if (!action.fleetId) throw new Error(`${action.type} missing fleetId`);
    const draft = cloneGameMutationSlice(readState(state));
    const fleet = draft.fleets?.find((f: StrategicFleet) => f.id === action.fleetId && f.faction === faction);
    if (!fleet) throw new Error(`Fleet ${action.fleetId} not found for ${faction}`);
    const result = updater(fleet, draft);
    writeState(state, draft);
    return result;
  };

  return {
    assignMission: (action) => updateFleet(action, (fleet, draft) => {
      const mission = normalizeMission(action.mission || intentToMission(action.reason) || fleet.mission);
      fleet.mission = mission;
      setFleetCommand(fleet, missionToIntent(mission), orderId(currentTurn, action));
      addLogAndReport(draft, currentTurn, 'REQUEST_AUTHORIZATION', fleet, action, `Assigned mission ${mission}`);
      return `Mission assigned: ${mission}`;
    }),

    moveFleet: (action) => updateFleet(action, (fleet, draft) => {
      if (!action.targetPosition) throw new Error('move_fleet missing targetPosition');
      const heading = bearing(fleet.position.globalX, fleet.position.globalY, action.targetPosition.x, action.targetPosition.y);
      fleet.mission = action.mission ? normalizeMission(action.mission) : fleet.mission;
      (fleet as any).targetPosition = { ...action.targetPosition };
      setFleetCommand(fleet, 'search', orderId(currentTurn, action));
      for (const ship of fleet.ships) {
        ship.headingDeg = heading;
        ship.targetSpeedKts = action.speedKts ?? ship.targetSpeedKts;
      }
      addLogAndReport(draft, currentTurn, 'REQUEST_AUTHORIZATION', fleet, action, `Move ordered to (${action.targetPosition.x},${action.targetPosition.y}) heading ${heading}`);
      return `Move ordered to (${action.targetPosition.x},${action.targetPosition.y})`;
    }),

    launchSearch: (action) => updateFleet(action, (fleet, draft) => {
      const ship = carrierWithAircraft(fleet);
      if (!ship?.aircraft) throw new Error(`Fleet ${fleet.name} has no available aircraft for search`);
      const targetArea = resolveSearchArea(action, fleet, draft);
      const centerDeg = action.searchArcDeg?.centerDeg ?? action.headingDeg ?? bearing(fleet.position.globalX, fleet.position.globalY, targetArea.x, targetArea.y);
      const result = createSearchMission({
        shipId: ship.id,
        airGroup: ship.aircraft,
        targetArea,
        searchArcDeg: {
          centerDeg: normalizeHeading(centerDeg),
          widthDeg: action.searchArcDeg?.widthDeg ?? 120,
          range: action.searchArcDeg?.range ?? targetArea.radius,
        },
        aircraftCount: action.aircraftCount ?? 4,
      });
      ship.aircraft = result.airGroup;
      fleet.airGroupState = result.airGroup.readyAircraft > 0 ? 'recovering' : 'depleted';
      fleet.mission = 'search';
      draft.intel.searchMissions = [...(draft.intel.searchMissions || []), result.mission];
      addAirOperation(draft, result.mission.id, 'search', targetArea.x, targetArea.y, centerDeg, fleet.name, result.mission.aircraftCount);
      addLogAndReport(draft, currentTurn, 'AIR_SEARCH_REPORT', fleet, action, `Search launched toward (${targetArea.x},${targetArea.y})`);
      return `Search launched toward (${targetArea.x},${targetArea.y})`;
    }),

    launchCap: (action) => updateFleet(action, (fleet, draft) => {
      const ship = carrierWithAircraft(fleet);
      if (!ship?.aircraft) throw new Error(`Fleet ${fleet.name} has no available fighters for CAP`);
      const result = createCAPMission({ shipId: ship.id, airGroup: ship.aircraft, fighterCount: action.aircraftCount ?? 4 });
      result.mission.targetArea = {
        x: action.targetPosition?.x ?? fleet.position.globalX,
        y: action.targetPosition?.y ?? fleet.position.globalY,
        radius: action.searchArea?.radius ?? 30,
      };
      ship.aircraft = result.airGroup;
      fleet.airGroupState = result.airGroup.readyAircraft > 0 ? 'recovering' : 'depleted';
      draft.intel.searchMissions = [...(draft.intel.searchMissions || []), result.mission];
      addAirOperation(draft, result.mission.id, 'cap', result.mission.targetArea.x, result.mission.targetArea.y, ship.headingDeg, fleet.name, result.mission.aircraftCount);
      addLogAndReport(draft, currentTurn, 'CAP_REPORT', fleet, action, `CAP launched over (${result.mission.targetArea.x},${result.mission.targetArea.y})`);
      return 'CAP launched';
    }),

    launchStrike: (action) => updateFleet(action, (fleet, draft) => {
      if (!action.contactId) throw new Error('launch_strike missing contactId');
      const contact = findContact(draft, faction, action.contactId);
      if (!contact) throw new Error(`Contact ${action.contactId} not found`);
      const ship = carrierWithAircraft(fleet);
      if (!ship?.aircraft) throw new Error(`Fleet ${fleet.name} has no available aircraft for strike`);
      const result = createStrikeMission({
        shipId: ship.id,
        airGroup: ship.aircraft,
        targetContactId: contact.id,
        targetArea: { x: contact.lastKnownPosition.x, y: contact.lastKnownPosition.y, radius: 12 },
        aircraftCount: action.aircraftCount ?? 12,
      });
      ship.aircraft = result.airGroup;
      fleet.airGroupState = result.airGroup.readyAircraft > 0 ? 'recovering' : 'depleted';
      fleet.mission = 'carrier_strike';
      draft.intel.searchMissions = [...(draft.intel.searchMissions || []), result.mission];
      addAirOperation(draft, result.mission.id, 'strike', contact.lastKnownPosition.x, contact.lastKnownPosition.y, bearing(fleet.position.globalX, fleet.position.globalY, contact.lastKnownPosition.x, contact.lastKnownPosition.y), fleet.name, result.mission.aircraftCount);
      addLogAndReport(draft, currentTurn, 'STRIKE_REPORT', fleet, action, `Strike launched against contact ${contact.id}`);
      return `Strike launched against ${contact.id}`;
    }),

    withdrawFleet: (action) => updateFleet(action, (fleet, draft) => {
      const target = action.targetPosition || nearestFriendlyBase(draft, faction, fleet) || { x: Math.max(0, fleet.position.globalX - 160), y: fleet.position.globalY };
      fleet.mission = 'withdraw';
      (fleet as any).targetPosition = target;
      setFleetCommand(fleet, 'withdraw', orderId(currentTurn, action));
      const heading = bearing(fleet.position.globalX, fleet.position.globalY, target.x, target.y);
      for (const ship of fleet.ships) {
        ship.headingDeg = heading;
        ship.targetSpeedKts = ship.motion?.maxSpeedKts ? Math.round(ship.motion.maxSpeedKts * 0.8) : ship.targetSpeedKts;
      }
      addLogAndReport(draft, currentTurn, 'WITHDRAWAL_REPORT', fleet, action, `Withdrawing toward (${target.x},${target.y})`);
      return `Withdrawing toward (${target.x},${target.y})`;
    }),

    holdPosition: (action) => updateFleet(action, (fleet, draft) => {
      (fleet as any).targetPosition = { x: fleet.position.globalX, y: fleet.position.globalY };
      setFleetCommand(fleet, 'hold_sea_area', orderId(currentTurn, action));
      addLogAndReport(draft, currentTurn, 'REQUEST_AUTHORIZATION', fleet, action, 'Holding current position');
      return 'Holding current position';
    }),

    repairFleet: (action) => updateFleet(action, (fleet, draft) => {
      if (!action.baseId) throw new Error('repair_fleet missing baseId');
      const base = (draft.facilities || draft.bases || []).find((b: any) => b.id === action.baseId || `la_${b.id}` === action.baseId);
      if (base) {
        const distance = Math.hypot((base.x ?? 0) - fleet.position.globalX, (base.y ?? 0) - fleet.position.globalY);
        if (distance > 120 && fleet.mission !== 'withdraw' && fleet.mission !== 'resupply') {
          throw new Error(`Fleet ${fleet.name} is too far from base ${action.baseId} for repair`);
        }
      }
      fleet.mission = 'resupply';
      fleet.airGroupState = fleet.airGroupState === 'depleted' ? 'recovering' : fleet.airGroupState;
      (fleet as any).repairStatus = 'repairing';
      setFleetCommand(fleet, 'withdraw', orderId(currentTurn, action));
      addLogAndReport(draft, currentTurn, 'DAMAGE_REPORT', fleet, action, `Repair ordered at ${action.baseId}`);
      return `Repair ordered at ${action.baseId}`;
    }),

    protectBase: (action) => updateFleet(action, (fleet, draft) => {
      fleet.mission = 'escort';
      setFleetCommand(fleet, 'escort', orderId(currentTurn, action));
      addLogAndReport(draft, currentTurn, 'REQUEST_AUTHORIZATION', fleet, action, `Protecting base ${action.baseId}`);
      return `Protecting base ${action.baseId}`;
    }),

    protectSupplyLine: (action) => updateFleet(action, (fleet, draft) => {
      fleet.mission = 'escort';
      setFleetCommand(fleet, 'escort', orderId(currentTurn, action));
      addLogAndReport(draft, currentTurn, 'REQUEST_AUTHORIZATION', fleet, action, `Protecting supply line ${action.supplyLineId}`);
      return `Protecting supply line ${action.supplyLineId}`;
    }),

    shadowContact: (action) => updateFleet(action, (fleet, draft) => {
      if (!action.contactId) throw new Error('shadow_contact missing contactId');
      const contact = findContact(draft, faction, action.contactId);
      if (!contact) throw new Error(`Contact ${action.contactId} not found`);
      fleet.mission = 'search';
      (fleet as any).targetPosition = { ...contact.lastKnownPosition };
      setFleetCommand(fleet, 'search', orderId(currentTurn, action));
      addLogAndReport(draft, currentTurn, 'CONTACT_REPORT', fleet, action, `Shadowing contact ${contact.id}`);
      return `Shadowing ${contact.id}`;
    }),

    interceptContact: (action) => updateFleet(action, (fleet, draft) => {
      if (!action.contactId) throw new Error('intercept_contact missing contactId');
      const contact = findContact(draft, faction, action.contactId);
      if (!contact) throw new Error(`Contact ${action.contactId} not found`);
      fleet.mission = 'intercept';
      (fleet as any).targetPosition = { ...contact.lastKnownPosition };
      setFleetCommand(fleet, 'intercept', orderId(currentTurn, action));
      const heading = bearing(fleet.position.globalX, fleet.position.globalY, contact.lastKnownPosition.x, contact.lastKnownPosition.y);
      fleet.ships.forEach((ship: any) => { ship.headingDeg = heading; });
      addLogAndReport(draft, currentTurn, 'CONTACT_REPORT', fleet, action, `Intercepting contact ${contact.id}`);
      return `Intercepting ${contact.id}`;
    }),

    supportLanding: (action) => updateFleet(action, (fleet, draft) => {
      fleet.mission = 'invasion_support';
      setFleetCommand(fleet, 'support_landing', orderId(currentTurn, action));
      addLogAndReport(draft, currentTurn, 'REQUEST_AUTHORIZATION', fleet, action, `Supporting landing at ${action.baseId}`);
      return `Supporting landing at ${action.baseId}`;
    }),
  };
}

function readState(state: any): any {
  return typeof state.getState === 'function' ? state.getState() : state;
}

function writeState(root: any, draft: any): void {
  if (typeof root.setState === 'function') {
    root.setState(draft);
  } else {
    Object.keys(root).forEach((key) => delete root[key]);
    Object.assign(root, draft);
  }
}

function cloneState(state: any): any {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(state);
    } catch {
      // Zustand states include action functions; JSON clone keeps serializable game state.
    }
  }
  return JSON.parse(JSON.stringify(state));
}

function cloneGameMutationSlice(state: any): any {
  return {
    currentTurn: state.currentTurn,
    date: state.date,
    currentPhase: state.currentPhase,
    weather: state.weather,
    fleets: cloneState(state.fleets || []),
    intel: cloneState(state.intel || {}),
    reports: cloneState(state.reports || []),
    battleLog: cloneState(state.battleLog || []),
    airOperations: cloneState(state.airOperations || []),
    facilities: cloneState(state.facilities || []),
    bases: cloneState(state.bases || []),
    supplyLines: cloneState(state.supplyLines || []),
    shippingLanes: cloneState(state.shippingLanes || []),
  };
}

function snapshotAIState(state: any): AIStateSnapshot {
  const fleets: AIStateSnapshot['fleets'] = {};
  for (const fleet of state.fleets || []) {
    fleets[fleet.id] = {
      mission: fleet.mission,
      position: { x: fleet.position.globalX, y: fleet.position.globalY },
      targetPosition: (fleet as any).targetPosition,
      aircraftReady: fleet.ships?.reduce((sum: number, ship: any) => sum + (ship.aircraft?.readyAircraft || 0), 0) || 0,
      damage: fleet.ships?.map((s: any) => s.damage?.status || 'unknown').join(',') || 'unknown',
      fuelState: fleet.fuelState,
      ammoState: fleet.ammoState,
      repairStatus: (fleet as any).repairStatus,
    };
  }
  return {
    turn: state.currentTurn || 0,
    date: state.date,
    fleets,
    searchMissionCount: state.intel?.searchMissions?.length || 0,
    airOperationCount: state.airOperations?.length || 0,
    reportCount: state.reports?.length || 0,
    battleLogCount: state.battleLog?.length || 0,
  };
}

function createStateDiff(params: {
  before: AIStateSnapshot;
  after: AIStateSnapshot;
  validation: ReturnType<typeof validateLLMCommanderDecision> | null;
  execution: AIExecutionReport | null;
  state: any;
}): AIStateDiff {
  const { before, after, validation, execution, state } = params;
  const changes: string[] = [];
  for (const [fleetId, beforeFleet] of Object.entries(before.fleets)) {
    const afterFleet = after.fleets[fleetId];
    if (!afterFleet) continue;
    if (beforeFleet.mission !== afterFleet.mission) changes.push(`${fleetId} mission ${beforeFleet.mission} -> ${afterFleet.mission}`);
    if (JSON.stringify(beforeFleet.targetPosition) !== JSON.stringify(afterFleet.targetPosition)) changes.push(`${fleetId} target ${JSON.stringify(beforeFleet.targetPosition)} -> ${JSON.stringify(afterFleet.targetPosition)}`);
    if (beforeFleet.aircraftReady !== afterFleet.aircraftReady) changes.push(`${fleetId} aircraftReady ${beforeFleet.aircraftReady} -> ${afterFleet.aircraftReady}`);
    if (beforeFleet.repairStatus !== afterFleet.repairStatus) changes.push(`${fleetId} repair ${beforeFleet.repairStatus || 'none'} -> ${afterFleet.repairStatus || 'none'}`);
  }
  if (before.searchMissionCount !== after.searchMissionCount) changes.push(`searchMissions ${before.searchMissionCount} -> ${after.searchMissionCount}`);
  if (before.airOperationCount !== after.airOperationCount) changes.push(`airOperations ${before.airOperationCount} -> ${after.airOperationCount}`);
  if (before.reportCount !== after.reportCount) changes.push(`reports ${before.reportCount} -> ${after.reportCount}`);
  if (before.battleLogCount !== after.battleLogCount) changes.push(`battleLog ${before.battleLogCount} -> ${after.battleLogCount}`);

  const accepted = validation?.acceptedActions || [];
  const rejected = validation?.rejectedActions || [];
  const affectedFleetIds = unique([
    ...accepted.map(a => a.fleetId).filter(Boolean) as string[],
    ...(execution?.executed.flatMap(e => e.affectedFleetIds) || []),
    ...(execution?.failed.flatMap(e => e.affectedFleetIds) || []),
  ]);
  const affectedContactIds = unique([
    ...accepted.map(a => a.contactId).filter(Boolean) as string[],
    ...(execution?.executed.flatMap(e => e.affectedContactIds) || []),
    ...(execution?.failed.flatMap(e => e.affectedContactIds) || []),
  ]);
  const stateLogs = (state.battleLog || []).slice(before.battleLogCount).map((event: any) => event.description);
  return {
    before,
    after,
    affectedFleetIds,
    affectedContactIds,
    changes,
    logMessages: [
      ...(execution?.logMessages || []),
      ...rejected.map(r => `REJECTED ${r.action.type}: ${r.reason}`),
      ...stateLogs,
    ],
  };
}

function addLogAndReport(draft: any, turn: number, reportType: NavalReportType, fleet: StrategicFleet, action: LLMDecisionAction, summary: string): void {
  const event: NavalBattleLogEvent = {
    id: `llm_${turn}_${draft.battleLog?.length || 0}_${action.type}`,
    turn,
    type: `llm_${action.type}`,
    description: `${fleet.name}: ${summary}${action.reason ? ` (${action.reason})` : ''}`,
    shipId: fleet.ships[0]?.id,
    targetId: action.contactId,
  };
  draft.battleLog = [...(draft.battleLog || []), event];
  const report = createDefaultReport(reportType, turn, `LLM ${action.type}`, summary) as NavalAIReport;
  report.fromFleetId = fleet.id;
  report.facts = [summary];
  report.estimates = action.reason ? [action.reason] : [];
  report.rawLogIds = [event.id];
  if (action.contactId) {
    const contact = findContact(draft, fleet.faction === 'enemy' ? 'enemy' : 'player', action.contactId);
    if (contact) {
      report.contacts = [{
        contactId: contact.id,
        detectionLevel: contact.detectionLevel,
        confidence: contact.confidence,
        lastKnownPosition: contact.lastKnownPosition,
        uncertaintyRadius: contact.uncertaintyRadius,
      }];
    }
  }
  draft.reports = [...(draft.reports || []), report];
}

function addAirOperation(draft: any, id: string, type: 'search' | 'strike' | 'cap', x: number, y: number, heading: number, fleetName: string, aircraft: number): void {
  draft.airOperations = [...(draft.airOperations || []), {
    id,
    type,
    x,
    y,
    heading: normalizeHeading(heading),
    fleetName,
    status: 'launched',
    aircraft,
  }];
}

function resolveSearchArea(action: LLMDecisionAction, fleet: StrategicFleet, draft: any): { x: number; y: number; radius: number } {
  if (action.searchArea) return { x: action.searchArea.x, y: action.searchArea.y, radius: action.searchArea.radius ?? action.searchArcDeg?.range ?? 80 };
  if (action.targetPosition) return { x: action.targetPosition.x, y: action.targetPosition.y, radius: action.searchArcDeg?.range ?? 80 };
  if (action.contactId) {
    const contact = findContact(draft, fleet.faction === 'enemy' ? 'enemy' : 'player', action.contactId);
    if (contact) return { x: contact.lastKnownPosition.x, y: contact.lastKnownPosition.y, radius: Math.max(40, contact.uncertaintyRadius) };
  }
  const heading = normalizeHeading(action.searchArcDeg?.centerDeg ?? action.headingDeg ?? fleet.ships[0]?.headingDeg ?? 0);
  const range = action.searchArcDeg?.range ?? 160;
  const rad = heading * Math.PI / 180;
  return {
    x: Math.round(fleet.position.globalX + Math.sin(rad) * range),
    y: Math.round(fleet.position.globalY - Math.cos(rad) * range),
    radius: range,
  };
}

function carrierWithAircraft(fleet: StrategicFleet): any {
  return fleet.ships.find((ship: any) =>
    ship.aircraft &&
    ship.aircraft.deckCycleState !== 'deck_damaged' &&
    ship.aircraft.readyAircraft > 0
  );
}

function findContact(draft: any, faction: 'player' | 'enemy', contactId: string): any {
  const list = faction === 'player' ? draft.intel?.playerContacts : draft.intel?.enemyContacts;
  return (list || []).find((c: any) => c.id === contactId);
}

function nearestFriendlyBase(draft: any, faction: 'player' | 'enemy', fleet: StrategicFleet): { x: number; y: number } | undefined {
  const bases = (draft.facilities || draft.bases || []).filter((b: any) => b.faction === faction || b.owner === faction);
  if (bases.length === 0) return undefined;
  const base = bases.reduce((best: any, current: any) => {
    const bestDist = Math.hypot((best.x ?? 0) - fleet.position.globalX, (best.y ?? 0) - fleet.position.globalY);
    const currentDist = Math.hypot((current.x ?? 0) - fleet.position.globalX, (current.y ?? 0) - fleet.position.globalY);
    return currentDist < bestDist ? current : best;
  });
  return { x: base.x ?? 0, y: base.y ?? 0 };
}

function normalizeMission(value: string): NavalFleetMission {
  const allowed: NavalFleetMission[] = ['patrol', 'search', 'raid', 'escort', 'invasion_support', 'carrier_strike', 'intercept', 'withdraw', 'resupply'];
  return allowed.includes(value as NavalFleetMission) ? value as NavalFleetMission : 'patrol';
}

function intentToMission(text?: string): NavalFleetMission | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();
  if (lower.includes('strike')) return 'carrier_strike';
  if (lower.includes('search')) return 'search';
  if (lower.includes('withdraw') || lower.includes('repair')) return 'withdraw';
  if (lower.includes('escort') || lower.includes('protect')) return 'escort';
  if (lower.includes('intercept')) return 'intercept';
  return undefined;
}

function missionToIntent(mission: NavalFleetMission): CommanderIntent {
  if (mission === 'carrier_strike') return 'strike';
  if (mission === 'invasion_support') return 'support_landing';
  if (mission === 'resupply') return 'withdraw';
  if (mission === 'patrol') return 'hold_sea_area';
  if (mission === 'raid') return 'intercept';
  return mission;
}

function setFleetCommand(fleet: StrategicFleet, commanderIntent: CommanderIntent, currentOrderId: string): void {
  fleet.command = {
    controller: fleet.command?.controller ?? (fleet.faction === 'enemy' ? 'enemy_ai' : 'ai_delegated'),
    riskTolerance: fleet.command?.riskTolerance ?? 'medium',
    engagementPolicy: fleet.command?.engagementPolicy ?? 'engage_if_advantage',
    preserveCapitalShips: fleet.command?.preserveCapitalShips ?? true,
    ...fleet.command,
    commanderIntent,
    currentOrderId,
  };
}

function orderId(turn: number, action: LLMDecisionAction): string {
  return `llm_${turn}_${action.type}_${action.priority}`;
}

function bearing(fromX: number, fromY: number, toX: number, toY: number): number {
  return normalizeHeading(Math.atan2(toX - fromX, fromY - toY) * 180 / Math.PI);
}

function normalizeHeading(heading: number): number {
  return Math.round(((heading % 360) + 360) % 360);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
