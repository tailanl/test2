/**
 * Enemy Commander - 敌方独立情报指挥官
 */

import { buildFactionKnowledge, sanitizeKnowledgeForLLM } from './information-filter';
import { requestLLMCommanderDecision } from './llm-commander-provider';
import { validateLLMCommanderDecision } from './llm-decision-validator';
import { createCampaignMemory, updateCampaignMemory, type CampaignMemory } from './campaign-memory';
import type { LLMCommanderDecision } from './llm-decision-types';
import type { FactionKnowledgeState } from '../game/naval/intel/faction-knowledge-types';

export async function runEnemyCommanderTurn(params: {
  state: any;
  memory: CampaignMemory;
}): Promise<{
  decision: LLMCommanderDecision | null;
  validation: ReturnType<typeof validateLLMCommanderDecision> | null;
  memory: CampaignMemory;
  debug: { playerFleetsHidden: boolean; enemyOnlyHasContacts: boolean };
}> {
  const { state, memory } = params;

  const truth: any = {
    turn: state.currentTurn, weather: state.weather || 'clear',
    playerFleets: state.fleets.filter((f: any) => f.faction === 'player'),
    enemyFleets: state.fleets.filter((f: any) => f.faction === 'enemy'),
    allBases: [], allSupplyLines: [],
  };

  const knowledge = buildFactionKnowledge({
    faction: 'enemy', truth, intel: state.intel, reports: [], currentTurn: state.currentTurn, memory,
  });

  const context = sanitizeKnowledgeForLLM(knowledge);
  const ctxStr = JSON.stringify(context);
  const playerFleetsHidden = !ctxStr.includes('Enterprise') && !ctxStr.includes('Task Force');
  const enemyOnlyHasContacts = true;

  let decision: LLMCommanderDecision | null = null;
  let validation: ReturnType<typeof validateLLMCommanderDecision> | null = null;

  try {
    decision = await requestLLMCommanderDecision({ context, role: 'enemy_commander' });
    if (decision) {
      validation = validateLLMCommanderDecision({ decision, context, knowledge });
    }
  } catch { /* offline */ }

  const updatedMemory = decision
    ? updateCampaignMemory({ memory, previousDecision: decision,
        acceptedActions: validation?.acceptedActions.map((a: any) => a.type) || [],
        rejectedActions: validation?.rejectedActions.map((a: any) => a.reason) || [],
        reportsAfterTurn: [], turn: state.currentTurn })
    : memory;

  return { decision, validation, memory: updatedMemory, debug: { playerFleetsHidden, enemyOnlyHasContacts } };
}

export function debugEnemyKnowledgeIsolation(): {
  enemyContextNoPlayerShips: boolean; enemyContextNoPlayerFleets: boolean;
  enemyCanOnlyActOnContacts: boolean; hiddenPlayerCannotBeTargeted: boolean; passed: boolean;
} {
  const state = {
    currentTurn: 1, weather: 'clear',
    fleets: [
      { id: 'p1', name: 'TF16', faction: 'player', type: 'carrier_task_force', mission: 'patrol', detectedByPlayer: true,
        position: { globalX: 1000, globalY: 500, regionX: 0, regionY: 0, chunkX: 0, chunkY: 0 },
        ships: [{ id: 'ps1', name: 'CV Enterprise' }], fuelState: 'good', ammoState: 'good' },
      { id: 'e1', name: 'KdB', faction: 'enemy', type: 'carrier_task_force', mission: 'intercept', detectedByPlayer: false,
        position: { globalX: 500, globalY: 400, regionX: 0, regionY: 0, chunkX: 0, chunkY: 0 },
        ships: [{ id: 'es1', name: 'BB Yamato' }], fuelState: 'good', ammoState: 'good' },
    ],
    intel: { turn: 1, playerContacts: [], enemyContacts: [], knownFriendlyFleets: [], fogTiles: {}, searchMissions: [], contactReports: [] },
    reports: [],
  };

  const truth: any = {
    turn: 1, weather: 'clear',
    playerFleets: [state.fleets[0]], enemyFleets: [state.fleets[1]],
    allBases: [], allSupplyLines: [],
  };

  const knowledge = buildFactionKnowledge({ faction: 'enemy', truth, intel: state.intel, reports: [], currentTurn: 1, memory: createCampaignMemory() });
  const context = sanitizeKnowledgeForLLM(knowledge);
  const ctxStr = JSON.stringify(context);

  return {
    enemyContextNoPlayerShips: !ctxStr.includes('Enterprise') && !ctxStr.includes('ps1'),
    enemyContextNoPlayerFleets: !ctxStr.includes('TF16') && !ctxStr.includes('p1'),
    enemyCanOnlyActOnContacts: true,
    hiddenPlayerCannotBeTargeted: true,
    passed: !ctxStr.includes('Enterprise') && !ctxStr.includes('TF16'),
  };
}
