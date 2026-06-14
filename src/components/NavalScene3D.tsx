/**
 * NavalScene3D - Three.js 3D 海战场景 (优化版)
 * 修复无限循环 + 合并视野区域 + 可切换显示层
 */

import React, { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useNavalStore } from '@/store/naval-store';
import type { NavalShip } from '@/game/naval/ship/ship-types';

const S = 0.15;
function toX(wx: number, cx: number) { return wx * S - cx; }
function toZ(wy: number, cz: number) { return -(wy * S - cz); }

// ========== 坐标缓存（避免重复计算） ==========
let _cx = 0, _cz = 0, _W = 0, _H = 0;
function syncCoords(overlay: any) {
  _H = overlay.length; _W = overlay[0]?.length ?? 1024;
  _cx = _W * S / 2; _cz = _H * S / 2;
}

// ========== 海洋分层 ==========
function OceanFloor() {
  const overlay = useNavalStore(s => s.overlay);
  if (!overlay) return null;
  syncCoords(overlay);
  const data = useMemo(() => {
    const items: Array<{ px: number; pz: number; color: string; opacity: number; h: number; tree?: boolean }> = [];
    const step = 8;
    for (let gy = 0; gy < Math.ceil(_H/step); gy++) {
      for (let gx = 0; gx < Math.ceil(_W/step); gx++) {
        const y = gy*step, x = gx*step;
        const cell = overlay[Math.min(y,_H-1)]?.[Math.min(x,_W-1)];
        if (!cell) continue;
        const px = toX(x, _cx), pz = toZ(y, _cz);
        if (cell.seaZoneType === 'deep_ocean') items.push({ px, pz, color: '#061428', opacity: 0.6, h: -0.05 });
        else if (cell.seaZoneType === 'coastal_water') items.push({ px, pz, color: '#0c3a5a', opacity: 0.5, h: -0.04 });
        else if (cell.seaZoneType === 'shallow_water' || cell.seaZoneType === 'reef') items.push({ px, pz, color: '#0e5a4a', opacity: 0.4, h: -0.03 });
        else if (cell.seaZoneType === 'island') items.push({ px, pz, color: '#1e4a14', opacity: 0.85, h: 0.12 + Math.random()*0.25, tree: Math.random()<0.3 });
      }
    }
    return items;
  }, [overlay]);

  return (
    <>
      {data.map((d, i) => (
        <group key={i}>
          <mesh position={[d.px, d.h, d.pz]} castShadow={d.color==='#1e4a14'}>
            {d.color === '#1e4a14'
              ? <boxGeometry args={[8*S*0.85, d.h*2, 8*S*0.85]} />
              : <planeGeometry args={[8*S*0.9, 8*S*0.9]} />
            }
            {d.color === '#1e4a14'
              ? <meshStandardMaterial color={d.color} roughness={0.85} />
              : <meshBasicMaterial color={d.color} transparent opacity={d.opacity} />
            }
          </mesh>
          {d.tree && <mesh position={[d.px+(Math.random()-0.5)*2, 0.5, d.pz+(Math.random()-0.5)*2]}><coneGeometry args={[0.2, 0.4, 4]}/><meshStandardMaterial color="#0d3d0a"/></mesh>}
        </group>
      ))}
    </>
  );
}

// ========== 设施 ==========
function FacilitiesLayer() {
  const facilities = useNavalStore(s => s.facilities);
  const overlay = useNavalStore(s => s.overlay);
  if (!overlay) return null;
  syncCoords(overlay);
  return (<>
    {facilities.map(f => {
      const px = toX(f.position.globalX, _cx), pz = toZ(f.position.globalY, _cz);
      const c = f.type==='naval_base'?'#f59e0b':f.type==='port'?'#3b82f6':f.type==='airfield'?'#a855f7':'#22c55e';
      return (
        <group key={f.id}>
          <mesh position={[px, 0.3, pz]}><cylinderGeometry args={[0.35, 0.4, 0.5, 8]}/><meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.3}/></mesh>
          <mesh position={[px, 0.65, pz]}><sphereGeometry args={[0.15, 6, 6]}/><meshBasicMaterial color="white"/></mesh>
          <Text position={[px, 0.85, pz]} fontSize={0.3} color={f.faction==='player'?'#60a5fa':'#f87171'} anchorX="center" anchorY="bottom" outlineWidth={0.02} outlineColor="#000">{f.name}</Text>
        </group>
      );
    })}
  </>);
}

