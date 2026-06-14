/**
 * LLM Campaign Runner v2 - 舰载机 + 击沉归因 + 更长战役
 */
import { generateNavalMap } from './game/naval/naval-map-generator';
import { updateShipMotion } from './game/naval/ship/ship-motion';
import { applyNavalDamage } from './game/naval/ship/ship-damage';
import { createDefaultIntelState } from './game/naval/intel/naval-intel-types';
import { updateNavalIntelState, decayNavalContacts } from './game/naval/intel/naval-contact-tracker';
import { detectNavalTarget } from './game/naval/intel/naval-visibility';
import { createShipForClass } from './game/naval/naval-debug';
import { createDefaultAircraft } from './game/naval/air/aircraft-types';
import { updateAircraftMotion } from './game/naval/air/aircraft-motion';
import { isTargetInForwardCone } from './game/naval/air/aircraft-attack';
import type { NavalShip } from './game/naval/ship/ship-types';
import type { StrategicFleet } from './game/naval/naval-strategic-types';
import type { NavalAircraft } from './game/naval/air/aircraft-types';

const KEY = 'sk-7abe53292a3f4698af3a1475d8f1cd19';
const URL = 'https://api.deepseek.com/v1/chat/completions';

async function ask(sys: string, usr: string): Promise<string> {
  const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }], temperature: 0.8, max_tokens: 400 }) });
  if (!r.ok) throw new Error(`${r.status}`);
  return ((await r.json()) as any).choices?.[0]?.message?.content || '';
}

interface KillRecord { victim: string; victimClass: string; killer: string; killerClass: string; weapon: string; turn: number; desc: string; }
interface AirRecord { name: string; cls: string; status: string; x: number; y: number; hdg: number; spd: number; fuel: number; mission: string; }
interface TurnRec { turn: number; playerPlan: string; enemyPlan: string; events: string[]; kills: KillRecord[]; playerAircraft: AirRecord[]; enemyAircraft: AirRecord[]; }

class Game {
  overlay: any; facilities: any[];
  pFleet: StrategicFleet; eFleet: StrategicFleet;
  pAircraft: NavalAircraft[] = []; eAircraft: NavalAircraft[] = [];
  intel = createDefaultIntelState(); turn = 0;
  kills: KillRecord[] = []; events: string[] = [];
  contactHistory: Array<{t:number;c:number}> = [];

  constructor() {
    const map = generateNavalMap({ width: 1024, height: 1024, seed: Date.now() });
    this.overlay = map.overlay; this.facilities = map.facilities;
    const pp = map.facilities.find(f => f.faction === 'player' && (f.type === 'port' || f.type === 'naval_base'));
    const pcx = pp?.position.globalX ?? 400, pcy = pp?.position.globalY ?? 500;

    const ecx = pcx + 25, ecy = pcy + 20;

    this.pFleet = {
      id: 'p_ctf', name: 'Task Force 16', faction: 'player', type: 'carrier_task_force',
      position: { regionX:0,regionY:0,chunkX:0,chunkY:0,globalX:pcx,globalY:pcy },
      ships: [
        this.ship('fleet_carrier','player','CV Enterprise',pcx,pcy,90,22),
        this.ship('heavy_cruiser','player','CA Northampton',pcx-6,pcy-8,80,26),
        this.ship('destroyer','player','DD Fletcher',pcx-10,pcy+6,100,30),
        this.ship('destroyer','player','DD O\'Bannon',pcx+8,pcy-4,70,28),
        this.ship('destroyer','player','DD Nicholas',pcx+3,pcy-12,95,30),
      ],
      mission: 'intercept', fuelState: 'good', ammoState: 'good', detectedByPlayer: true,
    };

    this.eFleet = {
      id: 'e_sag', name: 'Enemy Group 3', faction: 'enemy', type: 'surface_action_group',
      position: { regionX:0,regionY:0,chunkX:0,chunkY:0,globalX:ecx,globalY:ecy },
      ships: [
        this.ship('battleship','enemy','BB Kongo',ecx,ecy,270,18),
        this.ship('heavy_cruiser','enemy','CA Tone',ecx+5,ecy-5,280,22),
        this.ship('light_cruiser','enemy','CL Sendai',ecx-3,ecy+5,260,24),
        this.ship('destroyer','enemy','DD Kagero',ecx-5,ecy-2,250,28),
        this.ship('destroyer','enemy','DD Shiranui',ecx+3,ecy+2,275,28),
      ],
      mission: 'intercept', fuelState: 'good', ammoState: 'good', detectedByPlayer: false,
    };

    this.intel = createDefaultIntelState();
  }

