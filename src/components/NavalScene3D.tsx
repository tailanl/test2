/**
 * NavalScene3D - Three.js 3D 海战场景
 * 舰种差异化 + 传感器范围 + 地图清晰 + 可移动
 */

import React, { useRef, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useNavalStore } from '@/store/naval-store';
import type { NavalShip } from '@/game/naval/ship/ship-types';

// ========== 坐标工具 ==========
let S=0.15, CX=0, CZ=0;
function initCoords(overlay: any) {
  const H = overlay.length, W = overlay[0]?.length ?? 1024;
  S = 0.15; CX = W*S/2; CZ = H*S/2;
}
function toX(wx: number) { return wx * S - CX; }
function toZ(wy: number) { return -(wy * S - CZ); }

// ========== 海洋（深度分层） ==========
function OceanFloor() {
  const overlay = useNavalStore(s => s.overlay);
  if (!overlay) return null;
  initCoords(overlay);
  const H = overlay.length, W = overlay[0]?.length ?? 0;
  const step = 6;
  const elems: any[] = [];

  for (let gy = 0; gy < Math.ceil(H/step); gy++) {
    for (let gx = 0; gx < Math.ceil(W/step); gx++) {
      const y = gy*step, x = gx*step;
      const cell = overlay[Math.min(y,H-1)]?.[Math.min(x,W-1)];
      if (!cell) continue;
      const px = toX(x), pz = toZ(y);
      if (cell.seaZoneType === 'deep_ocean') {
        elems.push(<mesh key={`do${gx}_${gy}`} position={[px, -0.05, pz]}><planeGeometry args={[step*S*0.9, step*S*0.9]}/><meshBasicMaterial color="#061428" transparent opacity={0.6}/></mesh>);
      } else if (cell.seaZoneType === 'coastal_water') {
        elems.push(<mesh key={`cw${gx}_${gy}`} position={[px, -0.04, pz]}><planeGeometry args={[step*S*0.9, step*S*0.9]}/><meshBasicMaterial color="#0c3a5a" transparent opacity={0.5}/></mesh>);
      } else if (cell.seaZoneType === 'shallow_water' || cell.seaZoneType === 'reef') {
        elems.push(<mesh key={`sw${gx}_${gy}`} position={[px, -0.03, pz]}><planeGeometry args={[step*S*0.9, step*S*0.9]}/><meshBasicMaterial color="#0e5a4a" transparent opacity={0.4}/></mesh>);
      } else if (cell.seaZoneType === 'island') {
        elems.push(<mesh key={`is${gx}_${gy}`} position={[px, 0.12, pz]} castShadow><boxGeometry args={[step*S*0.85, 0.35+Math.random()*0.25, step*S*0.85]}/><meshStandardMaterial color="#1e4a14" roughness={0.85}/></mesh>);
        // Trees
        if (Math.random()<0.3) elems.push(<mesh key={`tr${gx}_${gy}`} position={[px+(Math.random()-0.5)*2, 0.4, pz+(Math.random()-0.5)*2]}><coneGeometry args={[0.2, 0.4, 4]}/><meshStandardMaterial color="#0d3d0a"/></mesh>);
      }
    }
  }
  return <>{elems}</>;
}

