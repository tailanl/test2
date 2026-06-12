/**
 * NavalCombatViewPanel - 战术海战视图面板
 */

import React, { useState } from 'react';
import { useNavalStore } from '@/store/naval-store';
import { NavalShipStatusPanel } from './NavalShipStatusPanel';

export function NavalCombatViewPanel() {
  const {
    fleets,
    selectedFleetId,
    intel,
    battleMap,
  } = useNavalStore();

  const selectedFleet = fleets.find((f) => f.id === selectedFleetId);
  const friendlyShips = selectedFleet?.ships ?? [];
  const contacts = intel.playerContacts;

  const [selectedShipId, setSelectedShipId] = useState<string | undefined>();
  const selectedShip = friendlyShips.find((s) => s.id === selectedShipId);

  return (
    <div className="flex flex-col h-full">
      {/* Battle map */}
      <div className="flex-1 relative bg-gray-950 overflow-hidden" style={{ minHeight: '250px' }}>
        <div className="absolute inset-0">
          {/* Grid */}
          <svg className="absolute inset-0 w-full h-full">
            {Array.from({ length: 12 }).map((_, i) => (
              <React.Fragment key={`gm${i}`}>
                <line x1={i * 50} y1={0} x2={i * 50} y2={250} stroke="#1e293b" strokeWidth={0.5} />
                <line x1={0} y1={i * 25} x2={600} y2={i * 25} stroke="#1e293b" strokeWidth={0.5} />
              </React.Fragment>
            ))}
          </svg>

          {/* Friendly ships */}
          {friendlyShips.map((ship) => (
            <div
              key={ship.id}
              onClick={() => setSelectedShipId(ship.id === selectedShipId ? undefined : ship.id)}
              className={`absolute cursor-pointer transition-all ${
                ship.id === selectedShipId ? 'ring-2 ring-amber-400 rounded' : 'hover:brightness-150'
              }`}
              style={{
                left: `${(ship.position.x - (selectedFleet?.position.globalX ?? 0) + 148) * 2}px`,
                top: `${250 - (ship.position.y - (selectedFleet?.position.globalY ?? 0) + 60) * 2}px`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              {/* Ship heading arrow */}
              <div
                className="w-0 h-0 border-l-[4px] border-r-[4px] border-b-[10px] border-l-transparent border-r-transparent border-b-blue-400"
                style={{ transform: `rotate(${ship.headingDeg}deg)`, margin: '0 auto' }}
              />
              <div className="text-[7px] text-blue-300 text-center mt-0.5 leading-tight">
                {ship.name.split(' ').pop()}
              </div>
              {/* Speed indicator */}
              <div className="text-[6px] text-blue-400/60 text-center">
                {ship.speedKts}kts
              </div>
              {/* Radar range circle */}
              {ship.sensors.radarOperational && (
                <div
                  className="absolute rounded-full border border-blue-500/20"
                  style={{
                    width: ship.sensors.surfaceRadarRange * 4,
                    height: ship.sensors.surfaceRadarRange * 4,
                    left: -ship.sensors.surfaceRadarRange * 2,
                    top: -ship.sensors.surfaceRadarRange * 2,
                  }}
                />
              )}
              {/* Visual range circle */}
              <div
                className="absolute rounded-full border border-gray-500/10"
                style={{
                  width: ship.sensors.visualRange * 4,
                  height: ship.sensors.visualRange * 4,
                  left: -ship.sensors.visualRange * 2,
                  top: -ship.sensors.visualRange * 2,
                }}
              />
            </div>
          ))}

          {/* Active aircraft */}
          {friendlyShips.filter((s) => s.aircraft?.aircraft && s.aircraft.aircraft.length > 0).flatMap((s) =>
            (s.aircraft?.aircraft || []).filter((ac) => ac.status !== 'lost' && ac.status !== 'landed').map((ac) => (
              <div
                key={ac.id}
                className="absolute cursor-pointer"
                style={{
                  left: `${(ac.position.x - (selectedFleet?.position.globalX ?? 0) + 148) * 2}px`,
                  top: `${250 - (ac.position.y - (selectedFleet?.position.globalY ?? 0) + 60) * 2}px`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div
                  className="w-0 h-0 border-l-[3px] border-r-[3px] border-b-[7px] border-l-transparent border-r-transparent"
                  style={{
                    borderBottomColor: ac.status === 'attack_run' ? '#ef4444' : ac.status === 'egress' ? '#eab308' : '#60a5fa',
                    transform: `rotate(${ac.headingDeg}deg)`, margin: '0 auto',
                  }}
                />
                <div className="text-[6px] text-center mt-0.5" style={{ color: ac.status === 'attack_run' ? '#fca5a5' : '#93c5fd' }}>
                  {ac.aircraftClass.slice(0, 4)}
                </div>
              </div>
            ))
          )}

          {/* Enemy contacts (only visible ones, not real positions) */}
          {contacts.map((contact) => {
            if (contact.detectionLevel === 'none' || contact.detectionLevel === 'lost') return null;
            const isTracked = contact.detectionLevel === 'tracked' || contact.detectionLevel === 'identified';

            return (
              <div
                key={contact.id}
                className="absolute"
                style={{
                  left: `${(contact.lastKnownPosition.x - (selectedFleet?.position.globalX ?? 0) + 148) * 2}px`,
                  top: `${250 - (contact.lastKnownPosition.y - (selectedFleet?.position.globalY ?? 0) + 60) * 2}px`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {isTracked ? (
                  <>
                    <div
                      className="w-0 h-0 border-l-[4px] border-r-[4px] border-b-[10px] border-l-transparent border-r-transparent border-b-red-400 opacity-70"
                      style={{ margin: '0 auto' }}
                    />
                    <div className="text-[7px] text-red-300 text-center mt-0.5">
                      {contact.estimatedClass || '?'}
                    </div>
                  </>
                ) : (
                  <div className="w-4 h-4 rounded-full border border-dashed border-yellow-500/50 bg-yellow-500/10 flex items-center justify-center">
                    <span className="text-[7px] text-yellow-400">?</span>
                  </div>
                )}

                {/* Uncertainty area for non-tracked */}
                {!isTracked && contact.uncertaintyRadius > 1 && (
                  <div
                    className="absolute rounded-full border border-dashed border-yellow-500/20"
                    style={{
                      width: contact.uncertaintyRadius * 4,
                      height: contact.uncertaintyRadius * 4,
                      left: -contact.uncertaintyRadius * 2,
                      top: -contact.uncertaintyRadius * 2,
                    }}
                  />
                )}
              </div>
            );
          })}

          {/* Legend */}
          <div className="absolute bottom-1 left-1 bg-gray-900/90 p-1 rounded text-[8px] text-gray-500 border border-gray-700">
            <div><span className="text-blue-400">▲</span> Friendly (click for details)</div>
            <div><span className="text-red-400">▲</span> Tracked</div>
            <div><span className="text-yellow-400">●</span> Detected</div>
          </div>
        </div>
      </div>

      {/* Ship status list */}
      {selectedFleet && (
        <div className="max-h-[250px] overflow-auto border-t border-gray-700">
          <div className="px-3 py-1 text-[10px] text-gray-500 uppercase bg-gray-900 flex justify-between">
            <span>{selectedFleet.name} - Ships ({friendlyShips.length})</span>
            {selectedShipId && (
              <button
                onClick={() => setSelectedShipId(undefined)}
                className="text-[9px] text-amber-400 hover:text-amber-300"
              >
                ✕ Deselect
              </button>
            )}
          </div>
          {friendlyShips.map((ship) => (
            <div
              key={ship.id}
              onClick={() => setSelectedShipId(ship.id === selectedShipId ? undefined : ship.id)}
              className={`cursor-pointer ${ship.id === selectedShipId ? 'bg-gray-800/80' : ''}`}
            >
              <NavalShipStatusPanel ship={ship} compact={ship.id !== selectedShipId} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
