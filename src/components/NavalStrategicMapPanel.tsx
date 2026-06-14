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
    facilities,
    shippingLanes,
    overlay,
  } = useNavalStore();

  const playerFleets = fleets.filter((f) => f.faction === 'player');
  const contacts = intel.playerContacts;

  const mapW = overlay?.[0]?.length ?? 1024;
  const mapH = overlay?.length ?? 1024;
  const scaleX = 0.78;
  const scaleY = 0.58;

  return (
    <div className="relative w-full h-full bg-gray-950 overflow-auto">
      {/* Canvas area - simplified grid */}
      <div className="absolute inset-0" style={{ minWidth: '800px', minHeight: '600px' }}>
        {/* Ocean background */}
        <rect width={mapW * scaleX} height={mapH * scaleY} fill="#0a1628" />

        {/* Shipping lanes */}
        {shippingLanes.map((lane) => (
          <polyline
            key={lane.id}
            points={lane.waypoints.map((wp) => `${wp.globalX * scaleX},${mapH * scaleY - wp.globalY * scaleY}`).join(' ')}
            fill="none"
            stroke="#1e40af"
            strokeWidth={1}
            strokeDasharray="4,4"
            opacity={0.3}
          />
        ))}

        {/* Island shapes (simplified) */}
        {overlay && Array.from({ length: Math.floor(mapH / 16) }).flatMap((_, gy) =>
          Array.from({ length: Math.floor(mapW / 16) }).map((_, gx) => {
            const x = gx * 16; const y = gy * 16;
            if (x >= mapW || y >= mapH) return null;
            const cell = overlay[y]?.[x];
            if (!cell) return null;
            if (cell.seaZoneType === 'island') {
              return (
                <rect
                  key={`isl_${gx}_${gy}`}
                  x={x * scaleX} y={mapH * scaleY - (y + 16) * scaleY}
                  width={16 * scaleX} height={16 * scaleY}
                  fill="#2d4a1e"
                  opacity={0.6}
                />
              );
            }
            if (cell.seaZoneType === 'shallow_water' || cell.seaZoneType === 'reef') {
              return (
                <rect
                  key={`shw_${gx}_${gy}`}
                  x={x * scaleX} y={mapH * scaleY - (y + 16) * scaleY}
                  width={16 * scaleX} height={16 * scaleY}
                  fill="#0f766e"
                  opacity={0.3}
                />
              );
            }
            if (cell.seaZoneType === 'coastal_water') {
              return (
                <rect
                  key={`cw_${gx}_${gy}`}
                  x={x * scaleX} y={mapH * scaleY - (y + 16) * scaleY}
                  width={16 * scaleX} height={16 * scaleY}
                  fill="#0e7490"
                  opacity={0.2}
                />
              );
            }
            return null;
          })
        )}

        {/* Facilities */}
        {facilities.map((fac) => (
          <g key={fac.id}>
            {fac.type === 'port' || fac.type === 'naval_base' ? (
              <circle
                cx={fac.position.globalX * scaleX}
                cy={mapH * scaleY - fac.position.globalY * scaleY}
                r={4}
                fill={fac.type === 'naval_base' ? '#f59e0b' : '#3b82f6'}
                stroke="#fff"
                strokeWidth={1}
              />
            ) : fac.type === 'airfield' ? (
              <rect
                x={fac.position.globalX * scaleX - 3}
                y={mapH * scaleY - fac.position.globalY * scaleY - 1.5}
                width={6} height={3}
                fill="#a855f7"
                stroke="#fff"
                strokeWidth={0.5}
              />
            ) : fac.type === 'supply_depot' ? (
              <rect
                x={fac.position.globalX * scaleX - 2}
                y={mapH * scaleY - fac.position.globalY * scaleY - 2}
                width={4} height={4}
                fill="#22c55e"
                stroke="#fff"
                strokeWidth={0.5}
              />
            ) : null}
            <text
              x={fac.position.globalX * scaleX}
              y={mapH * scaleY - fac.position.globalY * scaleY + 8}
              textAnchor="middle"
              fill={fac.faction === 'player' ? '#60a5fa' : fac.faction === 'enemy' ? '#f87171' : '#9ca3af'}
              fontSize={6}
            >
              {fac.name}
            </text>
          </g>
        ))}

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
              left: `${fleet.position.globalX * scaleX}px`,
              top: `${mapH * scaleY - fleet.position.globalY * scaleY}px`,
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
              left: `${contact.lastKnownPosition.x * scaleX}px`,
              top: `${mapH * scaleY - contact.lastKnownPosition.y * scaleY}px`,
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
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-amber-500"/><span>Naval Base</span></div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"/><span>Port</span></div>
          <div className="flex items-center gap-1"><div className="w-2 h-1 bg-purple-500"/><span>Airfield</span></div>
        </div>
      </div>
    </div>
  );
}
