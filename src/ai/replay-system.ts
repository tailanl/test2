/**
 * Naval Replay System
 * LLM 自动战役 → 保存 JSON → 回放加载
 */

import type { StrategicFleet } from '../game/naval/naval-strategic-types';
import type { NavalContact } from '../game/naval/intel/naval-intel-types';
import type { NavalAIReport } from '../game/naval/ai/naval-ai-types';
import type { NavalBattleLogEvent } from '../game/naval/ship/ship-damage';

// ==================== 回放数据结构 ====================

export interface ReplayTurnSnapshot {
  turn: number;
  timestamp: string;
  fleets: Array<{
    id: string; name: string; faction: string; type: string;
    position: { globalX: number; globalY: number };
    ships: Array<{
      id: string; name: string; shipClass: string; faction: string;
      position: { x: number; y: number }; headingDeg: number;
      speedKts: number; targetSpeedKts: number; rudderDeg: number;
      damage: {
        hullIntegrity: number; buoyancy: number; flooding: number; fire: number;
        status: string; speedPenalty: number; turnPenalty: number;
      };
      sensors: { radarOperational: boolean; sonarOperational: boolean; cicOperational: boolean };
      aircraft?: { fighters: number; diveBombers: number; torpedoBombers: number; readyAircraft: number; deckCycleState: string };
    }>;
  }>;
  contacts: Array<{
    id: string; detectionLevel: string; confidence: string;
    estimatedClass: string; lastKnownPosition: { x: number; y: number };
    uncertaintyRadius: number; lastDetectedTurn: number;
  }>;
  reports: Array<{ type: string; title: string; summary: string; turn: number }>;
  events: Array<{ type: string; description: string; shipId?: string }>;
  llmDecision?: { situation: string; orders: number };
}

export interface ReplayFile {
  version: string;
  generatedAt: string;
  totalTurns: number;
  mapConfig: { width: number; height: number; seed: number };
  turns: ReplayTurnSnapshot[];
  finalResult: {
    playerLosses: string[];
    enemyLosses: string[];
    summary: string;
  };
}

// ==================== 快照采集 ====================

export function captureTurnSnapshot(
  turn: number,
  fleets: StrategicFleet[],
  contacts: NavalContact[],
  reports: NavalAIReport[],
  events: NavalBattleLogEvent[],
  llmDecision?: { situation: string; orders: number }
): ReplayTurnSnapshot {
  return {
    turn,
    timestamp: new Date().toISOString(),
    fleets: fleets.map(f => ({
      id: f.id, name: f.name, faction: f.faction, type: f.type,
      position: f.position,
      ships: f.ships.map(s => ({
        id: s.id, name: s.name, shipClass: s.shipClass, faction: s.faction,
        position: s.position, headingDeg: s.headingDeg,
        speedKts: s.speedKts, targetSpeedKts: s.targetSpeedKts, rudderDeg: s.rudderDeg,
        damage: {
          hullIntegrity: s.damage.hullIntegrity, buoyancy: s.damage.buoyancy,
          flooding: s.damage.flooding, fire: s.damage.fire,
          status: s.damage.status, speedPenalty: s.damage.speedPenalty, turnPenalty: s.damage.turnPenalty,
        },
        sensors: { radarOperational: s.sensors.radarOperational, sonarOperational: s.sensors.sonarOperational, cicOperational: s.sensors.cicOperational },
        aircraft: s.aircraft ? { fighters: s.aircraft.fighters, diveBombers: s.aircraft.diveBombers, torpedoBombers: s.aircraft.torpedoBombers, readyAircraft: s.aircraft.readyAircraft, deckCycleState: s.aircraft.deckCycleState } : undefined,
      })),
    })),
    contacts: contacts.map(c => ({
      id: c.id, detectionLevel: c.detectionLevel, confidence: c.confidence,
      estimatedClass: (c.estimatedClass as string) || 'unknown',
      lastKnownPosition: c.lastKnownPosition,
      uncertaintyRadius: c.uncertaintyRadius, lastDetectedTurn: c.lastDetectedTurn,
    })),
    reports: reports.map(r => ({ type: r.type, title: r.title, summary: r.summary, turn: r.turn })),
    events: events.map(e => ({ type: e.type, description: e.description, shipId: e.shipId })),
    llmDecision,
  };
}

// ==================== 下载/保存 ====================

export function downloadReplay(replay: ReplayFile, filename?: string) {
  const json = JSON.stringify(replay, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `naval-replay-${replay.generatedAt.replace(/[:.]/g,'-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ==================== 加载回放 ====================

export function loadReplayFromFile(file: File): Promise<ReplayFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        resolve(data as ReplayFile);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsText(file);
  });
}

export function loadReplayFromURL(url: string): Promise<ReplayFile> {
  return fetch(url).then(r => r.json());
}
