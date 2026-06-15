/**
 * API Key Manager - 支持 DeepSeek + GLM 双 provider
 * 从 localStorage 读取，不硬编码
 */

const DS_KEY = 'deepseek_api_key';
const GLM_KEY = 'glm_api_key';

export function getDeepSeekKey(): string {
  if (typeof localStorage !== 'undefined') return localStorage.getItem(DS_KEY) || '';
  return '';
}

export function setDeepSeekKey(key: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(DS_KEY, key);
}

export function getGLMKey(): string {
  if (typeof localStorage !== 'undefined') return localStorage.getItem(GLM_KEY) || '';
  return '';
}

export function setGLMKey(key: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(GLM_KEY, key);
}

/** @deprecated use getDeepSeekKey() */
export function getAPIKey(): string { return getDeepSeekKey(); }
/** @deprecated use setDeepSeekKey() */
export function setAPIKey(key: string): void { setDeepSeekKey(key); }
/** @deprecated */
export function clearAPIKey(): void { if (typeof localStorage !== 'undefined') localStorage.removeItem(DS_KEY); }
