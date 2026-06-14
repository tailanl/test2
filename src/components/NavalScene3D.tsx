/**
 * NavalScene3D - Three.js 3D 海战场景
 * 海洋 + 岛屿 + 舰船 + 接触 + 设施
 */

import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Text, Line } from '@react-three/drei';
import * as THREE from 'three';
import { useNavalStore } from '@/store/naval-store';

// ============================================================
// Ocean
// ============================================================

function Ocean() {
  const meshRef = useRef<THREE.Mesh>(null);
  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow>
      <planeGeometry args={[200, 200, 40, 40]} />
      <meshStandardMaterial color="#0a3a5a" wireframe={false} transparent opacity={0.9} />
    </mesh>
  );
}

function OceanGrid() {
  const lines = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = -100; i <= 100; i += 5) {
      pts.push(new THREE.Vector3(i, 0.01, -100));
      pts.push(new THREE.Vector3(i, 0.01, 100));
      pts.push(new THREE.Vector3(-100, 0.01, i));
      pts.push(new THREE.Vector3(100, 0.01, i));
    }
    return pts;
  }, []);
  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[new Float32Array(lines.flatMap((p) => [p.x, p.y, p.z])), 3]}
          count={lines.length}
          itemSize={3}
        />
      </bufferGeometry>
      <lineBasicMaterial color="#1a5a8a" transparent opacity={0.3} />
    </lineSegments>
  );
}

// ============================================================
// Islands
// ============================================================

function IslandBlock({ x, z, size }: { x: number; z: number; size: number }) {
  return (
    <mesh position={[x, 0.15, z]} castShadow>
      <boxGeometry args={[size * 0.8, 0.3, size * 0.8]} />
      <meshStandardMaterial color="#2d5a1e" roughness={0.9} />
    </mesh>
  );
}

function TerrainBlocks() {
  const overlay = useNavalStore((s) => s.overlay);
  if (!overlay) return null;

  const blocks: React.ReactNode[] = [];
  const H = overlay.length;
  const W = overlay[0]?.length ?? 0;
  const scale = 0.15;
  const cx = W * scale / 2;
  const cz = H * scale / 2;

  for (let gy = 0; gy < Math.ceil(H / 12); gy++) {
    for (let gx = 0; gx < Math.ceil(W / 12); gx++) {
      const y = gy * 12; const x = gx * 12;
      const cell = overlay[Math.min(y, H - 1)]?.[Math.min(x, W - 1)];
      if (!cell) continue;
      if (cell.seaZoneType === 'island') {
        const px = x * scale - cx + (Math.random() - 0.5) * 0.3;
        const pz = -(y * scale - cz) + (Math.random() - 0.5) * 0.3;
        blocks.push(<IslandBlock key={`i${gx}_${gy}`} x={px} z={pz} size={1.5 + Math.random() * 0.5} />);
      }
    }
  }
  return <>{blocks}</>;
}

// ============================================================
// Facilities
// ============================================================

