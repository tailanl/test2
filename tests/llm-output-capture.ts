import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runAITurnPipeline } from '../src/ai/ai-turn-pipeline';
import { createCampaignMemory } from '../src/ai/campaign-memory';
import { createTraceId, type LLMDecisionProviderResult, type LLMOutputTrace } from '../src/ai/llm-output-trace';
import { createShipForClass } from '../src/game/naval/naval-debug';
import type { LLMCommanderDecision } from '../src/ai/llm-decision-types';
import type { NavalContact } from '../src/game/naval/intel/naval-intel-types';
import type { StrategicFleet } from '../src/game/naval/naval-strategic-types';

const outputDir = process.env.LLM_OUTPUT_DIR || join(process.cwd(), 'artifacts', 'llm-outputs', new Date().toISOString().replace(/[:.]/g, '-'));
const scenarios: Array<Record<string, unknown>> = [];

function contact(id: string, detectionLevel: NavalContact['detectionLevel'], x = 420, y = 520): NavalContact {
  return {
    id,
    originalEntityId: `${id}_ship`,
    contactType: 'surface_ship',
    detectionLevel,
    factionEstimate: 'enemy',
    estimatedClass: 'battleship',
    estimatedCount: 1,
    lastKnownPosition: { x, y },
    uncertaintyRadius: detectionLevel === 'tracked' ? 8 : 60,
    lastDetectedTurn: 1,
    confidence: detectionLevel === 'tracked' ? 'high' : 'medium',
    detectedBy: [],
    trackHistory: [],
    stale: false,
  };
}

function fleet(): StrategicFleet {
  const cv = createShipForClass('fleet_carrier', 'player', 'CV Test', 700, 500, 270, 20, 'carrier');
  return {
    id: 'tf_test',
    name: 'TF Test',
    faction: 'player',
    type: 'carrier_task_force',
    position: { regionX: 0, regionY: 0, chunkX: 0, chunkY: 0, globalX: 700, globalY: 500 },
    ships: [cv],
    command: {
      controller: 'player_direct',
      riskTolerance: 'medium',
      engagementPolicy: 'carrier_strike_only',
      preserveCapitalShips: true,
    },
    mission: 'patrol',
    fuelState: 'good',
    ammoState: 'good',
    airGroupState: 'ready',
    detectedByPlayer: true,
  };
}

function campaignState(contacts: NavalContact[] = []): any {
  return {
    currentTurn: 2,
    date: '1942-06-04',
    currentPhase: 'carrier_turning_point_1942',
    fleets: [fleet()],
    intel: {
      turn: 2,
      playerContacts: contacts,
      enemyContacts: [],
      knownFriendlyFleets: [],
      fogTiles: {},
      searchMissions: [],
      contactReports: [],
    },
    reports: [],
    battleLog: [],
    airOperations: [],
    facilities: [{ id: 'base_1', name: 'Forward Base', faction: 'player', type: 'naval_base', x: 700, y: 500 }],
    weather: 'clear',
  };
}

function decision(action: LLMCommanderDecision['decisions'][number], assessment: string): LLMCommanderDecision {
  return {
    assessment,
    intent: action.type === 'launch_strike' ? 'strike' : action.type === 'launch_search' ? 'search' : 'hold',
    confidence: 'high',
    risk: 'medium',
    decisions: [action],
    assumptions: ['diagnostic fixture'],
    informationGaps: [],
    abortConditions: ['carrier disabled'],
    nextReviewTurn: 3,
  };
}

function providerResult(name: string, output: LLMCommanderDecision): LLMDecisionProviderResult {
  const now = new Date().toISOString();
  const rawOutput = JSON.stringify(output, null, 2);
  return {
    decision: output,
    trace: {
      id: createTraceId(`diagnostic_${name}`, output.nextReviewTurn),
      source: 'diagnostic',
      provider: 'mock-deepseek',
      model: 'deepseek-chat',
      role: 'player_advisor',
      faction: 'player',
      turn: 2,
      startedAt: now,
      endedAt: now,
      durationMs: 0,
      prompt: {
        system: 'Diagnostic fixture system prompt',
        user: `Diagnostic fixture ${name}`,
      },
      rawOutput,
      parsedDecision: output,
      metadata: { deterministic: true, scenario: name },
    },
  };
}

