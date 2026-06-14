import React from 'react';
import { useNavalStore } from '@/store/naval-store';

export function NavalStrategicMapPanel() {
  const { fleets, intel, selectedFleetId, selectFleet, facilities, shippingLanes, overlay } = useNavalStore();
  const playerFleets = fleets.filter((f) => f.faction === 'player');
  const contacts = intel.playerContacts;
  const W = overlay?.[0]?.length ?? 1024;
  const H = overlay?.length ?? 1024;
  const S = 0.55;

  return (
    <div className="relative w-full h-full navy-bg overflow-hidden">
      <svg className="w-full h-full" viewBox={`0 0 ${W*S} ${H*S}`}>
        {/* Ocean */}
        <rect width={W*S} height={H*S} fill="#0a1628" />

        {/* Terrain blocks (sampled every 8 cells) */}
        {overlay && Array.from({length: Math.ceil(H/8)}).flatMap((_,gy) =>
          Array.from({length: Math.ceil(W/8)}).map((_,gx) => {
            const x=gx*8, y=gy*8;
            const c = overlay[Math.min(y,H-1)]?.[Math.min(x,W-1)];
            if (!c) return null;
            let fill='none',op=0;
            if (c.seaZoneType==='island'){fill='#1a3a1a';op=0.8}
            else if(c.seaZoneType==='shallow_water'||c.seaZoneType==='reef'){fill='#0f766e';op=0.4}
            else if(c.seaZoneType==='coastal_water'){fill='#0c4a6e';op=0.3}
            else return null;
            return <rect key={`t${gx}_${gy}`} x={x*S} y={H*S-(y+8)*S} width={8*S} height={8*S} fill={fill} opacity={op} rx={1}/>;
          })
        )}

        {/* Shipping lanes */}
        {shippingLanes.map(l => (
          <polyline key={l.id} points={l.waypoints.map(w=>`${w.globalX*S},${H*S-w.globalY*S}`).join(' ')}
            fill="none" stroke="#1e40af" strokeWidth={1.5} strokeDasharray="6,4" opacity={0.3}/>
        ))}

        {/* Facilities */}
        {facilities.map(f => {
          const fx=f.x*S, fy=H*S-f.y*S;
          const fc=f.faction==='player'?'#60a5fa':f.faction==='enemy'?'#f87171':'#9ca3af';
          return (
            <g key={f.id}>
              {f.type==='naval_base'?<circle cx={fx} cy={fy} r={5} fill="#f59e0b" stroke="#fff" strokeWidth={1}/>:null}
              {f.type==='port'?<circle cx={fx} cy={fy} r={4} fill="#3b82f6" stroke="#fff" strokeWidth={0.8}/>:null}
              {f.type==='airfield'?<rect x={fx-4} y={fy-2.5} width={8} height={5} fill="#a855f7" stroke="#fff" strokeWidth={0.5} rx={1}/>:null}
              {f.type==='supply_depot'?<rect x={fx-3} y={fy-3} width={6} height={6} fill="#22c55e" stroke="#fff" strokeWidth={0.5}/>:null}
              {f.type!=='supply_depot' && <text x={fx} y={fy+10} textAnchor="middle" fill={fc} fontSize={7} fontWeight="bold" className="select-none">{f.name}</text>}
            </g>
          );
        })}
      </svg>

      {/* Fleet markers */}
      {playerFleets.map(f => (
        <div key={f.id} onClick={() => selectFleet(f.id)}
          className={`absolute cursor-pointer ${f.id===selectedFleetId?'ring-2 ring-amber-400 rounded':''}`}
          style={{left:`${f.position.globalX*S}px`,top:`${H*S-f.position.globalY*S}px`,transform:'translate(-50%,-50%)'}}>
          <div className={`w-4 h-4 rounded-full mx-auto border-2 ${f.type==='carrier_task_force'?'bg-sky-600 border-sky-400':f.type==='surface_action_group'?'bg-red-600 border-red-400':'bg-slate-600 border-slate-400'}`}/>
          <span className="text-[9px] text-slate-300 block text-center whitespace-nowrap mt-0.5 font-medium">{f.name}</span>
        </div>
      ))}

      {/* Contact markers */}
      {contacts.map(c => (
        <div key={c.id} className="absolute" style={{left:`${c.lastKnownPosition.x*S}px`,top:`${H*S-c.lastKnownPosition.y*S}px`,transform:'translate(-50%,-50%)'}}>
          <div className="absolute rounded-full border pointer-events-none" style={{width:c.uncertaintyRadius*2*S,height:c.uncertaintyRadius*2*S,left:-(c.uncertaintyRadius*S),top:-(c.uncertaintyRadius*S),borderColor:c.detectionLevel==='tracked'?'#f59e0b':c.detectionLevel==='lost'?'#6b7280':'#fbbf24',borderStyle:c.detectionLevel==='lost'?'dashed':'solid',opacity:.35}}/>
          <div className={`w-3 h-3 rotate-45 border mx-auto ${c.detectionLevel==='tracked'?'border-amber-400 bg-amber-400/30':c.detectionLevel==='identified'?'border-red-400 bg-red-400/30':c.detectionLevel==='lost'?'border-slate-600 bg-slate-600/10':'border-yellow-400 bg-yellow-400/15'}`}/>
          <span className="text-[7px] text-slate-500 block text-center">{c.detectionLevel}</span>
        </div>
      ))}

      {/* Legend */}
      <div className="absolute bottom-2 left-2 glass rounded-lg p-2 text-[9px] text-slate-400 z-10 space-y-0.5">
        <div className="font-bold text-amber-400 text-[10px] mb-0.5">LEGEND</div>
        <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-500"/><span>Carrier TF</span></div>
        <div className="flex items-center gap-1"><span className="w-2 h-2 rotate-45 border border-red-400"/><span>Contact</span></div>
        <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"/><span>Naval Base</span></div>
        <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-500"/><span>Port</span></div>
        <div className="flex items-center gap-1"><span className="w-1.5 h-1 bg-purple-500 rounded"/><span>Airfield</span></div>
      </div>
    </div>
  );
}
