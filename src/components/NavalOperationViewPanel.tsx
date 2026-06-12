/**
 * NavalOperationViewPanel - 海上作战视图面板
 */

import React from 'react';
import { useNavalStore } from '@/store/naval-store';

export function NavalOperationViewPanel() {
  const {
    fleets,
    intel,
    selectedFleetId,
    selectFleet,
  } = useNavalStore();

  const selectedFleet = fleets.find((f) => f.id === selectedFleetId);
  const contacts = intel.playerContacts;

  return (
    <div className="relative w-full h-full bg-gray-950 overflow-auto">
      <div className="absolute inset-0" style={{ minWidth: '600px', minHeight: '400px' }}>
        {/* Grid */}
        <svg className="absolute inset-0 w-full h-full">
          {Array.from({ length: 15 }).map((_, i) => (
            <React.Fragment key={`g${i}`}>
              <line x1={i * 40} y1={0} x2={i * 40} y2={400} stroke="#1e293b" strokeWidth={0.5} />
              <line x1={0} y1={i * 40} x2={600} y2={i * 40} stroke="#1e293b" strokeWidth={0.5} />
            </React.Fragment>
          ))}
        </svg>

        {/* Fleet positions */}
        {fleets.map((fleet) => {
          const isSelected = fleet.id === selectedFleetId;
          const isPlayer = fleet.faction === 'player';
          const shouldShow = isPlayer || fleet.detectedByPlayer;

          if (!shouldShow) return null;

          return (
            <div
              key={fleet.id}
              onClick={() => selectFleet(fleet.id)}
              className={`absolute cursor-pointer ${isSelected ? 'z-10' : ''}`}
              style={{
                left: `${fleet.position.globalX * 0.3}px`,
                top: `${400 - fleet.position.globalY * 0.3}px`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div className={`flex flex-col items-center ${!isPlayer ? 'opacity-70' : ''}`}>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  isPlayer ? 'bg-blue-900/50 border-blue-500' : 'bg-red-900/50 border-red-500'
                } ${isSelected ? 'ring-2 ring-amber-400' : ''}`}>
                  <span className="text-[8px] text-gray-200 font-bold">
                    {fleet.ships.length}
                  </span>
                </div>
                <span className="text-[9px] text-gray-300 mt-1">{fleet.name}</span>
                {!isPlayer && (
                  <span className="text-[8px] text-gray-500">
                    {fleet.detectedByPlayer ? 'contact' : 'est.'}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {/* Contacts */}
        {contacts.map((contact) => (
          <div
            key={contact.id}
            className="absolute"
            style={{
              left: `${contact.lastKnownPosition.x * 0.3}px`,
              top: `${400 - contact.lastKnownPosition.y * 0.3}px`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div className={`w-4 h-4 rotate-45 border-2 ${
              contact.detectionLevel === 'tracked' ? 'border-amber-400 bg-amber-400/20' :
              contact.detectionLevel === 'identified' ? 'border-red-400 bg-red-400/20' :
              'border-yellow-400 bg-yellow-400/10'
            }`}>
              <span className="block -rotate-45 text-[6px] text-gray-300 text-center leading-4">
                {contact.detectionLevel === 'identified' ? '?' : ''}
              </span>
            </div>
          </div>
        ))}

        {/* Selected fleet info */}
        {selectedFleet && (
          <div className="absolute top-2 right-2 bg-gray-900/90 p-2 rounded text-[10px] border border-gray-700 max-w-[200px]">
            <div className="font-bold text-gray-200">{selectedFleet.name}</div>
            <div className="text-gray-400">{selectedFleet.type.replace(/_/g, ' ')}</div>
            <div className="text-gray-500 mt-1">
              Ships: {selectedFleet.ships.length} | Mission: {selectedFleet.mission.replace(/_/g, ' ')}
            </div>
            <div className="text-gray-500">
              Fuel: {selectedFleet.fuelState} | Ammo: {selectedFleet.ammoState}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
