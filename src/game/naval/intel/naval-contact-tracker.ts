/**
 * 海军接触跟踪器 - updateNavalIntelState
 * 这是唯一允许读取 enemyShips 的系统
 */

import type { NavalIntelState, NavalContact, DetectionLevel } from './naval-intel-types';
import type { NavalShip } from '../ship/ship-types';
import type { NavalEnvironmentState } from '../naval-types';
import type { NavalCellOverlay } from '../naval-types';
import type { NavalAirMission } from '../ship/ship-aircraft';
import type { NavalAIReport } from '../ai/naval-ai-types';
import { detectNavalTarget } from './naval-visibility';
import { upgradeDetectionLevel, decayDetectionLevel, growUncertaintyRadius } from './naval-sensor-model';

// ===== 核心：更新海军情报状态 =====

export function updateNavalIntelState(params: {
  intel: NavalIntelState;
  currentTurn: number;
  friendlyShips: NavalShip[];
  enemyShips: NavalShip[];
  friendlyAirMissions: NavalAirMission[];
  environment: NavalEnvironmentState;
  overlay: NavalCellOverlay[][];
}): {
  intel: NavalIntelState;
  newReports: NavalAIReport[];
} {
  const { intel, currentTurn, friendlyShips, enemyShips, friendlyAirMissions, environment } = params;

  const newIntel: NavalIntelState = {
    ...intel,
    turn: currentTurn,
    playerContacts: intel.playerContacts.map((c) => ({ ...c, trackHistory: [...c.trackHistory] })),
    enemyContacts: intel.enemyContacts.map((c) => ({ ...c, trackHistory: [...c.trackHistory] })),
  };

  const newReports: NavalAIReport[] = [];

  // === 1. 探测所有敌舰 ===
  const allObservers = friendlyShips.concat();

  for (const enemy of enemyShips) {
    for (const observer of allObservers) {
      const dx = enemy.position.x - observer.position.x;
      const dy = enemy.position.y - observer.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 目视探测
      const visResult = detectNavalTarget({
        observer,
        target: enemy,
        sensorType: 'visual',
        environment: {
          timeOfDay: environment.timeOfDay,
          weather: environment.weather,
          seaState: environment.seaState,
          smoke: 0,
        },
        distance: dist,
        lineOfSightBlocked: false,
      });

      if (visResult.success && visResult.detectionLevel !== 'none') {
        upsertContact(newIntel, enemy, visResult.detectionLevel, visResult.confidence, visResult.estimatedClass || 'unknown', visResult.positionErrorRadius, currentTurn, observer.id, 'visual');
      }

      // 雷达探测
      if (observer.sensors.radarOperational) {
        const radarResult = detectNavalTarget({
          observer,
          target: enemy,
          sensorType: 'surface_radar',
          environment: {
            timeOfDay: environment.timeOfDay,
            weather: environment.weather,
            seaState: environment.seaState,
            smoke: 0,
          },
          distance: dist,
          lineOfSightBlocked: false,
        });

        if (radarResult.success && radarResult.detectionLevel !== 'none') {
          upsertContact(newIntel, enemy, radarResult.detectionLevel, radarResult.confidence, radarResult.estimatedClass || 'unknown', radarResult.positionErrorRadius, currentTurn, observer.id, 'surface_radar');
        }
      }

      // 声呐探测
      if (observer.sensors.sonarOperational) {
        const sonarResult = detectNavalTarget({
          observer,
          target: enemy,
          sensorType: 'sonar',
          environment: {
            timeOfDay: environment.timeOfDay,
            weather: environment.weather,
            seaState: environment.seaState,
            smoke: 0,
          },
          distance: dist,
          lineOfSightBlocked: false,
        });

        if (sonarResult.success && sonarResult.detectionLevel !== 'none') {
          upsertContact(newIntel, enemy, sonarResult.detectionLevel, sonarResult.confidence, sonarResult.estimatedClass || 'unknown', sonarResult.positionErrorRadius, currentTurn, observer.id, 'sonar');
        }
      }
    }
  }

  // === 2. 处理丢失接触 ===
  for (const contact of newIntel.playerContacts) {
    if (contact.lastDetectedTurn < currentTurn) {
      const turnsSince = currentTurn - contact.lastDetectedTurn;
      const newLevel = decayDetectionLevel(contact.detectionLevel, turnsSince);

      if (newLevel === 'lost' && contact.detectionLevel !== 'lost') {
        newReports.push(createLostContactReport(contact, currentTurn));
      }

      contact.detectionLevel = newLevel;
      contact.uncertaintyRadius = growUncertaintyRadius(contact.uncertaintyRadius, turnsSince);
      contact.stale = turnsSince > 1;
    } else {
      contact.stale = false;
    }
  }

  // === 3. 清理完全丢失的接触（超过20回合） ===
  newIntel.playerContacts = newIntel.playerContacts.filter((c) => {
    if (c.detectionLevel === 'lost' && currentTurn - c.lastDetectedTurn > 20) {
      return false;
    }
    return true;
  });

  return { intel: newIntel, newReports };
}

// ===== 插入或更新接触 =====

