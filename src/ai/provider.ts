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
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 600,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// ===== 生成战术建议 =====

export async function getNavalAdvice(params: {
  config: AIProviderConfig;
  context: NavalLLMContext;
}): Promise<NavalLLMAdvice> {
  const { config, context } = params;

  if (config.kind === 'none' || config.kind === 'rule_based') {
    return getRuleBasedAdvice(context);
  }

  const systemPrompt = `你是一个二战太平洋海战AI战术顾问。你会收到当前战场情报（仅包含已探测到的敌方接触，不包含隐藏敌舰的真实位置）。

你必须以JSON格式回复，格式如下：
{
  "situationAssessment": "对当前局势的简要分析（中文）",
  "recommendations": [
    { "action": "建议行动", "priority": "high|medium|low", "reasoning": "理由" }
  ],
  "suggestedCommands": [
    { "command": "具体命令（中文）", "fleetId": "舰队ID", "type": "search|strike|intercept|withdraw|escort|patrol" }
  ],
  "riskLevel": "low|medium|high"
}

注意：
- 你只能看到已探测的敌方contact，不能假设知道隐藏敌舰位置
- 航母应保持距离，用舰载机搜索和打击
- 受损舰船优先考虑撤退
- 潜艇优先攻击运输船和航母`;

  try {
    const contextStr = JSON.stringify(context, null, 2);
    const userMessage = `当前回合: ${context.turn}\n战场情报:\n${contextStr}\n\n请给出战术建议。`;

    const rawResponse = await callDeepSeekAPI({ config, systemPrompt, userMessage });

    // 尝试解析 JSON
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        situationAssessment: parsed.situationAssessment || '无法解析局势评估',
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
        suggestedCommands: Array.isArray(parsed.suggestedCommands) ? parsed.suggestedCommands : [],
        riskLevel: parsed.riskLevel || 'medium',
      };
    }

    // JSON 解析失败，返回原始文本作为评估
    return {
      situationAssessment: rawResponse,
      recommendations: [],
      suggestedCommands: [],
      riskLevel: 'medium',
    };
  } catch (e) {
    console.warn('DeepSeek API failed, using rule-based fallback:', e);
    return getRuleBasedAdvice(context);
  }
}

// ===== 解析自然语言命令 =====

export async function parseNaturalCommand(params: {
  config: AIProviderConfig;
  userInput: string;
  context: NavalLLMContext;
}): Promise<NavalLLMCommandResult> {
  const { config, userInput, context } = params;

  if (config.kind === 'none' || config.kind === 'rule_based') {
    return parseRuleBasedCommand(userInput, context);
  }

  const systemPrompt = `你是一个海战命令解析器。将用户的自然语言命令转换为结构化格式。

你必须以JSON格式回复：
{
  "intent": "search|strike|intercept|withdraw|escort|patrol",
  "targetDescription": "目标描述",
  "fleetId": "指定的舰队ID或空",
  "actionType": "search|strike|move|defend",
  "explanation": "命令解读"
}

可用舰队：${context.friendlyFleets.map((f) => `${f.fleetId}: ${f.name}(${f.type})`).join(', ')}`;

  try {
    const userMessage = `用户命令: ${userInput}\n当前回合: ${context.turn}\n可用舰队: ${JSON.stringify(context.friendlyFleets.map((f) => ({ id: f.fleetId, name: f.name, type: f.type })))}`;
    const rawResponse = await callDeepSeekAPI({ config, systemPrompt, userMessage });

    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        parsed: true,
        intent: parsed.intent || '',
        targetDescription: parsed.targetDescription || '',
        fleetId: parsed.fleetId || undefined,
        actionType: parsed.actionType,
        explanation: parsed.explanation || '',
        rawResponse,
      };
    }

    return {
      parsed: false,
      intent: '',
      targetDescription: '',
      explanation: rawResponse,
      rawResponse,
    };
  } catch (e) {
    return parseRuleBasedCommand(userInput, context);
  }
}

// ===== 规则回退：战术建议 =====

function getRuleBasedAdvice(context: NavalLLMContext): NavalLLMAdvice {
  const hasContacts = context.contacts.length > 0;
  const hasDamaged = context.damagedShips.length > 0;
  const trackedContacts = context.contacts.filter((c) => c.detectionLevel === 'tracked' || c.detectionLevel === 'identified');

  const recommendations: NavalLLMAdvice['recommendations'] = [];
  const suggestedCommands: NavalLLMAdvice['suggestedCommands'] = [];

  if (trackedContacts.length > 0) {
    recommendations.push({
      action: `${trackedContacts.length}个目标已跟踪，建议发动舰载机打击`,
      priority: 'high',
      reasoning: '已获得足够精度的目标信息',
    });
    suggestedCommands.push({
      command: '发动航空打击',
      fleetId: context.friendlyFleets[0]?.fleetId,
      type: 'strike',
    });
  } else if (context.contacts.length > 0) {
    recommendations.push({
      action: `有${context.contacts.length}个可疑接触，建议派遣搜索机确认`,
      priority: 'medium',
      reasoning: '需要升级接触等级以获得攻击授权',
    });
    suggestedCommands.push({
      command: '发射搜索机',
      fleetId: context.friendlyFleets[0]?.fleetId,
      type: 'search',
    });
  } else {
    recommendations.push({
      action: '当前无敌方接触，建议执行巡逻搜索',
      priority: 'medium',
      reasoning: '需要主动搜索以发现敌方舰队',
    });
    suggestedCommands.push({
      command: '执行巡逻搜索',
      fleetId: context.friendlyFleets[0]?.fleetId,
      type: 'patrol',
    });
  }

  if (hasDamaged) {
    recommendations.push({
      action: `${context.damagedShips.length}艘舰船受损，评估是否需要撤退`,
      priority: context.damagedShips.some((s) => s.status === 'crippled' || s.status === 'sinking') ? 'high' : 'medium',
      reasoning: '保护受损舰船，避免进一步损失',
    });
  }

  return {
    situationAssessment: hasContacts
      ? `回合${context.turn}: 探测到${context.contacts.length}个敌方接触，其中${trackedContacts.length}个已跟踪。${hasDamaged ? `有${context.damagedShips.length}艘舰船受损。` : ''}`
      : `回合${context.turn}: 当前无敌方接触。${hasDamaged ? `有${context.damagedShips.length}艘舰船受损。` : ''}`,
    recommendations,
    suggestedCommands,
    riskLevel: hasContacts ? 'medium' : 'low',
  };
}

