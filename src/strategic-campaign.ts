/**
 * Strategic Campaign - 战略层海战
 * 大型太平洋地图 → 舰队不可拆分 → 遭遇后切入战术战 → LLM决策
 */
import { generateNavalMap } from './game/naval/naval-map-generator';
import { createShipForClass } from './game/naval/naval-debug';
import { updateShipMotion } from './game/naval/ship/ship-motion';
import { applyNavalDamage } from './game/naval/ship/ship-damage';
import { createDefaultIntelState } from './game/naval/intel/naval-intel-types';
import { updateNavalIntelState, decayNavalContacts } from './game/naval/intel/naval-contact-tracker';
import { detectNavalTarget } from './game/naval/intel/naval-visibility';
import type { NavalShip } from './game/naval/ship/ship-types';

const KEY = 'sk-7abe53292a3f4698af3a1475d8f1cd19';
const URL = 'https://api.deepseek.com/v1/chat/completions';
const MAP_W = 3000, MAP_H = 2000;

async function ask(sys: string, usr: string): Promise<string> {
  const r = await fetch(URL, { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${KEY}`},
    body: JSON.stringify({ model:'deepseek-chat', messages:[{role:'system',content:sys},{role:'user',content:usr}], temperature:0.7, max_tokens:500 }) });
  if(!r.ok) throw new Error(`${r.status}`);
  return ((await r.json()) as any).choices?.[0]?.message?.content || '';
}

// ==================== 战略地图 ====================
interface StratBase { id: string; name: string; x: number; y: number; faction: 'player'|'enemy'; type: 'naval_base'|'port'|'airfield'; }

function genStratMap() {
  const map = generateNavalMap({ width: MAP_W, height: MAP_H, seed: Date.now(), islandGroupCount: 15, maxIslandRadius: 80, minIslandRadius: 10, facilityDensity: 0.5, seaLevel: 0.45 });
  const bases: StratBase[] = [];
  // Group facilities by island proximity into named bases
  const used = new Set<string>();
  for (const f of map.facilities) {
    const key = `${Math.round(f.position.globalX/50)}_${Math.round(f.position.globalY/50)}`;
    if (used.has(key)) continue;
    used.add(key);
    bases.push({ id: f.id, name: f.name, x: f.position.globalX, y: f.position.globalY, faction: f.faction as 'player'|'enemy', type: f.type === 'naval_base' ? 'naval_base' : f.type === 'airfield' ? 'airfield' : 'port' });
  }
  return { overlay: map.overlay, bases };
}

// ==================== 战略舰队（不可拆分） ====================
interface StratFleet {
  id: string; name: string; faction: 'player'|'enemy';
  x: number; y: number; // strategic position
  ships: NavalShip[];
  homeBase: string;
  mission: string;
  fuel: number; // 0-100
  ammo: 'good'|'limited'|'critical';
  alive: boolean;
}

function makeFleet(faction:'player'|'enemy', name: string, x: number, y: number, home: string, shipDefs: Array<[string,string,number,number,number]>): StratFleet {
  const ships: NavalShip[] = [];
  for (const [cls, sname, dx, dy, hdg] of shipDefs) {
    const s = createShipForClass(cls as any, faction as any, sname, x+dx, y+dy, hdg, 18, 'screen' as any);
    s.targetSpeedKts = 18;
    ships.push(s);
  }
  return { id: `${faction}_${name.replace(/\s/g,'')}`, name, faction, x, y, ships, homeBase: home, mission: 'patrol', fuel: 100, ammo: 'good', alive: true };
}

// ==================== 战术战斗（复用现有系统） ====================
interface TacticalResult { events: string[]; kills: Array<{ victim: string; weapon: string; killer: string }>; playerLosses: string[]; enemyLosses: string[]; }

function runTacticalBattle(pFleet: StratFleet, eFleet: StratFleet, turns: number): TacticalResult {
  const events: string[] = [];
  const kills: TacticalResult['kills'] = [];
  const recordedKills = new Set<string>();

  for (let t = 0; t < turns; t++) {
    // Move ships
    for (const f of [pFleet, eFleet]) for (const s of f.ships) {
      const updated = updateShipMotion(s, 1);
      s.position = updated.position; s.headingDeg = updated.headingDeg; s.speedKts = updated.speedKts;
    }

    // Player attacks
    for (const ps of pFleet.ships) {
      for (const es of eFleet.ships) {
        const dx = ps.position.x - es.position.x, dy = ps.position.y - es.position.y;
        const dist = Math.sqrt(dx*dx+dy*dy);
        const vis = detectNavalTarget({ observer: ps, target: es, sensorType: 'visual',
          environment: { timeOfDay:'day', weather:'clear', seaState:1, smoke:0 }, distance: dist, lineOfSightBlocked: false });
        if (!vis.success || vis.detectionLevel === 'none') continue;
        const canFire = vis.detectionLevel === 'classified' || vis.detectionLevel === 'identified' || vis.detectionLevel === 'tracked';
        if (!canFire) continue;

        const torp = ps.shipClass === 'destroyer' && dist < 8 && Math.random() < 0.6;
        const r = applyNavalDamage({ ship: es, hitLocation:'midships',
          damageType: torp ? 'torpedo_hit' : 'shell_hit', penetration: torp ? 60 : 35, explosivePower: torp ? 35 : 12,
          underwater: torp, turn: t });
        es.damage = r.ship.damage;
        for (const e of r.events) {
          events.push(`🎯 ${ps.name} [${vis.detectionLevel}] → ${es.name}: ${torp?'TORPEDO':'GUNS'} → ${e.description}`);
          if ((es.damage.status === 'sinking' || es.damage.status === 'sunk') && !recordedKills.has(es.name)) {
            recordedKills.add(es.name);
            kills.push({ victim: es.name, weapon: torp?'Torpedo':'Naval Gun', killer: ps.name });
          }
        }
      }
    }

    // Enemy attacks
    for (const es of eFleet.ships) {
      for (const ps of pFleet.ships) {
        const dx = es.position.x - ps.position.x, dy = es.position.y - ps.position.y;
        const dist = Math.sqrt(dx*dx+dy*dy);
        const vis = detectNavalTarget({ observer: es, target: ps, sensorType: 'visual',
          environment: { timeOfDay:'day', weather:'clear', seaState:1, smoke:0 }, distance: dist, lineOfSightBlocked: false });
        if (!vis.success || vis.detectionLevel === 'none') continue;
        if (vis.detectionLevel !== 'classified' && vis.detectionLevel !== 'identified' && vis.detectionLevel !== 'tracked') continue;
        const r = applyNavalDamage({ ship: ps, hitLocation:'midships', damageType:'shell_hit', penetration: 28, explosivePower: 8, underwater:false, turn:t });
        ps.damage = r.ship.damage;
        for (const e of r.events) events.push(`🔫 ${es.name} → ${ps.name}: ${e.description}`);
      }
    }
  }

  return {
    events,
    kills,
    playerLosses: pFleet.ships.filter(s => s.damage.status==='sunk'||s.damage.status==='sinking').map(s=>s.name),
    enemyLosses: eFleet.ships.filter(s => s.damage.status==='sunk'||s.damage.status==='sinking').map(s=>s.name),
  };
}

// ==================== 主战役循环 ====================
async function runStrategicCampaign() {
  console.log(`\n⚓ PACIFIC STRATEGIC CAMPAIGN (${MAP_W}x${MAP_H})\n`);
  const { bases } = genStratMap();
  console.log(`Map: ${MAP_W}x${MAP_H}, ${bases.length} bases\n`);

  // Player fleets (3 fleets, each stays together)
  const pBases = bases.filter(b => b.faction === 'player' && b.type === 'naval_base');
  const eBases = bases.filter(b => b.faction === 'enemy' && b.type === 'naval_base');
  const pHome = pBases[0] || { x: 800, y: 1000, name: 'Pearl' };
  const eHome = eBases[0] || { x: 2000, y: 1000, name: 'Truk' };

  const playerFleets: StratFleet[] = [
    makeFleet('player', 'TF 16 Carrier', pHome.x, pHome.y, pHome.name, [
      ['fleet_carrier','CV Enterprise',0,0,90],['heavy_cruiser','CA Northampton',-8,-6,80],
      ['light_cruiser','CL Atlanta',8,-4,70],['destroyer','DD Fletcher',-12,8,100],
      ['destroyer','DD O\'Bannon',12,6,80],['destroyer','DD Nicholas',0,-10,60],
    ]),
    makeFleet('player', 'TF 17 Surface', pHome.x + 30, pHome.y + 20, pHome.name, [
      ['battleship','BB Washington',0,0,85],['heavy_cruiser','CA Portland',-6,-4,75],
      ['destroyer','DD Jenkins',-10,6,80],['destroyer','DD Radford',10,4,70],
    ]),
  ];

  const enemyFleets: StratFleet[] = [
    makeFleet('enemy', 'Mobile Fleet', eHome.x, eHome.y, eHome.name, [
      ['fleet_carrier','CV Shokaku',0,0,270],['battleship','BB Kongo',10,5,260],
      ['heavy_cruiser','CA Tone',-8,-6,250],['destroyer','DD Kagero',-14,8,280],
      ['destroyer','DD Shiranui',14,6,260],['destroyer','DD Hamakaze',0,-12,270],
    ]),
    makeFleet('enemy', 'Southern Force', eHome.x + 40, eHome.y - 30, eHome.name, [
      ['battleship','BB Kirishima',0,0,280],['light_cruiser','CL Sendai',-6,4,260],
      ['destroyer','DD Hatsuyuki',-10,6,270],['destroyer','DD Murakumo',10,4,250],
    ]),
  ];

  console.log(`Fleets: Player ${playerFleets.length} (${playerFleets.reduce((a,f)=>a+f.ships.length,0)} ships), Enemy ${enemyFleets.length} (${enemyFleets.reduce((a,f)=>a+f.ships.length,0)} ships)\n`);
  const allKills: TacticalResult['kills'] = [];

  // ========== STRATEGIC TURNS ==========
  for (let turn = 0; turn < 12; turn++) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  STRATEGIC TURN ${turn + 1}`);
    console.log(`${'═'.repeat(60)}`);

    // --- LLM Strategic Decision for each player fleet ---
    for (const pf of playerFleets) {
      if (!pf.alive) continue;
      let ctx = `TURN ${turn+1}\nFleet: ${pf.name} at (${pf.x},${pf.y}), ${pf.ships.length} ships, Fuel:${pf.fuel}, Ammo:${pf.ammo}\n`;
      ctx += `Ships: ${pf.ships.map(s=>`${s.name}(${s.shipClass}) ${s.damage.status}`).join(', ')}\n`;
      ctx += `Enemy fleets known near: `;
      const nearby = enemyFleets.filter(f => f.alive && Math.abs(f.x-pf.x)<500 && Math.abs(f.y-pf.y)<500);
      if (nearby.length === 0) ctx += 'none detected';
      else for (const ef of nearby) ctx += `\n  ${ef.name} at (~${ef.x},~${ef.y}) ${ef.ships.length} ships`;
      ctx += `\n\nStrategic order (move east/north/south/west/stay, or intercept/retreat):`;

      try {
        const resp = await ask('You are a Pacific Fleet commander. Give strategic movement orders for your fleet. Reply with fleet destination coordinates and reasoning. Format: DEST: x,y REASON: ...', ctx);
        console.log(`  🔵 ${pf.name}: ${resp.slice(0,150)}`);
        // Parse destination
        const m = resp.match(/DEST:\s*(\d+),\s*(\d+)/);
        if (m) {
          const tx = parseInt(m[1]), ty = parseInt(m[2]);
          const adx = tx - pf.x, ady = ty - pf.y;
          const dist = Math.sqrt(adx*adx+ady*ady);
          const speed = Math.min(40, dist);
          pf.x += Math.round(adx * speed / (dist||1));
          pf.y += Math.round(ady * speed / (dist||1));
          pf.fuel = Math.max(0, pf.fuel - speed/5);
          console.log(`    → moved toward (${tx},${ty}), now at (${pf.x},${pf.y}) fuel:${pf.fuel.toFixed(0)}`);
        }
      } catch { console.log(`  🔵 ${pf.name}: LLM offline, holding`); }
    }

    // --- Enemy strategic decision ---
    for (const ef of enemyFleets) {
      if (!ef.alive) continue;
      let ctx = `TURN ${turn+1}\nFleet: ${ef.name} at (${ef.x},${ef.y}), ${ef.ships.length} ships, Fuel:${ef.fuel}\n`;
      ctx += `Ships: ${ef.ships.map(s=>`${s.name}(${s.shipClass}) ${s.damage.status}`).join(', ')}\n`;
      const nearby = playerFleets.filter(f => f.alive && Math.abs(f.x-ef.x)<500 && Math.abs(f.y-ef.y)<500);
      ctx += `US fleets known near: ${nearby.length > 0 ? nearby.map(f=>`${f.name}(~${f.x},~${f.y})`).join('; ') : 'none'}\n`;
      ctx += `\nStrategic order (format: DEST: x,y REASON: ...):`;
      try {
        const resp = await ask('You command an Imperial Japanese fleet in the Pacific. Issue strategic orders. Format: DEST: x,y REASON: ...', ctx);
        console.log(`  🔴 ${ef.name}: ${resp.slice(0,150)}`);
        const m = resp.match(/DEST:\s*(\d+),\s*(\d+)/);
        if (m) {
          const tx = parseInt(m[1]), ty = parseInt(m[2]);
          const adx = tx - ef.x, ady = ty - ef.y;
          const dist = Math.sqrt(adx*adx+ady*ady);
          const speed = Math.min(35, dist);
          ef.x += Math.round(adx * speed / (dist||1));
          ef.y += Math.round(ady * speed / (dist||1));
          ef.fuel = Math.max(0, ef.fuel - speed/5);
          console.log(`    → moved toward (${tx},${ty}), now at (${ef.x},${ef.y})`);
        }
      } catch { console.log(`  🔴 ${ef.name}: LLM offline, holding`); }
    }

    // --- Check for fleet encounters ---
    for (const pf of playerFleets) {
      if (!pf.alive) continue;
      for (const ef of enemyFleets) {
        if (!ef.alive) continue;
        const sdx = pf.x - ef.x, sdy = pf.y - ef.y;
        const sdist = Math.sqrt(sdx*sdx+sdy*sdy);
        if (sdist < 80) {
          console.log(`\n  ⚔️ ENGAGEMENT! ${pf.name} encounters ${ef.name} at ${sdist.toFixed(0)} units!`);
          console.log(`  ${'─'.repeat(50)}`);
          // Place ships CLOSE together for visual range combat (18-25u visual)
          const midX = (pf.x + ef.x) / 2, midY = (pf.y + ef.y) / 2;
          const spreadX = 15; // within visual range of each other
          for (const s of pf.ships) { s.position.x = midX - spreadX + (Math.random()-0.5)*4; s.position.y = midY + (Math.random()-0.5)*8; s.targetSpeedKts = 25; }
          for (const s of ef.ships) { s.position.x = midX + spreadX + (Math.random()-0.5)*4; s.position.y = midY + (Math.random()-0.5)*8; s.targetSpeedKts = 25; }

          const result = runTacticalBattle(pf, ef, 8);
          for (const e of result.events.slice(-15)) console.log(`    ${e}`);
          for (const k of result.kills) console.log(`    💀 ${k.victim} destroyed by ${k.killer} (${k.weapon})`);
          allKills.push(...result.kills);

          // Remove sunk ships
          pf.ships = pf.ships.filter(s => s.damage.status !== 'sunk' && s.damage.status !== 'sinking');
          ef.ships = ef.ships.filter(s => s.damage.status !== 'sunk' && s.damage.status !== 'sinking');
          if (pf.ships.length === 0) { pf.alive = false; console.log(`    🏴 ${pf.name} DESTROYED`); }
          if (ef.ships.length === 0) { ef.alive = false; console.log(`    🏴 ${ef.name} DESTROYED`); }
          console.log(`  ${'─'.repeat(50)}`);
        }
      }
    }

    await sleep(800);
  }

  // ========== FINAL REPORT ==========
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log(`  STRATEGIC CAMPAIGN COMPLETE`);
  console.log(`${'═'.repeat(60)}`);

  console.log(`\n🔵 PLAYER FLEETS:`);
  for (const f of playerFleets) {
    const sunk = (makeFleet('player','',0,0,'',[]).ships.length || 0);
    const alive = f.ships.length;
    console.log(`  ${f.name}: ${f.alive?'ALIVE':'DESTROYED'} at (${f.x},${f.y}), ${alive} ships remaining, Fuel:${f.fuel.toFixed(0)}`);
    for (const s of f.ships) {
      const d = s.damage.status !== 'combat_effective' ? ` [${s.damage.status} F:${s.damage.flooding.toFixed(0)}%]` : '';
      console.log(`    ${s.name} (${s.shipClass})${d}`);
    }
  }

  console.log(`\n🔴 ENEMY FLEETS:`);
  for (const f of enemyFleets) {
    const alive = f.ships.length;
    console.log(`  ${f.name}: ${f.alive?'ALIVE':'DESTROYED'} at (${f.x},${f.y}), ${alive} ships remaining`);
    for (const s of f.ships) {
      const d = s.damage.status !== 'combat_effective' ? ` [${s.damage.status} F:${s.damage.flooding.toFixed(0)}%]` : '';
      console.log(`    ${s.name} (${s.shipClass})${d}`);
    }
  }

  console.log(`\n💀 ALL KILLS (${allKills.length}):`);
  for (const k of allKills) console.log(`  ${k.victim} — ${k.weapon} from ${k.killer}`);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
runStrategicCampaign().catch(e => console.error('Campaign failed:', e));
