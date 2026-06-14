/**
 * Campaign Controller - LLM 驱动的战役自动运行
 * DeepSeek V3 控制双方舰队决策，记录完整战役日志
 */

import type { NavalShip } from '../game/naval/ship/ship-types';
import type { StrategicFleet } from '../game/naval/naval-strategic-types';
import type { NavalContact } from '../game/naval/intel/naval-intel-types';
import type { NavalIntelState } from '../game/naval/intel/naval-intel-types';
import type { NavalEnvironmentState } from '../game/naval/naval-types';
import type { NavalAIReport } from '../game/naval/ai/naval-ai-types';
import type { NavalBattleLogEvent } from '../game/naval/ship/ship-damage';
import { callDeepSeekAPI, buildNavalLLMContext } from './provider';
import type { AIProviderConfig, NavalLLMContext } from './types';
import type { generateNavalMap } from '../game/naval/naval-map-generator';
import {
  CAMPAIGN_JSON_PROMPT,
  campaignDecisionToActions,
  getRuleBasedCampaignDecision,
  normalizeCampaignDecision,
  parseCampaignDecision,
} from './naval-campaign-policy';

// ============================================================
// 战役日志
// ============================================================

export interface CampaignLogEntry {
  turn: number;
  timestamp: string;
  phase: 'intel' | 'planning_player' | 'planning_enemy' | 'execution' | 'report';
  faction: string;
  content: string;
  data?: Record<string, unknown>;
}

export interface CampaignTurnResult {
  turn: number;
  events: NavalBattleLogEvent[];
  reports: NavalAIReport[];
  contacts: Array<{ level: string; class: string; position: string }>;
  playerPlan: string;
  enemyPlan: string;
  summary: string;
}

export interface CampaignResult {
  totalTurns: number;
  turns: CampaignTurnResult[];
  playerLosses: string[];
  enemyLosses: string[];
  playerDamage: Record<string, string>;
  enemyDamage: Record<string, string>;
  finalSummary: string;
}

// ============================================================
// 状态摘要（供 LLM 使用）
// ============================================================

interface TurnState {
  turn: number;
  playerFleet: StrategicFleet | undefined;
  enemyFleets: StrategicFleet[];
  contacts: NavalContact[];
  environment: NavalEnvironmentState;
  recentReports: NavalAIReport[];
  battleLog: NavalBattleLogEvent[];
}

function summarizeForLLM(state: TurnState): string {
  const pf = state.playerFleet;
  const ef = state.enemyFleets[0];

  let s = `=== TURN ${state.turn} ===\n`;
  s += `Weather: ${state.environment.weather}, Sea: ${state.environment.seaState}, Time: ${state.environment.timeOfDay}\n\n`;

  // Player fleet
  if (pf) {
    s += `--- Your Fleet (${pf.name}) ---\n`;
    s += `Type: ${pf.type}, Mission: ${pf.mission}, Fuel: ${pf.fuelState}, Ammo: ${pf.ammoState}\n`;
    s += `Position: (${pf.position.globalX}, ${pf.position.globalY})\n`;
    for (const ship of pf.ships) {
      const dmg = ship.damage.status !== 'combat_effective'
        ? ` DAMAGED(flood:${ship.damage.flooding.toFixed(0)}% fire:${ship.damage.fire.toFixed(0)}% status:${ship.damage.status})`
        : '';
      const ac = ship.aircraft ? ` [AC:F${ship.aircraft.fighters}DB${ship.aircraft.diveBombers}TB${ship.aircraft.torpedoBombers}]` : '';
      s += `  ${ship.name} (${ship.shipClass}) HDG:${ship.headingDeg}° SPD:${ship.speedKts}kts${ac}${dmg}\n`;
    }
    s += '\n';
  }

  // Enemy fleet (only what's detected)
  if (ef) {
    s += `--- Enemy Fleet (Intel) ---\n`;
    s += `Detected: ${ef.detectedByPlayer ? 'YES' : 'NO'}\n`;
    if (ef.detectedByPlayer && ef.lastKnownPosition) {
      s += `Last known: (${ef.lastKnownPosition.globalX}, ${ef.lastKnownPosition.globalY}) ±${ef.lastKnownPosition.uncertaintyRadius}\n`;
    }
  }

  // Contacts
  s += `\n--- Contacts (${state.contacts.length}) ---\n`;
  if (state.contacts.length === 0) {
    s += 'NONE - No enemy contacts on any sensors.\n';
  } else {
    for (const c of state.contacts) {
      s += `  [${c.detectionLevel}] ${c.estimatedClass || 'unknown'} at (${c.lastKnownPosition.x.toFixed(0)},${c.lastKnownPosition.y.toFixed(0)}) ±${c.uncertaintyRadius.toFixed(0)} conf:${c.confidence}\n`;
    }
  }

  // Recent events
  if (state.battleLog.length > 0) {
    const recent = state.battleLog.slice(-5);
    s += `\n--- Recent Events ---\n`;
    for (const e of recent) {
      s += `  ${e.description}\n`;
    }
  }

  // Reports
  if (state.recentReports.length > 0) {
    s += `\n--- Reports ---\n`;
    for (const r of state.recentReports.slice(-3)) {
      s += `  [${r.type}] ${r.summary}\n`;
    }
  }

  return s;
}

