/**
 * LLM Decision Schema - JSON prompt builder
 */

import type { LLMDecisionContext, LLMCommanderDecision } from './llm-decision-types';

export function buildDecisionPrompt(context: LLMDecisionContext): { system: string; user: string } {
  const system = `你是太平洋舰队指挥官。你只能根据下面给出的已知情报决策。
你不能假设存在未列出的敌舰。你不能使用真实隐藏信息。
如果情报不足，优先搜索、侦察、保护和保持距离。
你必须返回严格 JSON。不要返回 Markdown。不要返回解释文字。

JSON schema:
{
  "assessment": "1-2 sentence tactical assessment",
  "intent": "search|shadow|intercept|strike|withdraw|protect|raid|support_landing|repair|hold",
  "confidence": "low|medium|high",
  "risk": "low|medium|high",
  "decisions": [{
    "type": "launch_search|launch_strike|move_fleet|withdraw_fleet|intercept_contact|shadow_contact|hold_position|repair_fleet|protect_base|protect_supply_line|assign_mission|launch_cap|support_landing",
    "fleetId": "your fleet id or empty",
    "contactId": "target contact id or empty",
    "baseId": "target base id or empty",
    "targetPosition": {"x":0,"y":0},
    "priority": 1,
    "reason": "why"
  }],
  "assumptions": ["what you assume about enemy"],
  "informationGaps": ["what intel is missing"],
  "abortConditions": ["when to abort"],
  "nextReviewTurn": 5
}`;

  const user = `TURN ${context.turn} (${context.faction})\n\nYOUR FORCES:\n${context.ownForces.map(f => `  ${f.name}(${f.type}) [${f.position.x},${f.position.y}] ${f.damageSummary} fuel:${f.fuelState}`).join('\n')}\n\nKNOWN CONTACTS:\n${context.knownContacts.length === 0 ? '  NONE' : context.knownContacts.map(c => `  [${c.detectionLevel}] ${c.estimatedClass||'?'} (${c.lastKnownPosition.x},${c.lastKnownPosition.y}) ±${c.uncertaintyRadius} conf:${c.confidence} id:${c.contactId}`).join('\n')}\n\nLEGAL ACTIONS: ${context.legalActionHints.join(', ')}\n\nMEMORY: ${context.memorySummary.previousOutcome || 'none'}\n\nReturn JSON decision:`;

  return { system, user };
}

export function parseLLMDecision(resp: string, defaultTurn: number = 1): LLMCommanderDecision | null {
  try {
    const m = resp.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]);
    return {
      assessment: p.assessment || '',
      intent: p.intent || 'hold',
      confidence: p.confidence || 'medium',
      risk: p.risk || 'medium',
      decisions: Array.isArray(p.decisions) ? p.decisions : [],
      assumptions: Array.isArray(p.assumptions) ? p.assumptions : [],
      informationGaps: Array.isArray(p.informationGaps) ? p.informationGaps : [],
      abortConditions: Array.isArray(p.abortConditions) ? p.abortConditions : [],
      nextReviewTurn: typeof p.nextReviewTurn === 'number' ? p.nextReviewTurn : defaultTurn + 5,
    };
  } catch { return null; }
}
