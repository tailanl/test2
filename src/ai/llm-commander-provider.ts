/**
 * LLM Commander Provider - requestLLMCommanderDecision
 */

import type { LLMDecisionContext, LLMCommanderDecision } from './llm-decision-types';
import { buildDecisionPrompt } from './llm-decision-schema';
import { getAPIKey, getCommanderLLMProvider, getOllamaBaseUrl, getOllamaModel } from './api-key';
import { createTraceId, type LLMDecisionProviderResult, type LLMOutputTrace } from './llm-output-trace';

function parseLLMDecisionWithError(resp: string, context: LLMDecisionContext): { decision: LLMCommanderDecision | null; error?: string } {
  try {
    const candidate = extractJSONCandidate(resp);
    if (!candidate) return { decision: null, error: 'No JSON object found in LLM response' };
    const p = parseJSONWithRepair(candidate);
    const decisions = normalizeDecisionActions(p, context);
    return { decision: {
      situationAssessment: normalizeSituationAssessment(p.situationAssessment),
      missionAnalysis: normalizeMissionAnalysis(p.missionAnalysis),
      availableDecisionReview: Array.isArray(p.availableDecisionReview) ? p.availableDecisionReview : [],
      courseOfActionAnalysis: Array.isArray(p.courseOfActionAnalysis) ? p.courseOfActionAnalysis : [],
      selectedDecisionRationale: typeof p.selectedDecisionRationale === 'string' ? p.selectedDecisionRationale : undefined,
      assessment: p.assessment || '',
      intent: p.intent || inferIntent(decisions[0]?.type),
      confidence: p.confidence || 'medium',
      risk: p.risk || 'medium',
      decisions,
      assumptions: Array.isArray(p.assumptions) ? p.assumptions : [],
      informationGaps: Array.isArray(p.informationGaps) ? p.informationGaps : [],
      abortConditions: Array.isArray(p.abortConditions) ? p.abortConditions : [],
      nextReviewTurn: typeof p.nextReviewTurn === 'number' ? p.nextReviewTurn : context.turn + 5,
    } };
  } catch (error) {
    return { decision: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseJSONWithRepair(candidate: string): any {
  try {
    return JSON.parse(candidate);
  } catch (firstError) {
    const repaired = repairCommonSmallModelJSON(candidate);
    try {
      return JSON.parse(repaired);
    } catch {
      throw firstError;
    }
  }
}

function repairCommonSmallModelJSON(candidate: string): string {
  return candidate
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
    .replace(/:\s*(low|medium|high|search|shadow|intercept|strike|withdraw|protect|raid|support_landing|repair|hold|ready|good|limited|critical|unknown|none)(\s*[,}\]])/gi, (_m, value, suffix) => `: "${String(value).toLowerCase()}"${suffix}`)
    .replace(/,\s*([}\]])/g, '$1');
}

function normalizeDecisionActions(payload: any, context: LLMDecisionContext): LLMCommanderDecision['decisions'] {
  if (Array.isArray(payload.decisions) && payload.decisions.length > 0) {
    return payload.decisions;
  }

  const reviewed = Array.isArray(payload.availableDecisionReview)
    ? payload.availableDecisionReview.find((item: any) => item?.feasible !== false && item?.actionType)
    : undefined;
  const option = reviewed
    ? context.decisionFramework?.availableOptions.find(o => o.actionType === reviewed.actionType)
    : context.decisionFramework?.availableOptions[0];
  if (!reviewed && !option) return [];

  const actionType = String(reviewed?.actionType || option?.actionType || '') as LLMCommanderDecision['decisions'][number]['type'];
  const fleetId = option?.fleetId || context.ownForces[0]?.fleetId;
  const quantity = normalizeQuantity(reviewed?.quantity, option?.maxQuantity);
  const reason = String(reviewed?.reason || option?.reason || payload.selectedDecisionRationale || 'normalized from decision review');
  const base = {
    type: actionType,
    fleetId,
    priority: 1,
    reason,
    successEstimate: normalizeEstimate(reviewed?.estimatedSuccess || option?.estimatedSuccess),
    expectedEffect: String(payload.missionAnalysis?.desiredEffect || ''),
    resourceCommitment: quantity ? `${quantity} aircraft` : undefined,
  };

  if (actionType === 'launch_search') {
    const heading = extractHeading(String(reviewed?.method || option?.method || '')) ?? extractHeading(String(option?.method || '')) ?? 270;
    return [{
      ...base,
      aircraftCount: quantity || option?.maxQuantity || 4,
      searchArcDeg: { centerDeg: heading, widthDeg: 60, range: 160 },
    }];
  }

  if (actionType === 'launch_cap') {
    return [{
      ...base,
      aircraftCount: quantity || option?.maxQuantity || 4,
      durationTurns: 2,
    }];
  }

  if (actionType === 'launch_strike' || actionType === 'shadow_contact' || actionType === 'intercept_contact') {
    return [{
      ...base,
      contactId: option?.targetId,
      aircraftCount: actionType === 'launch_strike' ? quantity || option?.maxQuantity || 8 : undefined,
    }];
  }

  if (actionType === 'repair_fleet' || actionType === 'protect_base' || actionType === 'support_landing') {
    return [{ ...base, baseId: option?.targetId }];
  }

  return [base];
}

