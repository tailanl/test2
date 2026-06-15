/**
 * AI Turn Pipeline - 统一 AI 回合管线
 * buildKnowledge → sanitize → LLM → validate → execute → memory
 */

import { buildFactionKnowledge, sanitizeKnowledgeForLLM } from './information-filter';
import { requestLLMCommanderDecision } from './llm-commander-provider';
import { validateLLMCommanderDecision } from './llm-decision-validator';
import { executeLLMDecisionActions } from './llm-decision-executor';
import { updateCampaignMemory, createCampaignMemory, type CampaignMemory } from './campaign-memory';
import { generateSearchPlan } from './search-planner';
import { assessThreat } from './threat-assessment';
import { getDoctrineForPhase } from './naval-doctrine';
import { requestGLMVisualAssessment, shouldRunGLMVisualAssessment, bearingAndDist } from './glm-provider';
import { getGLMKey } from './api-key';
import { GLM_DEFAULTS } from './glm-config';
import type { LLMDecisionContext, LLMCommanderDecision } from './llm-decision-types';
import type { FactionKnowledgeState } from '../game/naval/intel/faction-knowledge-types';

export interface AITurnPipelineResult {
  knowledge: FactionKnowledgeState;
  context: LLMDecisionContext;
  decision: LLMCommanderDecision | null;
  validation: ReturnType<typeof validateLLMCommanderDecision> | null;
  execution: ReturnType<typeof executeLLMDecisionActions> | null;
  memory: CampaignMemory;
}

export async function runAITurnPipeline(params: {
  faction: 'player' | 'enemy';
  mode: 'advisor' | 'commander';
  state: any; // Zustand store state
  memory: CampaignMemory;
}): Promise<AITurnPipelineResult> {
  const { faction, mode, state, memory } = params;

  // 1. Build faction knowledge (enemy never sees player real data)
  const truth = {
    turn: state.currentTurn,
    playerFleets: state.fleets?.filter((f: any) => f.faction === 'player') || [],
    enemyFleets: state.fleets?.filter((f: any) => f.faction === 'enemy') || [],
    allBases: [],
    allSupplyLines: [],
    weather: state.weather || 'clear',
  };

  const knowledge = buildFactionKnowledge({
    faction, truth, intel: state.intel, reports: state.reports || [], currentTurn: state.currentTurn, memory,
  });

  // 2. Sanitize for LLM
  const context = sanitizeKnowledgeForLLM(knowledge, state.currentPhase);

  // 3-6. Attach smart modules
  const searchPlan = generateSearchPlan({
    contacts: context.knownContacts.map(c => ({
      detectionLevel: c.detectionLevel, lastKnownPosition: c.lastKnownPosition, uncertaintyRadius: c.uncertaintyRadius,
    })),
    ownPosition: context.ownForces[0]?.position || { x: 0, y: 0 },
    lastContactTurn: Math.max(...context.knownContacts.map(c => c.lastDetectedTurn), 0),
    currentTurn: state.currentTurn,
  });
  context.legalActionHints.push(...searchPlan.sectors.map(s => `search_${s.heading}deg@P${s.priority}`));

  const threat = assessThreat({
    contacts: context.knownContacts.map(c => ({ detectionLevel: c.detectionLevel, estimatedClass: c.estimatedClass, confidence: c.confidence })),
    ownDamage: state.fleets?.flatMap((f: any) => f.ships.map((s: any) => ({ flooding: s.damage?.flooding || 0, fire: s.damage?.fire || 0, hullIntegrity: s.damage?.hullIntegrity || 100 }))) || [],
    supplyStatus: state.fleets?.map((f: any) => ({ fuelState: f.fuelState || 'good', ammoState: f.ammoState || 'good' })) || [],
    weather: state.weather || 'clear',
  });
  if (threat.overallThreat === 'high' || threat.overallThreat === 'critical') {
    context.strategicSituation.riskTolerance = 'low';
  }

  const doctrine = getDoctrineForPhase(state.currentPhase || '');
  context.legalActionHints.push(`doctrine:${doctrine.type}`);

  // 6b. GLM Visual Assessment (only on trigger conditions, not every turn)
  const shouldRunGLM = shouldRunGLMVisualAssessment({
    strategy: GLM_DEFAULTS.strategy,
    turn: state.currentTurn,
    newContactThisTurn: context.knownContacts.some(c => c.lastDetectedTurn === state.currentTurn),
    contactUpgraded: context.knownContacts.some(c => c.detectionLevel === 'classified' || c.detectionLevel === 'identified' || c.detectionLevel === 'tracked'),
    carrierDamaged: (state.fleets?.find((f: any) => f.faction === faction)?.ships || []).some((s: any) => s.shipClass?.includes('carrier') && s.damage?.status !== 'combat_effective'),
    strikePlanned: false,
    manualRequest: false,
  });

  if (shouldRunGLM) {
    try {
      const ownPos = context.ownForces[0];
      const textualCtx = context.knownContacts.map(c => {
        const bd = bearingAndDist(ownPos?.position?.x || 0, ownPos?.position?.y || 0, c.lastKnownPosition.x, c.lastKnownPosition.y);
        return `[${c.detectionLevel}] ${c.estimatedClass||'?'} 方位:${bd.bearing}°(${bd.bearingLabel}) 距离:${bd.dist}格`;
      }).join('\n');

      const glmResult = await requestGLMVisualAssessment({
        config: { apiKey: getGLMKey() },
        textualContext: `本队:${ownPos?.name||'Fleet'}(${ownPos?.position?.x},${ownPos?.position?.y}) 天气:${state.weather||'clear'}\n${textualCtx}`,
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
    } catch { /* GLM offline, continue without visual assessment */ }
  }

  // 7. LLM Decision (DeepSeek, with GLM visualAssessment if available) (DeepSeek, with GLM review context)
  let decision: LLMCommanderDecision | null = null;
  let validation: ReturnType<typeof validateLLMCommanderDecision> | null = null;
  let execution: ReturnType<typeof executeLLMDecisionActions> | null = null;

  try {
    decision = await requestLLMCommanderDecision({ context, role: mode === 'commander' ? 'enemy_commander' : 'player_advisor' });
  } catch { /* LLM offline */ }

  // 8. Validate
  if (decision) {
    validation = validateLLMCommanderDecision({ decision, context, knowledge });

    // 9. Execute (commander mode only)
    if (mode === 'commander' && validation.acceptedActions.length > 0) {
      const storeCalls = {
        assignMission: () => {}, moveFleet: () => {},
        launchSearch: () => {}, launchCap: () => {}, launchStrike: () => {},
        withdrawFleet: () => {}, holdPosition: () => {}, repairFleet: () => {},
        protectBase: () => {}, protectSupplyLine: () => {},
      };
      execution = executeLLMDecisionActions({ actions: validation.acceptedActions, storeCalls, currentTurn: state.currentTurn });
    }
  }

  // 10. Update memory
  const updatedMemory = decision
    ? updateCampaignMemory({
        memory, previousDecision: decision,
        acceptedActions: validation?.acceptedActions.map((a: any) => a.type) || [],
        rejectedActions: validation?.rejectedActions.map((a: any) => a.reason) || [],
        reportsAfterTurn: [], turn: state.currentTurn,
      })
    : memory;

  return { knowledge, context, decision, validation, execution, memory: updatedMemory };
}
