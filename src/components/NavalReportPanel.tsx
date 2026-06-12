/**
 * NavalReportPanel - 报告面板
 * 只显示已知/估计信息，不显示隐藏敌舰
 */

import React from 'react';
import { useNavalStore } from '@/store/naval-store';

export function NavalReportPanel() {
  const { reports } = useNavalStore();

  if (reports.length === 0) {
    return (
      <div className="p-4 text-gray-500 text-sm">
        <div className="text-gray-400/50 text-xs font-bold mb-2">NO REPORTS</div>
        <p className="text-xs">No battle reports generated yet.</p>
        <p className="text-xs mt-2 text-gray-600">Reports are generated when contacts are made, damage occurs, or missions complete.</p>
      </div>
    );
  }

  return (
    <div className="p-2 text-sm space-y-2">
      {reports.slice().reverse().map((report) => (
        <div key={report.id} className={`p-2 rounded border text-xs ${
          report.type.includes('DAMAGE') || report.type.includes('FIRE') || report.type.includes('FLOODING')
            ? 'border-red-900/50 bg-red-950/20'
            : report.type.includes('CONTACT')
            ? 'border-amber-900/50 bg-amber-950/20'
            : 'border-gray-800 bg-gray-900/50'
        }`}>
          <div className="flex items-center justify-between mb-1">
            <span className={`font-bold ${
              report.type.includes('DAMAGE') ? 'text-red-400' :
              report.type.includes('FIRE') ? 'text-orange-400' :
              report.type.includes('FLOODING') ? 'text-blue-400' :
              'text-amber-400'
            }`}>
              {report.type.replace(/_/g, ' ')}
            </span>
            <span className="text-gray-600">T{report.turn}</span>
          </div>

          <div className="font-semibold text-gray-200 mb-1">{report.title}</div>
          <div className="text-gray-400 mb-1">{report.summary}</div>

          {report.facts.length > 0 && (
            <div className="mb-1">
              <div className="text-[10px] text-gray-500 uppercase">Facts</div>
              {report.facts.map((f, i) => (
                <div key={i} className="text-gray-400 pl-2">{f}</div>
              ))}
            </div>
          )}

          {report.estimates.length > 0 && (
            <div className="mb-1">
              <div className="text-[10px] text-yellow-500/70 uppercase">Estimates</div>
              {report.estimates.map((e, i) => (
                <div key={i} className="text-yellow-400/60 pl-2 italic">{e}</div>
              ))}
            </div>
          )}

          {report.contacts.length > 0 && (
            <div className="mb-1">
              <div className="text-[10px] text-gray-500 uppercase">Contacts</div>
              {report.contacts.map((c) => (
                <div key={c.contactId} className="text-gray-500 pl-2">
                  {c.detectionLevel} @ ({c.lastKnownPosition.x.toFixed(0)}, {c.lastKnownPosition.y.toFixed(0)}) [{c.confidence}] ±{c.uncertaintyRadius.toFixed(1)}
                </div>
              ))}
            </div>
          )}

          {report.damagedShips.length > 0 && (
            <div className="mb-1">
              <div className="text-[10px] text-red-500/70 uppercase">Damaged Ships</div>
              {report.damagedShips.map((d) => (
                <div key={d.shipId} className="text-red-400 pl-2">
                  {d.shipName}: {d.damageSummary}
                </div>
              ))}
            </div>
          )}

          {report.recommendations.length > 0 && (
            <div>
              <div className="text-[10px] text-gray-500 uppercase">Recommendations</div>
              {report.recommendations.map((r, i) => (
                <div key={i} className={`pl-2 ${
                  r.urgency === 'critical' ? 'text-red-400 font-bold' :
                  r.urgency === 'high' ? 'text-orange-400' :
                  r.urgency === 'medium' ? 'text-yellow-400' :
                  'text-gray-400'
                }`}>
                  [{r.urgency}] {r.text}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
