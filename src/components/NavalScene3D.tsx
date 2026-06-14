import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { useNavalStore } from '@/store/naval-store';

const S = 0.07;

function tx(wx: number, cx: number) { return wx * S - cx; }
function tz(wy: number, cz: number) { return -(wy * S - cz); }

function StratMap() {
  const ov = useNavalStore(s => s.overlay);
  const facs = useNavalStore(s => s.facilities);
  const islands = useNavalStore(s => s.islands);
  if (!ov) return null;
  const W = ov[0]?.length ?? 3000, H = ov.length ?? 2000;
  const cx = W * S / 2, cz = H * S / 2;
  const step = 10;
  const tiles: React.ReactNode[] = [];

  for (let gy = 0; gy < Math.ceil(H / step); gy++) {
    for (let ix = 0; ix < Math.ceil(W / step); ix++) {
      const y = gy * step, x = ix * step;
      const cell = ov[Math.min(y, H - 1)]?.[Math.min(x, W - 1)];
      if (!cell) continue;
      const px = tx(x, cx), pz = tz(y, cz), s = step * S;
      if (cell.seaZoneType === 'island') {
        tiles.push(<mesh key={`i${ix}_${gy}`} position={[px, 0.25, pz]}><boxGeometry args={[s * 0.9, 0.6, s * 0.9]} /><meshStandardMaterial color="#1e4a14" roughness={0.85} /></mesh>);
      } else if (cell.seaZoneType === 'deep_ocean') {
        tiles.push(<mesh key={`d${ix}_${gy}`} position={[px, -0.03, pz]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[s, s]} /><meshBasicMaterial color="#050d18" transparent opacity={0.9} /></mesh>);
      } else if (cell.seaZoneType === 'shallow_water' || cell.seaZoneType === 'reef') {
        tiles.push(<mesh key={`s${ix}_${gy}`} position={[px, -0.02, pz]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[s, s]} /><meshBasicMaterial color="#0d5c4a" transparent opacity={0.7} /></mesh>);
      } else if (cell.seaZoneType === 'coastal_water') {
        tiles.push(<mesh key={`c${ix}_${gy}`} position={[px, -0.02, pz]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[s, s]} /><meshBasicMaterial color="#0a3550" transparent opacity={0.6} /></mesh>);
      }
    }
  }

  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[100, 200, 100]} intensity={1.0} />
      <hemisphereLight args={['#1e3a5f', '#0a1628', 0.3]} />
      {tiles}

      {/* Facilities - large prominent markers */}
      {facs.map(f => {
        const fx = tx(f.x, cx), fz = tz(f.y, cz);
        const isBase = f.type === 'naval_base';
        const isPort = f.type === 'port';
        const isAirfield = f.type === 'airfield';
        const c = isBase ? '#f59e0b' : isPort ? '#3b82f6' : isAirfield ? '#a855f7' : '#22c55e';
        const em = isBase ? '#f59e0b' : isPort ? '#3b82f6' : isAirfield ? '#a855f7' : '#22c55e';
        const size = isBase ? 1.2 : isPort ? 0.9 : isAirfield ? 0.7 : 0.6;
        return (
          <group key={f.id}>
            <mesh position={[fx, 0.6, fz]}>
              {isAirfield ? <boxGeometry args={[1.5, 0.3, 0.6]} /> : <cylinderGeometry args={[size * 0.7, size, size * 1.5, 6]} />}
              <meshStandardMaterial color={c} emissive={em} emissiveIntensity={0.6} />
            </mesh>
            <Text position={[fx, 1.6, fz]} fontSize={1.0} color={f.faction === 'player' ? '#93c5fd' : '#fca5a5'} anchorX="center" anchorY="bottom" outlineWidth={0.1} outlineColor="#000" fontWeight="bold">
              {f.name}
            </Text>
          </group>
        );
      })}

      {/* Island names */}
      {islands.filter(i => i.radius >= 25).map(i => (
        <Text key={`in_${i.name}`} position={[tx(i.x, cx), 2.0, tz(i.y, cz)]} fontSize={1.2} color="#e2e8f0" anchorX="center" anchorY="bottom" outlineWidth={0.1} outlineColor="#000">
          {i.name}
        </Text>
      ))}

      <gridHelper args={[S * W, 40, '#1a3a5a', '#0a1628']} position={[0, 0.005, 0]} />
    </>
  );
}