async function runScenario(name: string, contacts: NavalContact[], output: LLMCommanderDecision): Promise<void> {
  const state = campaignState(contacts);
  const traces: LLMOutputTrace[] = [];
  const result = await runAITurnPipeline({
    faction: 'player',
    mode: 'commander',
    state,
    memory: createCampaignMemory(),
    skipVisualAssessment: true,
    decisionProvider: () => providerResult(name, output),
    llmTraceSink: (trace) => traces.push(trace),
  });

  const record = {
    scenario: name,
    traces,
    validation: result.validation,
    executionReport: result.executionReport,
    stateDiff: result.stateDiff,
  };
  scenarios.push({
    scenario: name,
    traceCount: traces.length,
    accepted: result.validation?.acceptedActions.length ?? 0,
    rejected: result.validation?.rejectedActions.length ?? 0,
    executed: result.execution?.executed.length ?? 0,
    failed: result.execution?.failed.length ?? 0,
  });
  await writeFile(join(outputDir, `${name}.json`), JSON.stringify(record, null, 2));
}

function fakeGLMTrace(): LLMOutputTrace {
  const now = new Date().toISOString();
  const rawOutput = JSON.stringify({
    assessment: 'No confirmed enemy contacts. Search coverage is the priority.',
    bearingSummary: 'No bearing available',
    threatRanking: [],
    recommendation: 'Launch sector search and keep CAP ready.',
  }, null, 2);
  return {
    id: createTraceId('diagnostic_glm_visual', 2),
    source: 'visual_assessment',
    provider: 'mock-z.ai',
    model: 'glm-4.6v-flashx',
    role: 'visual_assessor',
    faction: 'player',
    turn: 2,
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    prompt: { user: 'Diagnostic visual assessment fixture' },
    rawOutput,
    parsedOutput: JSON.parse(rawOutput),
    metadata: { deterministic: true, scenario: 'glm-visual-assessment' },
  };
}

await mkdir(outputDir, { recursive: true });

await runScenario('commander-launch-search', [], decision({
  type: 'launch_search',
  fleetId: 'tf_test',
  searchArcDeg: { centerDeg: 250, widthDeg: 90, range: 140 },
  priority: 1,
  reason: 'No contacts; search likely enemy axis',
}, 'Search before strike'));

await runScenario('commander-rejected-weak-strike', [contact('weak_1', 'suspected')], decision({
  type: 'launch_strike',
  fleetId: 'tf_test',
  contactId: 'weak_1',
  priority: 1,
  reason: 'Diagnostic illegal strike should be rejected',
}, 'Unsafe strike attempt'));

await runScenario('commander-tracked-strike', [contact('track_1', 'tracked')], decision({
  type: 'launch_strike',
  fleetId: 'tf_test',
  contactId: 'track_1',
  priority: 1,
  reason: 'Tracked contact is valid strike target',
}, 'Strike confirmed contact'));

const glmTrace = fakeGLMTrace();
await writeFile(join(outputDir, 'glm-visual-assessment.json'), JSON.stringify({ scenario: 'glm-visual-assessment', traces: [glmTrace] }, null, 2));
scenarios.push({ scenario: 'glm-visual-assessment', traceCount: 1, accepted: 0, rejected: 0, executed: 0, failed: 0 });

await writeFile(join(outputDir, 'index.json'), JSON.stringify({ outputDir, scenarios }, null, 2));
console.log(`LLM output traces saved to ${outputDir}`);
console.log(`LLM output scenarios: ${scenarios.length}`);
