import type { LLMCommanderDecision } from './llm-decision-types';

export interface LLMOutputTrace {
  id: string;
  source: 'commander_decision' | 'visual_assessment' | 'campaign_controller' | 'diagnostic';
  provider: string;
  model: string;
  role?: string;
  faction?: string;
  turn?: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  prompt?: {
    system?: string;
    user?: string;
  };
  rawOutput: string | null;
  parsedDecision?: LLMCommanderDecision | null;
  parsedOutput?: unknown;
  parseError?: string;
  requestError?: string;
  metadata?: Record<string, unknown>;
}

export interface LLMDecisionProviderResult {
  decision: LLMCommanderDecision | null;
  trace?: LLMOutputTrace;
}

export function isLLMDecisionProviderResult(value: unknown): value is LLMDecisionProviderResult {
  return !!value && typeof value === 'object' && 'decision' in value;
}

export function createTraceId(prefix: string, turn?: number): string {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${turn ?? 'na'}_${suffix}`;
}
