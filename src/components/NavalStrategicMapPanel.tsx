/**
 * NavalStrategicMapPanel - 战略图面板 (with island terrain + facilities)
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
  const scale = 0.55;
  const svgW = mapW * scale;
  const svgH = mapH * scale;

  return (
    <div className="relative w-full h-full bg-gray-950 overflow-auto">
      <div className="absolute inset-0" style={{ minWidth: '800px', minHeight: '600px' }}>
        {/* === TERRAIN LAYER (SVG) === */}
        <svg className="absolute inset-0" width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}>
          {/* Ocean background */}
          <rect x={0} y={0} width={svgW} height={svgH} fill="#0a1628" />

          {/* Island terrain blocks at 16x16 resolution */}
          {overlay && Array.from({ length: Math.floor(mapH / 16) }).flatMap((_, gy) =>
            Array.from({ length: Math.floor(mapW / 16) }).map((_, gx) => {
              const x = gx * 16; const y = gy * 16;
              const cell = overlay[y]?.[x];
              if (!cell) return null;
              const sx = x * scale; const sy = svgH - (y + 16) * scale;
              const sw = 16 * scale; const sh = 16 * scale;

              let fill = 'none';
              let opacity = 0;
              if (cell.seaZoneType === 'island') { fill = '#2d4a1e'; opacity = 0.7; }
              else if (cell.seaZoneType === 'shallow_water' || cell.seaZoneType === 'reef') { fill = '#0f766e'; opacity = 0.35; }
              else if (cell.seaZoneType === 'coastal_water') { fill = '#0e7490'; opacity = 0.25; }
              else return null;

              return (
                <rect key={`t_${gx}_${gy}`} x={sx} y={sy} width={sw} height={sh} fill={fill} opacity={opacity} />
              );
            })
          )}

          {/* Shipping lanes */}
          {shippingLanes.map((lane) => (
            <polyline
              key={lane.id}
              points={lane.waypoints.map((wp) => `${wp.globalX * scale},${svgH - wp.globalY * scale}`).join(' ')}
              fill="none" stroke="#1e40af" strokeWidth={1.5} strokeDasharray="6,4" opacity={0.35}
            />
          ))}

          {/* Facilities */}
          {facilities.map((fac) => {
            const fx = fac.position.globalX * scale;
            const fy = svgH - fac.position.globalY * scale;
            const fc = fac.faction === 'player' ? '#60a5fa' : fac.faction === 'enemy' ? '#f87171' : '#9ca3af';

            return (
              <g key={fac.id}>
                {fac.type === 'port' || fac.type === 'naval_base' ? (
                  <>
                    <circle cx={fx} cy={fy} r={5} fill={fac.type === 'naval_base' ? '#f59e0b' : '#3b82f6'} stroke="#fff" strokeWidth={1} />
                    <circle cx={fx} cy={fy} r={2} fill="#fff" opacity={0.6} />
                  </>
                ) : fac.type === 'airfield' ? (
                  <rect x={fx - 4} y={fy - 2} width={8} height={4} fill="#a855f7" stroke="#fff" strokeWidth={0.5} rx={1} />
                ) : fac.type === 'supply_depot' ? (
                  <rect x={fx - 3} y={fy - 3} width={6} height={6} fill="#22c55e" stroke="#fff" strokeWidth={0.5} />
                ) : null}
                <text x={fx} y={fy + 10} textAnchor="middle" fill={fc} fontSize={7} fontWeight="bold">
                  {fac.name}
                </text>
              </g>
            );
          })}
        </svg>

        {/* === FLEET + CONTACT LAYER (HTML overlays) === */}
        {playerFleets.map((fleet) => (
          <div
            key={fleet.id}
            onClick={() => selectFleet(fleet.id)}
            className={`absolute cursor-pointer ${
              fleet.id === selectedFleetId ? 'ring-2 ring-amber-400 rounded' : ''
            }`}
            style={{
              left: `${fleet.position.globalX * scale}px`,
              top: `${svgH - fleet.position.globalY * scale}px`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div className="w-4 h-4 rounded-full bg-blue-500 border border-blue-300 mx-auto" />
            <span className="text-[10px] text-gray-300 block text-center whitespace-nowrap mt-0.5">{fleet.name}</span>
          </div>
        ))}

        {contacts.map((contact) => (
          <div
            key={contact.id}
            className="absolute"
            style={{
              left: `${contact.lastKnownPosition.x * scale}px`,
              top: `${svgH - contact.lastKnownPosition.y * scale}px`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div
              className="absolute rounded-full border pointer-events-none"
              style={{
                width: contact.uncertaintyRadius * 2 * scale,
                height: contact.uncertaintyRadius * 2 * scale,
                left: -(contact.uncertaintyRadius * scale),
                top: -(contact.uncertaintyRadius * scale),
                borderColor: contact.detectionLevel === 'tracked' ? '#f59e0b' : contact.detectionLevel === 'lost' ? '#6b7280' : '#fbbf24',
                borderStyle: contact.detectionLevel === 'lost' ? 'dashed' : 'solid',
                opacity: 0.4,
              }}
            />
            <div className={`w-3 h-3 rotate-45 border mx-auto ${
              contact.detectionLevel === 'tracked' ? 'border-amber-400 bg-amber-400/30' :
              contact.detectionLevel === 'identified' ? 'border-red-400 bg-red-400/30' :
              contact.detectionLevel === 'lost' ? 'border-gray-500 bg-gray-500/10' :
              'border-yellow-400 bg-yellow-400/15'
            }`} />
            <span className="text-[8px] text-gray-400 block text-center mt-0.5">{contact.detectionLevel}</span>
          </div>
        ))}

        {/* Legend */}
        <div className="absolute bottom-2 left-2 bg-gray-900/95 p-2 rounded text-[9px] text-gray-400 border border-gray-700 z-10">
          <div className="font-bold text-amber-400 mb-1">Legend</div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"/><span>Fleet</span></div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rotate-45 border border-red-400"/><span>Tracked</span></div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-amber-500"/><span>Naval Base</span></div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"/><span>Port</span></div>
            <div className="flex items-center gap-1"><div className="w-2 h-1 bg-purple-500 rounded"/><span>Airfield</span></div>
            <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 bg-green-500"/><span>Supply</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
