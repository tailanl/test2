/**
 * API Key Manager - 从 localStorage 读取，不硬编码
 * 用户通过 Web UI 输入 key 保存到 localStorage
 */

export function getAPIKey(): string {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem('deepseek_api_key') || '';
  }
  return '';
}

export function setAPIKey(key: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('deepseek_api_key', key);
  }
}

export function clearAPIKey(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('deepseek_api_key');
  }
}
