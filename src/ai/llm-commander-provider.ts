/**
 * LLM Commander Provider - requestLLMCommanderDecision
 */

import type { LLMDecisionContext, LLMCommanderDecision } from './llm-decision-types';
import { buildDecisionPrompt } from './llm-decision-schema';
import { getAPIKey } from './api-key';

function parseLLMDecision(resp: string, context: LLMDecisionContext): LLMCommanderDecision | null {
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
      nextReviewTurn: typeof p.nextReviewTurn === 'number' ? p.nextReviewTurn : context.turn + 5,
    };
  } catch { return null; }
}

export async function requestLLMCommanderDecision(params: {
  context: LLMDecisionContext;
  role: 'player_advisor' | 'enemy_commander';
}): Promise<LLMCommanderDecision | null> {
  const key = getAPIKey();
  if (!key) return null;

  const { system, user } = buildDecisionPrompt(params.context);

  try {
    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.7, max_tokens: 500 }),
    });
    if (!r.ok) throw new Error(`API ${r.status}`);
    const text = ((await r.json()) as any).choices?.[0]?.message?.content || '';
    return parseLLMDecision(text, params.context);
  } catch {
    return null;
  }
}
