/**
 * NavalStrategicMapPanel - 战略图面板
 */

import React from 'react';
import { useNavalStore } from '@/store/naval-store';

export function NavalStrategicMapPanel() {
  const {
    fleets,
    intel,
    selectedFleetId,
    selectFleet,
    openNavalCombatView,
  } = useNavalStore();

  const playerFleets = fleets.filter((f) => f.faction === 'player');
  const contacts = intel.playerContacts;

  return (
    <div className="relative w-full h-full bg-gray-950 overflow-auto">
      {/* Canvas area - simplified grid */}
      <div className="absolute inset-0" style={{ minWidth: '800px', minHeight: '600px' }}>
        {/* Grid lines */}
        <svg className="absolute inset-0 w-full h-full">
          {Array.from({ length: 20 }).map((_, i) => (
            <line key={`v${i}`} x1={i * 40} y1={0} x2={i * 40} y2={600} stroke="#1e293b" strokeWidth={1} />
          ))}
          {Array.from({ length: 15 }).map((_, i) => (
            <line key={`h${i}`} x1={0} y1={i * 40} x2={800} y2={i * 40} stroke="#1e293b" strokeWidth={1} />
          ))}
        </svg>

        {/* Fog tiles */}
        {/* In a real implementation, render fog tile overlay */}

        {/* Player fleets */}
        {playerFleets.map((fleet) => (
          <div
            key={fleet.id}
            onClick={() => selectFleet(fleet.id)}
            className={`absolute cursor-pointer transition-colors ${
              fleet.id === selectedFleetId ? 'ring-2 ring-amber-400' : ''
            }`}
            style={{
              left: `${fleet.position.globalX * 0.4}px`,
              top: `${600 - fleet.position.globalY * 0.4}px`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div className="flex flex-col items-center">
              <div className={`w-4 h-4 rounded-full ${
                fleet.type === 'carrier_task_force' ? 'bg-blue-500' :
                fleet.type === 'surface_action_group' ? 'bg-red-500' :
                fleet.type === 'transport_convoy' ? 'bg-green-500' :
                'bg-gray-500'
              }`} />
              <span className="text-[10px] text-gray-300 mt-1 whitespace-nowrap">{fleet.name}</span>
              <span className="text-[8px] text-gray-500">{fleet.ships.length} ships</span>
            </div>
          </div>
        ))}

        {/* Contacts (not real enemy positions!) */}
        {contacts.map((contact) => (
          <div
            key={contact.id}
            className="absolute"
            style={{
              left: `${contact.lastKnownPosition.x * 0.4}px`,
              top: `${600 - contact.lastKnownPosition.y * 0.4}px`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            {/* Uncertainty circle */}
            <svg
              width={contact.uncertaintyRadius * 2}
              height={contact.uncertaintyRadius * 2}
              style={{
                position: 'absolute',
                left: -contact.uncertaintyRadius,
                top: -contact.uncertaintyRadius,
              }}
            >
              <circle
                cx={contact.uncertaintyRadius}
                cy={contact.uncertaintyRadius}
                r={contact.uncertaintyRadius}
                fill="none"
                stroke={
                  contact.detectionLevel === 'tracked' ? '#f59e0b' :
                  contact.detectionLevel === 'identified' ? '#ef4444' :
                  contact.detectionLevel === 'lost' ? '#6b7280' :
                  '#fbbf24'
                }
                strokeWidth={1}
                strokeDasharray={contact.detectionLevel === 'lost' ? '4,4' : 'none'}
                opacity={contact.detectionLevel === 'lost' ? 0.3 : 0.5}
              />
            </svg>
            <div className={`w-3 h-3 rotate-45 border ${
              contact.detectionLevel === 'tracked' ? 'border-amber-400 bg-amber-400/30' :
              contact.detectionLevel === 'identified' ? 'border-red-400 bg-red-400/30' :
              contact.detectionLevel === 'classified' ? 'border-orange-400 bg-orange-400/20' :
              contact.detectionLevel === 'lost' ? 'border-gray-500 bg-gray-500/10' :
              'border-yellow-400 bg-yellow-400/15'
            }`} />
            <span className="text-[8px] text-gray-400 mt-1 block text-center">
              {contact.detectionLevel}
            </span>
          </div>
        ))}

        {/* Legend */}
        <div className="absolute bottom-2 left-2 bg-gray-900/90 p-2 rounded text-[10px] text-gray-400 border border-gray-700">
          <div className="font-bold text-amber-400 mb-1">Legend</div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"/><span>Player Fleet</span></div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rotate-45 border border-red-400"/><span>Tracked Contact</span></div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rotate-45 border border-amber-400"/><span>Detected Contact</span></div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rotate-45 border border-gray-500"/><span>Lost Contact</span></div>
        </div>
      </div>
    </div>
  );
}
