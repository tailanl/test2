import React, { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { useNavalStore } from '@/store/naval-store';

const S = 0.12;

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

const StratMap = React.memo(function StratMap() {
  const ov = useNavalStore(s => s.overlay);
  const facs = useNavalStore(s => s.facilities);
  const islands = useNavalStore(s => s.islands);
  if (!ov) return null;
  const { cx, cz, W, H } = useCoords();
  const step = 16;

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
    const c = isBase ? '#f59e0b' : isPort ? '#3b82f6' : '#a855f7';
    return (
      <group key={f.id}>
        <mesh position={[fx, 0.5, fz]}>
          <cylinderGeometry args={[isBase ? 0.7 : 0.5, isBase ? 1.0 : 0.7, isBase ? 1.2 : 0.9, 6]} />
          <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.5} />
        </mesh>
      </group>
    );
  }), [facs, cx, cz]);

  const largeIslands = useMemo(() => islands.filter(i => i.radius >= 20), [islands]);

  // Map island names to their faction from facilities
  const islandFaction = useMemo(() => {
    const m = new Map<string, 'player'|'enemy'>();
    for (const f of facs) { if (f.islandName && !m.has(f.islandName)) m.set(f.islandName, (f.faction === 'neutral' ? 'player' : f.faction) as 'player'|'enemy'); }
    return m;
  }, [facs]);

  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[100, 200, 100]} intensity={1.0} />
      <hemisphereLight args={['#1e3a5f', '#0a1628', 0.3]} />
      {tiles}
      {facMarkers}
      {largeIslands.map(i => {
        const faction = islandFaction.get(i.name) || 'player';
        const color = faction === 'player' ? '#60a5fa' : '#f87171';
        return (
          <Text key={`in_${i.name}`} position={[tx(i.x, cx), 3.5, tz(i.y, cz)]} fontSize={2.5} color={color} anchorX="center" outlineWidth={0.2} outlineColor="#000" fontWeight="bold">
            {i.name}
          </Text>
        );
      })}
      <gridHelper args={[S * W, 30, '#1a3a6a', '#0a1628']} position={[0, 0.005, 0]} />
    </>
  );
});

const FleetMarkers = React.memo(function FleetMarkers() {
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
            <Text position={[0, 1.2, 0]} fontSize={0.9} color={isP ? '#93c5fd' : '#fca5a5'} anchorX="center" outlineWidth={0.08} outlineColor="#000" fontWeight="bold">
              {f.name}
            </Text>
          </group>
        );
      })}
    </>
  );
});

const AircraftMarkers = React.memo(function AircraftMarkers() {
  const airOps = useNavalStore(s => s.airOperations);
  const ov = useNavalStore(s => s.overlay);
  const { cx, cz } = useCoords();
  if (!ov || !airOps || airOps.length === 0) return null;

  return (
    <>
      {airOps.slice(-12).map(a => {
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
});

const ContactMarkers = React.memo(function ContactMarkers() {
  const contacts = useNavalStore(s => s.intel.playerContacts);
  const ov = useNavalStore(s => s.overlay);
  const { cx, cz } = useCoords();
  if (!ov) return null;

  return (
    <>
      {contacts.filter(c => c.detectionLevel !== 'none' && c.detectionLevel !== 'lost').slice(0, 20).map(c => {
        const px = tx(c.lastKnownPosition.x, cx), pz = tz(c.lastKnownPosition.y, cz);
        const t = c.detectionLevel === 'tracked' || c.detectionLevel === 'identified';
        return (
          <group key={c.id}>
            <mesh position={[px, 0.4, pz]}>
              {t ? <coneGeometry args={[0.4, 0.8, 6]} /> : <sphereGeometry args={[0.35, 8, 8]} />}
              <meshBasicMaterial color={t ? '#ef4444' : '#fbbf24'} transparent opacity={0.7} />
            </mesh>
            <mesh position={[px, 0.02, pz]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[c.uncertaintyRadius * S * 0.4, c.uncertaintyRadius * S * 0.4 + 0.06, 24]} />
              <meshBasicMaterial color={t ? '#ef4444' : '#fbbf24'} transparent opacity={0.18} side={2} />
            </mesh>
          </group>
        );
      })}
    </>
  );
});

export function NavalScene3D() {
  const ov = useNavalStore(s => s.overlay);
  const fleets = useNavalStore(s => s.fleets);
  if (!ov || fleets.length === 0) return null;

  return (
    <div className="relative w-full h-full">
      {/* 图例面板 */}
      <div className="absolute bottom-3 left-3 glass rounded-lg p-3 text-[11px] text-slate-300 space-y-1 z-10">
        <div className="font-bold text-amber-400 text-xs mb-1">图例</div>
        <div className="flex items-center gap-2"><span className="w-4 h-2 bg-[#3b82f6] rounded"/><span className="text-sky-400">美军基地/舰队</span></div>
        <div className="flex items-center gap-2"><span className="w-4 h-2 bg-[#ef4444] rounded"/><span className="text-red-400">日军基地/舰队</span></div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 bg-[#f59e0b] rounded-full"/><span className="text-amber-400">海军基地</span></div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 bg-[#3b82f6] rounded-full"/><span className="text-sky-400">港口</span></div>
        <div className="flex items-center gap-2"><span className="w-3 h-1.5 bg-[#a855f7] rounded"/><span className="text-purple-400">机场</span></div>
        <div className="flex items-center gap-2"><span className="text-[#1e4a14]">■</span><span className="text-green-700">岛屿</span></div>
      </div>
      <Canvas camera={{ position: [0, 160, 0], fov: 30, near: 1, far: 1000 }} style={{ background: '#050d18' }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        <StratMap />
        <FleetMarkers />
        <AircraftMarkers />
        <ContactMarkers />
        <OrbitControls enableDamping dampingFactor={0.06} minDistance={20} maxDistance={400} maxPolarAngle={Math.PI / 2.2} />
      </Canvas>
    </div>
  );
}