  ship(cls: string, fac: string, name: string, x: number, y: number, hdg: number, spd: number): NavalShip {
    const s = createShipForClass(cls as any, fac as any, name, x, y, hdg, spd, 'screen' as any);
    s.targetSpeedKts = spd + 2;
    return s;
  }

  launchAircraft(fleet: StrategicFleet, count: number, side: 'p'|'e') {
    const cv = fleet.ships.find(s => s.shipClass?.includes('carrier'));
    if (!cv) return;
    for (let i = 0; i < count; i++) {
      const offset = (i - count/2) * 2;
      const ac = createDefaultAircraft(
        side === 'p' ? 'dive_bomber' : 'fighter', fleet.faction as 'player'|'enemy',
        `${side}${i}`, cv.position.x + offset, cv.position.y + offset, cv.headingDeg, 150, cv.id, ''
      );
      ac.status = 'searching';
      (side === 'p' ? this.pAircraft : this.eAircraft).push(ac);
    }
  }

  advance() {
    this.turn++;
    for (const f of [this.pFleet, this.eFleet]) {
      for (let i = 0; i < f.ships.length; i++) f.ships[i] = updateShipMotion(f.ships[i], 1);
    }
    // Update aircraft
    this.pAircraft = this.pAircraft.filter(a => a.fuel > 0).map(a => updateAircraftMotion({ aircraft: a, deltaTurns: 1 }));
    this.eAircraft = this.eAircraft.filter(a => a.fuel > 0).map(a => updateAircraftMotion({ aircraft: a, deltaTurns: 1 }));
    // Intel
    const res = updateNavalIntelState({ intel: this.intel, currentTurn: this.turn, friendlyShips: this.pFleet.ships, enemyShips: this.eFleet.ships, friendlyAirMissions: [], overlay: this.overlay, environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, windDirectionDeg: 0, windSpeedKts: 0, visibilityModifier: 1 } });
    this.intel = res.intel;
    this.intel.playerContacts = decayNavalContacts({ contacts: this.intel.playerContacts, currentTurn: this.turn, staleAfterTurns: 2 });
    this.pFleet.position.globalX = Math.round(this.pFleet.ships.reduce((a,s)=>a+s.position.x,0)/this.pFleet.ships.length);
    this.pFleet.position.globalY = Math.round(this.pFleet.ships.reduce((a,s)=>a+s.position.y,0)/this.pFleet.ships.length);
    this.contactHistory.push({t:this.turn, c:this.intel.playerContacts.length});
  }

  doCombat() {
    const env = { timeOfDay: 'day' as const, weather: 'clear' as const, seaState: 1 as const, smoke: 0 };

    // Check what each player ship can detect
    const playerDetects: Map<string, Array<{ enemy: NavalShip; sensor: string; level: string }>> = new Map();
    for (const ps of this.pFleet.ships) {
      const detected: Array<{ enemy: NavalShip; sensor: string; level: string }> = [];
      for (const es of this.eFleet.ships) {
        const dx = ps.position.x - es.position.x, dy = ps.position.y - es.position.y;
        const dist = Math.sqrt(dx*dx+dy*dy);

        const vis = detectNavalTarget({ observer: ps, target: es, sensorType: 'visual', environment: env, distance: dist, lineOfSightBlocked: false });
        const radar = detectNavalTarget({ observer: ps, target: es, sensorType: 'surface_radar', environment: env, distance: dist, lineOfSightBlocked: false });
        const sonar = detectNavalTarget({ observer: ps, target: es, sensorType: 'sonar', environment: env, distance: dist, lineOfSightBlocked: false });

        if (vis.success && vis.detectionLevel !== 'none') {
          detected.push({ enemy: es, sensor: 'visual', level: vis.detectionLevel });
        } else if (radar.success && radar.detectionLevel !== 'none') {
          detected.push({ enemy: es, sensor: 'radar', level: radar.detectionLevel });
        } else if (sonar.success && sonar.detectionLevel !== 'none') {
          detected.push({ enemy: es, sensor: 'sonar', level: sonar.detectionLevel });
        }
      }
      if (detected.length > 0) playerDetects.set(ps.name, detected);
    }

    // Only fire at detected targets, and only with sufficient detection level
    for (const [psName, detected] of playerDetects) {
      const ps = this.pFleet.ships.find(s => s.name === psName)!;
      for (const d of detected) {
        const es = d.enemy;
        const dist = Math.sqrt((ps.position.x-es.position.x)**2 + (ps.position.y-es.position.y)**2);

        // Need classified+ for guns, detected+ for torpedoes
        const canGun = d.level === 'classified' || d.level === 'identified' || d.level === 'tracked';
        const canTorp = (d.level === 'detected' || canGun) && ps.shipClass === 'destroyer' && dist < 10;
        const fireChance = d.level === 'tracked' ? 0.8 : d.level === 'identified' ? 0.7 : d.level === 'classified' ? 0.5 : d.level === 'detected' ? 0.3 : 0;

        if (canTorp && Math.random() < fireChance) {
          const r = applyNavalDamage({ ship: es, hitLocation: 'midships', damageType: 'torpedo_hit', penetration: 60, explosivePower: 35, underwater: true, turn: this.turn });
          es.damage = r.ship.damage;
          for (const e of r.events) this.events.push(`TORPEDO [${d.sensor}:${d.level}] ${ps.name} → ${es.name}: ${e.description}`);
          this.recordKill(es, ps, 'Torpedo');
          console.log(`  🎯 ${ps.name} [${d.sensor}:${d.level}] → ${es.name}: TORPEDO @ ${dist.toFixed(0)}u`);
        } else if (canGun && dist < 20 && Math.random() < fireChance * 0.7) {
          const r = applyNavalDamage({ ship: es, hitLocation: 'midships', damageType: 'shell_hit', penetration: 40, explosivePower: 15, underwater: false, turn: this.turn });
          es.damage = r.ship.damage;
          for (const e of r.events) this.events.push(`GUNS [${d.sensor}:${d.level}] ${ps.name} → ${es.name}: ${e.description}`);
          this.recordKill(es, ps, 'Naval Gun');
          console.log(`  🎯 ${ps.name} [${d.sensor}:${d.level}] → ${es.name}: GUNS @ ${dist.toFixed(0)}u`);
        }
      }
    }

    // Enemy retaliates: check what they can see
    const enemyDetects: Map<string, Array<{ enemy: NavalShip; sensor: string; level: string }>> = new Map();
    for (const es of this.eFleet.ships) {
      const detected: Array<{ enemy: NavalShip; sensor: string; level: string }> = [];
      for (const ps of this.pFleet.ships) {
        const dx = es.position.x - ps.position.x, dy = es.position.y - ps.position.y;
        const dist = Math.sqrt(dx*dx+dy*dy);
        const vis = detectNavalTarget({ observer: es, target: ps, sensorType: 'visual', environment: env, distance: dist, lineOfSightBlocked: false });
        const radar = detectNavalTarget({ observer: es, target: ps, sensorType: 'surface_radar', environment: env, distance: dist, lineOfSightBlocked: false });
        if ((vis.success && vis.detectionLevel !== 'none') || (radar.success && radar.detectionLevel !== 'none')) {
          detected.push({ enemy: ps, sensor: vis.success ? 'visual' : 'radar', level: vis.success ? vis.detectionLevel : radar.detectionLevel });
        }
      }
      if (detected.length > 0) enemyDetects.set(es.name, detected);
    }

    for (const [esName, detected] of enemyDetects) {
      const es = this.eFleet.ships.find(s => s.name === esName)!;
      for (const d of detected) {
        const ps = d.enemy;
        const dist = Math.sqrt((es.position.x-ps.position.x)**2 + (es.position.y-ps.position.y)**2);
        const level = d.level;
        if ((level === 'classified' || level === 'identified' || level === 'tracked') && dist < 20 && Math.random() < 0.4) {
          const r = applyNavalDamage({ ship: ps, hitLocation: 'midships', damageType: 'shell_hit', penetration: 30, explosivePower: 10, underwater: false, turn: this.turn });
          ps.damage = r.ship.damage;
          for (const e of r.events) this.events.push(`RETURN [${d.sensor}:${d.level}] ${es.name} → ${ps.name}: ${e.description}`);
          this.recordKill(ps, es, 'Naval Gun');
          console.log(`  🔫 ${es.name} [${d.sensor}:${d.level}] → ${ps.name}: RETURN FIRE @ ${dist.toFixed(0)}u`);
        }
      }
    }
  }

  recordKill(victim: NavalShip, killer: NavalShip, weapon: string) {
    if (victim.damage.status !== 'sinking' && victim.damage.status !== 'sunk') return;
    if (this.kills.find(k => k.victim === victim.name)) return;
    this.kills.push({ victim: victim.name, victimClass: victim.shipClass, killer: killer.name, killerClass: killer.shipClass, weapon, turn: this.turn, desc: `${killer.name} ${weapon} sank ${victim.name}` });
  }
}

