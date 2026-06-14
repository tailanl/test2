import React, { useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useNavalStore } from '@/store/naval-store';

const S = 0.07;

function tx(wx: number, cx: number) { return wx * S - cx; }
function tz(wy: number, cz: number) { return -(wy * S - cz); }

function useCoords() {
  const ov = useNavalStore(s => s.overlay);
  return useMemo(() => {
    if (!ov) return { cx: 0, cz: 0, W: 0, H: 0 };
    const W = ov[0]?.length ?? 3000, H = ov.length ?? 2000;
    return { cx: W * S / 2, cz: H * S / 2, W, H };
  }, [ov]);
}

function IslandLabels() {
  const islands = useNavalStore(s => s.islands);
  const { cx, cz } = useCoords();
  const { camera } = useThree();
  const camDist = camera.position.length();
  const showLabels = camDist < 120; // Only show labels when zoomed in

  if (!showLabels) return null;

  return (
    <>
      {islands.map(i => {
        const ix = tx(i.x, cx), iz = tz(i.y, cz);
        const distToCam = Math.sqrt(
          (ix - camera.position.x) ** 2 + (iz - camera.position.z) ** 2
        );
        if (distToCam > 80 || i.radius < 20) return null;
        return (
          <Text key={`in_${i.name}`} position={[ix, 2.5, iz]} fontSize={1.5} color="#e2e8f0" anchorX="center" anchorY="middle" outlineWidth={0.15} outlineColor="#000" fontWeight="bold">
            {i.name}
          </Text>
        );
      })}
    </>
  );
}

function FacilityLabels() {
  const facs = useNavalStore(s => s.facilities);
  const { cx, cz } = useCoords();
  const { camera } = useThree();
  const camDist = camera.position.length();
  if (camDist > 100) return null;

  return (
    <>
      {facs.map(f => {
        const fx = tx(f.x, cx), fz = tz(f.y, cz);
        const distToCam = Math.sqrt((fx - camera.position.x) ** 2 + (fz - camera.position.z) ** 2);
        if (distToCam > 60) return null;
        const c = f.type === 'naval_base' ? '#f59e0b' : f.type === 'port' ? '#60a5fa' : f.type === 'airfield' ? '#c084fc' : '#4ade80';
        return (
          <Text key={`fl_${f.id}`} position={[fx, 1.8, fz]} fontSize={0.8} color={c} anchorX="center" anchorY="middle" outlineWidth={0.08} outlineColor="#000">
            {f.name}
          </Text>
        );
      })}
    </>
  );
}

function StratMap() {
  const ov = useNavalStore(s => s.overlay);
  const facs = useNavalStore(s => s.facilities);
  if (!ov) return null;
  const { cx, cz, W, H } = useCoords();
  const step = 8;

  const tiles = useMemo(() => {
    const t: React.ReactNode[] = [];
    for (let gy = 0; gy < Math.ceil(H / step); gy++) {
      for (let ix = 0; ix < Math.ceil(W / step); ix++) {
        const y = gy * step, x = ix * step;
        const cell = ov[Math.min(y, H - 1)]?.[Math.min(x, W - 1)];
        if (!cell) continue;
        const px = tx(x, cx), pz = tz(y, cz), s = step * S;
        if (cell.seaZoneType === 'island') {
          t.push(<mesh key={`i${ix}_${gy}`} position={[px, 0.2, pz]}><boxGeometry args={[s * 0.9, 0.5, s * 0.9]} /><meshStandardMaterial color="#1e4a14" roughness={0.85} /></mesh>);
        } else if (cell.seaZoneType === 'deep_ocean') {
          t.push(<mesh key={`d${ix}_${gy}`} position={[px, -0.03, pz]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[s, s]} /><meshBasicMaterial color="#050d18" transparent opacity={0.9} /></mesh>);
        } else if (cell.seaZoneType === 'shallow_water' || cell.seaZoneType === 'reef') {
          t.push(<mesh key={`s${ix}_${gy}`} position={[px, -0.02, pz]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[s, s]} /><meshBasicMaterial color="#0d5c4a" transparent opacity={0.7} /></mesh>);
        } else {
          t.push(<mesh key={`c${ix}_${gy}`} position={[px, -0.02, pz]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[s, s]} /><meshBasicMaterial color="#0a3550" transparent opacity={0.6} /></mesh>);
        }
      }
    }
    return t;
  }, [ov, cx, cz, W, H]);

  const facMarkers = useMemo(() => facs.map(f => {
    const fx = tx(f.x, cx), fz = tz(f.y, cz);
    const isBase = f.type === 'naval_base';
    const isPort = f.type === 'port';
    const isAirfield = f.type === 'airfield';
    const c = isBase ? '#f59e0b' : isPort ? '#3b82f6' : isAirfield ? '#a855f7' : '#22c55e';
    const sz = isBase ? 1.0 : isPort ? 0.8 : isAirfield ? 0.6 : 0.5;
    return (
      <group key={f.id}>
        <mesh position={[fx, 0.5, fz]}>
          {isAirfield ? <boxGeometry args={[1.2, 0.25, 0.5]} /> : <cylinderGeometry args={[sz * 0.6, sz, sz * 1.2, 6]} />}
          <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.5} />
        </mesh>
      </group>
    );
  }), [facs, cx, cz]);

  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[100, 200, 100]} intensity={1.0} />
      <hemisphereLight args={['#1e3a5f', '#0a1628', 0.3]} />
      {tiles}
      {facMarkers}
      <FacilityLabels />
      <IslandLabels />
      <gridHelper args={[S * W, 40, '#1a3a6a', '#0a1628']} position={[0, 0.005, 0]} />
    </>
  );
}

