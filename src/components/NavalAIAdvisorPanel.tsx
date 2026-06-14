import React, { useState } from 'react';
import { useNavalStore } from '@/store/naval-store';

export function NavalAIAdvisorPanel() {
  const { aiConfig, aiAdvice, aiLoading, aiError, requestAIAdvice, submitACommand, currentTurn } = useNavalStore();
  const [cmd, setCmd] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <div className="flex flex-col p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-purple-400">🧠 AI ADVISOR</span>
        <span className="text-[10px] text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{aiConfig.model}</span>
      </div>

      <button onClick={requestAIAdvice} disabled={aiLoading}
        className="btn-navy w-full py-2.5 rounded-lg text-white font-bold text-sm disabled:opacity-50">
        {aiLoading ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin"/>Analyzing...</span> : '📡 REQUEST TACTICAL ADVICE'}
      </button>

      {aiError && <div className="p-2 bg-red-950/30 border border-red-900/30 rounded text-red-400 text-[10px]">{aiError}</div>}

      {aiAdvice && (
        <div className="space-y-2">
          <div className="p-2.5 glass rounded-lg border border-blue-900/20">
            <div className="text-[10px] text-slate-500 uppercase mb-1">Situation Assessment</div>
            <div className="text-slate-200 text-xs leading-relaxed">{aiAdvice.situationAssessment}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">Risk:</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${aiAdvice.riskLevel === 'high' ? 'bg-red-900/30 text-red-400' : aiAdvice.riskLevel === 'medium' ? 'bg-yellow-900/30 text-yellow-400' : 'bg-green-900/30 text-green-400'}`}>{aiAdvice.riskLevel.toUpperCase()}</span>
          </div>
          {aiAdvice.recommendations.map((r, i) => (
            <div key={i} className={`p-2 rounded border text-[10px] ${r.priority === 'high' ? 'border-red-900/30 bg-red-950/10' : 'border-slate-800 bg-slate-900/30'}`}>
              <div className="flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${r.priority === 'high' ? 'bg-red-400' : 'bg-yellow-400'}`}/><span className="text-slate-200">{r.action}</span></div>
              <div className="text-slate-600 mt-0.5 ml-3">{r.reasoning}</div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-slate-800 pt-2">
        <div className="text-[10px] text-slate-500 uppercase mb-1">Voice Command</div>
        <form onSubmit={async (e) => { e.preventDefault(); if(!cmd.trim()) return; setLoading(true); try { const r = await submitACommand(cmd); setResult(r ? (r.parsed ? `[${r.intent}] ${r.explanation}` : r.explanation||'?') : 'Failed'); } catch { setResult('Error'); } setLoading(false); setCmd(''); }}
          className="flex gap-1">
          <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder='e.g. "Search enemy fleet"'
            className="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-amber-500/50" />
          <button type="submit" disabled={loading} className="btn-gold px-3 py-1.5 rounded text-xs font-bold text-white disabled:opacity-50">Send</button>
        </form>
        {result && <div className="mt-1 p-1.5 glass rounded text-[10px] text-green-400">{result}</div>}
      </div>
    </div>
  );
}