function normalizeQuantity(value: unknown, max?: number): number | undefined {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return max;
  return max ? Math.min(num, max) : num;
}

function normalizeEstimate(value: unknown): 'low' | 'medium' | 'high' | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

function extractHeading(value: string): number | undefined {
  const match = value.match(/(?:heading|search_)\s*([0-9]{1,3})/i);
  if (!match) return undefined;
  return Math.round(((Number(match[1]) % 360) + 360) % 360);
}

function inferIntent(actionType?: string): LLMCommanderDecision['intent'] {
  if (actionType === 'launch_search') return 'search';
  if (actionType === 'launch_strike') return 'strike';
  if (actionType === 'withdraw_fleet') return 'withdraw';
  if (actionType === 'repair_fleet') return 'repair';
  if (actionType === 'launch_cap' || actionType === 'protect_base' || actionType === 'protect_supply_line') return 'protect';
  if (actionType === 'move_fleet' || actionType === 'intercept_contact') return 'intercept';
  return 'hold';
}

function normalizeSituationAssessment(value: any): LLMCommanderDecision['situationAssessment'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return {
    enemy: String(value.enemy || ''),
    friendly: String(value.friendly || ''),
    self: String(value.self || ''),
    battlefield: String(value.battlefield || ''),
  };
}

function normalizeMissionAnalysis(value: any): LLMCommanderDecision['missionAnalysis'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const riskTolerance = value.riskTolerance === 'low' || value.riskTolerance === 'high' ? value.riskTolerance : 'medium';
  return {
    primaryTask: String(value.primaryTask || ''),
    constraints: Array.isArray(value.constraints) ? value.constraints.map(String) : [],
    desiredEffect: String(value.desiredEffect || ''),
    riskTolerance,
  };
}

function extractJSONCandidate(resp: string): string | null {
  const trimmed = resp.trim();
  const first = trimmed.indexOf('{');
  if (first < 0) return null;

  const direct = trimmed.slice(first);
  const last = direct.lastIndexOf('}');
  const complete = last >= 0 ? direct.slice(0, last + 1) : direct;
  const repaired = repairMissingClosers(complete);
  return repaired || complete;
}

function repairMissingClosers(value: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const ch of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if ((ch === '}' || ch === ']') && stack[stack.length - 1] === ch) stack.pop();
  }

  return `${value}${stack.reverse().join('')}`;
}

export async function requestLLMCommanderDecision(params: {
  context: LLMDecisionContext;
  role: 'player_advisor' | 'enemy_commander';
}): Promise<LLMCommanderDecision | null> {
  const result = await requestLLMCommanderDecisionWithTrace(params);
  return result.decision;
}

export async function requestLLMCommanderDecisionWithTrace(params: {
  context: LLMDecisionContext;
  role: 'player_advisor' | 'enemy_commander';
}): Promise<LLMDecisionProviderResult> {
  if (getCommanderLLMProvider() === 'ollama') {
    return requestOllamaCommanderDecisionWithTrace(params);
  }
  return requestDeepSeekCommanderDecisionWithTrace(params);
}

