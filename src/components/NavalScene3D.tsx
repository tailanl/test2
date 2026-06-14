import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useNavalStore } from '@/store/naval-store';

const S = 0.15;

function toX(wx: number, cx: number) { return wx * S - cx; }
function toZ(wy: number, cz: number) { return -(wy * S - cz); }
function center(ov: any) { const W=ov?.[0]?.length??1024; const H=ov?.length??1024; return {cx:W*S/2, cz:H*S/2, W, H}; }

function World() {
  const overlay = useNavalStore(s=>s.overlay);
  const facilities = useNavalStore(s=>s.facilities);
  if(!overlay) return null;
  const {cx,cz,W,H} = center(overlay);
  const step = 10;
  const items: React.ReactNode[] = [];

  for(let gy=0; gy<Math.ceil(H/step); gy++){
    for(let ix=0; ix<Math.ceil(W/step); ix++){
      const y=gy*step, x=ix*step;
      const cell = overlay[Math.min(y,H-1)]?.[Math.min(x,W-1)];
      if(!cell) continue;
      const px=toX(x,cx), pz=toZ(y,cz), s=step*S;
      if(cell.seaZoneType==='island'){
        items.push(<mesh key={`i${ix}_${gy}`} position={[px,0.15,pz]}><boxGeometry args={[s*0.9, 0.4, s*0.9]}/><meshStandardMaterial color="#1e4a14" roughness={0.8}/></mesh>);
      } else {
        const b=cell.seaZoneType==='deep_ocean'?'#061428':cell.seaZoneType==='coastal_water'?'#0c3a5a':'#0e5a4a';
        const o=cell.seaZoneType==='deep_ocean'?0.8:0.6;
        items.push(<mesh key={`w${ix}_${gy}`} position={[px,-0.01,pz]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[s,s]}/><meshBasicMaterial color={b} transparent opacity={o}/></mesh>);
      }
    }
  }

  return (<>
    <ambientLight intensity={0.4}/>
    <directionalLight position={[80,100,50]} intensity={0.8}/>
    <hemisphereLight args={['#1e3a5f','#0a1628',0.3]}/>
    {items}
    {facilities.map(f => {
      const fx=toX(f.position.globalX,cx), fz=toZ(f.position.globalY,cz);
      return <mesh key={f.id} position={[fx,0.3,fz]}>
        <cylinderGeometry args={[0.3,0.35,0.5,6]}/>
        <meshStandardMaterial color={f.type==='naval_base'?'#f59e0b':f.type==='port'?'#3b82f6':f.type==='airfield'?'#a855f7':'#22c55e'} emissiveIntensity={0.3}/>
      </mesh>;
    })}
    <gridHelper args={[150,40,'#1a3a5a','#0a1628']} position={[0,0.005,0]}/>
  </>);
}

function Fleets() {
  const overlay = useNavalStore(s=>s.overlay);
  const fleets = useNavalStore(s=>s.fleets);
  if(!overlay) return null;
  const {cx,cz} = center(overlay);
  return (<>
    {fleets.filter(f=>f.faction==='player').flatMap(f=>
      f.ships.map(s=>{
        const px=toX(s.position.x,cx), pz=toZ(s.position.y,cz);
        const a=(s.headingDeg*Math.PI)/180, isCV=s.shipClass?.includes('carrier');
        const len=isCV?2.5:1.2, wid=isCV?0.8:0.4;
        return <group key={s.id} position={[px,0.15,pz]} rotation={[0,a,0]}>
          <mesh><boxGeometry args={[len,0.2,wid]}/><meshStandardMaterial color="#3b82f6" metalness={0.3}/></mesh>
          {isCV && <mesh position={[0,0.22,0]}><boxGeometry args={[len*0.8,0.04,wid*0.7]}/><meshStandardMaterial color="#64748b"/></mesh>}
          <mesh position={[len/2+0.3,0.04,0]} rotation={[0,0,-1.57]}><coneGeometry args={[0.1,0.2,4]}/><meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.5}/></mesh>
        </group>;
      })
    )}
  </>);
}

function ContactMarkers() {
  const overlay = useNavalStore(s=>s.overlay);
  const cs = useNavalStore(s=>s.intel.playerContacts);
  if(!overlay) return null;
  const {cx,cz} = center(overlay);
  return (<>{cs.filter(c=>c.detectionLevel!=='none'&&c.detectionLevel!=='lost').map(c=>{
    const px=toX(c.lastKnownPosition.x,cx), pz=toZ(c.lastKnownPosition.y,cz);
    const t=c.detectionLevel==='tracked'||c.detectionLevel==='identified';
    return <mesh key={c.id} position={[px,0.35,pz]}>
      {t?<coneGeometry args={[0.3,0.8,6]}/>:<sphereGeometry args={[0.25,8,8]}/>}
      <meshStandardMaterial color={t?'#ef4444':'#fbbf24'} transparent opacity={0.6} wireframe={!t}/>
    </mesh>;
  })}</>);
}

export function NavalScene3D() {
  const overlay = useNavalStore(s=>s.overlay);
  const fleets = useNavalStore(s=>s.fleets);
  if(!overlay||fleets.length===0) return null;
  return <Canvas camera={{position:[0,70,0],fov:40,near:0.1,far:600}} style={{background:'#0a1628'}} gl={{antialias:true}}>
    <World/><Fleets/><ContactMarkers/>
    <OrbitControls enableDamping dampingFactor={0.08} minDistance={5} maxDistance={150} maxPolarAngle={Math.PI/2.2}/>
  </Canvas>;
}
