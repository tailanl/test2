/**
 * Campaign Memory - 增强版，带 Update 函数
 */

import type { LLMCommanderDecision } from './llm-decision-types';

export interface PlanRecord {
  turn: number;
  decisionIntent: string;
  acceptedActions: string[];
  rejectedActions: string[];
  expectedOutcome: string;
  actualOutcome?: string;
  success?: boolean;
  lesson?: string;
}

export interface CampaignMemory {
  records: PlanRecord[];
  recurringProblems: string[];
  enemyPatternEstimates: string[];
  playerDoctrine: string[];
}

export function createCampaignMemory(): CampaignMemory {
  return { records: [], recurringProblems: [], enemyPatternEstimates: [], playerDoctrine: ['carrier_strike_priority', 'island_hopping', 'submarine_interdiction'] };
}

export function recordPlan(memory: CampaignMemory, record: PlanRecord): CampaignMemory {
  return { ...memory, records: [...memory.records, record] };
}

export function updateCampaignMemory(params: {
  memory: CampaignMemory;
  previousDecision: LLMCommanderDecision;
  acceptedActions: string[];
  rejectedActions: string[];
  reportsAfterTurn: Array<{ type: string; summary: string }>;
  turn: number;
}): CampaignMemory {
  const record: PlanRecord = {
    turn: params.turn,
    decisionIntent: params.previousDecision.intent,
    acceptedActions: params.acceptedActions,
    rejectedActions: params.rejectedActions,
    expectedOutcome: params.previousDecision.assessment,
    actualOutcome: params.reportsAfterTurn.map(r => r.summary).join('; '),
    success: params.rejectedActions.length === 0,
    lesson: params.rejectedActions.length > 0 ? `Rejected ${params.rejectedActions.length} actions: ${params.rejectedActions.join(', ')}` : undefined,
  };

  const updated = recordPlan(params.memory, record);
  const newProblems = [...updated.recurringProblems];
  if (params.rejectedActions.length >= 2 && !newProblems.includes('LLM attempting illegal actions')) {
    newProblems.push('LLM attempting illegal actions');
  }

  return { ...updated, recurringProblems: newProblems };
}

export function getMemorySummary(memory: CampaignMemory): string {
  let s = `Records:${memory.records.length} `;
  s += `Success:${memory.records.filter(r => r.success).length} Fail:${memory.records.filter(r => r.success === false).length}`;
  if (memory.recurringProblems.length > 0) s += ` Problems:${memory.recurringProblems.join(';')}`;
  return s;
}
