/**
 * GLM Provider v2 - GLM-4.6V / GLM-4.6V-FlashX
 * 支持多模态 image input 视觉态势分析
 * 不硬编码 key，接收 GLMProviderConfig
 */

import type { GLMProviderConfig, GLMModel, GLMCallStrategy } from './glm-config';
import { createGLMConfig } from './glm-config';
import { getGLMKey } from './api-key';

// ========== Types ==========

export interface GLMVisualAssessment {
  success: boolean;
  assessment: string;
  bearingSummary: string;
  threatRanking: Array<{ contact: string; bearing: number; dist: number; threat: string }>;
  recommendation: string;
  rawText: string;
  model: string;
}

// ========== Core API Call ==========

async function callGLMAPI(config: GLMProviderConfig, messages: Array<{ role: string; content: any }>): Promise<string> {
  if (!config.apiKey) throw new Error('GLM API key not configured');

  const r = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages, temperature: config.temperature, max_tokens: config.maxTokens }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`GLM API ${r.status}: ${err.slice(0, 200)}`);
  }

  const data = await r.json() as any;
  return data.choices?.[0]?.message?.content || '';
}

// ========== Visual Assessment (with optional image) ==========

export async function requestGLMVisualAssessment(params: {
  config?: Partial<GLMProviderConfig>;
  textualContext: string;
  imageBase64?: string;
  imageMimeType?: string;
}): Promise<GLMVisualAssessment> {
  const config = createGLMConfig({ ...params.config, apiKey: params.config?.apiKey || getGLMKey() });

  if (!config.apiKey) {
    throw new Error('GLM API key not configured. Please set GLM key in settings.');
  }

  // Build messages with optional image
  const userContent: any[] = [{ type: 'text', text: params.textualContext }];

  if (params.imageBase64 && params.imageMimeType) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${params.imageMimeType};base64,${params.imageBase64}` },
    });
  }

  const system = `你是太平洋舰队态势分析官。你会收到战术地图和情报。
你必须:
1. 使用精确方位角(0-360°)和距离(格)描述每个接触
2. 按威胁程度排序
3. 给出具体侦察和行动建议
回复JSON:
{
  "assessment": "总体态势评估",
  "bearingSummary": "方位总结",
  "threatRanking": [{"contact": "c1", "bearing": 284, "dist": 82, "threat": "高威胁-已分类重巡"}],
  "recommendation": "建议行动"
}`;

  let rawText = '';
  try {
    rawText = await callGLMAPI(config, [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ]);
  } catch (e: any) {
    return {
      success: false, assessment: '', bearingSummary: '', threatRanking: [],
      recommendation: `GLM error: ${String(e).slice(0, 100)}`, rawText: '', model: config.model,
    };
  }

  // Parse JSON
  try {
    const m = rawText.match(/\{[\s\S]*\}/);
    if (m) {
      const p = JSON.parse(m[0]);
      return {
        success: true,
        assessment: p.assessment || rawText.slice(0, 200),
        bearingSummary: p.bearingSummary || '',
        threatRanking: Array.isArray(p.threatRanking) ? p.threatRanking : [],
        recommendation: p.recommendation || '',
        rawText,
        model: config.model,
      };
    }
  } catch { /* JSON parse failed, use raw text */ }

  return {
    success: true, assessment: rawText, bearingSummary: '',
    threatRanking: [], recommendation: '', rawText, model: config.model,
  };
}

// ========== Call Strategy Check ==========

export function shouldRunGLMVisualAssessment(params: {
  strategy: GLMCallStrategy;
  turn: number;
  newContactThisTurn: boolean;
  contactUpgraded: boolean;
  carrierDamaged: boolean;
  strikePlanned: boolean;
  manualRequest: boolean;
}): boolean {
  const { strategy, turn, newContactThisTurn, contactUpgraded, carrierDamaged, strikePlanned, manualRequest } = params;

  if (strategy === 'disabled') return false;
  if (strategy === 'manual_only') return manualRequest;
  if (strategy === 'critical_events') return newContactThisTurn || contactUpgraded || carrierDamaged || strikePlanned;
  if (strategy === 'every_5_turns') return turn % 5 === 0 || newContactThisTurn || contactUpgraded || carrierDamaged || strikePlanned;
  return false;
}

// ========== Bearing/Distance helper ==========

export function bearingAndDist(ox: number, oy: number, tx: number, ty: number): { bearing: number; bearingLabel: string; dist: number } {
  const dx = tx - ox, dy = ty - oy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  let bearing = Math.atan2(dx, -dy) * 180 / Math.PI;
  if (bearing < 0) bearing += 360;
  const labels = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const label = labels[Math.round(bearing / 22.5) % 16];
  return { bearing: Math.round(bearing), bearingLabel: label, dist: Math.round(dist) };
}
