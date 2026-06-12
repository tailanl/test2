/**
 * NavalShipStatusPanel - 舰船状态面板
 */

import React from 'react';
import type { NavalShip } from '@/game/naval/ship/ship-types';
import { NavalShipModuleGrid } from './NavalShipModuleGrid';

interface Props {
  ship: NavalShip;
  compact?: boolean;
}

export function NavalShipStatusPanel({ ship, compact = false }: Props) {
  if (compact) {
    return (
      <div className={`px-2 py-1 border-b border-gray-800/50 text-xs ${
        ship.damage.status === 'sinking' || ship.damage.status === 'sunk' ? 'opacity-50' : ''
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${
              ship.faction === 'player' ? 'bg-blue-400' : 'bg-red-400'
            }`} />
            <span className="text-gray-300 truncate max-w-[100px]">{ship.name}</span>
          </div>
          <span className="text-gray-500 text-[10px]">{ship.shipClass.replace(/_/g, ' ')}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-500">
          <span>HDG {ship.headingDeg}°</span>
          <span>SPD {ship.speedKts}kts</span>
          <span>RUD {ship.rudderDeg}°</span>
        </div>
        {/* Damage indicators */}
        {(ship.damage.flooding > 0 || ship.damage.fire > 0) && (
          <div className="flex items-center gap-1 mt-0.5">
            {ship.damage.flooding > 0 && (
              <span className="text-[9px] text-blue-400">FLOOD {ship.damage.flooding.toFixed(0)}%</span>
            )}
            {ship.damage.fire > 0 && (
              <span className="text-[9px] text-orange-400">FIRE {ship.damage.fire.toFixed(0)}%</span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-3 border-b border-gray-800 text-sm space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-bold text-gray-200">{ship.name}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          ship.damage.status === 'combat_effective' ? 'bg-green-900/50 text-green-400' :
          ship.damage.status === 'damaged' ? 'bg-yellow-900/50 text-yellow-400' :
          ship.damage.status === 'mission_kill' ? 'bg-orange-900/50 text-orange-400' :
          ship.damage.status === 'crippled' ? 'bg-red-900/50 text-red-400' :
          'bg-red-950 text-red-500'
        }`}>
          {ship.damage.status.replace(/_/g, ' ')}
        </span>
      </div>

      <div className="text-xs text-gray-400">
        {ship.shipClass.replace(/_/g, ' ')} | {ship.faction}
      </div>

      {/* Motion */}
      <div className="grid grid-cols-2 gap-1 text-[11px]">
        <div className="text-gray-400">Heading: <span className="text-gray-200">{ship.headingDeg}°</span></div>
        <div className="text-gray-400">Speed: <span className="text-gray-200">{ship.speedKts}kts</span></div>
        <div className="text-gray-400">Target: <span className="text-gray-200">{ship.targetSpeedKts}kts</span></div>
        <div className="text-gray-400">Rudder: <span className="text-gray-200">{ship.rudderDeg}°</span></div>
      </div>

      {/* Damage stats */}
      <div className="border-t border-gray-800 pt-1 mt-1">
        <div className="text-[10px] text-gray-500 uppercase mb-1">Damage</div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
          <div className="flex justify-between">
            <span className="text-gray-500">Hull:</span>
            <span className={ship.damage.hullIntegrity < 50 ? 'text-red-400' : 'text-gray-300'}>
              {ship.damage.hullIntegrity.toFixed(0)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Buoyancy:</span>
            <span className={ship.damage.buoyancy < 50 ? 'text-red-400' : 'text-gray-300'}>
              {ship.damage.buoyancy.toFixed(0)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Stability:</span>
            <span className={ship.damage.stability < 50 ? 'text-red-400' : 'text-gray-300'}>
              {ship.damage.stability.toFixed(0)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Crew:</span>
            <span className={ship.damage.crewEfficiency < 50 ? 'text-red-400' : 'text-gray-300'}>
              {ship.damage.crewEfficiency.toFixed(0)}%
            </span>
          </div>
        </div>

        {/* Fire/Flood bars */}
        {ship.damage.fire > 0 && (
          <div className="mt-1">
            <div className="flex justify-between text-[9px]">
              <span className="text-orange-400">FIRE</span>
              <span className="text-orange-300">{ship.damage.fire.toFixed(0)}%</span>
            </div>
            <div className="w-full h-1 bg-gray-800 rounded">
              <div className="h-full bg-orange-500 rounded" style={{ width: `${ship.damage.fire}%` }} />
            </div>
          </div>
        )}
        {ship.damage.flooding > 0 && (
          <div className="mt-1">
            <div className="flex justify-between text-[9px]">
              <span className="text-blue-400">FLOOD</span>
              <span className="text-blue-300">{ship.damage.flooding.toFixed(0)}%</span>
            </div>
            <div className="w-full h-1 bg-gray-800 rounded">
              <div className="h-full bg-blue-500 rounded" style={{ width: `${ship.damage.flooding}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Modules - full grid (non-compact) */}
      <div className="border-t border-gray-800 pt-1 mt-1">
        <NavalShipModuleGrid ship={ship} />
      </div>

      {/* Weapons */}
      <div className="border-t border-gray-800 pt-1 mt-1">
        <div className="text-[10px] text-gray-500 uppercase mb-1">Weapons</div>
        <div className="flex flex-wrap gap-1">
          {ship.weapons.map((w) => (
            <span key={w.id} className="text-[9px] px-1 rounded bg-gray-800 text-gray-400">
              {w.name}: {w.ammo}
            </span>
          ))}
        </div>
      </div>

      {/* Sensors */}
      <div className="border-t border-gray-800 pt-1 mt-1">
        <div className="text-[10px] text-gray-500 uppercase mb-1">Sensors</div>
        <div className="flex gap-2 text-[10px]">
          <span className={ship.sensors.radarOperational ? 'text-green-400' : 'text-red-400'}>
            RDR {ship.sensors.radarOperational ? 'ON' : 'OFF'}
          </span>
          <span className={ship.sensors.sonarOperational ? 'text-green-400' : 'text-red-400'}>
            SON {ship.sensors.sonarOperational ? 'ON' : 'OFF'}
          </span>
          <span className={ship.sensors.cicOperational ? 'text-green-400' : 'text-red-400'}>
            CIC {ship.sensors.cicOperational ? 'ON' : 'OFF'}
          </span>
        </div>
      </div>

      {/* DC Teams */}
      <div className="border-t border-gray-800 pt-1 mt-1 text-[10px] text-gray-500">
        DC Teams: {ship.damageControl.availableTeams} available / {ship.damageControl.assignedTeams.length} assigned
        {ship.damageControl.fatigue > 20 && (
          <span className="text-yellow-400 ml-1">(fatigue: {ship.damageControl.fatigue}%)</span>
        )}
      </div>

      {/* Aircraft - carrier only */}
      {ship.aircraft && (
        <div className="border-t border-gray-800 pt-1 mt-1">
          <div className="text-[10px] text-gray-500 uppercase mb-1">Air Group</div>
          <div className="grid grid-cols-3 gap-1 text-[9px]">
            <div className="text-gray-400">Fighters: <span className="text-gray-200">{ship.aircraft.fighters}</span></div>
            <div className="text-gray-400">Dive: <span className="text-gray-200">{ship.aircraft.diveBombers}</span></div>
            <div className="text-gray-400">Torp: <span className="text-gray-200">{ship.aircraft.torpedoBombers}</span></div>
          </div>
          <div className="flex justify-between text-[9px] mt-0.5">
            <span className="text-gray-400">Ready: <span className="text-green-400">{ship.aircraft.readyAircraft}</span></span>
            <span className="text-gray-400">Lost: <span className="text-red-400">{ship.aircraft.lostAircraft}</span></span>
            <span className="text-gray-400">Deck: <span className={ship.aircraft.deckCycleState === 'ready' ? 'text-green-400' : ship.aircraft.deckCycleState === 'deck_damaged' ? 'text-red-400' : 'text-yellow-400'}>{ship.aircraft.deckCycleState}</span></span>
          </div>
          {ship.aircraft.aircraft && ship.aircraft.aircraft.length > 0 && (
            <div className="mt-1 max-h-24 overflow-auto">
              <div className="text-[9px] text-gray-500 uppercase mb-0.5">Active Aircraft ({ship.aircraft.aircraft.length})</div>
              {ship.aircraft.aircraft.map((ac) => (
                <div key={ac.id} className="text-[8px] text-gray-400 flex items-center gap-1 py-0.5 border-b border-gray-800/30">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    ac.status === 'attack_run' ? 'bg-red-400' :
                    ac.status === 'en_route' ? 'bg-blue-400' :
                    ac.status === 'egress' ? 'bg-yellow-400' :
                    ac.status === 'lost' ? 'bg-gray-600' : 'bg-green-400'
                  }`} />
                  <span>{ac.aircraftClass}</span>
                  <span>{ac.status}</span>
                  <span>{ac.speedKts}kts</span>
                  <span>HDG{ac.headingDeg}°</span>
                  <span>Fuel{ac.fuel}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
