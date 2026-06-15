/**
 * LLM Decision Executor - 执行 validator 接受的动作
 * LLM 只能提出 action，不能直接改 state
 */

import type { LLMDecisionAction } from './llm-decision-types';

export function executeLLMDecisionActions(params: {
  actions: LLMDecisionAction[];
  storeCalls: {
    assignMission: (fleetId: string, mission: string) => void;
    moveFleet: (fleetId: string, x: number, y: number) => void;
    launchSearch: (fleetId: string, heading: number) => void;
    launchCap: (fleetId: string) => void;
    launchStrike: (fleetId: string, contactId: string) => void;
    withdrawFleet: (fleetId: string) => void;
    holdPosition: (fleetId: string) => void;
    repairFleet: (fleetId: string, baseId: string) => void;
    protectBase: (fleetId: string, baseId: string) => void;
    protectSupplyLine: (fleetId: string, lineId: string) => void;
  };
  currentTurn: number;
}): { executed: Array<{ action: LLMDecisionAction; result: string }>; failed: Array<{ action: LLMDecisionAction; reason: string }> } {
  const { actions, storeCalls } = params;
  const executed: Array<{ action: LLMDecisionAction; result: string }> = [];
  const failed: Array<{ action: LLMDecisionAction; reason: string }> = [];

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'assign_mission':
          if (action.fleetId) { storeCalls.assignMission(action.fleetId, action.reason); executed.push({ action, result: 'Mission assigned' }); }
          else failed.push({ action, reason: 'Missing fleetId' });
          break;
        case 'move_fleet':
          if (action.fleetId && action.targetPosition) {
            storeCalls.moveFleet(action.fleetId, action.targetPosition.x, action.targetPosition.y);
            executed.push({ action, result: `Fleet moving to (${action.targetPosition.x},${action.targetPosition.y})` });
          } else failed.push({ action, reason: 'Missing position' });
          break;
        case 'launch_search':
          if (action.fleetId) { storeCalls.launchSearch(action.fleetId, 315); executed.push({ action, result: 'Search launched' }); }
          else failed.push({ action, reason: 'Missing fleetId' });
          break;
        case 'launch_cap':
          if (action.fleetId) { storeCalls.launchCap(action.fleetId); executed.push({ action, result: 'CAP launched' }); }
          else failed.push({ action, reason: 'Missing fleetId' });
          break;
        case 'launch_strike':
          if (action.fleetId && action.contactId) { storeCalls.launchStrike(action.fleetId, action.contactId); executed.push({ action, result: 'Strike launched' }); }
          else failed.push({ action, reason: 'Missing fleetId or contactId' });
          break;
        case 'withdraw_fleet':
          if (action.fleetId) { storeCalls.withdrawFleet(action.fleetId); executed.push({ action, result: 'Fleet withdrawing' }); }
          else failed.push({ action, reason: 'Missing fleetId' });
          break;
        case 'hold_position':
          if (action.fleetId) { storeCalls.holdPosition(action.fleetId); executed.push({ action, result: 'Holding' }); }
          else failed.push({ action, reason: 'Missing fleetId' });
          break;
        case 'repair_fleet':
          if (action.fleetId && action.baseId) { storeCalls.repairFleet(action.fleetId, action.baseId); executed.push({ action, result: 'Repair ordered' }); }
          else failed.push({ action, reason: 'Missing baseId' });
          break;
        default:
          executed.push({ action, result: 'Action type not implemented' });
      }
    } catch (e: any) {
      failed.push({ action, reason: String(e) });
    }
  }

  return { executed, failed };
}