async function requestDeepSeekCommanderDecisionWithTrace(params: {
  context: LLMDecisionContext;
  role: 'player_advisor' | 'enemy_commander';
}): Promise<LLMDecisionProviderResult> {
  const key = getAPIKey();
  const { system, user } = buildDecisionPrompt(params.context);
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const baseTrace: Omit<LLMOutputTrace, 'endedAt' | 'durationMs' | 'rawOutput'> = {
    id: createTraceId('deepseek_commander', params.context.turn),
    source: 'commander_decision',
    provider: 'deepseek',
    model: 'deepseek-chat',
    role: params.role,
    faction: params.context.faction,
    turn: params.context.turn,
    startedAt,
    prompt: { system, user },
  };

  const finish = (partial: Omit<Partial<LLMOutputTrace>, 'id' | 'source' | 'provider' | 'model' | 'startedAt' | 'prompt'>): LLMDecisionProviderResult => {
    const ended = Date.now();
    const trace: LLMOutputTrace = {
      ...baseTrace,
      endedAt: new Date(ended).toISOString(),
      durationMs: ended - started,
      rawOutput: partial.rawOutput ?? null,
      parsedDecision: partial.parsedDecision,
      parsedOutput: partial.parsedOutput,
      parseError: partial.parseError,
      requestError: partial.requestError,
      metadata: partial.metadata,
    };
    return { decision: trace.parsedDecision ?? null, trace };
  };

  if (!key) {
    return finish({ requestError: 'DeepSeek API key not configured' });
  }

  try {
    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.7, max_tokens: 500 }),
    });
    if (!r.ok) throw new Error(`API ${r.status}`);
    const text = ((await r.json()) as any).choices?.[0]?.message?.content || '';
    const parsed = parseLLMDecisionWithError(text, params.context);
    return finish({ rawOutput: text, parsedDecision: parsed.decision, parseError: parsed.error });
  } catch (error) {
    return finish({ requestError: error instanceof Error ? error.message : String(error) });
  }
}

async function requestOllamaCommanderDecisionWithTrace(params: {
  context: LLMDecisionContext;
  role: 'player_advisor' | 'enemy_commander';
}): Promise<LLMDecisionProviderResult> {
  const model = getOllamaModel();
  const baseUrl = getOllamaBaseUrl();
  const { system, user } = buildDecisionPrompt(params.context);
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const baseTrace: Omit<LLMOutputTrace, 'endedAt' | 'durationMs' | 'rawOutput'> = {
    id: createTraceId('ollama_commander', params.context.turn),
    source: 'commander_decision',
    provider: 'ollama',
    model,
    role: params.role,
    faction: params.context.faction,
    turn: params.context.turn,
    startedAt,
    prompt: { system, user },
  };

  const finish = (partial: Omit<Partial<LLMOutputTrace>, 'id' | 'source' | 'provider' | 'model' | 'startedAt' | 'prompt'>): LLMDecisionProviderResult => {
    const ended = Date.now();
    const trace: LLMOutputTrace = {
      ...baseTrace,
      endedAt: new Date(ended).toISOString(),
      durationMs: ended - started,
      rawOutput: partial.rawOutput ?? null,
      parsedDecision: partial.parsedDecision,
      parsedOutput: partial.parsedOutput,
      parseError: partial.parseError,
      requestError: partial.requestError,
      metadata: { baseUrl, ...partial.metadata },
    };
    return { decision: trace.parsedDecision ?? null, trace };
  };

  try {
    const r = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `/no_think\n${system}` },
          { role: 'user', content: user },
        ],
        stream: false,
        format: 'json',
        think: false,
        options: {
          temperature: 0,
          num_predict: 900,
        },
      }),
    });
    if (!r.ok) throw new Error(`Ollama API ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const json = (await r.json()) as any;
    const text = String(json.message?.content || json.response || '');
    const parsed = parseLLMDecisionWithError(text, params.context);
    return finish({ rawOutput: text, parsedDecision: parsed.decision, parseError: parsed.error });
  } catch (error) {
    return finish({ requestError: error instanceof Error ? error.message : String(error) });
  }
}
