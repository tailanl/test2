'use client';

/**
 * NavalShipModuleGrid - 完整模块网格展示，按 location 分组
 */

import React from 'react';
import type { NavalShip } from '@/game/naval/ship/ship-types';
import type { ModuleLocation } from '@/game/naval/ship/ship-modules';
import { NavalShipModuleRow } from './NavalShipModuleRow';

interface Props {
  ship: NavalShip;
  compact?: boolean;
}

const LOCATION_LABELS: Record<ModuleLocation, string> = {
  superstructure: 'Superstructure',
  bow: 'Bow',
  forward: 'Forward',
  midships: 'Midships',
  aft: 'Aft',
  stern: 'Stern',
  port: 'Port',
  starboard: 'Starboard',
  below_waterline: 'Below Waterline',
};

const LOCATION_ORDER: ModuleLocation[] = [
  'superstructure',
  'bow',
  'forward',
  'midships',
  'aft',
  'stern',
  'port',
  'starboard',
  'below_waterline',
];

export function NavalShipModuleGrid({ ship, compact = false }: Props) {
  // Group modules by location
  const grouped = new Map<ModuleLocation, typeof ship.modules>();
  for (const loc of LOCATION_ORDER) {
    const mods = ship.modules.filter((m) => m.location === loc);
    if (mods.length > 0) grouped.set(loc, mods);
  }

  // Modules not in known locations
  const knownLocs = new Set(LOCATION_ORDER);
  const otherMods = ship.modules.filter((m) => !knownLocs.has(m.location));
  if (otherMods.length > 0) grouped.set('midships' as ModuleLocation, [...(grouped.get('midships') || []), ...otherMods]);

  if (compact) {
    const total = ship.modules.length;
    const damaged = ship.modules.filter((m) => m.status !== 'operational').length;
    const fireCount = ship.modules.filter((m) => m.fire > 0).length;
    const floodCount = ship.modules.filter((m) => m.flooding > 0).length;

    return (
      <div className="text-[10px] text-gray-400 px-2">
        <div className="flex justify-between mb-1">
          <span>Modules: {total}</span>
          <span className={damaged > 0 ? 'text-yellow-400' : ''}>Damaged: {damaged}</span>
        </div>
        {(fireCount > 0 || floodCount > 0) && (
          <div className="flex gap-2">
            {fireCount > 0 && <span className="text-orange-400">Fire: {fireCount}</span>}
            {floodCount > 0 && <span className="text-blue-400">Flood: {floodCount}</span>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="text-xs">
      <div className="px-2 py-1 text-[10px] text-gray-500 uppercase bg-gray-800/50 sticky top-0">
        Modules ({ship.modules.length})
        {ship.modules.filter((m) => m.status !== 'operational').length > 0 && (
          <span className="text-yellow-400 ml-1">
            {ship.modules.filter((m) => m.status !== 'operational').length} damaged
          </span>
        )}
      </div>

      {Array.from(grouped.entries()).map(([location, modules]) => (
        <div key={location}>
          <div className="px-2 py-0.5 text-[9px] font-bold text-gray-500 uppercase bg-gray-800/30 border-y border-gray-700/30">
            {LOCATION_LABELS[location] || location} ({modules.length})
          </div>
          {modules.map((mod) => (
            <NavalShipModuleRow key={mod.id} module={mod} />
          ))}
        </div>
      ))}
    </div>
  );
}
