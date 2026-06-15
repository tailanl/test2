/**
 * Operational Plan State - 作战计划状态跟踪
 */

import type { LLMDecisionAction } from './llm-decision-types';

export type OpPhase = 'planning' | 'search' | 'approach' | 'engagement' | 'withdrawal' | 'complete';

export interface OperationalPlanState {
  id: string;
  name: string;
  intent: string;
  phase: OpPhase;
  createdTurn: number;
  targetTurn: number;
  assignedFleetIds: string[];
  orderedActions: Array<{ action: LLMDecisionAction; status: 'pending' | 'executed' | 'failed'; result?: string }>;
  successConditions: string[];
  abortConditions: string[];
  currentRisk: 'low' | 'medium' | 'high';
  notes: string[];
}

export function createOperationalPlan(params: {
  intent: string;
  fleetIds: string[];
  turn: number;
  successConditions: string[];
  abortConditions: string[];
}): OperationalPlanState {
  return {
    id: `op_${Date.now()}`,
    name: `Operation ${params.intent}`,
    intent: params.intent,
    phase: 'planning',
    createdTurn: params.turn,
    targetTurn: params.turn + 10,
    assignedFleetIds: params.fleetIds,
    orderedActions: [],
    successConditions: params.successConditions,
    abortConditions: params.abortConditions,
    currentRisk: 'medium',
    notes: [],
  };
}

export function updateOpPhase(plan: OperationalPlanState, phase: OpPhase, note?: string): OperationalPlanState {
  const updated = { ...plan, phase };
  if (note) updated.notes = [...plan.notes, `T${plan.createdTurn}: ${note}`];
  return updated;
}

export function addOpAction(plan: OperationalPlanState, action: LLMDecisionAction): OperationalPlanState {
  return { ...plan, orderedActions: [...plan.orderedActions, { action, status: 'pending' }] };
}

export function markActionExecuted(plan: OperationalPlanState, actionIdx: number, result: string): OperationalPlanState {
  const actions = [...plan.orderedActions];
  if (actions[actionIdx]) actions[actionIdx] = { ...actions[actionIdx], status: 'executed', result };
  return { ...plan, orderedActions: actions };
}
