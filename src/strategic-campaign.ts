/**
 * Strategic Campaign v2 — 航母战略航空作战
 * 侦察机搜索 → 发现 → 派攻击机打击 → 战斗机CAP → 航空战
 */
import { generateNavalMap } from './game/naval/naval-map-generator';
import { createShipForClass } from './game/naval/naval-debug';
import { updateShipMotion } from './game/naval/ship/ship-motion';
import { applyNavalDamage } from './game/naval/ship/ship-damage';
import { detectNavalTarget } from './game/naval/intel/naval-visibility';
import type { NavalShip } from './game/naval/ship/ship-types';

const KEY='sk-7abe53292a3f4698af3a1475d8f1cd19', ENDPOINT='https://api.deepseek.com/v1/chat/completions';
const MAP_W=3000, MAP_H=2000;

async function ask(sys:string,usr:string):Promise<string>{
  const r=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${KEY}`},
    body:JSON.stringify({model:'deepseek-chat',messages:[{role:'system',content:sys},{role:'user',content:usr}],temperature:0.7,max_tokens:500})});
  if(!r.ok)throw new Error(`${r.status}`);
  return((await r.json())as any).choices?.[0]?.message?.content||'';
}

// ==================== 航空单位 ====================
interface AirGroup {
  fighters: number; fighterReady: number;
  diveBombers: number; diveBomberReady: number;
  torpedoBombers: number; torpedoBomberReady: number;
  missions: AirMission[];
}

interface AirMission {
  id: string; type: 'search'|'strike'|'cap';
  aircraft: number; aircraftType: 'fighter'|'dive_bomber'|'torpedo_bomber';
  x: number; y: number; targetX: number; targetY: number;
  fuel: number; maxFuel: number;
  status: 'en_route'|'searching'|'attacking'|'returning'|'lost';
  turnLaunched: number;
}

type FleetFaction = 'player'|'enemy';

interface StratFleet {
  id:string; name:string; faction:FleetFaction;
  x:number; y:number; ships:NavyShip[]; airGroup?:AirGroup;
  homeBase:string; mission:string; fuel:number; ammo:string; alive:boolean;
  intel: Array<{target:string; x:number; y:number; confidence:'low'|'medium'|'high'; lastSeen:number}>;
}

interface NavyShip extends NavalShip { isCarrier?:boolean; }

function makeFleet(faction:FleetFaction,name:string,x:number,y:number,home:string,
  shipDefs:Array<[string,string,number,number,number]>, air?:Partial<AirGroup>):StratFleet{
  const ships:NavyShip[]=[];
  for(const[cls,sname,dx,dy,hdg]of shipDefs){
    const s=createShipForClass(cls as any,faction as any,sname,x+dx,y+dy,hdg,18,'screen'as any)as NavyShip;
    s.targetSpeedKts=18; s.isCarrier=cls.includes('carrier'); ships.push(s);
  }
  const ag:AirGroup|undefined=air?{
    fighters:air.fighters||0,fighterReady:air.fighterReady||air.fighters||0,
    diveBombers:air.diveBombers||0,diveBomberReady:air.diveBomberReady||air.diveBombers||0,
    torpedoBombers:air.torpedoBombers||0,torpedoBomberReady:air.torpedoBomberReady||air.torpedoBombers||0,
    missions:[]
  }:undefined;
  return{id:`${faction}_${name.replace(/\s/g,'')}`,name,faction,x,y,ships,airGroup:ag,homeBase:home,mission:'patrol',fuel:100,ammo:'good',alive:true,intel:[]};
}

// ==================== 战略地图 ====================
interface StratBase{id:string;name:string;x:number;y:number;faction:FleetFaction;type:'naval_base'|'port'|'airfield';}
function genStratMap(){
  const map=generateNavalMap({width:MAP_W,height:MAP_H,seed:Date.now(),islandGroupCount:15,maxIslandRadius:80,minIslandRadius:10,facilityDensity:0.5,seaLevel:0.45});
  const bases:StratBase[]=[];
  const used=new Set<string>();
  for(const f of map.facilities){
    const k=`${Math.round(f.position.globalX/50)}_${Math.round(f.position.globalY/50)}`;
    if(used.has(k))continue; used.add(k);
    bases.push({id:f.id,name:f.name,x:f.position.globalX,y:f.position.globalY,faction:f.faction as FleetFaction,type:f.type==='naval_base'?'naval_base':f.type==='airfield'?'airfield':'port'});
  }
  return{overlay:map.overlay,bases};
}

// ==================== 航空任务执行 ====================
function runAirMissions(fleets:StratFleet[], turn:number, allKills: any[]){
  for(const fleet of fleets){
    if(!fleet.alive||!fleet.airGroup) continue;
    const ag=fleet.airGroup;

    // Process existing missions
    ag.missions=ag.missions.filter(m=>{
      if(m.status==='lost') return false;
      m.fuel=Math.max(0,m.fuel-3);

      // CAP stays near fleet
      if(m.type==='cap'){
        m.x=fleet.x; m.y=fleet.y; m.status='searching';
        if(m.fuel<=0){ag.fighterReady+=m.aircraft; return false;}
        return true;
      }

      // Search/strike: fly toward target
      const dx=m.targetX-m.x, dy=m.targetY-m.y, dist=Math.sqrt(dx*dx+dy*dy);
      if(dist<2){m.status=m.type==='search'?'searching':'attacking';}

      if(m.status==='attacking'){
        // Strike hits: apply damage to target fleet
        const tgt=fleets.find(f=>f.alive && Math.abs(f.x-m.targetX)<10 && Math.abs(f.y-m.targetY)<10);
        if(tgt && tgt.faction!==fleet.faction){
          const bombPower=m.aircraftType==='torpedo_bomber'?60:45;
          const bombExplosive=m.aircraftType==='torpedo_bomber'?35:25;
          let hits=0;
          for(const s of tgt.ships){
            if(Math.random()<0.35){
              const r=applyNavalDamage({ship:s,hitLocation:'midships',damageType:m.aircraftType==='torpedo_bomber'?'torpedo_hit':'bomb_hit',penetration:bombPower,explosivePower:bombExplosive,underwater:m.aircraftType==='torpedo_bomber',turn});
              s.damage=r.ship.damage; hits++;
              if((s.damage.status==='sinking'||s.damage.status==='sunk')){
                allKills.push({victim:s.name,weapon:'Aerial Bomb',killer:`${fleet.name} aircraft`});
              }
            }
          }
          console.log(`  ✈️ ${m.aircraftType}s from ${fleet.name} strike ${tgt.name}: ${hits} hits, ${m.aircraft} planes`);
        }
        m.status='returning';
      }

      if(m.status==='searching'){
        // Check if any enemy fleet is within search range (30 units)
        for(const ef of fleets){
          if(ef.faction===fleet.faction||!ef.alive) continue;
          const sdx=m.x-ef.x, sdy=m.y-ef.y, sdist=Math.sqrt(sdx*sdx+sdy*sdy);
          if(sdist<80){
            fleet.intel.push({target:ef.name,x:ef.x,y:ef.y,confidence:'high',lastSeen:turn});
            console.log(`  🔍 ${fleet.name} search spotted ${ef.name} at (~${ef.x},~${ef.y})`);
            m.status='returning';
          }
        }
        if(m.fuel<=10){m.status='returning';}
      }

      if(m.status==='returning'){
        // Fly back toward fleet
        const rdx=fleet.x-m.x, rdy=fleet.y-m.y, rdist=Math.sqrt(rdx*rdx+rdy*rdy);
        if(rdist<2 && m.type!=='cap'){
          if(m.aircraftType==='fighter') ag.fighterReady+=m.aircraft;
          else if(m.aircraftType==='dive_bomber') ag.diveBomberReady+=m.aircraft;
          else ag.torpedoBomberReady+=m.aircraft;
          return false;
        }
        const step=Math.min(40/rdist,1);
        m.x+=rdx*step; m.y+=rdy*step;
      }else if(m.status!=='cap'&&m.status!=='searching'){
        const step=Math.min(40/dist,1);
        m.x+=dx*step; m.y+=dy*step;
      }

      if(m.fuel<=0){console.log(`  ✈️ ${fleet.name} aircraft ${m.id} lost (fuel)`); return false;}
      return true;
    });
  }
}

// ==================== 战术交战（遭遇战） ====================
interface TacticalResult{events:string[];kills:Array<{victim:string;weapon:string;killer:string}>;playerLosses:string[];enemyLosses:string[];}

function runTacticalBattle(pFleet:StratFleet,eFleet:StratFleet,turns:number):TacticalResult{
  const events:string[]=[], kills:TacticalResult['kills']=[];
  const recKills=new Set<string>();

  for(let t=0;t<turns;t++){
    // CAP intercept: if defending fleet has fighters, intercept incoming strikes
    for(const f of [pFleet,eFleet]){
      if(!f.airGroup) continue;
      for(const em of eFleet.faction===f.faction?[]: (f===pFleet?eFleet.airGroup?.missions||[]:pFleet.airGroup?.missions||[])){
        if(em.type==='strike'&&em.status==='attacking'){
          const defending=f;
          if(defending.airGroup!.fighterReady>=2){
            defending.airGroup!.fighterReady-=2;
            if(Math.random()<0.5){em.aircraft=Math.max(0,em.aircraft-1);events.push(`🛡️ ${defending.name} CAP intercepted ${em.aircraftType} strike`);}
          }
        }
      }
    }

    // Ship vs ship (detection-gated, same as before)
    for(const ps of pFleet.ships){
      for(const es of eFleet.ships){
        const dx=ps.position.x-es.position.x,dy=ps.position.y-es.position.y,dist=Math.sqrt(dx*dx+dy*dy);
        const vis=detectNavalTarget({observer:ps,target:es,sensorType:'visual',environment:{timeOfDay:'day',weather:'clear',seaState:1,smoke:0},distance:dist,lineOfSightBlocked:false});
        if(!vis.success||vis.detectionLevel==='none') continue;
        if(vis.detectionLevel!=='classified'&&vis.detectionLevel!=='identified'&&vis.detectionLevel!=='tracked') continue;
        const torp=ps.shipClass==='destroyer'&&dist<8&&Math.random()<0.6;
        const r=applyNavalDamage({ship:es,hitLocation:'midships',damageType:torp?'torpedo_hit':'shell_hit',penetration:torp?60:35,explosivePower:torp?35:12,underwater:torp,turn:t});
        es.damage=r.ship.damage;
        for(const e of r.events){
          events.push(`🎯 ${ps.name}→${es.name}: ${torp?'TORPEDO':'GUNS'} → ${e.description}`);
          if((es.damage.status==='sinking'||es.damage.status==='sunk')&&!recKills.has(es.name)){recKills.add(es.name);kills.push({victim:es.name,weapon:torp?'Torpedo':'Naval Gun',killer:ps.name});}
        }
      }
    }
  }

  return{events,kills,
    playerLosses:pFleet.ships.filter(s=>s.damage.status==='sunk'||s.damage.status==='sinking').map(s=>s.name),
    enemyLosses:eFleet.ships.filter(s=>s.damage.status==='sunk'||s.damage.status==='sinking').map(s=>s.name)};
}

// ==================== 主循环 ====================
async function run(){
  console.log(`\n⚓ PACIFIC STRATEGIC CAMPAIGN v2 — Carrier Air Operations\n`);
  const{bases}=genStratMap();
  const pB=bases.filter(b=>b.faction==='player'&&b.type==='naval_base');
  const eB=bases.filter(b=>b.faction==='enemy'&&b.type==='naval_base');
  const pH=pB[0]||{x:800,y:1000,name:'Pearl'}, eH={x:1200,y:950,name:'Truk'}; // closer start

  const pFleets:StratFleet[]=[
    makeFleet('player','TF 16 Carrier',pH.x,pH.y,pH.name,[
      ['fleet_carrier','CV Enterprise',0,0,90],['heavy_cruiser','CA Northampton',-8,-6,80],
      ['light_cruiser','CL Atlanta',8,-4,70],['destroyer','DD Fletcher',-12,8,100],
      ['destroyer','DD O\'Bannon',12,6,80],['destroyer','DD Nicholas',0,-10,60],
    ],{fighters:36,diveBombers:36,torpedoBombers:18}),
    makeFleet('player','TF 17 Surface',pH.x+30,pH.y+20,pH.name,[
      ['battleship','BB Washington',0,0,85],['heavy_cruiser','CA Portland',-6,-4,75],
      ['destroyer','DD Jenkins',-10,6,80],['destroyer','DD Radford',10,4,70],
    ]),
  ];

  const eFleets:StratFleet[]=[
    makeFleet('enemy','Mobile Fleet KdB',eH.x,eH.y,eH.name,[
      ['fleet_carrier','CV Shokaku',0,0,270],['fleet_carrier','CV Zuikaku',10,-5,275],
      ['battleship','BB Kongo',-10,8,250],['heavy_cruiser','CA Tone',-15,-8,260],
      ['destroyer','DD Kagero',-20,10,280],['destroyer','DD Shiranui',20,8,270],
    ],{fighters:54,diveBombers:54,torpedoBombers:36}),
    makeFleet('enemy','Southern Force',eH.x+40,eH.y-20,eH.name,[
      ['battleship','BB Kirishima',0,0,280],['light_cruiser','CL Sendai',-6,4,260],
      ['destroyer','DD Hatsuyuki',-10,6,270],['destroyer','DD Murakumo',10,4,250],
    ]),
  ];

  const allKills:any[]=[];
  let mid=0;
  const nextId=()=>`m${++mid}`;

  for(let turn=0;turn<12;turn++){
    console.log(`\n${'═'.repeat(60)}\n  STRATEGIC TURN ${turn+1}\n${'═'.repeat(60)}`);
    // Clean old intel (>3 turns)
    for(const f of [...pFleets,...eFleets]) f.intel=f.intel.filter(i=>turn-i.lastSeen<3);

    // ====== LLM STRATEGIC COMMANDS ======
    for(const pf of pFleets){
      if(!pf.alive) continue;
      let ctx=`TURN ${turn+1}\nFleet:${pf.name} at(${pf.x},${pf.y}), ${pf.ships.length}ships, Fuel:${pf.fuel.toFixed(0)}\n`;
      ctx+=`Ships:${pf.ships.map(s=>`${s.name}(${s.shipClass})`).join(',')}\n`;
      if(pf.airGroup){
        ctx+=`AIR: F:${pf.airGroup.fighters}/${pf.airGroup.fighterReady} DB:${pf.airGroup.diveBombers}/${pf.airGroup.diveBomberReady} TB:${pf.airGroup.torpedoBombers}/${pf.airGroup.torpedoBomberReady}\n`;
        ctx+=`Missions:${pf.airGroup.missions.filter(m=>m.status!=='lost').length} airborne\n`;
      }
      ctx+=`Intel:${pf.intel.map(i=>`${i.target} at(~${i.x},~${i.y})`).join('; ')||'none'}\n`;
      ctx+=`Options: launch_search DIRECTION, launch_strike TARGET, launch_cap, move DEST:x,y\nFormat: CMD: ... REASON: ...`;

      try{
        const resp=await ask('Pacific Fleet commander. Issue strategic orders including air operations. Format: CMD: search NE or CMD: strike Mobile Fleet or CMD: move 1500,850 REASON:',ctx);
        console.log(`  🔵 ${pf.name}: ${resp.slice(0,160)}`);
        // Parse commands
        if(resp.includes('search')||resp.includes('SEARCH')){
          const dir=resp.includes('NW')||resp.includes('northwest')?'NW':resp.includes('NE')||resp.includes('northeast')?'NE':resp.includes('SW')||resp.includes('southwest')?'SW':resp.includes('SE')||resp.includes('southeast')?'SE':'E';
          const angles:Record<string,number>={NW:315,NE:45,SW:225,SE:135,N:0,E:90,S:180,W:270};
          if(pf.airGroup&&pf.airGroup.diveBomberReady>=4){
            pf.airGroup.diveBomberReady-=4;
            pf.airGroup.missions.push({id:nextId(),type:'search',aircraft:4,aircraftType:'dive_bomber',x:pf.x,y:pf.y,targetX:pf.x+Math.cos(angles[dir]*Math.PI/180)*400,targetY:pf.y+Math.sin(angles[dir]*Math.PI/180)*400,fuel:200,maxFuel:200,status:'en_route',turnLaunched:turn});
            console.log(`    ✈️ Launched search ${dir} (4 planes)`);
          }
        }
        if(resp.includes('strike')||resp.includes('STRIKE')){
          const tgt=eFleets.find(ef=>ef.alive&&(resp.includes(ef.name)||resp.includes(ef.name.replace(/\s.*/,''))));
          if(tgt&&pf.airGroup&&pf.airGroup.torpedoBomberReady>=6){
            pf.airGroup.torpedoBomberReady-=6;
            pf.airGroup.missions.push({id:nextId(),type:'strike',aircraft:6,aircraftType:'torpedo_bomber',x:pf.x,y:pf.y,targetX:tgt.x,targetY:tgt.y,fuel:120,maxFuel:120,status:'en_route',turnLaunched:turn});
            console.log(`    ✈️ Launched strike on ${tgt.name} (6 TB)`);
          }
        }
        if(resp.includes('CAP')||resp.includes('cap')||resp.includes('fighter')){
          if(pf.airGroup&&pf.airGroup.fighterReady>=4){
            pf.airGroup.fighterReady-=4;
            pf.airGroup.missions.push({id:nextId(),type:'cap',aircraft:4,aircraftType:'fighter',x:pf.x,y:pf.y,targetX:pf.x,targetY:pf.y,fuel:60,maxFuel:60,status:'en_route',turnLaunched:turn});
            console.log(`    🛡️ CAP launched (4 fighters)`);
          }
        }
        const mm=resp.match(/move\s*(\d+)\s*[, ]\s*(\d+)/i);
        if(mm){const tx=parseInt(mm[1]),ty=parseInt(mm[2]);pf.x=Math.round(pf.x+(tx-pf.x)*0.7);pf.y=Math.round(pf.y+(ty-pf.y)*0.7);pf.fuel=Math.max(0,pf.fuel-5);}
      }catch{console.log(`  🔵 ${pf.name}: LLM offline`);}
    }

    // Enemy decisions
    for(const ef of eFleets){
      if(!ef.alive) continue;
      let ctx=`TURN ${turn+1}\nFleet:${ef.name} at(${ef.x},${ef.y}), ${ef.ships.length}ships\n`;
      if(ef.airGroup)ctx+=`AIR: F:${ef.airGroup.fighters}/${ef.airGroup.fighterReady} DB:${ef.airGroup.diveBombers}/${ef.airGroup.diveBomberReady} TB:${ef.airGroup.torpedoBombers}/${ef.airGroup.torpedoBomberReady}\n`;
      ctx+=`Intel:${ef.intel.map(i=>`${i.target} at(~${i.x},~${i.y})`).join(';')||'none'}\nOptions: launch_search/lance_strike/launch_cap/move CMD:x,y REASON:`;
      try{
        const resp=await ask('Imperial Japanese Navy commander. Issue strategic orders. Format: CMD: search NE or CMD: strike TF16 or CMD: move 1500,850 REASON:',ctx);
        console.log(`  🔴 ${ef.name}: ${resp.slice(0,160)}`);
        if(resp.includes('search')||resp.includes('SEARCH')){
          const dir=resp.includes('NW')?'NW':resp.includes('NE')?'NE':resp.includes('SW')?'SW':resp.includes('SE')?'SE':'W';
          const angles:Record<string,number>={NW:315,NE:45,SW:225,SE:135,N:0,E:90,S:180,W:270};
          if(ef.airGroup&&ef.airGroup.diveBomberReady>=4){
            ef.airGroup.diveBomberReady-=4;
            ef.airGroup.missions.push({id:nextId(),type:'search',aircraft:4,aircraftType:'dive_bomber',x:ef.x,y:ef.y,targetX:ef.x+Math.cos(angles[dir]*Math.PI/180)*400,targetY:ef.y+Math.sin(angles[dir]*Math.PI/180)*400,fuel:200,maxFuel:200,status:'en_route',turnLaunched:turn});
          }
        }
        if(resp.includes('strike')||resp.includes('STRIKE')){
          const tgt=pFleets.find(pf=>pf.alive&&(resp.includes(pf.name)||resp.includes(pf.name.replace(/\s.*/,''))));
          if(tgt&&ef.airGroup&&ef.airGroup.torpedoBomberReady>=6){
            ef.airGroup.torpedoBomberReady-=6;
            ef.airGroup.missions.push({id:nextId(),type:'strike',aircraft:6,aircraftType:'torpedo_bomber',x:ef.x,y:ef.y,targetX:tgt.x,targetY:tgt.y,fuel:120,maxFuel:120,status:'en_route',turnLaunched:turn});
          }
        }
        if(resp.includes('CAP')||resp.includes('cap')){
          if(ef.airGroup&&ef.airGroup.fighterReady>=4){ef.airGroup.fighterReady-=4;ef.airGroup.missions.push({id:nextId(),type:'cap',aircraft:4,aircraftType:'fighter',x:ef.x,y:ef.y,targetX:ef.x,targetY:ef.y,fuel:60,maxFuel:60,status:'en_route',turnLaunched:turn});}
        }
        const mm=resp.match(/move\s*(\d+)\s*[, ]\s*(\d+)/i);
        if(mm){const tx=parseInt(mm[1]),ty=parseInt(mm[2]);ef.x=Math.round(ef.x+(tx-ef.x)*0.7);ef.y=Math.round(ef.y+(ty-ef.y)*0.7);ef.fuel=Math.max(0,ef.fuel-5);}
      }catch{}
    }

    // ====== RUN AIR MISSIONS ======
    runAirMissions([...pFleets,...eFleets],turn,allKills);

    // Prune sunk ships
    for(const f of[...pFleets,...eFleets]) f.ships=f.ships.filter(s=>s.damage.status!=='sunk'&&s.damage.status!=='sinking');
    for(const f of pFleets) if(f.ships.length===0) f.alive=false;
    for(const f of eFleets) if(f.ships.length===0) f.alive=false;

    await sleep(800);
  }

  // ====== FINAL REPORT ======
  console.log(`\n\n${'═'.repeat(60)}\n  CAMPAIGN COMPLETE\n${'═'.repeat(60)}`);
  for(const f of[...pFleets,...eFleets]){
    console.log(`\n${f.faction==='player'?'🔵':'🔴'} ${f.name}: ${f.alive?'ALIVE':'DESTROYED'} (${f.x},${f.y}) ${f.ships.length}ships`);
    for(const s of f.ships){
      const d=s.damage.status!=='combat_effective'?` [${s.damage.status} F:${s.damage.flooding.toFixed(0)}%]`:'';
      console.log(`  ${s.name}(${s.shipClass})${d}`);
    }
    if(f.airGroup)console.log(`  ✈️ Lost: F${f.airGroup.fighters-f.airGroup.fighterReady} DB${f.airGroup.diveBombers-f.airGroup.diveBomberReady} TB${f.airGroup.torpedoBombers-f.airGroup.torpedoBomberReady}`);
  }
  console.log(`\n💀 ALL KILLS (${allKills.length}):`);
  for(const k of allKills) console.log(`  ${k.victim} — ${k.weapon} from ${k.killer}`);
}

function sleep(ms:number){return new Promise(r=>setTimeout(r,ms));}
run().catch(e=>console.error(e));
