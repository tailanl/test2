/**
 * AIProviderSettingsPanel - API Key 设置面板
 */

import React, { useState } from 'react';
import { getDeepSeekKey, setDeepSeekKey, getGLMKey, setGLMKey } from '@/ai/api-key';
import type { GLMModel, GLMCallStrategy } from '@/ai/glm-config';

export function AIProviderSettingsPanel() {
  const [dsKey, setDSKey] = useState(getDeepSeekKey());
  const [glmKey, setGLMKeyLocal] = useState(getGLMKey());
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setDeepSeekKey(dsKey);
    setGLMKey(glmKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="px-5 py-3 border-b border-slate-800/50 text-[10px] space-y-2">
      <div className="text-slate-400 font-bold text-xs mb-2 tracking-wider">⚙️ AI 提供商设置</div>

      <div>
        <label className="text-slate-500">DeepSeek API Key</label>
        <input type="password" value={dsKey} onChange={e => setDSKey(e.target.value)}
          placeholder="sk-..."
          className="w-full px-2 py-1.5 mt-0.5 bg-slate-800 border border-slate-700 rounded text-[11px] text-slate-200 placeholder-slate-600 outline-none" />
      </div>

      <div>
        <label className="text-slate-500">GLM API Key (智谱AI)</label>
        <input type="password" value={glmKey} onChange={e => setGLMKeyLocal(e.target.value)}
          placeholder="GLM API Key..."
          className="w-full px-2 py-1.5 mt-0.5 bg-slate-800 border border-slate-700 rounded text-[11px] text-slate-200 placeholder-slate-600 outline-none" />
      </div>

      <button onClick={handleSave}
        className="w-full py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-bold">
        {saved ? '✅ 已保存' : '保存设置'}
      </button>
    </div>
  );
}
