/**
 * NavalScene3D - Three.js 3D 海战场景 v3
 * 修复：水面平放、舰船可移动、视野切换、label
 */

import React, { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useNavalStore } from '@/store/naval-store';

const S = 0.15;

// ========== 坐标 (全局) ==========
function useCoords() {
  const overlay = useNavalStore(s => s.overlay);
  return useMemo(() => {
    if (!overlay) return { cx: 0, cz: 0 };
    const W = overlay[0]?.length ?? 1024;
    const H = overlay.length;
    return { cx: W * S / 2, cz: H * S / 2, W, H, overlay };
  }, [overlay]);
}
function tx(wx: number, cx: number) { return wx * S - cx; }
function tz(wy: number, cz: number) { return -(wy * S - cz); }

// ========== 海洋 + 岛屿 ==========
function TerrainLayer() {
  const { overlay, cx, cz } = useCoords();
  if (!overlay) return null;
  const H = overlay.length, W = overlay[0]?.length ?? 0;
  const step = 6;
  const data = useMemo(() => {
    const items: Array<{ x: number; z: number; type: number }> = [];
    for (let gy = 0; gy < Math.ceil(H/step); gy++) {
      for (let gx = 0; gx < Math.ceil(W/step); gx++) {
        const y = gy*step, x = gx*step;
        const c = overlay[Math.min(y,H-1)]?.[Math.min(x,W-1)];
        if (!c) continue;
        let t = 0;
        if (c.seaZoneType === 'deep_ocean') t = 1;
        else if (c.seaZoneType === 'coastal_water') t = 2;
        else if (c.seaZoneType === 'shallow_water' || c.seaZoneType === 'reef') t = 3;
        else if (c.seaZoneType === 'island') t = 4;
        if (t > 0) items.push({ x: tx(x, cx), z: tz(y, cz), type: t });
      }
    }
    return items;
  }, [overlay, cx, cz]);

  return (
    <>
      {data.map((d, i) => (
        <group key={i}>
          {d.type === 4 ? (
            <mesh position={[d.x, 0.15, d.z]}>
              <boxGeometry args={[step*S*0.85, 0.35 + Math.random()*0.2, step*S*0.85]} />
              <meshStandardMaterial color="#1e4a14" roughness={0.85} />
            </mesh>
          ) : (
            <mesh position={[d.x, -0.02, d.z]} rotation={[-Math.PI/2, 0, 0]}>
              <planeGeometry args={[step*S*0.95, step*S*0.95]} />
              <meshBasicMaterial
                color={d.type===1?'#061428':d.type===2?'#0c3a5a':'#0e5a4a'}
                transparent opacity={d.type===1?0.7:d.type===2?0.55:0.45}
              />
            </mesh>
          )}
        </group>
      ))}
    </>
  );
}

// ========== 设施 ==========
function FacilitiesLayer() {
  const facilities = useNavalStore(s => s.facilities);
  const { overlay, cx, cz } = useCoords();
  if (!overlay) return null;
  return (<>
    {facilities.map(f => (
      <group key={f.id}>
        <mesh position={[tx(f.position.globalX, cx), 0.3, tz(f.position.globalY, cz)]}>
          <cylinderGeometry args={[0.35, 0.4, 0.5, 8]}/>
          <meshStandardMaterial color={f.type==='naval_base'?'#f59e0b':f.type==='port'?'#3b82f6':f.type==='airfield'?'#a855f7':'#22c55e'}
            emissive={f.type==='naval_base'?'#f59e0b':f.type==='port'?'#3b82f6':f.type==='airfield'?'#a855f7':'#22c55e'} emissiveIntensity={0.3}/>
        </mesh>
        <mesh position={[tx(f.position.globalX, cx), 0.65, tz(f.position.globalY, cz)]}>
          <sphereGeometry args={[0.15, 6, 6]}/><meshBasicMaterial color="white"/>
        </mesh>
        <Text position={[tx(f.position.globalX, cx), 0.85, tz(f.position.globalY, cz)]} fontSize={0.3} color={f.faction==='player'?'#60a5fa':'#f87171'} anchorX="center" anchorY="bottom" outlineWidth={0.02} outlineColor="#000">{f.name}</Text>
      </group>
    ))}
  </>);
}

