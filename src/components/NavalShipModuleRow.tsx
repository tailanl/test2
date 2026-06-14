import React from 'react';
import type { ShipModule } from '@/game/naval/ship/ship-modules';

interface Props { module: ShipModule; compact?: boolean; }

export function NavalShipModuleRow({ module, compact }: Props) {
  const sc = module.status==='destroyed'?'text-red-600':module.status==='disabled'?'text-orange-400':module.status==='damaged'?'text-yellow-400':'text-green-400';
  const hpPct = module.maxHp>0 ? (module.hp/module.maxHp)*100 : 100;
  const hc = hpPct<=0?'bg-red-600':hpPct<=30?'bg-red-500':hpPct<=60?'bg-yellow-500':hpPct<=80?'bg-amber-500':'bg-green-600';

  if (compact) return (
    <div className={`flex items-center gap-1.5 text-[8px] py-0.5 ${module.status==='destroyed'?'opacity-40':''}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${sc.replace('text-','bg-')}`}/>
      <span className="text-slate-400 truncate max-w-[60px]">{module.name}</span>
      {module.fire>0 && <span className="text-orange-400">🔥{module.fire.toFixed(0)}</span>}
      {module.flooding>0 && <span className="text-blue-400">🌊{module.flooding.toFixed(0)}</span>}
    </div>
  );

  return (
    <div className="py-1 px-1.5 border-b border-slate-800/30 text-[9px]">
      <div className="flex items-center justify-between">
        <span className="text-slate-300">{module.critical ? '⚠️ ' : ''}{module.name}</span>
        <span className={sc}>{module.status.slice(0,4)}</span>
      </div>
      <div className="flex items-center gap-1 mt-0.5">
        <span className="text-slate-600">HP</span>
        <div className="flex-1 h-1 bg-slate-800 rounded"><div className={`h-full ${hc} rounded`} style={{width:`${Math.max(1,hpPct)}%`}}/></div>
        <span className="text-slate-500">{module.hp}/{module.maxHp}</span>
      </div>
      <div className="flex gap-1 text-[7px] text-slate-600 mt-0.5">
        <span>Armor S{module.armorProfile.sideArmor} D{module.armorProfile.deckArmor} U{module.armorProfile.underwaterProtection}</span>
      </div>
      {(module.fire>0||module.flooding>0) && (
        <div className="flex gap-2 mt-0.5">
          {module.fire>0 && <span className="text-orange-400">🔥{module.fire.toFixed(0)}%</span>}
          {module.flooding>0 && <span className="text-blue-400">🌊{module.flooding.toFixed(0)}%</span>}
        </div>
      )}
    </div>
  );
}
