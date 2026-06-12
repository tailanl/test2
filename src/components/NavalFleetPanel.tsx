/**
 * NavalFleetPanel - 舰队列表面板
 */

import React from 'react';
import { useNavalStore } from '@/store/naval-store';
import { NavalShipStatusPanel } from './NavalShipStatusPanel';

export function NavalFleetPanel() {
  const { fleets, selectedFleetId, selectFleet, openNavalCombatView } = useNavalStore();

  if (fleets.length === 0) {
    return (
      <div className="p-4 text-gray-500 text-sm">
        No fleets available
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {fleets.map((fleet) => (
        <div key={fleet.id}>
          {/* Fleet header */}
          <div
            onClick={() => selectFleet(fleet.id)}
            className={`px-3 py-2 cursor-pointer border-b border-gray-800 ${
              fleet.id === selectedFleetId ? 'bg-gray-800' : 'hover:bg-gray-800/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className={`text-xs font-bold ${
                  fleet.faction === 'player' ? 'text-blue-400' : 'text-red-400'
                }`}>
                  {fleet.name}
                </span>
                <span className="text-[10px] text-gray-500 ml-2">{fleet.type.replace(/_/g, ' ')}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  fleet.fuelState === 'good' ? 'bg-green-900/50 text-green-400' :
                  fleet.fuelState === 'limited' ? 'bg-yellow-900/50 text-yellow-400' :
                  'bg-red-900/50 text-red-400'
                }`}>
                  {fleet.fuelState}
                </span>
                <span className="text-[10px] text-gray-500">{fleet.ships.length}s</span>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-gray-500">
                Mission: {fleet.mission.replace(/_/g, ' ')}
              </span>
              <span className="text-[10px] text-gray-500">
                Pos: ({fleet.position.globalX}, {fleet.position.globalY})
              </span>
            </div>

            {/* Detect status for enemy fleets */}
            {fleet.faction === 'enemy' && (
              <div className="mt-1">
                <span className={`text-[10px] ${
                  fleet.detectedByPlayer ? 'text-amber-400' : 'text-gray-600'
                }`}>
                  {fleet.detectedByPlayer ? 'DETECTED' : 'UNDETECTED'}
                </span>
                {fleet.lastKnownPosition && fleet.detectedByPlayer && (
                  <span className="text-[9px] text-gray-500 ml-2">
                    last known T{fleet.lastKnownPosition.turn} (±{fleet.lastKnownPosition.uncertaintyRadius})
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Ship list when selected */}
          {fleet.id === selectedFleetId && fleet.faction === 'player' && (
            <div className="px-2 py-1 bg-gray-800/50">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-gray-400 uppercase">Ships</span>
                <button
                  onClick={() => openNavalCombatView(fleet.id)}
                  className="text-[10px] px-2 py-0.5 bg-amber-700/50 hover:bg-amber-700 text-amber-300 rounded"
                >
                  Combat View
                </button>
              </div>
              {fleet.ships.map((ship) => (
                <NavalShipStatusPanel key={ship.id} ship={ship} compact />
              ))}
            </div>
          )}
          {fleet.id === selectedFleetId && fleet.faction === 'enemy' && (
            <div className="px-2 py-1 bg-gray-800/50">
              <div className="text-[10px] text-gray-500 italic">
                {fleet.detectedByPlayer
                  ? 'Ship details based on intelligence estimates'
                  : 'Ship details not available - fleet undetected'}
              </div>
              {fleet.detectedByPlayer && (
                <div className="text-[9px] text-gray-600 mt-1">
                  Estimated composition: {fleet.type.replace(/_/g, ' ')}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
