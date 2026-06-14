import React from 'react';
import { useNavalStore } from '@/store/naval-store';

const LEVEL_COLORS: Record<string, string> = {
  tracked: 'border-amber-400 text-amber-400 bg-amber-400/5',
  identified: 'border-red-400 text-red-400 bg-red-400/5',
  classified: 'border-orange-400 text-orange-400 bg-orange-400/5',
  detected: 'border-yellow-400 text-yellow-400 bg-yellow-400/5',
  suspected: 'border-slate-400 text-slate-400 bg-slate-400/5',
  lost: 'border-slate-600 text-slate-600 bg-slate-600/5',
};

export function NavalIntelPanel() {
  const { intel } = useNavalStore();
  const contacts = intel.playerContacts;

  if (contacts.length === 0) return (
    <div className="p-4 text-center space-y-2">
      <div className="text-3xl">🔍</div>
      <div className="text-slate-500 text-xs">NO CONTACTS</div>
      <div className="text-slate-700 text-[10px]">Launch search aircraft to find enemy forces</div>
    </div>
  );

  return (
    <div className="p-2 space-y-3">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-slate-400 tracking-wider">CONTACT BOARD</span>
        <span className="text-amber-400 font-bold">{contacts.length} contacts</span>
      </div>
      {contacts.map((c) => (
        <div key={c.id} className={`p-2 border-l-2 rounded-r text-xs ${LEVEL_COLORS[c.detectionLevel] || 'border-slate-600'} ${c.stale ? 'opacity-50' : ''}`}>
          <div className="flex justify-between items-start">
            <div>
              <span className="font-bold">{c.estimatedClass || 'Unknown'}</span>
              <span className="ml-2 text-[10px] opacity-60">{c.contactType}</span>
            </div>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.confidence === 'high' ? 'bg-green-900/30 text-green-400' : c.confidence === 'medium' ? 'bg-yellow-900/30 text-yellow-400' : 'bg-slate-800 text-slate-500'}`}>{c.confidence}</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1 space-y-0.5">
            <div>📍 ({c.lastKnownPosition.x.toFixed(0)}, {c.lastKnownPosition.y.toFixed(0)}) ±{c.uncertaintyRadius.toFixed(1)}</div>
            <div>🕐 T{c.lastDetectedTurn} · via {c.detectedBy[c.detectedBy.length-1]?.sensorType?.replace(/_/g,' ') || '?'}</div>
            {c.trackHistory.length > 1 && <div>📈 {c.trackHistory.length} track points</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
