import type { AIProviderConfig, NavalLLMContext, NavalLLMAdvice, NavalLLMCommandResult } from './types';
import { getOllamaBaseUrl, getOllamaModel } from './api-key';

const DEFAULT_DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';

export async function callDeepSeekAPI(params: {
  config: AIProviderConfig;
  systemPrompt: string;
  userMessage: string;
}): Promise<string> {
  const { config, systemPrompt, userMessage } = params;
  const endpoint = config.endpoint || DEFAULT_DEEPSEEK_ENDPOINT;
  const model = config.model || DEFAULT_DEEPSEEK_MODEL;
  const apiKey = config.apiKey;

  if (!apiKey) {
    throw new Error('DeepSeek API key not configured');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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
    const err = await response.text();
    throw new Error(`DeepSeek ${response.status}: ${err.slice(0, 200)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callOllamaChat(params: {
  config: AIProviderConfig;
  systemPrompt: string;
  userMessage: string;
}): Promise<string> {
  const baseUrl = (params.config.endpoint || getOllamaBaseUrl()).replace(/\/+$/, '');
  const model = params.config.model || getOllamaModel();
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: `/no_think\n${params.systemPrompt}` },
        { role: 'user', content: params.userMessage },
      ],
      stream: false,
      format: 'json',
      think: false,
      options: {
        temperature: params.config.temperature ?? 0,
        num_predict: params.config.maxTokens ?? 700,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const data = await response.json();
  return String(data.message?.content || data.response || '');
}

export async function getNavalAdvice(params: { config: AIProviderConfig; context: NavalLLMContext }): Promise<NavalLLMAdvice> {
  const { config, context } = params;
  if (config.kind === 'none' || config.kind === 'rule_based') return getRuleBasedAdvice(context);

  try {
    const systemPrompt = [
      'You are a WWII carrier task force staff officer.',
      'Use only the supplied known contacts and friendly status.',
      'Return JSON: situationAssessment, recommendations[], suggestedCommands[], riskLevel.',
    ].join('\n');
    const raw = config.kind === 'ollama'
      ? await callOllamaChat({ config, systemPrompt, userMessage: JSON.stringify(context) })
      : await callDeepSeekAPI({ config, systemPrompt, userMessage: JSON.stringify(context) });
    const parsed = parseJSON(raw);
    if (!parsed) return getRuleBasedAdvice(context);
    return {
      situationAssessment: String(parsed.situationAssessment || parsed.assessment || ''),
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      suggestedCommands: Array.isArray(parsed.suggestedCommands) ? parsed.suggestedCommands : [],
      riskLevel: parsed.riskLevel === 'high' || parsed.riskLevel === 'low' ? parsed.riskLevel : 'medium',
    };
  } catch {
    return getRuleBasedAdvice(context);
  }
}

function getRuleBasedAdvice(context: NavalLLMContext): NavalLLMAdvice {
  const tracked = context.contacts.filter((contact) => ['tracked', 'identified', 'classified'].includes(contact.detectionLevel));
  const weak = context.contacts.filter((contact) => ['suspected', 'detected'].includes(contact.detectionLevel));
  const damaged = context.damagedShips.length;
  const recommendations: NavalLLMAdvice['recommendations'] = [];
  const suggestedCommands: NavalLLMAdvice['suggestedCommands'] = [];

  if (damaged > 0) {
    recommendations.push({ action: 'withdraw or repair damaged ships', priority: 'high', reasoning: `${damaged} damaged ship(s) need preservation decisions.` });
    suggestedCommands.push({ command: 'Withdraw to nearest friendly base', type: 'withdraw' });
  }
  if (tracked.length > 0) {
    recommendations.push({ action: 'prepare strike or shadow order', priority: 'high', reasoning: `${tracked.length} high-confidence contact(s) are strike-legal after validation.` });
    suggestedCommands.push({ command: `Strike contact ${tracked[0].contactId}`, type: 'strike' });
  } else if (weak.length > 0) {
    recommendations.push({ action: 'launch search to refine contact', priority: 'medium', reasoning: `${weak.length} low-confidence contact(s) should not be attacked directly.` });
    suggestedCommands.push({ command: `Search toward contact ${weak[0].contactId}`, type: 'search' });
  } else {
    recommendations.push({ action: 'launch search aircraft', priority: 'medium', reasoning: 'No enemy contact is currently known.' });
    suggestedCommands.push({ command: 'Launch search aircraft west', type: 'search' });
  }

  return {
    situationAssessment: context.contacts.length > 0
      ? `${context.contacts.length} known contact(s); ${tracked.length} high-confidence; ${weak.length} low-confidence.`
      : 'No enemy contacts. Search coverage is the priority.',
    recommendations,
    suggestedCommands,
    riskLevel: damaged > 0 || tracked.length > 0 ? 'medium' : 'low',
  };
}

export async function parseNaturalCommand(params: {
  config: AIProviderConfig;
  userInput: string;
  context: NavalLLMContext;
}): Promise<NavalLLMCommandResult> {
  const local = parseCommandLocally(params.userInput, params.context);
  if (local.parsed || params.config.kind !== 'ollama') return local;

  try {
    const raw = await callOllamaChat({
      config: params.config,
      systemPrompt: 'Parse the user naval command into JSON: parsed,intent,targetDescription,fleetId,actionType,targetPosition,explanation. Do not invent enemy contacts.',
      userMessage: JSON.stringify({ command: params.userInput, context: params.context }),
    });
    const parsed = parseJSON(raw);
    if (!parsed) return local;
    return {
      parsed: Boolean(parsed.parsed),
      intent: String(parsed.intent || local.intent),
      targetDescription: String(parsed.targetDescription || local.targetDescription),
      fleetId: typeof parsed.fleetId === 'string' ? parsed.fleetId : local.fleetId,
      actionType: typeof parsed.actionType === 'string' ? parsed.actionType : local.actionType,
      targetPosition: isPosition(parsed.targetPosition) ? parsed.targetPosition : local.targetPosition,
      explanation: String(parsed.explanation || local.explanation),
      rawResponse: raw,
    };
  } catch {
    return local;
  }
}

export function buildNavalLLMContext(params: any): NavalLLMContext {
  const fleets = Array.isArray(params.fleets) ? params.fleets : [];
  const contacts = Array.isArray(params.contacts) ? params.contacts : [];
  const reports = Array.isArray(params.reports) ? params.reports : [];

  return {
    turn: params.turn ?? 0,
    environment: {
      timeOfDay: params.environment?.timeOfDay || 'day',
      weather: params.environment?.weather || 'clear',
      seaState: params.environment?.seaState ?? 1,
    },
    friendlyFleets: fleets
      .filter((fleet: any) => fleet.faction === 'player')
      .map((fleet: any) => ({
        fleetId: fleet.id,
        name: fleet.name,
        type: fleet.type,
        faction: fleet.faction,
        position: { x: fleet.position?.globalX ?? fleet.position?.x ?? 0, y: fleet.position?.globalY ?? fleet.position?.y ?? 0 },
        shipCount: fleet.ships?.length ?? 0,
        fuelState: fleet.fuelState || 'unknown',
        ammoState: fleet.ammoState || 'unknown',
        mission: fleet.mission || 'unknown',
      })),
    contacts: contacts.map((contact: any) => ({
      contactId: contact.id,
      detectionLevel: contact.detectionLevel,
      confidence: contact.confidence,
      estimatedClass: contact.estimatedClass || 'unknown',
      lastKnownPosition: contact.lastKnownPosition,
      uncertaintyRadius: contact.uncertaintyRadius,
      lastDetectedTurn: contact.lastDetectedTurn,
    })),
    damagedShips: fleets
      .flatMap((fleet: any) => fleet.ships || [])
      .filter((ship: any) => ship.damage && ship.damage.status !== 'combat_effective')
      .map((ship: any) => ({
        shipName: ship.name,
        shipClass: ship.shipClass,
        status: ship.damage.status,
        hullIntegrity: ship.damage.hullIntegrity,
        flooding: ship.damage.flooding,
        fire: ship.damage.fire,
        buoyancy: ship.damage.buoyancy,
      })),
    recentReports: reports.map((report: any) => ({
      type: report.type,
      title: report.title,
      summary: report.summary,
    })),
    knownOnly: true,
  };
}

function parseCommandLocally(userInput: string, context: NavalLLMContext): NavalLLMCommandResult {
  const lower = userInput.toLowerCase();
  const fleet = context.friendlyFleets[0];
  const targetPosition = parseCoordinate(userInput);
  let actionType = '';
  let intent = '';

  if (/cap|防空|空中巡逻/.test(lower)) {
    actionType = 'launch_cap';
    intent = 'protect';
  } else if (/strike|attack|打击|攻击/.test(lower)) {
    actionType = 'launch_strike';
    intent = 'strike';
  } else if (/withdraw|retreat|撤退|返航/.test(lower)) {
    actionType = 'withdraw_fleet';
    intent = 'withdraw';
  } else if (/repair|修理|维修|补给/.test(lower)) {
    actionType = 'repair_fleet';
    intent = 'repair';
  } else if (/move|heading|course|移动|航向|前往/.test(lower)) {
    actionType = 'move_fleet';
    intent = 'move';
  } else if (/search|recon|侦察|搜索|搜寻/.test(lower)) {
    actionType = 'launch_search';
    intent = 'search';
  }

  return {
    parsed: Boolean(actionType && fleet),
    intent,
    targetDescription: targetPosition ? `position ${targetPosition.x},${targetPosition.y}` : '',
    fleetId: fleet?.fleetId,
    actionType,
    targetPosition,
    explanation: actionType ? `Parsed as ${actionType}` : 'No deterministic command pattern matched.',
    rawResponse: '',
  };
}

function parseJSON(raw: string): any | null {
  try {
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first < 0 || last < first) return null;
    return JSON.parse(raw.slice(first, last + 1));
  } catch {
    return null;
  }
}

function parseCoordinate(text: string): { x: number; y: number } | undefined {
  const match = text.match(/(?:\(|\[)?\s*([0-9]{2,5})\s*[,，]\s*([0-9]{2,5})\s*(?:\)|\])?/);
  if (!match) return undefined;
  return { x: Number(match[1]), y: Number(match[2]) };
}

function isPosition(value: any): value is { x: number; y: number } {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y);
}
