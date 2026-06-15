/**
 * LLMKnowledgePanel - 显示 LLM 当前看到的信息摘要
 */

import React from 'react';
import { useNavalStore } from '@/store/naval-store';
import { buildFactionKnowledge, sanitizeKnowledgeForLLM } from '@/ai/information-filter';

export function LLMKnowledgePanel() {
  const fleets = useNavalStore(s => s.fleets);
  const intel = useNavalStore(s => s.intel);
  const reports = useNavalStore(s => s.reports);
  const currentTurn = useNavalStore(s => s.currentTurn);
  const overlay = useNavalStore(s => s.overlay);

  if (!overlay || fleets.length === 0) return null;

  try {
    const truth = {
      turn: currentTurn,
      playerFleets: fleets.filter(f => f.faction === 'player') as any,
      enemyFleets: fleets.filter(f => f.faction === 'enemy') as any,
      allBases: [] as any, allSupplyLines: [] as any, weather: 'clear',
    };
    const knowledge = buildFactionKnowledge({ faction: 'player', truth, intel, reports, currentTurn });
    const context = sanitizeKnowledgeForLLM(knowledge);

    return (
      <div className="px-5 py-3 border-b border-emerald-900/20 text-[10px]">
        <div className="text-emerald-400 font-bold text-xs mb-2 tracking-wider">🧠 LLM 可见情报</div>
        <div className="space-y-1 text-slate-400">
          <div>本方舰队: {context.ownForces.length}支 ({context.ownForces.map(f => f.name).join(', ')})</div>
          <div>已知接触: {context.knownContacts.length}个</div>
          {context.knownContacts.map(c => (
            <div key={c.contactId} className="ml-2 text-[9px]">[{c.detectionLevel}] {c.estimatedClass} ±{c.uncertaintyRadius}</div>
          ))}
          <div>报告: {context.recentReports.length}份</div>
          <div>合法行动: {context.legalActionHints.join(', ')}</div>
          <div className="text-emerald-600 text-[9px] mt-1">✅ 未泄露敌方真实舰队数据</div>
        </div>
      </div>
    );
  } catch {
    return <div className="px-5 py-3 text-[10px] text-slate-600">LLM 情报面板暂不可用</div>;
  }
}
