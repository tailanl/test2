/**
 * GLM Provider Config
 */

export type GLMModel = 'glm-4.6v-flashx' | 'glm-4.6v' | 'glm-4.6v-flash';

export type GLMCallStrategy = 'disabled' | 'manual_only' | 'critical_events' | 'every_5_turns';

export interface GLMProviderConfig {
  endpoint: string;
  model: GLMModel;
  apiKey: string;
  strategy: GLMCallStrategy;
  temperature: number;
  maxTokens: number;
}

export const GLM_DEFAULTS = {
  endpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
  flashModel: 'glm-4.6v-flashx' as GLMModel,
  highQualityModel: 'glm-4.6v-flashx' as GLMModel,
  fallbackModel: 'glm-4.6v-flash' as GLMModel,
  strategy: 'disabled' as GLMCallStrategy,
  temperature: 0.6,
  maxTokens: 400,
};

export function createGLMConfig(overrides?: Partial<GLMProviderConfig>): GLMProviderConfig {
  return {
    endpoint: GLM_DEFAULTS.endpoint,
    model: GLM_DEFAULTS.flashModel,
    apiKey: '',
    strategy: GLM_DEFAULTS.strategy,
    temperature: GLM_DEFAULTS.temperature,
    maxTokens: GLM_DEFAULTS.maxTokens,
    ...overrides,
  };
}
