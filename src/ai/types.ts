/**
 * AI Provider 类型定义
 */

// ===== Provider 配置 =====

export type AIProviderKind = 'none' | 'rule_based' | 'deepseek' | 'ollama';

export interface AIProviderConfig {
  kind: AIProviderKind;
  model?: string;
  endpoint?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

// ===== LLM 可看到的内容（不泄露隐藏敌舰） =====

export interface ForceSummary {
  fleetId: string;
  name: string;
  type: string;
  faction: string;
  position: { x: number; y: number };
  shipCount: number;
  fuelState: string;
  ammoState: string;
  mission: string;
}

export interface ContactSummary {
  contactId: string;
  detectionLevel: string;
  confidence: string;
  estimatedClass: string;
  lastKnownPosition: { x: number; y: number };
  uncertaintyRadius: number;
  lastDetectedTurn: number;
}

export interface DamageSummary {
  shipName: string;
  shipClass: string;
  status: string;
  hullIntegrity: number;
  flooding: number;
  fire: number;
  buoyancy: number;
}

export interface NavalLLMContext {
  turn: number;
  environment: {
    timeOfDay: string;
    weather: string;
    seaState: number;
  };
  friendlyFleets: ForceSummary[];
  contacts: ContactSummary[];
  damagedShips: DamageSummary[];
  recentReports: Array<{ type: string; title: string; summary: string }>;
  knownOnly: true;
}

// ===== LLM 输出（必须通过验证） =====

export interface NavalLLMAdvice {
  situationAssessment: string;
  recommendations: Array<{
    action: string;
    priority: 'high' | 'medium' | 'low';
    reasoning: string;
  }>;
  suggestedCommands: Array<{
    command: string;
    fleetId?: string;
    type: 'search' | 'strike' | 'intercept' | 'withdraw' | 'escort' | 'patrol';
  }>;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface NavalLLMCommandResult {
  parsed: boolean;
  intent: string;
  targetDescription: string;
  fleetId?: string;
  actionType?: string;
  targetPosition?: { x: number; y: number };
  explanation: string;
  rawResponse: string;
}