// ===== 规则回退：命令解析 =====

function parseRuleBasedCommand(userInput: string, context: NavalLLMContext): NavalLLMCommandResult {
  const lower = userInput.toLowerCase();
  const fleets = context.friendlyFleets;

  let intent = '';
  let fleetId: string | undefined;
  let actionType = '';

  // 简单关键词匹配
  if (lower.includes('搜索') || lower.includes('search') || lower.includes('侦察') || lower.includes('recon')) {
    intent = 'search';
    actionType = 'search';
  } else if (lower.includes('打击') || lower.includes('攻击') || lower.includes('strike') || lower.includes('attack')) {
    intent = 'strike';
    actionType = 'strike';
  } else if (lower.includes('拦截') || lower.includes('intercept')) {
    intent = 'intercept';
    actionType = 'intercept';
  } else if (lower.includes('撤退') || lower.includes('撤退') || lower.includes('withdraw') || lower.includes('retreat')) {
    intent = 'withdraw';
    actionType = 'withdraw';
  } else if (lower.includes('护航') || lower.includes('escort')) {
    intent = 'escort';
    actionType = 'escort';
  } else if (lower.includes('巡逻') || lower.includes('patrol')) {
    intent = 'patrol';
    actionType = 'patrol';
  }

  // 匹配舰队
  for (const f of fleets) {
    if (lower.includes(f.name.toLowerCase()) || lower.includes(f.fleetId.toLowerCase())) {
      fleetId = f.fleetId;
      break;
    }
  }
  if (!fleetId && fleets.length > 0) fleetId = fleets[0].fleetId;

  return {
    parsed: intent !== '',
    intent,
    targetDescription: userInput,
    fleetId,
    actionType,
    explanation: `规则匹配: intent=${intent}, fleet=${fleetId || 'none'}`,
    rawResponse: '',
  };
}

// ===== 构建 LLM 上下文 =====

export function buildNavalLLMContext(params: {
  turn: number;
  fleets: Array<{
    id: string; name: string; type: string; faction: string;
    position: { globalX: number; globalY: number };
    ships: Array<{ id: string; name: string; shipClass: string; damage: { status: string; hullIntegrity: number; flooding: number; fire: number; buoyancy: number } }>;
    fuelState: string; ammoState: string; mission: string;
  }>;
  contacts: Array<{
    id: string; detectionLevel: string; confidence: string;
    estimatedClass?: string; lastKnownPosition: { x: number; y: number };
    uncertaintyRadius: number; lastDetectedTurn: number;
  }>;
  reports: Array<{ type: string; title: string; summary: string }>;
  environment: { timeOfDay: string; weather: string; seaState: number };
}): NavalLLMContext {
  const friendlyFleets = params.fleets
    .filter((f) => f.faction === 'player')
    .map((f) => ({
      fleetId: f.id,
      name: f.name,
      type: f.type,
      faction: f.faction,
      position: { x: f.position.globalX, y: f.position.globalY },
      shipCount: f.ships.length,
      fuelState: f.fuelState,
      ammoState: f.ammoState,
      mission: f.mission,
    }));

  const damagedShips = params.fleets
    .flatMap((f) => f.ships)
    .filter((s) => s.damage.status !== 'combat_effective')
    .map((s) => ({
      shipName: s.name,
      shipClass: s.shipClass,
      status: s.damage.status,
      hullIntegrity: s.damage.hullIntegrity,
      flooding: s.damage.flooding,
      fire: s.damage.fire,
      buoyancy: s.damage.buoyancy,
    }));

  const contactSummaries = params.contacts.map((c) => ({
    contactId: c.id,
    detectionLevel: c.detectionLevel,
    confidence: c.confidence,
    estimatedClass: c.estimatedClass || 'unknown',
    lastKnownPosition: c.lastKnownPosition,
    uncertaintyRadius: c.uncertaintyRadius,
    lastDetectedTurn: c.lastDetectedTurn,
  }));

  const recentReports = params.reports.slice(-5).map((r) => ({
    type: r.type,
    title: r.title,
    summary: r.summary,
  }));

  return {
    turn: params.turn,
    environment: params.environment,
    friendlyFleets,
    contacts: contactSummaries,
    damagedShips,
    recentReports,
    knownOnly: true,
  };
}