// ========== 视野范围 ==========
function VisibilityOverlay({ showVisual, showRadar, showSonar }: { showVisual: boolean; showRadar: boolean; showSonar: boolean }) {
  const fleets = useNavalStore(s => s.fleets);
  const { overlay, cx, cz } = useCoords();
  if (!overlay || (!showVisual && !showRadar && !showSonar)) return null;
  const ships = fleets.filter(f => f.faction === 'player').flatMap(f => f.ships);
  
  const circles = useMemo(() => {
    const c: Array<{ x: number; z: number; r: number; color: string; alpha: number; y: number }> = [];
    for (const ship of ships) {
      const px = tx(ship.position.x, cx), pz = tz(ship.position.y, cz);
      if (showVisual) c.push({ x: px, z: pz, r: ship.sensors.visualRange * S, color: '#22c55e', alpha: 0.15, y: 0.005 });
      if (showRadar && ship.sensors.radarOperational) c.push({ x: px, z: pz, r: ship.sensors.surfaceRadarRange * S, color: '#3b82f6', alpha: 0.10, y: 0.005 });
      if (showSonar && ship.sensors.sonarOperational) c.push({ x: px, z: pz, r: ship.sensors.sonarRange * S, color: '#eab308', alpha: 0.12, y: -0.03 });
    }
    return c;
  }, [ships, showVisual, showRadar, showSonar, cx, cz]);

  return (<>{circles.map((c,i) => (
    <mesh key={i} position={[c.x, c.y, c.z]} rotation={[-Math.PI/2, 0, 0]}>
      <ringGeometry args={[c.r - 0.06, c.r, 48]} />
      <meshBasicMaterial color={c.color} transparent opacity={c.alpha} side={THREE.DoubleSide} />
    </mesh>
  ))}</>);
}

// ========== 舰船(3D) ==========
const SHIP_DIMS: Record<string, [number,number,number,number,number]> = {
  fleet_carrier: [2.8,0.9,0.25,0,1], light_carrier: [2.2,0.75,0.22,0,1], escort_carrier: [1.8,0.65,0.2,0,1],
  battleship: [2.4,0.85,0.3,3,0], heavy_cruiser: [2.0,0.6,0.25,2,0], light_cruiser: [1.7,0.55,0.22,2,0],
  destroyer: [1.3,0.35,0.18,1,0], submarine: [0.9,0.2,0.15,0,2],
  transport: [1.5,0.6,0.22,0,0], oiler: [1.4,0.55,0.2,0,0], landing_ship: [1.3,0.5,0.18,0,0],
};

function ShipModel({ ship, onClick }: { ship: any; onClick?: () => void }) {
  const { overlay, cx, cz } = useCoords();
  if (!overlay) return null;
  const px = tx(ship.position.x, cx), pz = tz(ship.position.y, cz);
  const angle = THREE.MathUtils.degToRad(ship.headingDeg);
  const fc = ship.faction === 'player' ? '#3b82f6' : '#ef4444';
  const [len, wid, hgt, turrets, subtype] = SHIP_DIMS[ship.shipClass] || SHIP_DIMS.destroyer;

  return (
    <group position={[px, 0.15, pz]} rotation={[0, angle, 0]} onClick={onClick}>
      <mesh><boxGeometry args={[len, hgt, wid]}/><meshStandardMaterial color={fc} roughness={0.5} metalness={0.35}/></mesh>
      <mesh position={[len/2+0.15, -hgt*0.3, 0]} rotation={[0,0,Math.PI/4]}><boxGeometry args={[0.3, hgt*0.6, wid*0.7]}/><meshStandardMaterial color={fc}/></mesh>
      {subtype===1 && <><mesh position={[0, hgt+0.02, 0]}><boxGeometry args={[len*0.85, 0.04, wid*0.8]}/><meshStandardMaterial color="#64748b" roughness={0.6}/></mesh>
        <mesh position={[len*0.15, hgt+0.2, wid*0.25]}><boxGeometry args={[len*0.2, 0.35, wid*0.3]}/><meshStandardMaterial color="#334155"/></mesh></>}
      {subtype===2 && <mesh position={[len*0.15, hgt+0.15, 0]}><cylinderGeometry args={[0.1, 0.13, 0.25, 6]}/><meshStandardMaterial color="#1e293b"/></mesh>}
      {turrets > 0 && Array.from({length: turrets}).map((_, i) => {
        const spread = turrets > 1 ? (i/(turrets-1)-0.5) * (len*0.5) : 0;
        return <group key={i} position={[spread, hgt+0.05, 0]}>
          <mesh><boxGeometry args={[0.25, 0.15, 0.2]}/><meshStandardMaterial color="#475569"/></mesh>
          <mesh position={[0.18, 0.03, 0]}><cylinderGeometry args={[0.04, 0.04, 0.2, 6]}/><meshStandardMaterial color="#1e293b"/></mesh>
        </group>;
      })}
      <Text position={[0, hgt+0.45, 0]} fontSize={0.22} color={ship.faction==='player'?'#93c5fd':'#fca5a5'} anchorX="center" outlineWidth={0.02} outlineColor="#000">{ship.name.split(' ').pop()}</Text>
      <group rotation={[0,0,-Math.PI/2]}><mesh position={[len/2+0.3, 0.05, 0]}><coneGeometry args={[0.12, 0.25, 4]}/><meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.6}/></mesh></group>
      {ship.speedKts > 3 && <mesh position={[-len/2-0.3, 0.02, wid*0.3]}><boxGeometry args={[ship.speedKts*0.008, 0.02, 0.04]}/><meshBasicMaterial color={ship.faction==='player'?'#93c5fd':'#fca5a5'} transparent opacity={0.6}/></mesh>}
    </group>
  );
}