// ===== MAIN =====
async function main() {
  console.log(`\n⚓ PACIFIC COMMAND: LLM CAMPAIGN (8 turns, 5v5, with aircraft)\n`);
  const g = new Game();
  const history: TurnRec[] = [];

  for (let t = 0; t < 8; t++) {
    console.log(`\n━━━ TURN ${t+1} ━━━`);

    // Launch aircraft on turn 2+
    if (t >= 2) { g.launchAircraft(g.pFleet, 3, 'p'); g.launchAircraft(g.eFleet, 2, 'e'); }

    // Detection summary before LLM
    let detReport = '';
    for (const ps of g.pFleet.ships) {
      for (const es of g.eFleet.ships) {
        const dx = ps.position.x - es.position.x, dy = ps.position.y - es.position.y;
        const dist = Math.sqrt(dx*dx+dy*dy);
        const vis = detectNavalTarget({ observer: ps, target: es, sensorType: 'visual', environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, smoke: 0 }, distance: dist, lineOfSightBlocked: false });
        const radar = detectNavalTarget({ observer: ps, target: es, sensorType: 'surface_radar', environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, smoke: 0 }, distance: dist, lineOfSightBlocked: false });
        if (vis.success) detReport += `  👁️ ${ps.name} sees ${es.name}: [${vis.detectionLevel}] dist ${dist.toFixed(0)}u\n`;
        else if (radar.success) detReport += `  📡 ${ps.name} radar ${es.name}: [${radar.detectionLevel}] dist ${dist.toFixed(0)}u\n`;
        else if (dist < 40) detReport += `  ❌ ${ps.name} can't see ${es.name}: dist ${dist.toFixed(0)}u (vis range ${ps.sensors.visualRange})\n`;
      }
    }
    if (detReport) console.log(detReport.trimEnd());
    else console.log(`  🔍 No ships in detection range`);

    // LLM
    let pPlan = '', ePlan = '';
    try { pPlan = await ask('You command a US carrier task force in the Pacific. Tactical assessment and orders.', playerCtx(g)); } catch {}
    try { ePlan = await ask('You command an Imperial Japanese surface group. Tactical assessment and orders.', enemyCtx(g)); } catch {}
    console.log(`  🔵 ${pPlan.slice(0,130)}`);
    console.log(`  🔴 ${ePlan.slice(0,130)}`);

    g.doCombat();
    g.advance();
    await sleep(500);

    history.push({
      turn: g.turn, playerPlan: pPlan, enemyPlan: ePlan,
      events: [...g.events.slice(-10)],
      kills: [...g.kills],
      playerAircraft: g.pAircraft.map(a => ({ name: a.name, cls: a.aircraftClass, status: a.status, x: Math.round(a.position.x), y: Math.round(a.position.y), hdg: a.headingDeg, spd: a.speedKts, fuel: a.fuel, mission: a.status })),
      enemyAircraft: g.eAircraft.map(a => ({ name: a.name, cls: a.aircraftClass, status: a.status, x: Math.round(a.position.x), y: Math.round(a.position.y), hdg: a.headingDeg, spd: a.speedKts, fuel: a.fuel, mission: a.status })),
    });
  }

  generateReports(g, history);
}

