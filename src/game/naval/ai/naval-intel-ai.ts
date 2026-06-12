/**
 * 情报 AI - 分析 contact 并生成情报报告
 */

import type { NavalIntelState, NavalContact } from '../intel/naval-intel-types';
import type { NavalAIInput, NavalAIAction, NavalAIReport, NavalReportType } from './naval-ai-types';

let actionIdCounter = 0;
function nextId(): string { actionIdCounter++; return `intel_${actionIdCounter}`; }

export function generateIntelAIActions(input: NavalAIInput): NavalAIAction[] {
  const { contacts, intel } = input;
  const actions: NavalAIAction[] = [];

  // 检查是否有需要升级的接触
  for (const contact of contacts) {
    if (contact.detectionLevel === 'suspected') {
      // 需要更多侦察
      actions.push({
        id: nextId(),
        type: 'launch_search',
        targetContactId: contact.id,
        targetPosition: contact.lastKnownPosition,
        reason: 'Intel recommends searching suspected contact for upgrade',
        basedOnContactIds: [contact.id],
      });
    }
  }

  return actions;
}

export function generateIntelReports(
  intel: NavalIntelState,
  contacts: NavalContact[],
  currentTurn: number
): NavalAIReport[] {
  const reports: NavalAIReport[] = [];

  // 按探测等级汇总
  const tracked = contacts.filter((c) => c.detectionLevel === 'tracked');
  const identified = contacts.filter((c) => c.detectionLevel === 'identified');
  const classified = contacts.filter((c) => c.detectionLevel === 'classified');
  const detected = contacts.filter((c) => c.detectionLevel === 'detected');
  const suspected = contacts.filter((c) => c.detectionLevel === 'suspected');
  const lost = contacts.filter((c) => c.detectionLevel === 'lost');

  if (contacts.length === 0) {
    reports.push({
      id: `intel_report_${currentTurn}_0`,
      turn: currentTurn,
      type: 'CONTACT_REPORT',
      title: 'Intelligence Summary',
      summary: 'No enemy contacts detected. Situation unclear.',
      facts: ['No contacts on sensors', 'No reports from search aircraft'],
      estimates: ['Enemy may be outside sensor range', 'Recommend expanding search operations'],
      contacts: [],
      damagedShips: [],
      recommendations: [
        { text: 'Launch long-range search aircraft', urgency: 'medium' },
        { text: 'Consider repositioning picket ships', urgency: 'low' },
      ],
      rawLogIds: [],
    });
  } else {
    reports.push({
      id: `intel_report_${currentTurn}_1`,
      turn: currentTurn,
      type: 'CONTACT_REPORT',
      title: 'Contact Summary',
      summary: `Contact report: ${tracked.length} tracked, ${identified.length} identified, ${classified.length} classified, ${detected.length} detected, ${suspected.length} suspected, ${lost.length} lost`,
      facts: contacts.slice(0, 5).map((c) =>
        `${c.detectionLevel} ${c.estimatedClass || 'unknown'} at (${c.lastKnownPosition.x.toFixed(1)}, ${c.lastKnownPosition.y.toFixed(1)}) [confidence: ${c.confidence}]`
      ),
      estimates: contacts.length >= 3 ? ['Multiple enemy units may indicate a task force'] : [],
      contacts: contacts.slice(0, 10).map((c) => ({
        contactId: c.id,
        detectionLevel: c.detectionLevel,
        confidence: c.confidence,
        lastKnownPosition: c.lastKnownPosition,
        uncertaintyRadius: c.uncertaintyRadius,
      })),
      damagedShips: [],
      recommendations: tracked.length > 0
        ? [{ text: 'Engage tracked contacts with naval aviation', urgency: 'high' }]
        : [{ text: 'Continue search operations to upgrade contact quality', urgency: 'medium' }],
      rawLogIds: [],
    });
  }

  return reports;
}