function FleetMarkers() {
  const fleets = useNavalStore(s => s.fleets);
  const ov = useNavalStore(s => s.overlay);
  const { cx, cz } = useCoords();
  if (!ov) return null;

  return (
    <>
      {fleets.map(f => {
        const fx = tx(f.position.globalX, cx), fz = tz(f.position.globalY, cz);
        const isP = f.faction === 'player';
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
          </group>
        );
      })}
    </>
  );
}

function AircraftMarkers() {
  const airOps = useNavalStore(s => s.airOperations);
  const ov = useNavalStore(s => s.overlay);
  const { cx, cz } = useCoords();
  if (!ov || !airOps || airOps.length === 0) return null;

  return (
    <>
      {airOps.map(a => {
        const ax = tx(a.x, cx), az = tz(a.y, cz);
        const color = a.type === 'strike' ? '#ef4444' : a.type === 'search' ? '#60a5fa' : '#22c55e';
        return (
          <group key={a.id} position={[ax, 0.55, az]} rotation={[0, (a.heading || 45) * Math.PI / 180, 0]}>
            <mesh>
              <coneGeometry args={[0.4, 1.0, 4]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function ContactMarkers() {
  const contacts = useNavalStore(s => s.intel.playerContacts);
  const ov = useNavalStore(s => s.overlay);
  const { cx, cz } = useCoords();
  if (!ov) return null;

  return (
    <>
      {contacts.filter(c => c.detectionLevel !== 'none' && c.detectionLevel !== 'lost').map(c => {
        const px = tx(c.lastKnownPosition.x, cx), pz = tz(c.lastKnownPosition.y, cz);
        const t = c.detectionLevel === 'tracked' || c.detectionLevel === 'identified';
        return (
          <group key={c.id}>
            <mesh position={[px, 0.4, pz]}>
              {t ? <coneGeometry args={[0.4, 0.8, 6]} /> : <sphereGeometry args={[0.35, 8, 8]} />}
              <meshStandardMaterial color={t ? '#ef4444' : '#fbbf24'} transparent opacity={0.8} emissive={t ? '#ef4444' : '#fbbf24'} emissiveIntensity={0.5} wireframe={!t} />
            </mesh>
            <mesh position={[px, 0.02, pz]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[c.uncertaintyRadius * S * 0.5, c.uncertaintyRadius * S * 0.5 + 0.06, 36]} />
              <meshBasicMaterial color={t ? '#ef4444' : '#fbbf24'} transparent opacity={0.2} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

const Scene = React.memo(function Scene() {
  return (
    <>
      <StratMap />
      <FleetMarkers />
      <AircraftMarkers />
      <ContactMarkers />
    </>
  );
});

export function NavalScene3D() {
  const ov = useNavalStore(s => s.overlay);
  const fleets = useNavalStore(s => s.fleets);
  if (!ov || fleets.length === 0) return null;

  return (
    <Canvas camera={{ position: [0, 180, 0], fov: 30, near: 1, far: 1000 }} style={{ background: '#050d18' }} gl={{ antialias: true }}>
      <Scene />
      <OrbitControls enableDamping dampingFactor={0.06} minDistance={20} maxDistance={400} maxPolarAngle={Math.PI / 2.2} />
    </Canvas>
  );
}
