import React, { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useNavalStore } from '@/store/naval-store';

const S = 0.15;

function toX(wx: number, cx: number) { return wx * S - cx; }
function toZ(wy: number, cz: number) { return -(wy * S - cz); }
function cen(ov: any) { const W=ov?.[0]?.length??1024; const H=ov?.length??1024; return {cx:W*S/2, cz:H*S/2, W, H}; }

type ViewMode = 'god' | 'player' | 'enemy';

// ========== 地形 + 设施 ==========
function World() {
  const ov = useNavalStore(s=>s.overlay);
  const fac = useNavalStore(s=>s.facilities);
  if(!ov) return null;
  const {cx,cz,W,H} = cen(ov);
  const step = 10;
  const tiles: React.ReactNode[] = [];

  for(let gy=0; gy<Math.ceil(H/step); gy++){
    for(let ix=0; ix<Math.ceil(W/step); ix++){
      const y=gy*step, x=ix*step;
      const cell = ov[Math.min(y,H-1)]?.[Math.min(x,W-1)];
      if(!cell) continue;
      const px=toX(x,cx), pz=toZ(y,cz), s=step*S;
      if(cell.seaZoneType==='island'){
        tiles.push(<mesh key={`i${ix}_${gy}`} position={[px,0.15,pz]}><boxGeometry args={[s*0.9, 0.4, s*0.9]}/><meshStandardMaterial color="#1e4a14" roughness={0.8}/></mesh>);
      } else {
        const b=cell.seaZoneType==='deep_ocean'?'#061428':cell.seaZoneType==='coastal_water'?'#0c3a5a':'#0e5a4a';
        const o=cell.seaZoneType==='deep_ocean'?0.8:0.6;
        tiles.push(<mesh key={`w${ix}_${gy}`} position={[px,-0.01,pz]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[s,s]}/><meshBasicMaterial color={b} transparent opacity={o}/></mesh>);
      }
    }
  }

  return (<>
    <ambientLight intensity={0.4}/><directionalLight position={[80,100,50]} intensity={0.8}/><hemisphereLight args={['#1e3a5f','#0a1628',0.3]}/>
    {tiles}
    {fac.map(f => {
      const fx=toX(f.position.globalX,cx), fz=toZ(f.position.globalY,cz);
      return <mesh key={f.id} position={[fx,0.3,fz]}>
        <cylinderGeometry args={[0.3,0.35,0.5,6]}/>
        <meshStandardMaterial color={f.type==='naval_base'?'#f59e0b':f.type==='port'?'#3b82f6':f.type==='airfield'?'#a855f7':'#22c55e'} emissiveIntensity={0.3}/>
      </mesh>;
    })}
    <gridHelper args={[150,40,'#1a3a5a','#0a1628']} position={[0,0.005,0]}/>
  </>);
}

// ========== 舰船渲染 ==========
function ShipMark({ ship, color }: { ship: any; color: string }) {
  const ov = useNavalStore(s=>s.overlay);
  if(!ov) return null;
  const {cx,cz} = cen(ov);
  const px=toX(ship.position.x,cx), pz=toZ(ship.position.y,cz);
  const a=(ship.headingDeg*Math.PI)/180, isCv=ship.shipClass?.includes('carrier');
  const len=isCv?2.5:1.2, wid=isCv?0.8:0.4;
  return <group position={[px,0.15,pz]} rotation={[0,a,0]}>
    <mesh><boxGeometry args={[len,0.2,wid]}/><meshStandardMaterial color={color} metalness={0.3}/></mesh>
    {isCv && <mesh position={[0,0.22,0]}><boxGeometry args={[len*0.8,0.04,wid*0.7]}/><meshStandardMaterial color="#64748b"/></mesh>}
    <mesh position={[len/2+0.3,0.04,0]} rotation={[0,0,-1.57]}><coneGeometry args={[0.1,0.2,4]}/><meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.5}/></mesh>
  </group>;
}

function AllFleets({ mode }: { mode: ViewMode }) {
  const fleets = useNavalStore(s=>s.fleets);
  const ov = useNavalStore(s=>s.overlay);
  if(!ov) return null;

  // God: show all ships
  // Player: show player ships only  
  // Enemy: show enemy ships that are detected
  return (<>
    {fleets.flatMap(f => {
      const show = mode === 'god' || (mode === 'player' && f.faction === 'player') || (mode === 'enemy' && f.faction === 'enemy');
      if (!show) return null;
      const color = f.faction === 'player' ? '#3b82f6' : '#ef4444';
      return f.ships.map(s => <ShipMark key={s.id} ship={s} color={color} />);
    })}
  </>);
}

// ========== 接触标记 ==========
function AllContacts({ mode }: { mode: ViewMode }) {
  const ov = useNavalStore(s=>s.overlay);
  const playerC = useNavalStore(s=>s.intel.playerContacts);
  const enemyC = useNavalStore(s=>s.intel.enemyContacts);
  if(!ov) return null;
  const {cx,cz} = cen(ov);

  // God: both sides' contacts
  // Player: player contacts
  // Enemy: enemy contacts
  const contacts = mode === 'god' ? [...playerC, ...enemyC] : mode === 'player' ? playerC : enemyC;

  return (<>{contacts.filter(c=>c.detectionLevel!=='none'&&c.detectionLevel!=='lost').map(c=>{
    const px=toX(c.lastKnownPosition.x,cx), pz=toZ(c.lastKnownPosition.y,cz);
    const t=c.detectionLevel==='tracked'||c.detectionLevel==='identified';
    return <mesh key={c.id} position={[px,0.35,pz]}>
      {t?<coneGeometry args={[0.3,0.8,6]}/>:<sphereGeometry args={[0.25,8,8]}/>}
      <meshStandardMaterial color={t?'#ef4444':'#fbbf24'} transparent opacity={0.6} wireframe={!t}/>
    </mesh>;
  })}</>);
}

// ========== 主组件 ==========
export function NavalScene3D() {
  const ov = useNavalStore(s=>s.overlay);
  const fleets = useNavalStore(s=>s.fleets);
  const [mode, setMode] = useState<ViewMode>('god');

  if(!ov||fleets.length===0) return null;

  const modes: Array<{id:ViewMode;label:string;color:string}> = [
    {id:'god',label:'GOD EYE',color:'text-purple-400 border-purple-500'},
    {id:'player',label:'PLAYER',color:'text-sky-400 border-sky-500'},
    {id:'enemy',label:'ENEMY',color:'text-red-400 border-red-500'},
  ];

  return <div className="relative w-full h-full">
    {/* View mode selector */}
    <div className="absolute top-3 left-3 z-10 flex gap-1">
      {modes.map(m => (
        <button key={m.id} onClick={()=>setMode(m.id)}
          className={`px-3 py-1 text-[10px] font-bold rounded border transition-colors ${
            mode===m.id ? `${m.color} bg-slate-900/80` : 'border-slate-700 text-slate-600 bg-slate-900/50'}`}>
          {m.label}
        </button>
      ))}
    </div>

    <Canvas camera={{position:[0,70,0],fov:40,near:0.1,far:600}} style={{background:'#0a1628'}} gl={{antialias:true}}>
      <World/>
      <AllFleets mode={mode}/>
      <AllContacts mode={mode}/>
      <OrbitControls enableDamping dampingFactor={0.08} minDistance={5} maxDistance={150} maxPolarAngle={Math.PI/2.2}/>
    </Canvas>
  </div>;
}