function FacilitiesLayer() {
  const facilities = useNavalStore((s) => s.facilities);
  const overlay = useNavalStore((s) => s.overlay);
  if (!overlay) return null;
  const H = overlay.length; const W = overlay[0]?.length ?? 0;
  const scale = 0.15; const cx = W * scale / 2; const cz = H * scale / 2;

  return (
    <>
      {facilities.map((f) => {
        const px = f.position.globalX * scale - cx;
        const pz = -(f.position.globalY * scale - cz);
        const color = f.type === 'naval_base' ? '#f59e0b' : f.type === 'port' ? '#3b82f6' : f.type === 'airfield' ? '#a855f7' : '#22c55e';
        return (
          <group key={f.id}>
            <mesh position={[px, 0.25, pz]}>
              <cylinderGeometry args={[0.3, 0.35, 0.4, 8]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
            </mesh>
            <mesh position={[px, 0.55, pz]}>
              <sphereGeometry args={[0.15, 8, 8]} />
              <meshBasicMaterial color="white" />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

// ============================================================
// Ships
// ============================================================

function ShipMarker({ ship, onClick }: { ship: any; onClick?: () => void }) {
  const overlay = useNavalStore((s) => s.overlay);
  if (!overlay) return null;
  const H = overlay.length; const W = overlay[0]?.length ?? 0;
  const scale = 0.15; const cx = W * scale / 2; const cz = H * scale / 2;

  const px = ship.position.x * scale - cx;
  const pz = -(ship.position.y * scale - cz);
  const angle = THREE.MathUtils.degToRad(ship.headingDeg);

  const isCarrier = ship.shipClass?.includes('carrier');
  const color = ship.faction === 'player' ? '#3b82f6' : '#ef4444';

  return (
    <group position={[px, 0.15, pz]} rotation={[0, angle, 0]} onClick={onClick}>
      {/* Hull */}
      <mesh castShadow>
        <boxGeometry args={[isCarrier ? 2.5 : 1.2, 0.2, isCarrier ? 0.8 : 0.4]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.3} />
      </mesh>
      {/* Superstructure / island */}
      <mesh position={[isCarrier ? 0.3 : 0, 0.25, 0]}>
        <boxGeometry args={[isCarrier ? 0.6 : 0.4, 0.3, 0.3]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      {/* Flight deck for carriers */}
      {isCarrier && (
        <mesh position={[0, 0.25, 0]}>
          <boxGeometry args={[2.2, 0.05, 0.65]} />
          <meshStandardMaterial color="#94a3b8" roughness={0.5} />
        </mesh>
      )}
      {/* Heading cone */}
      <group rotation={[0, 0, -Math.PI / 2]}>
        <mesh position={[isCarrier ? 1.4 : 0.7, 0.12, 0]}>
          <coneGeometry args={[0.15, 0.3, 4]} />
          <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.5} />
        </mesh>
      </group>
    </group>
  );
}

function FleetLayer() {
  const { fleets, selectFleet, selectedFleetId, openNavalCombatView } = useNavalStore();
  const playerFleets = fleets.filter((f) => f.faction === 'player');

  return (
    <>
      {playerFleets.flatMap((f) =>
        f.ships.map((ship) => (
          <ShipMarker
            key={ship.id}
            ship={ship}
            onClick={() => {
              selectFleet(f.id);
              if (f.id === selectedFleetId) openNavalCombatView(f.id);
            }}
          />
        ))
      )}
    </>
  );
}

// ============================================================
// Contacts
// ============================================================

function ContactMarkers() {
  const contacts = useNavalStore((s) => s.intel.playerContacts);
  const overlay = useNavalStore((s) => s.overlay);
  if (!overlay) return null;
  const H = overlay.length; const W = overlay[0]?.length ?? 0;
  const scale = 0.15; const cx = W * scale / 2; const cz = H * scale / 2;

  return (
    <>
      {contacts.map((c) => {
        if (c.detectionLevel === 'none' || c.detectionLevel === 'lost') return null;
        const px = c.lastKnownPosition.x * scale - cx;
        const pz = -(c.lastKnownPosition.y * scale - cz);
        const isTracked = c.detectionLevel === 'tracked' || c.detectionLevel === 'identified';
        return (
          <group key={c.id}>
            {isTracked ? (
              <mesh position={[px, 0.3, pz]}>
                <coneGeometry args={[0.3, 0.8, 6]} />
                <meshStandardMaterial color="#ef4444" transparent opacity={0.7} emissive="#ef4444" emissiveIntensity={0.4} />
              </mesh>
            ) : (
              <mesh position={[px, 0.3, pz]}>
                <sphereGeometry args={[0.3, 8, 8]} />
                <meshStandardMaterial color="#fbbf24" transparent opacity={0.5} wireframe />
              </mesh>
            )}
            {/* Uncertainty ring */}
            <mesh position={[px, 0.02, pz]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[c.uncertaintyRadius * scale * 0.7, c.uncertaintyRadius * scale * 0.7 + 0.1, 32]} />
              <meshBasicMaterial color={isTracked ? '#ef4444' : '#fbbf24'} transparent opacity={0.2} side={THREE.DoubleSide} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

// ============================================================
// Main Scene
// ============================================================

function Scene() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[50, 80, 30]} intensity={0.8} castShadow shadow-mapSize={[512, 512]} />
      <pointLight position={[0, 30, 0]} intensity={0.3} color="#4488cc" />
      <Ocean />
      <OceanGrid />
      <TerrainBlocks />
      <FacilitiesLayer />
      <FleetLayer />
      <ContactMarkers />
    </>
  );
}

export function NavalScene3D() {
  const { overlay, fleets } = useNavalStore();

  if (!overlay || fleets.length === 0) return null;

  return (
    <div className="w-full h-full">
      <Canvas
        camera={{ position: [0, 50, 0], fov: 45, near: 0.1, far: 500 }}
        style={{ background: '#0a1628' }}
        shadows
      >
        <Scene />
        <OrbitControls
          enableDamping
          dampingFactor={0.1}
          minDistance={5}
          maxDistance={120}
          maxPolarAngle={Math.PI / 2.1}
          target={[0, 0, 0]}
        />
      </Canvas>
    </div>
  );
}
