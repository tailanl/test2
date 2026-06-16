/**
 * API and local model settings.
 *
 * Values are read from localStorage first, then Vite env vars. This keeps
 * browser testing configurable without hardcoding secrets or model names.
 */

const DS_KEY = 'deepseek_api_key';
const GLM_KEY = 'glm_api_key';
const LLM_PROVIDER_KEY = 'llm_provider';
const OLLAMA_MODEL_KEY = 'ollama_model';
const OLLAMA_BASE_URL_KEY = 'ollama_base_url';

export type CommanderLLMProvider = 'deepseek' | 'ollama';

export function getDeepSeekKey(): string {
  const stored = getStoredValue(DS_KEY);
  if (stored) return stored;
  return getEnvKey('VITE_DEEPSEEK_API_KEY') || getEnvKey('DEEPSEEK_API_KEY');
}

export function setDeepSeekKey(key: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(DS_KEY, key);
}

export function getGLMKey(): string {
  const stored = getStoredValue(GLM_KEY);
  if (stored) return stored;
  return getEnvKey('VITE_GLM_API_KEY') || getEnvKey('GLM_API_KEY');
}

export function setGLMKey(key: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(GLM_KEY, key);
}

export function getCommanderLLMProvider(): CommanderLLMProvider {
  const value = (
    getStoredValue(LLM_PROVIDER_KEY) ||
    getEnvKey('VITE_LLM_PROVIDER') ||
    getEnvKey('LLM_PROVIDER') ||
    'ollama'
  ).toLowerCase();
  return value === 'ollama' ? 'ollama' : 'deepseek';
}

export function setCommanderLLMProvider(provider: CommanderLLMProvider): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(LLM_PROVIDER_KEY, provider);
}

export function getOllamaModel(): string {
  return getStoredValue(OLLAMA_MODEL_KEY) ||
    getEnvKey('VITE_OLLAMA_MODEL') ||
    getEnvKey('OLLAMA_MODEL') ||
    'qwen3.5:0.8b';
}

export function setOllamaModel(model: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(OLLAMA_MODEL_KEY, model);
}

export function getOllamaBaseUrl(): string {
  return trimTrailingSlash(
    getStoredValue(OLLAMA_BASE_URL_KEY) ||
    getEnvKey('VITE_OLLAMA_BASE_URL') ||
    getEnvKey('OLLAMA_BASE_URL') ||
    'http://127.0.0.1:11434',
  );
}

export function setOllamaBaseUrl(url: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(OLLAMA_BASE_URL_KEY, url);
}

/** @deprecated use getDeepSeekKey() */
export function getAPIKey(): string { return getDeepSeekKey(); }
/** @deprecated use setDeepSeekKey() */
export function setAPIKey(key: string): void { setDeepSeekKey(key); }
/** @deprecated */
export function clearAPIKey(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(DS_KEY);
}

function getEnvKey(name: string): string {
  return ((import.meta as any).env?.[name] as string | undefined) || '';
}

function getStoredValue(key: string): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(key) || '';
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
