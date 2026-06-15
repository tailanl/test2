/**
 * Strategic Director - 战略层 AI
 * JSON schema 输出，受 validator 约束
 */
import type { PacificCampaignState, PacificObjective } from '../../game/naval/campaign/campaign-types';
import { getAPIKey } from '../api-key';

// ========== Schema ==========
export interface StrategicDirective {
  objectiveId: string;
  intent: 'defend'|'raid'|'interdict'|'capture'|'support_landing'|'seek_decisive_battle'|'avoid_decisive_battle';
  targetRegionId?: string;
  targetBaseId?: string;
  riskTolerance: 'low'|'medium'|'high';
  reason: string;
}

export interface PacificStrategicDecision {
  assessment: string;
  selectedObjectiveId: string;
  directive: StrategicDirective;
  assumptions: string[];
  risks: string[];
  requiredIntel: string[];
  nextReviewTurn: number;
}

// ========== 调用 ==========
export async function getStrategicDecision(
  state: PacificCampaignState,
  contacts: Array<{ level: string; class: string; x: number; y: number }>,
  recentReports: string[]
): Promise<PacificStrategicDecision | null> {
  const key = getAPIKey();
  if (!key) return null;

  const ctx = buildStrategicContext(state, contacts, recentReports);
  const resp = await callLLM(key, strategicPrompt, ctx);
  return parseStrategicDecision(resp, state);
}

function buildStrategicContext(state: PacificCampaignState, contacts: Array<{ level: string; class: string; x: number; y: number }>, reports: string[]): string {
  let c = `Phase: ${state.currentPhaseId}\nTurn: ${state.turn}\n\n`;
  c += `Regions:\n${state.regions.map(r => `  ${r.name} [${r.owner}] sea:${r.seaControl.player}/${r.seaControl.enemy} air:${r.airControl.player}/${r.airControl.enemy}`).join('\n')}\n`;
  c += `\nContacts: ${contacts.length}\n`;
  contacts.forEach(ct => c += `  [${ct.level}] ${ct.class} (${ct.x},${ct.y})\n`);
  c += `\nObjectives: ${state.playerObjectives.filter(o => o.status === 'active').map(o => `${o.name}[${o.type}]`).join(', ') || 'none'}\n`;
  c += `\nSupply lines: ${state.supplyLines.filter(s => s.status !== 'cut').length} open\n`;
  if (reports.length > 0) { c += `\nRecent events:\n`; reports.slice(-5).forEach(r => c += `  ${r}\n`); }
  c += `\n\nReturn JSON: {"assessment":"...","selectedObjectiveId":"...","directive":{"objectiveId":"...","intent":"...","targetRegionId":"...","riskTolerance":"low|medium|high","reason":"..."},"assumptions":[...],"risks":[...],"requiredIntel":[...],"nextReviewTurn":number}`;
  return c;
}

const strategicPrompt = `You are the Pacific Fleet Strategic Director. Assess the strategic situation and issue a directive.
You ONLY see contacts from reconnaissance, NOT real enemy positions.
Return ONLY valid JSON matching the schema.`;

async function callLLM(key: string, system: string, user: string): Promise<string> {
  const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.7, max_tokens: 500 }),
  });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return ((await r.json()) as any).choices?.[0]?.message?.content || '';
}

function parseStrategicDecision(resp: string, state: PacificCampaignState): PacificStrategicDecision | null {
  try {
    const m = resp.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);

    // Validate basic structure
    if (!parsed.assessment || !parsed.directive) return null;

    // Validate against state: objective must exist
    const obj = state.playerObjectives.find(o => o.id === parsed.selectedObjectiveId);
    if (!obj) {
      // Fallback: pick first active objective
      const first = state.playerObjectives.find(o => o.status === 'active');
      parsed.selectedObjectiveId = first?.id || 'patrol';
    }

    return {
      assessment: parsed.assessment || '',
      selectedObjectiveId: parsed.selectedObjectiveId || '',
      directive: {
        objectiveId: parsed.directive?.objectiveId || '',
        intent: parsed.directive?.intent || 'defend',
        targetRegionId: parsed.directive?.targetRegionId,
        targetBaseId: parsed.directive?.targetBaseId,
        riskTolerance: parsed.directive?.riskTolerance || 'medium',
        reason: parsed.directive?.reason || '',
      },
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      requiredIntel: Array.isArray(parsed.requiredIntel) ? parsed.requiredIntel : [],
      nextReviewTurn: typeof parsed.nextReviewTurn === 'number' ? parsed.nextReviewTurn : state.turn + 5,
    };
  } catch {
    return null;
  }
}
