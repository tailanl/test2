import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useNavalStore } from '@/store/naval-store';

const S = 0.08;

function toX(wx: number, cx: number) { return wx * S - cx; }
function toZ(wy: number, cz: number) { return -(wy * S - cz); }

function StratMap() {
  const ov = useNavalStore(s => s.overlay);
  const facs = useNavalStore(s => s.facilities);
  const islands = useNavalStore(s => s.islands);
  if (!ov) return null;
  const W = ov[0]?.length ?? 3000, H = ov.length ?? 2000;
  const cx = W * S / 2, cz = H * S / 2;
  const step = 20;
  const tiles: React.ReactNode[] = [];

  // Ocean floor
  for (let gy = 0; gy < Math.ceil(H / step); gy++) {
    for (let ix = 0; ix < Math.ceil(W / step); ix++) {
      const y = gy * step, x = ix * step;
      const cell = ov[Math.min(y, H - 1)]?.[Math.min(x, W - 1)];
      if (!cell) continue;
      const px = toX(x, cx), pz = toZ(y, cz), s = step * S;
      if (cell.seaZoneType === 'island') {
        tiles.push(<mesh key={`i${ix}_${gy}`} position={[px, 0.12, pz]}><boxGeometry args={[s * 0.9, 0.3, s * 0.9]} /><meshStandardMaterial color="#2d5a1e" roughness={0.8} /></mesh>);
      } else if (cell.seaZoneType === 'shallow_water' || cell.seaZoneType === 'reef') {
        tiles.push(<mesh key={`s${ix}_${gy}`} position={[px, -0.01, pz]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[s, s]} /><meshBasicMaterial color="#0f766e" transparent opacity={0.5} /></mesh>);
      } else if (cell.seaZoneType === 'coastal_water') {
        tiles.push(<mesh key={`c${ix}_${gy}`} position={[px, -0.02, pz]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[s, s]} /><meshBasicMaterial color="#0c4a6e" transparent opacity={0.4} /></mesh>);
      }
    }
  }

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[100, 150, 80]} intensity={0.9} />
      <hemisphereLight args={['#1e3a5f', '#0a1628', 0.3]} />
      {tiles}
      {/* Facilities */}
      {facs.map(f => {
        const fx = toX(f.x, cx), fz = toZ(f.y, cz);
        const c = f.type === 'naval_base' ? '#f59e0b' : f.type === 'port' ? '#3b82f6' : f.type === 'airfield' ? '#a855f7' : '#22c55e';
        return (
          <mesh key={f.id} position={[fx, 0.3, fz]}>
            <cylinderGeometry args={[0.6, 0.7, 0.8, 6]} />
            <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.3} />
          </mesh>
        );
      })}
      {/* Island name labels */}
      {islands.filter(i => i.radius >= 20).map(i => {
        const ix = toX(i.x, cx), iz = toZ(i.y, cz);
        // Use a mesh marker for now (Text from drei causes issues)
        return (
          <mesh key={`label_${i.name}`} position={[ix, 1.0, iz]}>
            <sphereGeometry args={[0.4, 4, 4]} />
            <meshBasicMaterial color="white" />
          </mesh>
        );
      })}
      <gridHelper args={[S * W, 50, '#1a3a5a', '#0a1628']} position={[0, 0.005, 0]} />
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
        const fx = toX(f.position.globalX, cx), fz = toZ(f.position.globalY, cz);
        const color = isP ? '#3b82f6' : '#ef4444';
        const isCV = f.type === 'carrier_task_force';
        return (
          <group key={f.id} position={[fx, 0.3, fz]}>
            <mesh>
              {isCV ? <boxGeometry args={[3, 0.8, 1.2]} /> : <boxGeometry args={[2, 0.5, 0.8]} />}
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
            </mesh>
            {isCV && <mesh position={[0, 0.6, 0]}><boxGeometry args={[2.4, 0.1, 0.9]} /><meshStandardMaterial color="#94a3b8" /></mesh>}
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
        const ax = toX(a.x, cx), az = toZ(a.y, cz);
        const color = a.type === 'strike' ? '#ef4444' : a.type === 'search' ? '#3b82f6' : '#22c55e';
        return (
          <group key={a.id} position={[ax, 0.5, az]}>
            <mesh rotation={[0, (a.heading || 45) * Math.PI / 180, 0]}>
              <coneGeometry args={[0.4, 0.8, 4]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

export function NavalScene3D() {
  const ov = useNavalStore(s => s.overlay);
  const fleets = useNavalStore(s => s.fleets);
  if (!ov || fleets.length === 0) return null;

  return (
    <Canvas camera={{ position: [0, 180, 0], fov: 35, near: 1, far: 800 }} style={{ background: '#0a1628' }} gl={{ antialias: true }}>
      <StratMap />
      <FleetMarkers />
      <AircraftMarkers />
      <OrbitControls enableDamping dampingFactor={0.08} minDistance={20} maxDistance={300} maxPolarAngle={Math.PI / 2.2} />
    </Canvas>
  );
}
