import React from 'react';
import type { NavalShip } from '@/game/naval/ship/ship-types';
import { NavalShipModuleGrid } from './NavalShipModuleGrid';

interface Props { ship: NavalShip; compact?: boolean; }

export function NavalShipStatusPanel({ ship, compact }: Props) {
  if (ship.damage.status === 'sunk') return (
    <div className="px-2 py-1 text-[10px] text-slate-700 line-through border-b border-slate-800/30 opacity-40">
      ☠️ {ship.name} — SUNK
    </div>
  );

  if (compact) return (
    <div className={`px-2 py-1 border-b border-slate-800/20 text-[10px] ${ship.damage.status !== 'combat_effective' ? 'bg-red-950/10' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${ship.faction === 'player' ? 'bg-sky-400' : 'bg-red-400'}`}/>
          <span className="text-slate-300 font-medium truncate max-w-[80px]">{ship.name}</span>
        </div>
        <span className={`text-[9px] px-1 rounded ${ship.damage.status === 'combat_effective' ? 'bg-green-900/30 text-green-400' : ship.damage.status === 'damaged' ? 'bg-yellow-900/30 text-yellow-400' : 'bg-red-900/30 text-red-400'}`}>{ship.damage.status.replace(/_/g,' ').slice(0,4)}</span>
      </div>
      <div className="flex items-center gap-2 mt-0.5 text-slate-500">
        <span>{ship.shipClass.replace(/_/g,' ')}</span>
        <span>HDG{ship.headingDeg}°</span>
        <span>{ship.speedKts}kts</span>
      </div>
      {(ship.damage.flooding>0||ship.damage.fire>0) && (
        <div className="flex gap-1 mt-0.5">
          {ship.damage.flooding>0 && <span className="text-blue-400 text-[8px]">🌊{ship.damage.flooding.toFixed(0)}%</span>}
          {ship.damage.fire>0 && <span className="text-orange-400 text-[8px]">🔥{ship.damage.fire.toFixed(0)}%</span>}
        </div>
      )}
    </div>
  );

  const pct = (v: number) => Math.max(0, Math.min(100, v));
  const bar = (v: number, color: string) => (
    <div className="w-full h-1.5 bg-slate-800 rounded overflow-hidden">
      <div className={`h-full ${color} rounded transition-all`} style={{ width: `${pct(v)}%` }}/>
    </div>
  );

  return (
    <div className="p-2 space-y-1.5 text-[10px]">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-bold text-slate-200 text-xs">{ship.name}</span>
          <span className="ml-2 text-slate-500">{ship.shipClass.replace(/_/g,' ')}</span>
        </div>
        <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${ship.damage.status === 'combat_effective' ? 'bg-green-900/30 text-green-400' : ship.damage.status === 'damaged' ? 'bg-yellow-900/30 text-yellow-400' : ship.damage.status === 'crippled' || ship.damage.status === 'sinking' ? 'bg-red-900/30 text-red-400' : 'bg-orange-900/30 text-orange-400'}`}>
          {ship.damage.status.replace(/_/g,' ').toUpperCase()}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-2 text-[9px] text-slate-400">
        <span>HDG {ship.headingDeg}°</span><span>SPD {ship.speedKts}kts</span>
        <span>TGT {ship.targetSpeedKts}kts</span><span>RUD {ship.rudderDeg}°</span>
      </div>

      <div className="border-t border-slate-800/50 pt-1 space-y-1">
        <div className="flex justify-between text-[9px]"><span className="text-slate-500">Hull</span><span className={ship.damage.hullIntegrity<50?'text-red-400':'text-slate-300'}>{ship.damage.hullIntegrity.toFixed(0)}%</span></div>
        {bar(ship.damage.hullIntegrity, 'dmg-ok')}
        <div className="flex justify-between text-[9px]"><span className="text-slate-500">Buoyancy</span><span className={ship.damage.buoyancy<50?'text-red-400':'text-slate-300'}>{ship.damage.buoyancy.toFixed(0)}%</span></div>
        {bar(ship.damage.buoyancy, 'dmg-warn')}
      </div>

      {ship.damage.flooding>0 && <div>
        <div className="flex justify-between text-[9px]"><span className="text-blue-400">🌊 Flood</span><span className="text-blue-300">{ship.damage.flooding.toFixed(0)}%</span></div>
        {bar(ship.damage.flooding, 'bg-blue-500')}
      </div>}
      {ship.damage.fire>0 && <div>
        <div className="flex justify-between text-[9px]"><span className="text-orange-400">🔥 Fire</span><span className="text-orange-300">{ship.damage.fire.toFixed(0)}%</span></div>
        {bar(ship.damage.fire, 'bg-orange-500')}
      </div>}

      <div className="border-t border-slate-800/50 pt-1">
        <div className="flex items-center gap-2 text-[9px]">
          <span className={ship.sensors.radarOperational?'text-green-400':'text-red-600'}>RDR {ship.sensors.radarOperational?'ON':'OFF'}</span>
          <span className={ship.sensors.sonarOperational?'text-green-400':'text-red-600'}>SON {ship.sensors.sonarOperational?'ON':'OFF'}</span>
          <span className={ship.sensors.cicOperational?'text-green-400':'text-red-600'}>CIC {ship.sensors.cicOperational?'ON':'OFF'}</span>
        </div>
        <div className="text-[9px] text-slate-500 mt-0.5">DC: {ship.damageControl.availableTeams} avail / {ship.damageControl.assignedTeams.length} active</div>
      </div>

      <div className="border-t border-slate-800/50 pt-1">
        <NavalShipModuleGrid ship={ship} />
      </div>
    </div>
  );
}