function playerCtx(g: Game): string {
  let c = `TURN ${g.turn+1}\nYOUR FORCES:\n`;
  for (const s of g.pFleet.ships) {
    const dmg = s.damage.status !== 'combat_effective' ? ` [${s.damage.status} F:${s.damage.flooding.toFixed(0)}% Fire:${s.damage.fire.toFixed(0)}%]` : '';
    const ac = s.aircraft ? ` CV:${s.aircraft.fighters}F/${s.aircraft.diveBombers}DB/${s.aircraft.torpedoBombers}TB` : '';
    c += `  ${s.name}(${s.shipClass}) (${s.position.x.toFixed(0)},${s.position.y.toFixed(0)}) HDG${s.headingDeg} SPD${s.speedKts}kt${ac}${dmg}\n`;
  }
  c += `\nAIRCRAFT: ${g.pAircraft.length} airborne\n`;
  for (const a of g.pAircraft) c += `  ${a.name}(${a.aircraftClass}) (${a.position.x.toFixed(0)},${a.position.y.toFixed(0)}) HDG${a.headingDeg} SPD${a.speedKts} Fuel:${a.fuel} Bombs:${a.ammo.bombs} Status:${a.status}\n`;
  c += `\nCONTACTS(${g.intel.playerContacts.length}): `;
  if (g.intel.playerContacts.length === 0) c += 'NONE\n';
  else for (const ct of g.intel.playerContacts) c += `\n  [${ct.detectionLevel}] ${ct.estimatedClass||'?'} ±${ct.uncertaintyRadius.toFixed(0)}`;
  const recent = g.events.slice(-5);
  if (recent.length > 0) { c += `\n\nRECENT:\n`; for (const e of recent) c += `  ${e}\n`; }
  return c;
}

