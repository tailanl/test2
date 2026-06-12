'use client';

/**
 * NavalShipModuleRow - 单个模块行展示
 */

import React from 'react';
import type { ShipModule } from '@/game/naval/ship/ship-modules';

interface Props {
  module: ShipModule;
  compact?: boolean;
}

export function NavalShipModuleRow({ module, compact = false }: Props) {
  const statusColor =
    module.status === 'destroyed' ? 'text-red-400' :
    module.status === 'disabled' ? 'text-orange-400' :
    module.status === 'damaged' ? 'text-yellow-400' :
    'text-green-400';

  const hpPct = module.maxHp > 0 ? (module.hp / module.maxHp) * 100 : 100;
  const hpColor =
    hpPct <= 0 ? 'bg-red-600' :
    hpPct <= 30 ? 'bg-red-500' :
    hpPct <= 60 ? 'bg-yellow-500' :
    hpPct <= 80 ? 'bg-amber-500' :
    'bg-green-600';

  if (compact) {
    return (
      <div className={`flex items-center gap-2 text-[9px] py-0.5 border-b border-gray-800/30 ${
        module.status === 'destroyed' ? 'opacity-50' : ''
      }`}>
        <span className={`w-2 h-2 rounded-full ${statusColor.replace('text-', 'bg-')}`} />
        <span className="text-gray-300 truncate max-w-[80px]">{module.name}</span>
        <span className="text-gray-500">{module.status}</span>
        {(module.fire > 0 || module.flooding > 0) && (
          <span className="text-[8px]">
            {module.fire > 0 && <span className="text-orange-400">F{module.fire.toFixed(0)} </span>}
            {module.flooding > 0 && <span className="text-blue-400">W{module.flooding.toFixed(0)}</span>}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`py-1.5 px-2 border-b border-gray-700/30 text-[10px] ${
      module.status === 'destroyed' ? 'opacity-40' : ''
    }`}>
      {/* Row 1: Name + Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {module.critical && (
            <span className="text-[8px] px-1 rounded bg-red-900/50 text-red-400 font-bold">CRIT</span>
          )}
          <span className={`text-gray-200 ${module.critical ? 'font-bold' : ''}`}>
            {module.name}
          </span>
        </div>
        <span className={`text-[9px] font-semibold ${statusColor}`}>
          {module.status.toUpperCase()}
        </span>
      </div>

      {/* Row 2: HP bar */}
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className="text-gray-500 w-4">HP</span>
        <div className="flex-1 h-1.5 bg-gray-800 rounded overflow-hidden">
          <div className={`h-full ${hpColor} rounded transition-all`} style={{ width: `${hpPct}%` }} />
        </div>
        <span className="text-gray-400 w-12 text-right">{module.hp}/{module.maxHp}</span>
      </div>

      {/* Row 3: Armor profile */}
      <div className="flex items-center gap-1 mt-0.5 text-[8px] text-gray-500">
        <span>Armor:</span>
        <span className="text-gray-400">S{module.armorProfile.sideArmor}</span>
        <span className="text-gray-400">D{module.armorProfile.deckArmor}</span>
        <span className="text-gray-400">U{module.armorProfile.underwaterProtection}</span>
      </div>

      {/* Row 4: Exposure */}
      <div className="flex items-center gap-1 text-[8px] text-gray-600">
        <span>Exp:</span>
        <span className={module.exposure.side > 1 ? 'text-yellow-400/60' : ''}>S{module.exposure.side}</span>
        <span className={module.exposure.vertical > 1 ? 'text-yellow-400/60' : ''}>V{module.exposure.vertical}</span>
        <span className={module.exposure.underwater > 1 ? 'text-blue-400/60' : ''}>U{module.exposure.underwater}</span>
      </div>

      {/* Row 5: Fire / Flooding */}
      {(module.fire > 0 || module.flooding > 0) && (
        <div className="flex items-center gap-2 mt-0.5 text-[9px]">
          {module.fire > 0 && (
            <span className="text-orange-400">FIRE {module.fire.toFixed(0)}%</span>
          )}
          {module.flooding > 0 && (
            <span className="text-blue-400">FLOOD {module.flooding.toFixed(0)}%</span>
          )}
        </div>
      )}
    </div>
  );
}