// ============================================================
// LLM 决策
// ============================================================

const CAMPAIGN_SYSTEM_PROMPT = CAMPAIGN_JSON_PROMPT;

export async function getLLMCampaignDecision(
  config: AIProviderConfig,
  state: TurnState,
): Promise<{
  situation: string;
  fleetOrders: Record<string, unknown>;
  shipOrders: Array<Record<string, unknown>>;
  priorityTargets: string[];
  notes: string;
}> {
  const context = summarizeForLLM(state);
  const userMessage = `${context}\n\nIssue orders for Turn ${state.turn}. Current position: (${state.playerFleet?.position.globalX},${state.playerFleet?.position.globalY})`;

  try {
    const raw = await callDeepSeekAPI({
      config,
      systemPrompt: CAMPAIGN_SYSTEM_PROMPT,
      userMessage,
    });

    const policyState = { turn: state.turn, playerFleet: state.playerFleet, contacts: state.contacts };
    const decision = normalizeCampaignDecision(parseCampaignDecision(raw), policyState);
    const actions = campaignDecisionToActions(decision, policyState);
    return {
      situation: decision.situation,
      fleetOrders: { ...(decision.orders[0] || {}) },
      shipOrders: actions.map((action) => ({
        action: action.type,
        heading: action.headingDeg,
        speed: action.targetSpeedKts,
        targetContactId: action.targetContactId,
        reason: action.reason,
      })),
      priorityTargets: actions.flatMap((action) => action.targetContactId ? [action.targetContactId] : []),
      notes: decision.notes || '',
    };
  } catch (e) {
    console.warn('LLM campaign decision failed, using rule-based fallback:', e);
    return getRuleBasedDecision(state);
  }
}

function getRuleBasedDecision(state: TurnState) {
  const policyState = { turn: state.turn, playerFleet: state.playerFleet, contacts: state.contacts };
  const decision = getRuleBasedCampaignDecision(policyState);
  const actions = campaignDecisionToActions(decision, policyState);
  return {
    situation: decision.situation,
    fleetOrders: { ...(decision.orders[0] || {}) },
    shipOrders: actions.map((action) => ({
      action: action.type,
      heading: action.headingDeg,
      speed: action.targetSpeedKts,
      targetContactId: action.targetContactId,
      reason: action.reason,
    })),
    priorityTargets: actions.flatMap((action) => action.targetContactId ? [action.targetContactId] : []),
    notes: 'Rule-based fallback',
  };
}

// ============================================================
// 战役执行循环
// ============================================================

export async function runCampaignTurn(params: {
  config: AIProviderConfig;
  state: TurnState;
  executeTurn: () => {
    newState: TurnState;
    events: NavalBattleLogEvent[];
    reports: NavalAIReport[];
  };
  log: (entry: CampaignLogEntry) => void;
}): Promise<{
  result: CampaignTurnResult;
  newState: TurnState;
}> {
  const { config, state, executeTurn, log } = params;

  // 1. Intel phase
  log({ turn: state.turn, timestamp: new Date().toISOString(), phase: 'intel', faction: 'player', content: `Intel updated: ${state.contacts.length} contacts` });

  // 2. Player LLM decision
  log({ turn: state.turn, timestamp: new Date().toISOString(), phase: 'planning_player', faction: 'player', content: 'Requesting LLM orders...' });
  const playerDecision = await getLLMCampaignDecision(config, state);
  log({
    turn: state.turn, timestamp: new Date().toISOString(), phase: 'planning_player', faction: 'player',
    content: `Player plan: ${playerDecision.situation}`,
    data: { shipOrders: playerDecision.shipOrders.length, notes: playerDecision.notes },
  });

  // 3. Enemy LLM decision (simple rule-based for now)
  log({ turn: state.turn, timestamp: new Date().toISOString(), phase: 'planning_enemy', faction: 'enemy', content: 'Enemy AI planning...' });

  // 4. Execute
  log({ turn: state.turn, timestamp: new Date().toISOString(), phase: 'execution', faction: 'both', content: 'Executing turn...' });
  const { newState, events, reports } = executeTurn();

  // Log events
  for (const e of events) {
    log({ turn: state.turn, timestamp: new Date().toISOString(), phase: 'execution', faction: 'both', content: e.description, data: { type: e.type, shipId: e.shipId } });
  }

  // 5. Reports
  log({ turn: state.turn, timestamp: new Date().toISOString(), phase: 'report', faction: 'player', content: `${reports.length} reports generated` });
  for (const r of reports) {
    log({ turn: state.turn, timestamp: new Date().toISOString(), phase: 'report', faction: 'player', content: `[${r.type}] ${r.summary}` });
  }

  const result: CampaignTurnResult = {
    turn: state.turn,
    events,
    reports,
    contacts: state.contacts.map((c) => ({
      level: c.detectionLevel,
      class: (c.estimatedClass as string) || 'unknown',
      position: `(${c.lastKnownPosition.x.toFixed(0)},${c.lastKnownPosition.y.toFixed(0)})`,
    })),
    playerPlan: playerDecision.situation,
    enemyPlan: 'Rule-based enemy AI',
    summary: `Turn ${state.turn}: ${events.length} events, ${reports.length} reports, ${state.contacts.length} contacts`,
  };

  return { result, newState };
}
