/**
 * Campaign Memory - LLM 计划结果记忆
 * 每回合记录计划成功/失败，供 Strategic Director 参考
 */

export interface PlanRecord {
  turn: number;
  objectiveId: string;
  intendedAction: string;
  expectedResult: string;
  actualResult?: string;
  success?: boolean;
  lesson?: string;
}

export interface CampaignMemory {
  plans: PlanRecord[];
  recurringProblems: string[];
  enemyPatternEstimates: string[];
  playerDoctrine: string[];
}

export function createCampaignMemory(): CampaignMemory {
  return {
    plans: [],
    recurringProblems: [],
    enemyPatternEstimates: [],
    playerDoctrine: ['carrier_strike_priority', 'island_hopping', 'submarine_interdiction'],
  };
}

export function recordPlan(memory: CampaignMemory, plan: PlanRecord): CampaignMemory {
  return { ...memory, plans: [...memory.plans, plan] };
}

export function recordResult(memory: CampaignMemory, turn: number, objectiveId: string, result: string, success: boolean): CampaignMemory {
  const updatedPlans = memory.plans.map(p => {
    if (p.turn === turn && p.objectiveId === objectiveId) {
      return { ...p, actualResult: result, success, lesson: success ? '' : `Avoid: ${p.intendedAction} failed due to ${result}` };
    }
    return p;
  });

  const problems = memory.recurringProblems;
  if (!success && memory.plans.filter(p => !p.success).length >= 3) {
    if (!problems.includes(result)) problems.push(result);
  }

  return { ...memory, plans: updatedPlans, recurringProblems: problems };
}

export function getMemorySummary(memory: CampaignMemory): string {
  let s = `Campaign Memory:\n`;
  s += `Plans: ${memory.plans.length} (${memory.plans.filter(p => p.success).length} success, ${memory.plans.filter(p => p.success === false).length} fail)\n`;
  if (memory.recurringProblems.length > 0) s += `Problems: ${memory.recurringProblems.join('; ')}\n`;
  if (memory.enemyPatternEstimates.length > 0) s += `Enemy patterns: ${memory.enemyPatternEstimates.join('; ')}\n`;
  return s;
}
