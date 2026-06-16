/**
 * LLM Decision Executor - applies validator-accepted actions through store calls.
 */

import type { LLMDecisionAction } from './llm-decision-types';

export interface AIActionExecutionResult {
  action: LLMDecisionAction;
  success: boolean;
  result?: string;
  reason?: string;
  affectedFleetIds: string[];
  affectedContactIds: string[];
  logMessages: string[];
}

export interface AIExecutionReport {
  turn: number;
  executed: AIActionExecutionResult[];
  failed: AIActionExecutionResult[];
  logMessages: string[];
}

export interface LLMDecisionStoreCalls {
  assignMission: (action: LLMDecisionAction) => string;
  moveFleet: (action: LLMDecisionAction) => string;
  launchSearch: (action: LLMDecisionAction) => string;
  launchCap: (action: LLMDecisionAction) => string;
  launchStrike: (action: LLMDecisionAction) => string;
  withdrawFleet: (action: LLMDecisionAction) => string;
  holdPosition: (action: LLMDecisionAction) => string;
  repairFleet: (action: LLMDecisionAction) => string;
  protectBase: (action: LLMDecisionAction) => string;
  protectSupplyLine: (action: LLMDecisionAction) => string;
  shadowContact: (action: LLMDecisionAction) => string;
  interceptContact: (action: LLMDecisionAction) => string;
  supportLanding: (action: LLMDecisionAction) => string;
}

export function executeLLMDecisionActions(params: {
  actions: LLMDecisionAction[];
  storeCalls: LLMDecisionStoreCalls;
  currentTurn: number;
}): AIExecutionReport {
  const { actions, storeCalls, currentTurn } = params;
  const executed: AIActionExecutionResult[] = [];
  const failed: AIActionExecutionResult[] = [];
  const logMessages: string[] = [];

  for (const action of actions) {
    try {
      const result = executeOne(action, storeCalls);
      const entry = toResult(action, true, result);
      executed.push(entry);
      logMessages.push(...entry.logMessages);
    } catch (error) {
      const entry = toResult(action, false, undefined, error instanceof Error ? error.message : String(error));
      failed.push(entry);
      logMessages.push(...entry.logMessages);
    }
  }

  return { turn: currentTurn, executed, failed, logMessages };
}

function executeOne(action: LLMDecisionAction, storeCalls: LLMDecisionStoreCalls): string {
  switch (action.type) {
    case 'assign_mission':
      return storeCalls.assignMission(action);
    case 'move_fleet':
      return storeCalls.moveFleet(action);
    case 'launch_search':
      return storeCalls.launchSearch(action);
    case 'launch_cap':
      return storeCalls.launchCap(action);
    case 'launch_strike':
      return storeCalls.launchStrike(action);
    case 'withdraw_fleet':
      return storeCalls.withdrawFleet(action);
    case 'hold_position':
      return storeCalls.holdPosition(action);
    case 'repair_fleet':
      return storeCalls.repairFleet(action);
    case 'protect_base':
      return storeCalls.protectBase(action);
    case 'protect_supply_line':
      return storeCalls.protectSupplyLine(action);
    case 'shadow_contact':
      return storeCalls.shadowContact(action);
    case 'intercept_contact':
      return storeCalls.interceptContact(action);
    case 'support_landing':
      return storeCalls.supportLanding(action);
    default:
      return assertNever(action.type);
  }
}

function toResult(action: LLMDecisionAction, success: boolean, result?: string, reason?: string): AIActionExecutionResult {
  const message = success ? result || `${action.type} executed` : reason || `${action.type} failed`;
  return {
    action,
    success,
    result,
    reason,
    affectedFleetIds: action.fleetId ? [action.fleetId] : [],
    affectedContactIds: action.contactId ? [action.contactId] : [],
    logMessages: [`${success ? 'EXECUTED' : 'FAILED'} ${action.type}: ${message}`],
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled LLM action type: ${String(value)}`);
}
