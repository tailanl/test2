/**
 * NavalModeRoot - 海军模式根组件
 */

import React, { useState } from 'react';
import { useNavalStore } from '@/store/naval-store';
import { NavalStrategicMapPanel } from './NavalStrategicMapPanel';
import { NavalFleetPanel } from './NavalFleetPanel';
import { NavalIntelPanel } from './NavalIntelPanel';
import { NavalReportPanel } from './NavalReportPanel';
import { NavalAIAdvisorPanel } from './NavalAIAdvisorPanel';

export function NavalModeRoot() {
  const {
    navalMode,
    fleets,
    overlay,
    createNavalScenario,
    advanceNavalTurn,
    currentTurn,
  } = useNavalStore();

  const [activeTab, setActiveTab] = useState<'fleet' | 'intel' | 'reports' | 'ai'>('fleet');

  if (!overlay && fleets.length === 0) {
    return (
      <div className="p-4 text-gray-200 space-y-4">
        <h2 className="text-xl font-bold text-amber-400">Naval Command Mode</h2>
        <p>No naval scenario loaded. Create one to begin.</p>
        <button
          onClick={createNavalScenario}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded"
        >
          Create Naval Scenario
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full text-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between p-2 bg-gray-900 border-b border-gray-700">
        <h2 className="text-lg font-bold text-amber-400">
          {navalMode === 'strategic' ? 'Strategic Map' : navalMode === 'operation' ? 'Operation View' : 'Combat View'}
        </h2>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">Turn {currentTurn}</span>
          <button
            onClick={advanceNavalTurn}
            className="px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded text-sm"
          >
            Advance Turn
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map panel */}
        <div className="flex-1 overflow-auto">
          <NavalStrategicMapPanel />
        </div>

        {/* Side panels */}
        <div className="w-80 border-l border-gray-700 flex flex-col bg-gray-900/80">
          {/* Tab bar */}
          <div className="flex border-b border-gray-700">
            {(['fleet', 'intel', 'reports', 'ai'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-2 py-1.5 text-xs font-semibold ${
                  activeTab === tab
                    ? 'bg-gray-800 text-amber-400 border-b-2 border-amber-400'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {tab === 'fleet' ? 'FLEETS' : tab === 'intel' ? 'INTEL' : tab === 'reports' ? 'REPORTS' : 'AI'}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-auto">
            {activeTab === 'fleet' && <NavalFleetPanel />}
            {activeTab === 'intel' && <NavalIntelPanel />}
            {activeTab === 'reports' && <NavalReportPanel />}
            {activeTab === 'ai' && <NavalAIAdvisorPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