// ========== 设施 ==========
function FacilitiesLayer() {
  const facilities = useNavalStore(s => s.facilities);
  const overlay = useNavalStore(s => s.overlay);
  if (!overlay) return null;
  initCoords(overlay);
  return (<>
    {facilities.map(f => {
      const px = toX(f.position.globalX), pz = toZ(f.position.globalY);
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

// ========== 舰船（按舰种不同） ==========
function ShipMesh({ ship, onClick }: { ship: NavalShip; onClick?: () => void }) {
  const { overlay, selectedFleetId } = useNavalStore(s => ({ overlay: s.overlay, selectedFleetId: s.selectedFleetId }));
  if (!overlay) return null;
  initCoords(overlay);

  const px = toX(ship.position.x), pz = toZ(ship.position.y);
  const angle = THREE.MathUtils.degToRad(ship.headingDeg);
  const sc = ship.shipClass;
  const isPlayer = ship.faction === 'player';
  const fc = isPlayer ? '#3b82f6' : '#ef4444';

  // 根据舰种确定尺寸
  const dims: Record<string, { len: number; wid: number; h: number; turrets: number; deck?: boolean; sub?: boolean }> = {
    fleet_carrier: { len: 2.8, wid: 0.9, h: 0.25, turrets: 0, deck: true },
    light_carrier: { len: 2.2, wid: 0.75, h: 0.22, turrets: 0, deck: true },
    escort_carrier: { len: 1.8, wid: 0.65, h: 0.2, turrets: 0, deck: true },
    battleship: { len: 2.4, wid: 0.85, h: 0.3, turrets: 3 },
    heavy_cruiser: { len: 2.0, wid: 0.6, h: 0.25, turrets: 2 },
    light_cruiser: { len: 1.7, wid: 0.55, h: 0.22, turrets: 2 },
    destroyer: { len: 1.3, wid: 0.35, h: 0.18, turrets: 1 },
    submarine: { len: 0.9, wid: 0.2, h: 0.15, turrets: 0, sub: true },
    transport: { len: 1.5, wid: 0.6, h: 0.22, turrets: 0 },
    oiler: { len: 1.4, wid: 0.55, h: 0.2, turrets: 0 },
    landing_ship: { len: 1.3, wid: 0.5, h: 0.18, turrets: 0 },
  };
  const d = dims[sc] || dims.destroyer;

  // 传感器范围（仅己方显示）
  const showSensors = isPlayer;
  const sensorRadar = ship.sensors.radarOperational ? ship.sensors.surfaceRadarRange * S : 0;
  const sensorVisual = ship.sensors.visualRange * S;
  const sensorSonar = ship.sensors.sonarOperational ? ship.sensors.sonarRange * S : 0;

  return (
    <group>
      {/* 传感器范围圈 */}
      {showSensors && sensorVisual > 0 && (
        <mesh position={[px, 0.015, pz]} rotation={[-Math.PI/2, 0, 0]}>
          <ringGeometry args={[sensorVisual-0.1, sensorVisual, 48]} />
          <meshBasicMaterial color="#22c55e" transparent opacity={0.18} side={THREE.DoubleSide} />
        </mesh>
      )}
      {showSensors && sensorRadar > 0 && (
        <mesh position={[px, 0.012, pz]} rotation={[-Math.PI/2, 0, 0]}>
          <ringGeometry args={[sensorRadar-0.08, sensorRadar, 48]} />
          <meshBasicMaterial color="#3b82f6" transparent opacity={0.12} side={THREE.DoubleSide} />
        </mesh>
      )}
      {showSensors && sensorSonar > 0 && (
        <mesh position={[px, -0.05, pz]} rotation={[-Math.PI/2, 0, 0]}>
          <ringGeometry args={[sensorSonar-0.06, sensorSonar, 32]} />
          <meshBasicMaterial color="#eab308" transparent opacity={0.15} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* 舰船主体 */}
      <group position={[px, 0.15, pz]} rotation={[0, angle, 0]} onClick={onClick}>
        {/* Hull */}
        <mesh castShadow>
          <boxGeometry args={[d.len, d.h, d.wid]} />
          <meshStandardMaterial color={fc} roughness={0.5} metalness={0.35} />
        </mesh>

        {/* 舰首楔形 */}
        <mesh position={[d.len/2+0.15, -d.h*0.3, 0]} rotation={[0,0,Math.PI/4]}>
          <boxGeometry args={[0.3, d.h*0.6, d.wid*0.7]} />
          <meshStandardMaterial color={fc} roughness={0.5} metalness={0.35} />
        </mesh>

        {/* 甲板颜色 */}
        {d.deck && (
          <mesh position={[0, d.h+0.02, 0]}>
            <boxGeometry args={[d.len*0.85, 0.04, d.wid*0.8]} />
            <meshStandardMaterial color="#64748b" roughness={0.6} />
          </mesh>
        )}
        {/* 航母舰岛 */}
        {d.deck && (
          <mesh position={[d.len*0.15, d.h+0.2, d.wid*0.25]}>
            <boxGeometry args={[d.len*0.2, 0.35, d.wid*0.3]} />
            <meshStandardMaterial color="#334155" />
          </mesh>
        )}

        {/* 炮塔 */}
        {d.turrets > 0 && Array.from({length: d.turrets}).map((_, i) => {
          const spread = d.turrets > 1 ? (i/(d.turrets-1)-0.5) * (d.len*0.5) : 0;
          return (
            <group key={i} position={[spread, d.h+0.05, 0]}>
              <mesh><boxGeometry args={[0.25, 0.15, 0.2]} /><meshStandardMaterial color="#475569" /></mesh>
              <mesh position={[0.18, 0.03, 0]}>
                <cylinderGeometry args={[0.04, 0.04, 0.2, 6]} />
                <meshStandardMaterial color="#1e293b" />
              </mesh>
            </group>
          );
        })}

        {/* 潜艇指挥塔 */}
        {d.sub && (
          <group rotation={[0, 0, 0]}>
            <mesh position={[d.len*0.15, d.h+0.15, 0]}>
              <cylinderGeometry args={[0.1, 0.13, 0.25, 6]} />
              <meshStandardMaterial color="#1e293b" />
            </mesh>
          </group>
        )}

        {/* 船名 */}
        <Text position={[0, d.h+0.45, 0]} fontSize={0.25} color={isPlayer?'#93c5fd':'#fca5a5'} anchorX="center" outlineWidth={0.02} outlineColor="#000">
          {ship.name.split(' ').pop()}
        </Text>

        {/* 航向指示器 */}
        <group rotation={[0, 0, -Math.PI/2]}>
          <mesh position={[d.len/2+0.3, 0.05, 0]}>
            <coneGeometry args={[0.12, 0.25, 4]} />
            <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.6} />
          </mesh>
        </group>

        {/* 速度线 */}
        {ship.speedKts > 3 && <mesh position={[-d.len/2-0.3, 0.02, d.wid*0.3]}>
          <boxGeometry args={[ship.speedKts*0.008, 0.02, 0.04]} />
          <meshBasicMaterial color={isPlayer?'#93c5fd':'#fca5a5'} transparent opacity={0.6} />
        </mesh>}
      </group>
    </group>
  );
}

// ========== 接触标记 ==========
function ContactLayer() {
  const contacts = useNavalStore(s => s.intel.playerContacts);
  const overlay = useNavalStore(s => s.overlay);
  if (!overlay) return null;
  initCoords(overlay);
  return (<>
    {contacts.map(c => {
      if (c.detectionLevel==='none'||c.detectionLevel==='lost') return null;
      const px=toX(c.lastKnownPosition.x), pz=toZ(c.lastKnownPosition.y);
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
function Scene() {
  const { fleets, selectFleet, selectedFleetId, openNavalCombatView } = useNavalStore();

  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[80, 120, 50]} intensity={0.9} castShadow shadow-mapSize={[512,512]} />
      <pointLight position={[0, 40, 0]} intensity={0.25} color="#4488cc" />
      <hemisphereLight args={['#1e3a5f', '#0a1628', 0.3]} />

      <OceanFloor />

      {/* 网格 */}
      <gridHelper args={[150, 50, '#1a3a5a', '#0a1a2a']} position={[0, 0.01, 0]} />

      <FacilitiesLayer />
      <ContactLayer />

      {/* 己方舰队 */}
      {fleets.filter(f=>f.faction==='player').flatMap(f =>
        f.ships.map(ship => (
          <ShipMesh key={ship.id} ship={ship} onClick={() => { selectFleet(f.id); if(f.id===selectedFleetId) openNavalCombatView(f.id); }} />
        ))
      )}

      {/* 敌方舰队（仅已探测的显示） */}
      {fleets.filter(f=>f.faction==='enemy'&&f.detectedByPlayer).flatMap(f =>
        f.ships.map(ship => (
          <ShipMesh key={ship.id} ship={ship} />
        ))
      )}
    </>
  );
}

// ========== 入口 ==========
export function NavalScene3D() {
  const { overlay, fleets } = useNavalStore();
  if (!overlay || fleets.length === 0) return null;

  return (
    <div className="w-full h-full">
      <Canvas
        camera={{ position: [0, 65, 0], fov: 40, near: 0.1, far: 600 }}
        style={{ background: 'linear-gradient(to bottom, #0a1628, #061020)' }}
        shadows
        gl={{ antialias: true }}
      >
        <Scene />
        <OrbitControls enableDamping dampingFactor={0.08} minDistance={5} maxDistance={150} maxPolarAngle={Math.PI/2.2} target={[0,0,0]} />
      </Canvas>
    </div>
  );
}