function enemyCtx(g: Game): string {
  let c = `TURN ${g.turn+1}\nYOUR FORCES:\n`;
  for (const s of g.eFleet.ships) {
    const dmg = s.damage.status !== 'combat_effective' ? ` [${s.damage.status} F:${s.damage.flooding.toFixed(0)}%]` : '';
    c += `  ${s.name}(${s.shipClass}) (${s.position.x.toFixed(0)},${s.position.y.toFixed(0)}) HDG${s.headingDeg} SPD${s.speedKts}kt${dmg}\n`;
  }
  let detected = false;
  for (const es of g.eFleet.ships) for (const ps of g.pFleet.ships) {
    if (Math.sqrt((ps.position.x-es.position.x)**2+(ps.position.y-es.position.y)**2) < es.sensors.visualRange) detected = true;
  }
  c += `\nCONTACTS: ${detected ? `US carrier group near (${g.pFleet.position.globalX},${g.pFleet.position.globalY})` : 'None'}\n`;
  return c;
}

function generateReports(g: Game, h: TurnRec[]) {
  console.log(`\n\n${'═'.repeat(50)}`);
  console.log(`  TRI-PERSPECTIVE BATTLE REPORT`);
  console.log(`${'═'.repeat(50)}`);

  // PLAYER
  console.log(`\n🔵 PLAYER VIEW (Contacts Only):`);
  for (const s of g.pFleet.ships) {
    const d = s.damage.status !== 'combat_effective' ? ` ⚠️${s.damage.status}` : '';
    console.log(`  ${s.name} (${s.shipClass}) HDG${s.headingDeg}° SPD${s.speedKts}kt${d}`);
  }
  console.log(`  ✈️ Aircraft: ${g.pAircraft.length} airborne`);
  for (const a of g.pAircraft) console.log(`    ${a.name}(${a.aircraftClass}) (${a.position.x.toFixed(0)},${a.position.y.toFixed(0)}) SPD${a.speedKts} Fuel:${a.fuel}`);
  console.log(`  Contacts: ${g.intel.playerContacts.length}`);
  for (const c of g.intel.playerContacts) console.log(`    [${c.detectionLevel}] ${c.estimatedClass||'?'} ±${c.uncertaintyRadius.toFixed(0)}`);

  // ENEMY
  console.log(`\n🔴 ENEMY VIEW:`);
  for (const s of g.eFleet.ships) {
    const d = s.damage.status !== 'combat_effective' ? ` ⚠️${s.damage.status}` : '';
    console.log(`  ${s.name} (${s.shipClass}) HDG${s.headingDeg}° SPD${s.speedKts}kt${d}`);
  }
  console.log(`  ✈️ Aircraft: ${g.eAircraft.length} airborne`);
  for (const a of g.eAircraft) console.log(`    ${a.name}(${a.aircraftClass}) (${a.position.x.toFixed(0)},${a.position.y.toFixed(0)}) SPD${a.speedKts}`);

  // GOD
  console.log(`\n🟣 GOD EYE (Full):`);
  console.log(`  Turns: ${g.turn} | Combat events: ${g.events.length}`);
  console.log(`\n  PLAYER FLEET:`);
  for (const s of g.pFleet.ships) console.log(`    ${s.name} (${s.shipClass}) pos(${s.position.x.toFixed(0)},${s.position.y.toFixed(0)}) HDG${s.headingDeg}° SPD${s.speedKts}kt` + (s.damage.status !== 'combat_effective' ? ` [${s.damage.status} F:${s.damage.flooding.toFixed(0)}% Fire:${s.damage.fire.toFixed(0)}%]` : ''));
  console.log(`    ✈️ ${g.pAircraft.length} aircraft:`);
  for (const a of g.pAircraft) console.log(`      ${a.name} ${a.aircraftClass} (${a.position.x.toFixed(0)},${a.position.y.toFixed(0)}) HDG${a.headingDeg} SPD${a.speedKts} Fuel:${a.fuel} Bombs:${a.ammo.bombs} Status:${a.status}`);

  console.log(`\n  ENEMY FLEET:`);
  for (const s of g.eFleet.ships) console.log(`    ${s.name} (${s.shipClass}) pos(${s.position.x.toFixed(0)},${s.position.y.toFixed(0)}) HDG${s.headingDeg}° SPD${s.speedKts}kt` + (s.damage.status !== 'combat_effective' ? ` [${s.damage.status} F:${s.damage.flooding.toFixed(0)}% Fire:${s.damage.fire.toFixed(0)}%]` : ''));
  console.log(`    ✈️ ${g.eAircraft.length} aircraft:`);
  for (const a of g.eAircraft) console.log(`      ${a.name} ${a.aircraftClass} (${a.position.x.toFixed(0)},${a.position.y.toFixed(0)}) HDG${a.headingDeg} SPD${a.speedKts}`);

  // KILLS
  console.log(`\n💀 KILL ATTRIBUTION:`);
  if (g.kills.length === 0) console.log(`  No ships sunk`);
  else for (const k of g.kills) console.log(`  ${k.victim}(${k.victimClass}) — ${k.weapon} from ${k.killer}(${k.killerClass}) at Turn ${k.turn}: ${k.desc}`);

  // Events
  console.log(`\n⚔️ ALL EVENTS:`);
  for (const e of g.events.slice(-30)) console.log(`  ${e}`);

  // Turn-by-turn LLM
  console.log(`\n🤖 LLM HISTORY:`);
  for (const t of h) {
    console.log(`  T${t.turn} P: ${t.playerPlan.slice(0,80)}`);
    console.log(`  T${t.turn} E: ${t.enemyPlan.slice(0,80)}`);
    if (t.kills.length > 0) for (const k of t.kills.filter(x => x.turn === t.turn)) console.log(`    💀 ${k.desc}`);
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
main().catch(e => console.error(e));
