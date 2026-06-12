/**
 * 海军报告生成器
 */

import type { NavalAIReport, NavalReportType } from './naval-ai-types';
import type { NavalContact } from '../intel/naval-intel-types';
import type { NavalShip } from '../ship/ship-types';
import type { NavalBattleLogEvent } from '../ship/ship-damage';

// ===== 生成报告 =====

export function generateNavalReports(params: {
  turn: number;
  fleetId?: string;
  shipId?: string;
  contacts: NavalContact[];
  damagedShips: NavalShip[];
  events: NavalBattleLogEvent[];
}): NavalAIReport[] {
  const { turn, fleetId, shipId, contacts, damagedShips, events } = params;
  const reports: NavalAIReport[] = [];

  // 接触报告
  if (contacts.length > 0) {
    reports.push(generateContactReport(turn, fleetId, contacts));
  }

  // 损伤报告
  for (const ship of damagedShips) {
    if (ship.damage.status !== 'combat_effective') {
      reports.push(generateDamageReport(turn, ship));
    }
  }

  // 火灾报告
  for (const ship of damagedShips) {
    if (ship.damage.fire > 30) {
      reports.push(generateFireReport(turn, ship));
    }
  }

  // 进水报告
  for (const ship of damagedShips) {
    if (ship.damage.flooding > 30) {
      reports.push(generateFloodingReport(turn, ship));
    }
  }

  return reports;
}

function generateContactReport(
  turn: number,
  fleetId: string | undefined,
  contacts: NavalContact[]
): NavalAIReport {
  const facts = contacts.map((c) =>
    `Contact: ${c.estimatedClass || 'unknown'} at (${c.lastKnownPosition.x.toFixed(1)}, ${c.lastKnownPosition.y.toFixed(1)}), level: ${c.detectionLevel}, confidence: ${c.confidence}`
  );

  const estimates = contacts.filter((c) => c.detectionLevel === 'suspected').length > 0
    ? ['Some contacts are unconfirmed and may be false echoes']
    : [];

  const recommendations: Array<{ text: string; urgency: 'low' | 'medium' | 'high' | 'critical' }> = [];
  if (contacts.some((c) => c.detectionLevel === 'tracked' || c.detectionLevel === 'identified')) {
    recommendations.push({ text: 'Recommend preparing strike aircraft', urgency: 'high' });
  }
  if (contacts.some((c) => c.detectionLevel === 'suspected' || c.detectionLevel === 'detected')) {
    recommendations.push({ text: 'Recommend launching search aircraft to confirm contacts', urgency: 'medium' });
  }

  return {
    id: `report_contact_${turn}`,
    turn,
    type: 'CONTACT_REPORT',
    fromFleetId: fleetId,
    title: 'Contact Report',
    summary: `${contacts.length} contacts detected`,
    facts,
    estimates,
    contacts: contacts.map((c) => ({
      contactId: c.id,
      detectionLevel: c.detectionLevel,
      confidence: c.confidence,
      lastKnownPosition: c.lastKnownPosition,
      uncertaintyRadius: c.uncertaintyRadius,
    })),
    damagedShips: [],
    recommendations,
    rawLogIds: [],
  };
}

function generateDamageReport(turn: number, ship: NavalShip): NavalAIReport {
  return {
    id: `report_damage_${ship.id}_${turn}`,
    turn,
    type: 'DAMAGE_REPORT',
    fromShipId: ship.id,
    title: `Damage Report: ${ship.name}`,
    summary: `${ship.name} status: ${ship.damage.status}. Hull: ${ship.damage.hullIntegrity.toFixed(0)}%, Buoyancy: ${ship.damage.buoyancy.toFixed(0)}%`,
    facts: [
      `Hull integrity: ${ship.damage.hullIntegrity.toFixed(0)}%`,
      `Buoyancy: ${ship.damage.buoyancy.toFixed(0)}%`,
      `Stability: ${ship.damage.stability.toFixed(0)}%`,
      `Flooding: ${ship.damage.flooding.toFixed(0)}%`,
      `Fire: ${ship.damage.fire.toFixed(0)}%`,
      `Crew efficiency: ${ship.damage.crewEfficiency.toFixed(0)}%`,
    ],
    estimates: [],
    contacts: [],
    damagedShips: [{
      shipId: ship.id,
      shipName: ship.name,
      damageSummary: `${ship.damage.status}: flood ${ship.damage.flooding}%, fire ${ship.damage.fire}%`,
      status: ship.damage.status,
    }],
    recommendations: ship.damage.status === 'crippled' || ship.damage.status === 'sinking'
      ? [{ text: `Recommend withdrawing ${ship.name}`, urgency: 'critical' }]
      : [{ text: `Damage control teams responding to ${ship.name}`, urgency: 'medium' }],
    rawLogIds: [],
  };
}

function generateFireReport(turn: number, ship: NavalShip): NavalAIReport {
  return {
    id: `report_fire_${ship.id}_${turn}`,
    turn,
    type: 'FIRE_REPORT',
    fromShipId: ship.id,
    title: `Fire Report: ${ship.name}`,
    summary: `Fire at ${ship.damage.fire.toFixed(0)}% intensity on ${ship.name}`,
    facts: [`Fire intensity: ${ship.damage.fire.toFixed(0)}%`],
    estimates: ['Fire may spread to adjacent compartments if not controlled'],
    contacts: [],
    damagedShips: [],
    recommendations: [{ text: 'Assign all available DC teams to firefighting', urgency: 'high' }],
    rawLogIds: [],
  };
}

function generateFloodingReport(turn: number, ship: NavalShip): NavalAIReport {
  return {
    id: `report_flood_${ship.id}_${turn}`,
    turn,
    type: 'FLOODING_REPORT',
    fromShipId: ship.id,
    title: `Flooding Report: ${ship.name}`,
    summary: `Flooding at ${ship.damage.flooding.toFixed(0)}% on ${ship.name}. Buoyancy: ${ship.damage.buoyancy.toFixed(0)}%`,
    facts: [
      `Flooding: ${ship.damage.flooding.toFixed(0)}%`,
      `Buoyancy: ${ship.damage.buoyancy.toFixed(0)}%`,
      `Stability: ${ship.damage.stability.toFixed(0)}%`,
    ],
    estimates: [],
    contacts: [],
    damagedShips: [],
    recommendations: ship.damage.flooding > 70
      ? [{ text: `CRITICAL: ${ship.name} may founder if flooding not controlled`, urgency: 'critical' }]
      : [{ text: 'Prioritize pumping operations', urgency: 'high' }],
    rawLogIds: [],
  };
}
