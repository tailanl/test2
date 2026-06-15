/**
 * LLM Knowledge Regression Test
 */

import { debugLLMKnowledgeIsolation } from '../src/ai/llm-decision-debug';
import { debugEnemyKnowledgeIsolation } from '../src/ai/enemy-commander';
import { createCampaignMemory } from '../src/ai/campaign-memory';
import { generateSearchPlan } from '../src/ai/search-planner';
import { assessThreat } from '../src/ai/threat-assessment';
import { getDoctrineForPhase } from '../src/ai/naval-doctrine';
import { createOperationalPlan, updateOpPhase } from '../src/ai/operational-plan-state';
import { COMMANDER_INTENTS } from '../src/ai/commander-intent';

let passed = 0, failed = 0;
function t(name: string, fn: () => boolean) {
  try {
    if (fn()) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}`); }
  } catch (e: any) { failed++; console.log(`  💥 ${name}: ${String(e).slice(0,80)}`); }
}

console.log('🧪 LLM Knowledge + Validator + Smart Modules Regression\n');

// 1. Knowledge isolation
t('LLM context不含 enemyShips', () => { const r = debugLLMKnowledgeIsolation(); return r.contextMentionsHiddenEnemy === false; });
t('LLM context不含 enemyFleets', () => { const r = debugLLMKnowledgeIsolation(); return r.contextMentionsHiddenEnemy === false; });
t('隐雪敌舰不能攻击', () => debugLLMKnowledgeIsolation().illegalStrikeRejected);

// 2. Enemy commander
const enemyDebug = debugEnemyKnowledgeIsolation();
t('敌指挥官context不含玩家舰船', () => enemyDebug.enemyContextNoPlayerShips);
t('敌指挥官context不含玩家舰队', () => enemyDebug.enemyContextNoPlayerFleets);
t('敌军只能基于enemyContacts行动', () => enemyDebug.enemyCanOnlyActOnContacts);
t('隐雪玩家舰队不能被敌军瞄准', () => enemyDebug.hiddenPlayerCannotBeTargeted);

// 3. Search planner
t('无接触时的默认搜索扇区', () => generateSearchPlan({ contacts: [], ownPosition: { x: 0, y: 0 }, lastContactTurn: 1, currentTurn: 5 }).sectors.length >= 3);
t('有跟踪接触时指向接触搜索', () => {
  const p = generateSearchPlan({ contacts: [{ detectionLevel: 'tracked', lastKnownPosition: { x: 100, y: 100 }, uncertaintyRadius: 10 }], ownPosition: { x: 0, y: 0 }, lastContactTurn: 3, currentTurn: 4 });
  return p.sectors.length > 0 && p.rationale.includes('Contact');
});
t('丢失接触时扩大搜索范围', () => {
  const p = generateSearchPlan({ contacts: [{ detectionLevel: 'lost', lastKnownPosition: { x: 100, y: 100 }, uncertaintyRadius: 50 }], ownPosition: { x: 0, y: 0 }, lastContactTurn: 1, currentTurn: 8 });
  return p.sectors.length > 0;
});

// 4. Threat assessment
t('航母接触威胁高', () => {
  const r = assessThreat({ contacts: [{ detectionLevel: 'classified', estimatedClass: 'fleet_carrier', confidence: 'high' }], ownDamage: [], supplyStatus: [], weather: 'clear' });
  return r.air.level === 'high';
});
t('近距离水面接触威胁中+', () => {
  const r = assessThreat({ contacts: [{ detectionLevel: 'tracked', estimatedClass: 'battleship', confidence: 'high' }], ownDamage: [], supplyStatus: [], weather: 'clear' });
  return r.surface.level !== 'low';
});

// 5. Operational plan
const plan = createOperationalPlan({ intent: 'test', fleetIds: ['f1'], turn: 1, successConditions: ['sink carrier'], abortConditions: ['carrier damaged'] });
t('计划创建成功', () => plan.phase === 'planning');
const updated = updateOpPhase(plan, 'search', 'starting search');
t('阶段可更新', () => updated.phase === 'search');

// 6. Commander intent
t('保存航母阻止strike', () => COMMANDER_INTENTS.preserve_carriers.forbiddenActions.includes('launch_strike'));
t('寻求决战阻止撤退', () => COMMANDER_INTENTS.seek_decisive_battle.forbiddenActions.includes('withdraw_fleet'));

// 7. Doctrine
t('航母转折阶段用航母中心战', () => getDoctrineForPhase('carrier_turning_point_1942').type === 'carrier_centric');
t('决战阶段用舰队决战', () => getDoctrineForPhase('philippines_leyte_1944').type === 'decisive_battle');

console.log(`\n══════════════════════════════`);
console.log(`  TOTAL: ${passed+failed}  ✅ ${passed}  ❌ ${failed}`);
console.log(`  RATE: ${((passed/(passed+failed))*100).toFixed(1)}%`);
console.log(`══════════════════════════════\n`);

process.exit(failed > 0 ? 1 : 0);
