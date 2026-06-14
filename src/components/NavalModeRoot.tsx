import React, { useState } from 'react';
import { useNavalStore } from '@/store/naval-store';
import { NavalStrategicMapPanel } from './NavalStrategicMapPanel';
import { NavalFleetPanel } from './NavalFleetPanel';
import { NavalIntelPanel } from './NavalIntelPanel';
import { NavalReportPanel } from './NavalReportPanel';
import { NavalAIAdvisorPanel } from './NavalAIAdvisorPanel';
import { NavalCampaignPanel } from './NavalCampaignPanel';

export function NavalModeRoot() {
  const {
    fleets, overlay, createNavalScenario, advanceNavalTurn, currentTurn, isCreatingScenario,
  } = useNavalStore();

  const [activeTab, setActiveTab] = useState<'fleet'|'intel'|'reports'|'ai'|'campaign'>('fleet');

  if (!overlay && fleets.length === 0) {
    return (
      <div className="flex items-center justify-center h-full navy-bg">
        <div className="text-center space-y-6 max-w-md">
          <div className="text-6xl">⚓</div>
          <h1 className="text-3xl font-black text-white tracking-wider">PACIFIC COMMAND</h1>
          <div className="h-px w-32 mx-auto bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
          <p className="text-sky-300/70 text-sm">WWII Carrier Task Force Operations</p>
          <div className="space-y-1.5 text-xs text-slate-500">
            <p>• Island chains with ports, airfields & supply depots</p>
            <p>• Fog of war with 7-level contact detection</p>
            <p>• DeepSeek AI campaign auto-play</p>
          </div>
          <button onClick={createNavalScenario} disabled={isCreatingScenario}
            className="btn-gold px-8 py-3 rounded-lg text-white font-bold text-base disabled:opacity-50 disabled:cursor-wait">
            {isCreatingScenario ? (
              <span className="flex items-center gap-2">
                <span className="w-5 h-5 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin" />
                Generating Pacific Map...
              </span>
            ) : '⚡ DEPLOY FLEET'}
          </button>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'fleet' as const, label: 'FLEET', icon: '🚢' },
    { id: 'intel' as const, label: 'INTEL', icon: '🔍' },
    { id: 'reports' as const, label: 'REPORTS', icon: '📋' },
    { id: 'ai' as const, label: 'AI', icon: '🧠' },
    { id: 'campaign' as const, label: 'CAMP', icon: '⚔️' },
  ];

  return (
    <div className="flex flex-col h-full bg-[#0a0e1a]">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 glass border-b border-blue-900/20 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-amber-400 font-black text-lg tracking-wider">PACIFIC COMMAND</span>
          <span className="text-slate-600 text-xs">|</span>
          <span className="text-slate-400 text-xs">Turn {currentTurn}</span>
        </div>
        <button onClick={advanceNavalTurn}
          className="btn-navy px-4 py-1.5 rounded text-white text-xs font-bold">
          ▶ ADVANCE TURN
        </button>
      </div>

      {/* Main */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <NavalStrategicMapPanel />
        </div>

        {/* Sidebar */}
        <div className="w-[340px] flex flex-col glass border-l border-blue-900/20 shrink-0">
          <div className="flex border-b border-blue-900/20">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`flex-1 py-2 text-[11px] font-bold tracking-wider transition-colors ${
                  activeTab === t.id
                    ? 'bg-blue-900/20 text-amber-400 border-b-2 border-amber-400'
                    : 'text-slate-600 hover:text-slate-400'}`}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto">
            {activeTab === 'fleet' && <NavalFleetPanel />}
            {activeTab === 'intel' && <NavalIntelPanel />}
            {activeTab === 'reports' && <NavalReportPanel />}
            {activeTab === 'ai' && <NavalAIAdvisorPanel />}
            {activeTab === 'campaign' && <NavalCampaignPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