// ========== 视野云（合并所有船的传感器范围为一个区） ==========
function VisibilityOverlay({ showVisual, showRadar, showSonar }: { showVisual: boolean; showRadar: boolean; showSonar: boolean }) {
  const fleets = useNavalStore(s => s.fleets);
  const overlay = useNavalStore(s => s.overlay);
  if (!overlay || (!showVisual && !showRadar && !showSonar)) return null;
  syncCoords(overlay);
  const ships = fleets.filter(f => f.faction === 'player').flatMap(f => f.ships);

  const circles = useMemo(() => {
    const c: Array<{ px: number; pz: number; r: number; color: string; alpha: number }> = [];
    for (const ship of ships) {
      const px = toX(ship.position.x, _cx), pz = toZ(ship.position.y, _cz);
      if (showVisual) c.push({ px, pz, r: ship.sensors.visualRange * S, color: '#22c55e', alpha: 0.12 });
      if (showRadar && ship.sensors.radarOperational) c.push({ px, pz, r: ship.sensors.surfaceRadarRange * S, color: '#3b82f6', alpha: 0.08 });
      if (showSonar && ship.sensors.sonarOperational) c.push({ px, pz, r: ship.sensors.sonarRange * S, color: '#eab308', alpha: 0.1 });
    }
    return c;
  }, [ships, showVisual, showRadar, showSonar]);

  return (
    <>
      {circles.map((c, i) => (
        <mesh key={i} position={[c.px, showSonar && c.color==='#eab308' ? -0.04 : 0.012, c.pz]} rotation={[-Math.PI/2, 0, 0]}>
          <ringGeometry args={[c.r - 0.05, c.r, 48]} />
          <meshBasicMaterial color={c.color} transparent opacity={c.alpha} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

// ========== 舰船 ==========
function ShipModel({ ship, onClick }: { ship: NavalShip; onClick?: () => void }) {
  const overlay = useNavalStore(s => s.overlay);
  if (!overlay) return null;
  syncCoords(overlay);
  const px = toX(ship.position.x, _cx), pz = toZ(ship.position.y, _cz);
  const angle = THREE.MathUtils.degToRad(ship.headingDeg);
  const sc = ship.shipClass;
  const fc = ship.faction === 'player' ? '#3b82f6' : '#ef4444';
  const dims: Record<string, number[]> = {
    fleet_carrier: [2.8, 0.9, 0.25, 0, 1], light_carrier: [2.2, 0.75, 0.22, 0, 1], escort_carrier: [1.8, 0.65, 0.2, 0, 1],
    battleship: [2.4, 0.85, 0.3, 3, 0], heavy_cruiser: [2.0, 0.6, 0.25, 2, 0], light_cruiser: [1.7, 0.55, 0.22, 2, 0],
    destroyer: [1.3, 0.35, 0.18, 1, 0], submarine: [0.9, 0.2, 0.15, 0, 2],
    transport: [1.5, 0.6, 0.22, 0, 0], oiler: [1.4, 0.55, 0.2, 0, 0], landing_ship: [1.3, 0.5, 0.18, 0, 0],
  };
  const [len, wid, hgt, turrets, subtype] = dims[sc] || dims.destroyer;
  const isDeck = subtype === 1;
  const isSub = subtype === 2;

  return (
    <group position={[px, 0.15, pz]} rotation={[0, angle, 0]} onClick={onClick}>
      {/* Hull */}
      <mesh castShadow><boxGeometry args={[len, hgt, wid]}/><meshStandardMaterial color={fc} roughness={0.5} metalness={0.35}/></mesh>
      {/* Bow wedge */}
      <mesh position={[len/2+0.15, -hgt*0.3, 0]} rotation={[0,0,Math.PI/4]}><boxGeometry args={[0.3, hgt*0.6, wid*0.7]}/><meshStandardMaterial color={fc} roughness={0.5} metalness={0.35}/></mesh>
      {/* Deck */}
      {isDeck && <mesh position={[0, hgt+0.02, 0]}><boxGeometry args={[len*0.85, 0.04, wid*0.8]}/><meshStandardMaterial color="#64748b" roughness={0.6}/></mesh>}
      {/* Island */}
      {isDeck && <mesh position={[len*0.15, hgt+0.2, wid*0.25]}><boxGeometry args={[len*0.2, 0.35, wid*0.3]}/><meshStandardMaterial color="#334155"/></mesh>}
      {/* Turrets */}
      {turrets > 0 && Array.from({length: turrets}).map((_, i) => {
        const spread = turrets > 1 ? (i/(turrets-1)-0.5) * (len*0.5) : 0;
        return (
          <group key={i} position={[spread, hgt+0.05, 0]}>
            <mesh><boxGeometry args={[0.25, 0.15, 0.2]}/><meshStandardMaterial color="#475569"/></mesh>
            <mesh position={[0.18, 0.03, 0]}><cylinderGeometry args={[0.04, 0.04, 0.2, 6]}/><meshStandardMaterial color="#1e293b"/></mesh>
          </group>
        );
      })}
      {/* Sub conning tower */}
      {isSub && <mesh position={[len*0.15, hgt+0.15, 0]}><cylinderGeometry args={[0.1, 0.13, 0.25, 6]}/><meshStandardMaterial color="#1e293b"/></mesh>}
      {/* Name */}
      <Text position={[0, hgt+0.45, 0]} fontSize={0.22} color={ship.faction==='player'?'#93c5fd':'#fca5a5'} anchorX="center" outlineWidth={0.02} outlineColor="#000">{ship.name.split(' ').pop()}</Text>
      {/* Heading arrow */}
      <group rotation={[0, 0, -Math.PI/2]}><mesh position={[len/2+0.3, 0.05, 0]}><coneGeometry args={[0.12, 0.25, 4]}/><meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.6}/></mesh></group>
      {/* Speed wake */}
      {ship.speedKts > 3 && <mesh position={[-len/2-0.3, 0.02, wid*0.3]}><boxGeometry args={[ship.speedKts*0.008, 0.02, 0.04]}/><meshBasicMaterial color={ship.faction==='player'?'#93c5fd':'#fca5a5'} transparent opacity={0.6}/></mesh>}
    </group>
  );
}

// ========== 接触 ==========
function ContactLayer() {
  const contacts = useNavalStore(s => s.intel.playerContacts);
  const overlay = useNavalStore(s => s.overlay);
  if (!overlay) return null;
  syncCoords(overlay);
  return (<>
    {contacts.map(c => {
      if (c.detectionLevel==='none'||c.detectionLevel==='lost') return null;
      const px=toX(c.lastKnownPosition.x, _cx), pz=toZ(c.lastKnownPosition.y, _cz);
      const tracked=c.detectionLevel==='tracked'||c.detectionLevel==='identified';
      return (
        <group key={c.id}>
          <mesh position={[px, 0.35, pz]}>
            {tracked ? <coneGeometry args={[0.35, 0.9, 6]}/> : <sphereGeometry args={[0.3, 8, 8]}/>}
            <meshStandardMaterial color={tracked?'#ef4444':'#fbbf24'} transparent opacity={tracked?0.7:0.4} emissive={tracked?'#ef4444':'#fbbf24'} emissiveIntensity={0.3} wireframe={!tracked}/>
          </mesh>
          <mesh position={[px, 0.015, pz]} rotation={[-Math.PI/2,0,0]}>
            <ringGeometry args={[c.uncertaintyRadius*S*0.6, c.uncertaintyRadius*S*0.6+0.06, 36]}/>
            <meshBasicMaterial color={tracked?'#ef4444':'#fbbf24'} transparent opacity={0.18} side={THREE.DoubleSide}/>
          </mesh>
          <Text position={[px, 0.9, pz]} fontSize={0.22} color={tracked?'#fca5a5':'#fde68a'} anchorX="center">{c.detectionLevel}</Text>
        </group>
      );
    })}
  </>);
}

// ========== 主场景 ==========
function Scene({ showVisual, showRadar, showSonar }: { showVisual: boolean; showRadar: boolean; showSonar: boolean }) {
  const overlay = useNavalStore(s => s.overlay);
  const fleets = useNavalStore(s => s.fleets);
  const selectFleet = useNavalStore(s => s.selectFleet);
  const selectedFleetId = useNavalStore(s => s.selectedFleetId);
  const openNavalCombatView = useNavalStore(s => s.openNavalCombatView);

  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[80, 120, 50]} intensity={0.9} />
      <pointLight position={[0, 40, 0]} intensity={0.25} color="#4488cc" />
      <hemisphereLight args={['#1e3a5f', '#0a1628', 0.3]} />

      <OceanFloor />
      <gridHelper args={[150, 50, '#1a3a5a', '#0a1a2a']} position={[0, 0.01, 0]} />
      <FacilitiesLayer />
      <VisibilityOverlay showVisual={showVisual} showRadar={showRadar} showSonar={showSonar} />
      <ContactLayer />

      {/* 己方舰队 */}
      {fleets.filter(f=>f.faction==='player').flatMap(f =>
        f.ships.map(ship => (
          <ShipModel key={ship.id} ship={ship} onClick={() => { selectFleet(f.id); if(f.id===selectedFleetId) openNavalCombatView(f.id); }} />
        ))
      )}
    </>
  );
}

// ========== 入口 ==========
export function NavalScene3D() {
  const overlay = useNavalStore(s => s.overlay);
  const fleets = useNavalStore(s => s.fleets);
  const [vis, setVis] = useState(true);
  const [radar, setRadar] = useState(false);
  const [sonar, setSonar] = useState(false);

  if (!overlay || fleets.length === 0) return null;

  return (
    <div className="relative w-full h-full">
      {/* 视野切换按钮 */}
      <div className="absolute top-3 right-3 z-10 flex gap-1.5">
        {[
          { label: '👁️ VIS', value: vis, set: setVis, color: 'border-green-500 text-green-400' },
          { label: '📡 RDR', value: radar, set: setRadar, color: 'border-blue-500 text-blue-400' },
          { label: '🔊 SON', value: sonar, set: setSonar, color: 'border-yellow-500 text-yellow-400' },
        ].map(b => (
          <button key={b.label}
            onClick={() => b.set(!b.value)}
            className={`px-2 py-1 text-[10px] font-bold rounded border transition-colors ${b.value ? `${b.color} bg-slate-900/80` : 'border-slate-700 text-slate-600 bg-slate-900/50'}`}>
            {b.label}
          </button>
        ))}
      </div>

      <Canvas
        camera={{ position: [0, 65, 0], fov: 40, near: 0.1, far: 600 }}
        style={{ background: '#0a1628' }}
        gl={{ antialias: true }}
      >
        <Scene showVisual={vis} showRadar={radar} showSonar={sonar} />
        <OrbitControls enableDamping dampingFactor={0.08} minDistance={5} maxDistance={150} maxPolarAngle={Math.PI/2.2} target={[0,0,0]} />
      </Canvas>
    </div>
  );
}
