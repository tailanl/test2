import React from 'react';
import { useNavalStore } from '@/store/naval-store';

const TYPE_ICONS: Record<string, string> = {
  CONTACT_REPORT: '📡', DAMAGE_REPORT: '💥', FLOODING_REPORT: '🌊', FIRE_REPORT: '🔥',
  STRIKE_REPORT: '🛩️', CAP_REPORT: '🛡️', AIR_SEARCH_REPORT: '🔭', SUBMARINE_CONTACT: '🐋',
  WITHDRAWAL_REPORT: '🏃', REQUEST_AUTHORIZATION: '📝',
};

export function NavalReportPanel() {
  const { reports } = useNavalStore();

  if (reports.length === 0) return (
    <div className="p-4 text-center space-y-2">
      <div className="text-3xl">📋</div>
      <div className="text-slate-500 text-xs">NO REPORTS</div>
      <div className="text-slate-700 text-[10px]">Reports generated after combat and contact events</div>
    </div>
  );

  return (
    <div className="p-2 space-y-2">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-slate-400 tracking-wider">SITUATION REPORTS</span>
        <span className="text-amber-400 font-bold">{reports.length}</span>
      </div>
      {[...reports].reverse().slice(0, 20).map((r, i) => (
        <div key={i} className={`p-2 rounded text-xs border ${r.type.includes('DAMAGE')||r.type.includes('FLOODING') ? 'border-red-900/30 bg-red-950/10' : r.type.includes('FIRE') ? 'border-orange-900/30 bg-orange-950/10' : 'border-slate-800 bg-slate-900/30'}`}>
          <div className="flex items-center gap-1.5 mb-1">
            <span>{TYPE_ICONS[r.type] || '📄'}</span>
            <span className={`font-bold ${r.type.includes('DAMAGE') ? 'text-red-400' : r.type.includes('FIRE') ? 'text-orange-400' : r.type.includes('FLOODING') ? 'text-blue-400' : 'text-amber-400'}`}>{r.type.replace(/_/g,' ')}</span>
            <span className="ml-auto text-[9px] text-slate-600">T{r.turn}</span>
          </div>
          <div className="font-semibold text-slate-200">{r.title}</div>
          <div className="text-slate-400 mt-0.5 text-[10px]">{r.summary}</div>
          {r.recommendations.length > 0 && (
            <div className="mt-1 pt-1 border-t border-slate-800/50">
              {r.recommendations.slice(0,2).map((rec, j) => (
                <div key={j} className={`text-[9px] ${rec.urgency === 'critical' ? 'text-red-400 font-bold' : rec.urgency === 'high' ? 'text-orange-400' : 'text-slate-500'}`}>
                  [{rec.urgency}] {rec.text}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
