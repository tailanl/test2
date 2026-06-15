/**
 * AI Regression Tests - 回归测试确保关键功能正常
 */

import { debugLLMKnowledgeIsolation, debugLLMContactBasedDecision } from '../ai/llm-decision-debug';
import { validateLLMCommanderDecision } from '../ai/llm-decision-validator';
import { buildFactionKnowledge, sanitizeKnowledgeForLLM } from '../ai/information-filter';
import { generateSearchPlan } from '../ai/search-planner';
import { assessThreat } from '../ai/threat-assessment';
import { getDoctrineForPhase } from '../ai/naval-doctrine';
import { assessIntelUncertainty } from '../ai/intel-uncertainty-model';

function assert(cond: boolean, name: string): void {
  if (!cond) { console.error(`❌ FAIL: ${name}`); process.exit(1); }
  console.log(`  ✅ ${name}`);
}

console.log('🧪 Running AI regression tests...\n');

// 1. Knowledge isolation
const isoResult = debugLLMKnowledgeIsolation();
assert(isoResult.passed, 'Knowledge isolation: hidden enemy not leaked');
assert(isoResult.illegalStrikeRejected, 'Knowledge isolation: illegal strike rejected');

// 2. Contact-based decision
const contactResult = debugLLMContactBasedDecision();
assert(contactResult.passed, 'Contact decision: suspected→rejected, classified→accepted');

// 3. Search planner
const plan = generateSearchPlan({ contacts: [], ownPosition: { x: 1000, y: 500 }, lastContactTurn: 1, currentTurn: 5 });
assert(plan.sectors.length >= 3, 'Search planner: generates default sectors');

const plan2 = generateSearchPlan({
  contacts: [{ detectionLevel: 'tracked', lastKnownPosition: { x: 800, y: 400 }, uncertaintyRadius: 10 }],
  ownPosition: { x: 1000, y: 500 }, lastContactTurn: 3, currentTurn: 4,
});
assert(plan2.sectors.length > 0, 'Search planner: generates contact-guided sectors');

// 4. Threat assessment
const threat = assessThreat({
  contacts: [{ detectionLevel: 'classified', estimatedClass: 'battleship', confidence: 'high' }],
  ownDamage: [{ flooding: 10, fire: 0, hullIntegrity: 80 }],
  supplyStatus: [{ fuelState: 'good', ammoState: 'good' }],
  weather: 'clear',
});
assert(threat.overallThreat !== undefined, 'Threat assessment: produces overall threat');
assert(threat.recommendations.length > 0, 'Threat assessment: produces recommendations');

// 5. Naval doctrine
const doctrine = getDoctrineForPhase('carrier_turning_point_1942');
assert(doctrine.type === 'carrier_centric', 'Naval doctrine: correct doctrine for phase');
assert(doctrine.rules.length > 0, 'Naval doctrine: has rules');

// 6. Intel uncertainty
const uncertainty = assessIntelUncertainty({
  contacts: [{ id: 'c1', detectionLevel: 'classified', lastDetectedTurn: 3, confidence: 'medium', stale: false }],
  currentTurn: 4, ownSensorStatus: { radarOperational: true, cicOperational: true, crewQuality: 'veteran' },
});
assert(uncertainty.overallSituationalAwareness !== undefined, 'Intel uncertainty: produces awareness level');
assert(uncertainty.contactReliability.length > 0, 'Intel uncertainty: has reliability data');

// 7. Information filter
const knowledge = buildFactionKnowledge({
  faction: 'player', currentTurn: 1,
  truth: { turn: 1, weather: 'clear', playerFleets: [], enemyFleets: [], allBases: [], allSupplyLines: [] },
  intel: { turn: 1, playerContacts: [], enemyContacts: [], knownFriendlyFleets: [], fogTiles: {}, searchMissions: [], contactReports: [] } as any,
  reports: [],
});
assert(knowledge.knownOwnFleets !== undefined, 'Info filter: builds knowledge');
assert(knowledge.knownContacts !== undefined, 'Info filter: includes contacts');
const ctx = sanitizeKnowledgeForLLM(knowledge);
assert(ctx.ownForces !== undefined, 'Sanitize: produces context');
assert(ctx.legalActionHints.length > 0, 'Sanitize: has legal action hints');

console.log(`\n✅ ALL ${7} test groups passed.`);
process.exit(0);