function upsertContact(
  intel: NavalIntelState,
  enemy: NavalShip,
  newLevel: DetectionLevel,
  confidence: 'low' | 'medium' | 'high',
  estimatedClass: string,
  positionErrorRadius: number,
  currentTurn: number,
  observerId: string,
  sensorType: 'visual' | 'surface_radar' | 'air_search_radar' | 'sonar' | 'aircraft_search' | 'radio_intercept' | 'reported_contact'
): void {
  // 查找现有接触
  let contact = intel.playerContacts.find((c) => c.originalEntityId === enemy.id);

  if (contact) {
    // 升级
    const upgradedLevel = upgradeDetectionLevel(contact.detectionLevel, newLevel, confidence);
    contact.detectionLevel = upgradedLevel;
    contact.lastKnownPosition = {
      x: enemy.position.x + (Math.random() - 0.5) * positionErrorRadius,
      y: enemy.position.y + (Math.random() - 0.5) * positionErrorRadius,
    };
    contact.uncertaintyRadius = positionErrorRadius;
    contact.lastDetectedTurn = currentTurn;
    contact.confidence = confidence;
    if (upgradedLevel === 'identified' || upgradedLevel === 'classified') {
      contact.estimatedClass = enemy.shipClass;
    }
    contact.detectedBy.push({
      sensorPlatformId: observerId,
      sensorType,
      turn: currentTurn,
    });
    contact.trackHistory.push({
      turn: currentTurn,
      x: enemy.position.x,
      y: enemy.position.y,
      uncertaintyRadius: positionErrorRadius,
      detectionLevel: upgradedLevel,
    });
    contact.stale = false;
  } else {
    // 新建接触
    const newContact: NavalContact = {
      id: `contact_${enemy.id}_${currentTurn}_${Math.random().toString(36).slice(2, 8)}`,
      originalEntityId: enemy.id,
      contactType: enemy.shipClass === 'submarine' ? 'submarine' : 'surface_ship',
      detectionLevel: newLevel,
      factionEstimate: 'enemy',
      estimatedClass: estimatedClass as any,
      estimatedCount: 1,
      lastKnownPosition: {
        x: enemy.position.x + (Math.random() - 0.5) * positionErrorRadius,
        y: enemy.position.y + (Math.random() - 0.5) * positionErrorRadius,
      },
      uncertaintyRadius: positionErrorRadius,
      lastDetectedTurn: currentTurn,
      confidence,
      detectedBy: [{ sensorPlatformId: observerId, sensorType, turn: currentTurn }],
      trackHistory: [{
        turn: currentTurn,
        x: enemy.position.x,
        y: enemy.position.y,
        uncertaintyRadius: positionErrorRadius,
        detectionLevel: newLevel,
      }],
      stale: false,
    };
    intel.playerContacts.push(newContact);
  }
}

// ===== 创建丢失接触报告 =====

function createLostContactReport(contact: NavalContact, turn: number): NavalAIReport {
  return {
    id: `report_lost_${contact.id}_${turn}`,
    turn,
    type: 'CONTACT_REPORT',
    title: 'Contact Lost',
    summary: `Lost contact with ${contact.estimatedClass || 'unknown'} at position (${contact.lastKnownPosition.x.toFixed(1)}, ${contact.lastKnownPosition.y.toFixed(1)}). Uncertainty radius: ${contact.uncertaintyRadius.toFixed(1)} units.`,
    facts: [`Last detected turn ${contact.lastDetectedTurn}`, `Current uncertainty radius: ${contact.uncertaintyRadius.toFixed(1)}`],
    estimates: ['Enemy may have changed course', 'Enemy may be beyond sensor range'],
    contacts: [{
      contactId: contact.id,
      detectionLevel: 'lost',
      confidence: 'low',
      lastKnownPosition: contact.lastKnownPosition,
      uncertaintyRadius: contact.uncertaintyRadius,
    }],
    damagedShips: [],
    recommendations: [{ text: 'Consider launching search missions to reacquire contact', urgency: 'medium' }],
    rawLogIds: [],
  };
}

// ===== 接触衰减：每回合未更新则降级并扩大不确定半径 =====

export function decayNavalContacts(params: {
  contacts: NavalContact[];
  currentTurn: number;
  staleAfterTurns?: number;
}): NavalContact[] {
  const { contacts, currentTurn, staleAfterTurns = 2 } = params;

  return contacts.map((contact) => {
    const turnsSince = currentTurn - contact.lastDetectedTurn;

    if (turnsSince < staleAfterTurns) return contact;

    // 已丢失的接触扩大 uncertaintyRadius
    if (contact.detectionLevel === 'lost') {
      return {
        ...contact,
        uncertaintyRadius: growUncertaintyRadius(contact.uncertaintyRadius, turnsSince),
        trackHistory: [...contact.trackHistory],
      };
    }

    // 降级
    const newLevel = decayDetectionLevel(contact.detectionLevel, turnsSince);
    if (newLevel === contact.detectionLevel) return contact;

    return {
      ...contact,
      detectionLevel: newLevel,
      uncertaintyRadius: growUncertaintyRadius(contact.uncertaintyRadius, turnsSince),
      stale: newLevel === 'lost' ? true : contact.stale,
      trackHistory: [...contact.trackHistory],
    };
  });
}