function FleetMarkers() {
  const fleets = useNavalStore(s => s.fleets);
  const ov = useNavalStore(s => s.overlay);
  if (!ov) return null;
  const W = ov[0]?.length ?? 3000, H = ov.length ?? 2000;
  const cx = W * S / 2, cz = H * S / 2;

  return (
    <>
      {fleets.map(f => {
        const isP = f.faction === 'player';
        const fx = tx(f.position.globalX, cx), fz = tz(f.position.globalY, cz);
        const color = isP ? '#3b82f6' : '#ef4444';
        const isCV = f.type === 'carrier_task_force';
        return (
          <group key={f.id} position={[fx, 0.5, fz]}>
            <mesh>
              {isCV ? <boxGeometry args={[4, 0.6, 1.5]} /> : <boxGeometry args={[2.5, 0.4, 1.0]} />}
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} metalness={0.4} />
            </mesh>
            {isCV && <mesh position={[0, 0.5, 0]}><boxGeometry args={[3.2, 0.08, 1.1]} /><meshStandardMaterial color="#94a3b8" /></mesh>}
            <Text position={[0, 1.2, 0]} fontSize={0.9} color={isP ? '#93c5fd' : '#fca5a5'} anchorX="center" anchorY="bottom" outlineWidth={0.08} outlineColor="#000" fontWeight="bold">
              {f.name}
            </Text>
            <Text position={[0, 0.3, 0]} fontSize={0.5} color="#94a3b8" anchorX="center">{f.ships.length}艘</Text>
          </group>
        );
      })}
    </>
  );
}

function AircraftMarkers() {
  const airOps = useNavalStore(s => s.airOperations);
  const ov = useNavalStore(s => s.overlay);
  if (!ov || !airOps || airOps.length === 0) return null;
  const W = ov[0]?.length ?? 3000, H = ov.length ?? 2000;
  const cx = W * S / 2, cz = H * S / 2;

  return (
    <>
      {airOps.map(a => {
        const ax = tx(a.x, cx), az = tz(a.y, cz);
        const color = a.type === 'strike' ? '#ef4444' : a.type === 'search' ? '#60a5fa' : '#22c55e';
        const em = a.type === 'strike' ? '#ef4444' : a.type === 'search' ? '#60a5fa' : '#22c55e';
        return (
          <group key={a.id} position={[ax, 0.6, az]} rotation={[0, (a.heading || 45) * Math.PI / 180, 0]}>
            <mesh>
              <coneGeometry args={[0.5, 1.2, 4]} />
              <meshStandardMaterial color={color} emissive={em} emissiveIntensity={0.7} />
            </mesh>
            <Text position={[0, 0.8, 0]} fontSize={0.4} color={color} anchorX="center" anchorY="bottom" outlineWidth={0.05} outlineColor="#000">
              {a.type}×{a.aircraft}
            </Text>
          </group>
        );
      })}
    </>
  );
}

function ContactMarkers() {
  const contacts = useNavalStore(s => s.intel.playerContacts);
  const ov = useNavalStore(s => s.overlay);
  if (!ov) return null;
  const W = ov[0]?.length ?? 3000, H = ov.length ?? 2000;
  const cx = W * S / 2, cz = H * S / 2;

  return (
    <>
      {contacts.filter(c => c.detectionLevel !== 'none' && c.detectionLevel !== 'lost').map(c => {
        const px = tx(c.lastKnownPosition.x, cx), pz = tz(c.lastKnownPosition.y, cz);
        const t = c.detectionLevel === 'tracked' || c.detectionLevel === 'identified';
        return (
          <group key={c.id}>
            <mesh position={[px, 0.5, pz]}>
              {t ? <coneGeometry args={[0.5, 1.0, 6]} /> : <sphereGeometry args={[0.4, 8, 8]} />}
              <meshStandardMaterial color={t ? '#ef4444' : '#fbbf24'} transparent opacity={0.8} emissive={t ? '#ef4444' : '#fbbf24'} emissiveIntensity={0.5} wireframe={!t} />
            </mesh>
            <mesh position={[px, 0.02, pz]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[c.uncertaintyRadius * S * 0.5, c.uncertaintyRadius * S * 0.5 + 0.08, 36]} />
              <meshBasicMaterial color={t ? '#ef4444' : '#fbbf24'} transparent opacity={0.25} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

import * as THREE from 'three';

export function NavalScene3D() {
  const ov = useNavalStore(s => s.overlay);
  const fleets = useNavalStore(s => s.fleets);
  if (!ov || fleets.length === 0) return null;

  return (
    <Canvas camera={{ position: [0, 200, 0], fov: 30, near: 1, far: 1000 }} style={{ background: '#050d18' }} gl={{ antialias: true }}>
      <StratMap />
      <FacilityLayer />
      <FleetMarkers />
      <AircraftMarkers />
      <ContactMarkers />
      <OrbitControls enableDamping dampingFactor={0.06} minDistance={20} maxDistance={400} maxPolarAngle={Math.PI / 2.2} />
    </Canvas>
  );
}

// FacilityLayer moved into StratMap for now
function FacilityLayer() { return null; }
