import { generateNavalMap } from './game/naval/naval-map-generator';
import { updateShipMotion } from './game/naval/ship/ship-motion';
import { createDefaultModulesForShipClass } from './game/naval/ship/ship-modules';
import { applyNavalDamage } from './game/naval/ship/ship-damage';
import { updateDamageControl } from './game/naval/ship/ship-damage-control';
import { detectNavalTarget } from './game/naval/intel/naval-visibility';
import { createDefaultIntelState } from './game/naval/intel/naval-intel-types';
import { updateNavalIntelState, decayNavalContacts } from './game/naval/intel/naval-contact-tracker';
import { generateFleetAIActions } from './game/naval/ai/naval-fleet-ai';
import { createShipForClass } from './game/naval/naval-debug';
import { createDefaultAircraft } from './game/naval/air/aircraft-types';
import { isTargetInForwardCone } from './game/naval/air/aircraft-attack';

function main() {
  let ok=0, fail=0;
  function t(n: string, fn: () => boolean) {
    try { if(fn()) { ok++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}`); } }
    catch(e: any) { fail++; console.log(`  💥 ${n}: ${String(e).slice(0,80)}`); }
  }

  console.log('\n══════ NAVAL HEADLESS TEST SUITE ══════\n');

  // MAP
  console.log('📐 MAP GENERATION');
  const map = generateNavalMap({ width: 1024, height: 1024, seed: 42 });
  t('Generate 1024x1024 Pacific map', () => map.overlay.length===1024 && map.overlay[0].length===1024);
  t('Has islands', () => map.overlay.flat().some(c=>c.seaZoneType==='island'));
  t('Has deep ocean', () => map.overlay.flat().some(c=>c.seaZoneType==='deep_ocean'));
  t('Has ports/naval bases', () => map.facilities.some(f=>f.type==='port'||f.type==='naval_base'));
  t('Has airfields', () => map.facilities.some(f=>f.type==='airfield'));
  t('Shipping lanes exist', () => map.shippingLanes.length>0);
  console.log(`  (${map.facilities.length} facilities, ${map.shippingLanes.length} lanes)\n`);

  // SHIP
  console.log('🚢 SHIP MOTION');
  const ship = createShipForClass('destroyer','player','DD Test',100,200,0,10,'screen');
  t('Factory creates valid ship', () => ship.name==='DD Test' && ship.motion.maxSpeedKts>0);
  const accel = updateShipMotion({...ship,speedKts:10,targetSpeedKts:25},5);
  t('Speed accelerates', () => accel.speedKts>15);
  const turn = updateShipMotion({...ship,speedKts:20,rudderDeg:15},3);
  t('Rudder changes heading', () => turn.headingDeg!==0);
  t('Cannot turn at zero speed', () => updateShipMotion({...ship,speedKts:0,rudderDeg:30},5).headingDeg===0);
  const move = updateShipMotion({...ship,speedKts:25,headingDeg:90},3);
  t('Position changes', () => move.position.x!==ship.position.x);
  console.log(`  Speed: ${accel.speedKts.toFixed(1)}kt  Turn: ${turn.headingDeg.toFixed(1)}deg  Move: (${move.position.x.toFixed(1)},${move.position.y.toFixed(1)})\n`);

  // MODULES
  console.log('🔧 MODULES');
  t('Carrier has flight deck + hangar', () => { const m=createDefaultModulesForShipClass('fleet_carrier'); return m.some(x=>x.type==='flight_deck')&&m.some(x=>x.type==='hangar'); });
  t('BB has 2+ main batteries', () => createDefaultModulesForShipClass('battleship').filter(x=>x.type==='main_battery').length>=2);
  t('DD has torpedo tubes', () => createDefaultModulesForShipClass('destroyer').some(x=>x.type==='torpedo_tubes'));
  t('SS has sonar', () => createDefaultModulesForShipClass('submarine').some(x=>x.type==='sonar'));
  console.log('');

  // DAMAGE
  console.log('💥 DAMAGE');
  const bb = createShipForClass('battleship','enemy','BB Target',0,0,0,15,'surface_combatant');
  t('Shell hit reduces hull', () => applyNavalDamage({ship:bb,hitLocation:'midships',damageType:'shell_hit',penetration:50,explosivePower:10,underwater:false,turn:1}).ship.damage.hullIntegrity<100);
  const torpR = applyNavalDamage({ship:bb,hitLocation:'midships',damageType:'torpedo_hit',penetration:60,explosivePower:35,underwater:true,turn:1});
  t('Torpedo causes flooding', () => torpR.ship.damage.flooding>20);
  t('Torpedo generates events', () => torpR.events.length>0);
  const cv = createShipForClass('fleet_carrier','player','CV',0,0,0,15,'carrier');
  t('Bomb hits flight deck', () => applyNavalDamage({ship:cv,hitLocation:'superstructure',damageType:'bomb_hit',penetration:40,explosivePower:25,underwater:false,turn:1}).ship.damage.aircraftOperationPenalty>0);
  let sunk=0; for(let i=0;i<20;i++){ const r=applyNavalDamage({ship:bb,hitLocation:'forward',damageType:'magazine_explosion',penetration:100,explosivePower:100,underwater:false,turn:1}); if(r.ship.damage.status==='sinking'||r.ship.damage.status==='sunk')sunk++; }
  t('Magazine → sinking (>40%)', () => sunk>8);
  console.log(`  Torpedo flood:${torpR.ship.damage.flooding.toFixed(1)}%  Magazine sunk:${sunk}/20\n`);

  // DC
  console.log('🛟 DAMAGE CONTROL');
  const dcShip = torpR.ship;
  const fb = dcShip.damage.flooding;
  const dcR = updateDamageControl(dcShip,10);
  t('Pump reduces flooding', () => dcR.ship.damage.flooding<fb);
  console.log(`  Flood: ${fb.toFixed(1)}→${dcR.ship.damage.flooding.toFixed(1)}%\n`);

  // DETECTION
  console.log('🔭 DETECTION');
  const obs = createShipForClass('destroyer','player','DD Scout',0,0,0,10,'picket');
  const en = createShipForClass('battleship','enemy','BB Far',15,0,180,15,'surface_combatant');
  const env = {timeOfDay:'day' as const,weather:'clear' as const,seaState:1 as const,smoke:0};
  t('Visual: day clear', () => detectNavalTarget({observer:obs,target:en,sensorType:'visual',environment:env,distance:15,lineOfSightBlocked:false}).success);
  t('Visual: fog blocks', () => !detectNavalTarget({observer:obs,target:en,sensorType:'visual',environment:{...env,weather:'fog'},distance:15,lineOfSightBlocked:false}).success);
  t('Radar: works at night', () => detectNavalTarget({observer:obs,target:en,sensorType:'surface_radar',environment:{...env,timeOfDay:'night'},distance:15,lineOfSightBlocked:false}).success);
  console.log('');

  // INTEL
  console.log('🕵️ INTEL');
  const intelR = updateNavalIntelState({intel:createDefaultIntelState(),currentTurn:1,friendlyShips:[obs],enemyShips:[en],friendlyAirMissions:[],environment:{timeOfDay:'day',weather:'clear',seaState:1,windDirectionDeg:0,windSpeedKts:0,visibilityModifier:1},overlay:[]});
  t('Creates contacts on detection', () => intelR.intel.playerContacts.length>0);
  const c0:any = {id:'c1',originalEntityId:'e1',lastDetectedTurn:1,detectionLevel:'tracked',uncertaintyRadius:3,trackHistory:[],detectedBy:[],confidence:'high',stale:false,lastKnownPosition:{x:0,y:0}};
  const dec = decayNavalContacts({contacts:[c0],currentTurn:10,staleAfterTurns:2});
  t('Contact decay: tracked degrades', () => dec[0].detectionLevel!=='tracked');
  const c1:any = {...c0,detectionLevel:'lost',lastDetectedTurn:1,uncertaintyRadius:3};
  const dec2 = decayNavalContacts({contacts:[c1],currentTurn:10,staleAfterTurns:2});
  t('Lost contact radius grows', () => dec2[0].uncertaintyRadius>5);
  console.log(`  Contacts:${intelR.intel.playerContacts.length}  Decay:${dec[0].detectionLevel}  Radius:${dec2[0].uncertaintyRadius.toFixed(1)}\n`);

  // AI
  console.log('🤖 AI');
  const aiCV = createShipForClass('fleet_carrier','player','CV AI',0,0,0,15,'carrier');
  const fl:any = {id:'f1',name:'TF1',faction:'player',type:'carrier_task_force',ships:[aiCV],position:{globalX:0,globalY:0}};
  const aiIn:any = {friendlyFleets:[fl],friendlyShips:[aiCV],contacts:[],intel:createDefaultIntelState(),reports:[],mission:{controller:'player_direct',riskTolerance:'medium',engagementPolicy:'carrier_strike_only',preserveCapitalShips:true},environment:{timeOfDay:'day',weather:'clear',seaState:1,windDirectionDeg:0,windSpeedKts:0,visibilityModifier:1}};
  const acts = generateFleetAIActions(aiIn);
  t('Fleet AI generates actions', () => acts.length>0);
  t('No enemyShips in AI input', () => !('enemyShips'in aiIn) && !('enemyFleets'in aiIn));
  console.log(`  Actions: ${acts.length}\n`);

  // AIRCRAFT
  console.log('✈️ AIRCRAFT');
  const f6f = createDefaultAircraft('fighter','player','F6F',0,0,0,250);
  const tbf = createDefaultAircraft('torpedo_bomber','player','TBF',0,0,0,150);
  t('Fighter faster', () => f6f.motion.maxSpeedKts>tbf.motion.maxSpeedKts);
  t('Front in cone', () => isTargetInForwardCone({attackerPosition:{x:0,y:0},attackerHeadingDeg:0,targetPosition:{x:5,y:0},forwardArcDeg:20,minRange:1,maxRange:8}).inCone);
  t('Behind blocked', () => !isTargetInForwardCone({attackerPosition:{x:0,y:0},attackerHeadingDeg:0,targetPosition:{x:-5,y:0},forwardArcDeg:20,minRange:1,maxRange:8}).inCone);
  console.log('');

  console.log(`══════════════════════════════`);
  console.log(`  TOTAL: ${ok+fail}  ✅ ${ok}  ❌ ${fail}`);
  console.log(`  RATE: ${((ok/(ok+fail))*100).toFixed(1)}%`);
  console.log(`══════════════════════════════\n`);
  return {ok,fail};
}

main();
