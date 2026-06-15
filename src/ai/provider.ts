/**
 * DeepSeek API Provider
 * 替代原 ZAI SDK，使用标准 OpenAI 兼容接口
 */

import type { AIProviderConfig, NavalLLMContext, NavalLLMAdvice, NavalLLMCommandResult } from './types';

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat';

// ===== 调用 DeepSeek API =====

export async function callDeepSeekAPI(params: {
  config: AIProviderConfig;
  systemPrompt: string;
  userMessage: string;
}): Promise<string> {
  const { config, systemPrompt, userMessage } = params;
  const endpoint = config.endpoint || DEFAULT_ENDPOINT;
  const model = config.model || DEFAULT_MODEL;
  const apiKey = config.apiKey;

  if (!apiKey) {
    throw new Error('DeepSeek API key not configured');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], temperature: config.temperature ?? 0.7, max_tokens: config.maxTokens ?? 600 }),
  });
  if (!response.ok) { const err = await response.text(); throw new Error(`DeepSeek ${response.status}: ${err.slice(0,200)}`); }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

export async function getNavalAdvice(params: { config: AIProviderConfig; context: NavalLLMContext }): Promise<NavalLLMAdvice> {
  const { config, context } = params;
  if (config.kind === 'none' || config.kind === 'rule_based') return getRuleBasedAdvice(context);
  try {
    const raw = await callDeepSeekAPI({ config, systemPrompt: '你是太平洋舰队战术顾问。给JSON回复。', userMessage: JSON.stringify(context) });
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { const p = JSON.parse(m[0]); return { situationAssessment: p.situationAssessment||'', recommendations: p.recommendations||[], suggestedCommands: p.suggestedCommands||[], riskLevel: p.riskLevel||'medium' }; }
    return { situationAssessment: raw, recommendations: [], suggestedCommands: [], riskLevel: 'medium' };
  } catch { return getRuleBasedAdvice(context); }
}

function getRuleBasedAdvice(context: NavalLLMContext): NavalLLMAdvice {
  return { situationAssessment: context.contacts.length > 0 ? `${context.contacts.length} contacts` : 'No contacts', recommendations: [], suggestedCommands: [], riskLevel: 'low' };
}

export async function parseNaturalCommand(params: { config: AIProviderConfig; userInput: string; context: NavalLLMContext }): Promise<NavalLLMCommandResult> {
  return { parsed: false, intent: '', targetDescription: '', explanation: 'unimplemented', rawResponse: '' };
}

export function buildNavalLLMContext(params: any): NavalLLMContext {
  return { turn: params.turn, environment: params.environment || {}, friendlyFleets: [], contacts: [], damagedShips: [], recentReports: [], knownOnly: true };
}
