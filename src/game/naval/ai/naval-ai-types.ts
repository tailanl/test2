/**
 * 海军 AI 类型定义
 */

import type { StrategicFleet, NavalFleetCommandState } from '../naval-strategic-types';
import type { NavalShip } from '../ship/ship-types';
import type { NavalContact } from '../intel/naval-intel-types';
import type { NavalIntelState } from '../intel/naval-intel-types';
import type { NavalEnvironmentState } from '../naval-types';
import type { DetectionLevel } from '../intel/naval-intel-types';
import type { ShipDamageState } from '../ship/ship-damage';

// ===== AI 输入（禁止包含 enemyShips） =====

export interface NavalAIInput {
  friendlyFleets: StrategicFleet[];
  friendlyShips: NavalShip[];
  contacts: NavalContact[];
  intel: NavalIntelState;
  reports: NavalAIReport[];
  mission: NavalFleetCommandState;
  environment: NavalEnvironmentState;
}

// ===== AI 操作类型 =====

export type NavalAIActionType =
  | 'change_course'
  | 'change_speed'
  | 'launch_search'
  | 'launch_cap'
  | 'launch_strike'
  | 'fire_main_guns'
  | 'fire_torpedoes'
  | 'deploy_smoke'
  | 'withdraw'
  | 'damage_control'
  | 'hold_fire';

// ===== AI 操作 =====

export interface NavalAIAction {
  id: string;
  shipId?: string;
  fleetId?: string;
  type: NavalAIActionType;
  targetContactId?: string;
  targetPosition?: {
    x: number;
    y: number;
  };
  headingDeg?: number;
  targetSpeedKts?: number;
  rudderDeg?: number;
  reason: string;
  basedOnContactIds: string[];
}

// ===== 报告类型 =====

export type NavalReportType =
  | 'CONTACT_REPORT'
  | 'AIR_SEARCH_REPORT'
  | 'STRIKE_REPORT'
  | 'SURFACE_ACTION_REPORT'
  | 'DAMAGE_REPORT'
  | 'FLOODING_REPORT'
  | 'FIRE_REPORT'
  | 'CAP_REPORT'
  | 'SUBMARINE_CONTACT'
  | 'WITHDRAWAL_REPORT'
  | 'REQUEST_AUTHORIZATION';

// ===== AI 报告 =====

export interface NavalAIReport {
  id: string;
  turn: number;
  type: NavalReportType;
  fromFleetId?: string;
  fromShipId?: string;
  title: string;
  summary: string;
  facts: string[];
  estimates: string[];
  contacts: Array<{
    contactId: string;
    detectionLevel: DetectionLevel;
    confidence: 'low' | 'medium' | 'high';
    lastKnownPosition: { x: number; y: number };
    uncertaintyRadius: number;
  }>;
  damagedShips: Array<{
    shipId: string;
    shipName: string;
    damageSummary: string;
    status: ShipDamageState['status'];
  }>;
  recommendations: Array<{
    text: string;
    urgency: 'low' | 'medium' | 'high' | 'critical';
  }>;
  rawLogIds: string[];
}

// ===== 创建默认报告 =====

export function createDefaultReport(
  type: NavalReportType,
  turn: number,
  title: string,
  summary: string
): NavalAIReport {
  return {
    id: `report_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    turn,
    type,
    title,
    summary,
    facts: [],
    estimates: [],
    contacts: [],
    damagedShips: [],
    recommendations: [],
    rawLogIds: [],
  };
}