// ========== 接触 ==========
function ContactLayer() {
  const contacts = useNavalStore(s => s.intel.playerContacts);
  const { overlay, cx, cz } = useCoords();
  if (!overlay) return null;
  return (<>{contacts.map(c => {
    if (c.detectionLevel==='none'||c.detectionLevel==='lost') return null;
    const px=tx(c.lastKnownPosition.x, cx), pz=tz(c.lastKnownPosition.y, cz);
    const t = c.detectionLevel==='tracked'||c.detectionLevel==='identified';
    return <group key={c.id}>
      <mesh position={[px, 0.35, pz]}>
        {t ? <coneGeometry args={[0.35, 0.9, 6]}/> : <sphereGeometry args={[0.3, 8, 8]}/>}
        <meshStandardMaterial color={t?'#ef4444':'#fbbf24'} transparent opacity={t?0.7:0.4} emissive={t?'#ef4444':'#fbbf24'} emissiveIntensity={0.3} wireframe={!t}/>
      </mesh>
      <mesh position={[px, 0.015, pz]} rotation={[-Math.PI/2,0,0]}>
        <ringGeometry args={[c.uncertaintyRadius*S*0.6, c.uncertaintyRadius*S*0.6+0.06, 36]}/>
        <meshBasicMaterial color={t?'#ef4444':'#fbbf24'} transparent opacity={0.18} side={THREE.DoubleSide}/>
      </mesh>
      <Text position={[px, 0.9, pz]} fontSize={0.22} color={t?'#fca5a5':'#fde68a'} anchorX="center">{c.detectionLevel}</Text>
    </group>;
  })}</>);
}

// ========== 主组件 ==========
export function NavalScene3D() {
  const overlay = useNavalStore(s => s.overlay);
  const fleets = useNavalStore(s => s.fleets);
  const selectFleet = useNavalStore(s => s.selectFleet);
  const selectedFleetId = useNavalStore(s => s.selectedFleetId);
  const openNavalCombatView = useNavalStore(s => s.openNavalCombatView);
  const [vis, setVis] = useState(true);
  const [radar, setRadar] = useState(false);
  const [sonar, setSonar] = useState(false);

  if (!overlay || fleets.length === 0) return null;

  return (
    <div className="relative w-full h-full">
      {/* 切换按钮 */}
      <div className="absolute top-3 right-3 z-10 flex gap-1.5">
        {[{label:'VIS',v:vis,s:setVis,c:'border-green-500 text-green-400'},
          {label:'RDR',v:radar,s:setRadar,c:'border-blue-500 text-blue-400'},
          {label:'SON',v:sonar,s:setSonar,c:'border-yellow-500 text-yellow-400'}].map(b=>(
          <button key={b.label} onClick={()=>b.s(!b.v)}
            className={`px-2 py-1 text-[10px] font-bold rounded border ${b.v?`${b.c} bg-slate-900/80`:'border-slate-700 text-slate-600 bg-slate-900/50'}`}>{b.label}</button>
        ))}
      </div>

      <Canvas camera={{position:[0,65,0],fov:40,near:0.1,far:600}} style={{background:'#0a1628'}} gl={{antialias:true}}>
        <ambientLight intensity={0.35} />
        <directionalLight position={[80,120,50]} intensity={0.9} />
        <pointLight position={[0,40,0]} intensity={0.25} color="#4488cc" />
        <hemisphereLight args={['#1e3a5f','#0a1628',0.3]} />
        <TerrainLayer />
        <gridHelper args={[150,50,'#1a3a5a','#0a1a2a']} position={[0,0.005,0]} />
        <FacilitiesLayer />
        <VisibilityOverlay showVisual={vis} showRadar={radar} showSonar={sonar} />
        <ContactLayer />
        {fleets.filter(f=>f.faction==='player').flatMap(f=>
          f.ships.map(s=><ShipModel key={s.id} ship={s} onClick={()=>{selectFleet(f.id);if(f.id===selectedFleetId)openNavalCombatView(f.id);}}/>)
        )}
        <OrbitControls enableDamping dampingFactor={0.08} minDistance={5} maxDistance={150} maxPolarAngle={Math.PI/2.2} />
      </Canvas>
    </div>
  );
}
