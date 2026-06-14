import React from 'react';
import { useNavalStore } from '@/store/naval-store';
import { NavalShipStatusPanel } from './NavalShipStatusPanel';

export function NavalFleetPanel() {
  const { fleets, selectedFleetId, selectFleet, openNavalCombatView } = useNavalStore();

  if (fleets.length === 0) return <div className="p-4 text-slate-600 text-xs">No fleets deployed</div>;

  return (
    <div className="flex flex-col">
      {fleets.map((fleet) => (
        <div key={fleet.id}>
          <div onClick={() => selectFleet(fleet.id)}
            className={`px-3 py-2.5 cursor-pointer border-b border-slate-800/50 transition-colors ${
              fleet.id === selectedFleetId ? 'bg-blue-900/20' : 'hover:bg-slate-800/30'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`text-lg ${fleet.type === 'carrier_task_force' ? '' : 'opacity-60'}`}>
                  {fleet.type === 'carrier_task_force' ? '🛳️' : fleet.type === 'surface_action_group' ? '🔫' : '🚢'}
                </span>
                <div>
                  <div className={`text-sm font-bold ${fleet.faction === 'player' ? 'text-sky-300' : 'text-red-400'}`}>
                    {fleet.name}
                  </div>
                  <div className="text-[10px] text-slate-500">{fleet.type.replace(/_/g, ' ')} · {fleet.ships.length} ships</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${fleet.fuelState === 'good' ? 'bg-green-900/30 text-green-400' : fleet.fuelState === 'limited' ? 'bg-yellow-900/30 text-yellow-400' : 'bg-red-900/30 text-red-400'}`}>
                  {fleet.fuelState}
                </span>
                {fleet.airGroupState && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${fleet.airGroupState === 'ready' ? 'bg-blue-900/30 text-blue-400' : 'bg-yellow-900/30 text-yellow-400'}`}>
                    {fleet.airGroupState}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
              <span>Mission: {fleet.mission.replace(/_/g, ' ')}</span>
              <span>({fleet.position.globalX}, {fleet.position.globalY})</span>
            </div>
          </div>

          {fleet.id === selectedFleetId && fleet.faction === 'player' && (
            <div className="bg-slate-900/50 px-2 py-1">
              <div className="flex items-center justify-between mb-1 px-1">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Ships</span>
                <button onClick={() => openNavalCombatView(fleet.id)}
                  className="text-[10px] px-2 py-0.5 btn-gold rounded text-amber-200 font-bold">Combat View</button>
              </div>
              {fleet.ships.map((ship) => (
                <NavalShipStatusPanel key={ship.id} ship={ship} compact />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
