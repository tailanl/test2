/**
 * Naval Doctrine - 海军战术原则
 */

export type DoctrineType = 'carrier_centric' | 'surface_action' | 'island_hopping' | 'attrition_defense' | 'decisive_battle';

export interface NavalDoctrine {
  type: DoctrineType;
  name: string;
  defaultRisk: 'low' | 'medium' | 'high';
  preferredRange: 'standoff' | 'medium' | 'close';
  carrierPolicy: 'conservative' | 'aggressive' | 'balanced';
  searchPattern: 'wide' | 'focused' | 'defensive';
  rules: string[];
}

export const DOCTRINES: Record<DoctrineType, NavalDoctrine> = {
  carrier_centric: {
    type: 'carrier_centric',
    name: '航母中心战',
    defaultRisk: 'medium',
    preferredRange: 'standoff',
    carrierPolicy: 'conservative',
    searchPattern: 'wide',
    rules: ['Keep carriers at 100+ nmi from enemy', 'Launch search at dawn', 'Strike first if contact classified+', 'Screen carriers with destroyers'],
  },
  surface_action: {
    type: 'surface_action',
    name: '水面舰队决战',
    defaultRisk: 'high',
    preferredRange: 'close',
    carrierPolicy: 'balanced',
    searchPattern: 'focused',
    rules: ['Close to gun range', 'Destroyers launch torpedo attacks', 'Use smoke screens when damaged', 'Battleships engage capital ships'],
  },
  island_hopping: {
    type: 'island_hopping',
    name: '岛屿跳跃',
    defaultRisk: 'medium',
    preferredRange: 'standoff',
    carrierPolicy: 'conservative',
    searchPattern: 'wide',
    rules: ['Secure sea control before landing', 'Bombard shore defenses first', 'Use carriers for CAP and ground support', 'Build airfields on captured islands'],
  },
  attrition_defense: {
    type: 'attrition_defense',
    name: '消耗防御',
    defaultRisk: 'low',
    preferredRange: 'standoff',
    carrierPolicy: 'conservative',
    searchPattern: 'defensive',
    rules: ['Avoid major engagement', 'Preserve capital ships', 'Use submarines to interdict supply lines', 'Retreat damaged ships to repair'],
  },
  decisive_battle: {
    type: 'decisive_battle',
    name: '舰队决战',
    defaultRisk: 'high',
    preferredRange: 'close',
    carrierPolicy: 'aggressive',
    searchPattern: 'focused',
    rules: ['Commit all forces', 'Target enemy carriers first', 'Accept losses for victory', 'No retreat unless critical damage'],
  },
};

export function getDoctrineForPhase(phase: string): NavalDoctrine {
  if (phase.includes('offensive') || phase.includes('philippines') || phase.includes('iwo') || phase.includes('home')) return DOCTRINES.decisive_battle;
  if (phase.includes('central_pacific') || phase.includes('solomons')) return DOCTRINES.island_hopping;
  if (phase.includes('carrier_turning')) return DOCTRINES.carrier_centric;
  if (phase.includes('japanese_offensive')) return DOCTRINES.attrition_defense;
  return DOCTRINES.carrier_centric;
}
