/**
 * ThreatAssessment - 评估当前威胁等级
 */

export interface ThreatReport {
  overallThreat: 'low' | 'medium' | 'high' | 'critical';
  surface: { level: 'low' | 'medium' | 'high'; reason: string };
  submarine: { level: 'low' | 'medium' | 'high'; reason: string };
  air: { level: 'low' | 'medium' | 'high'; reason: string };
  supply: { level: 'low' | 'medium' | 'high'; reason: string };
  recommendations: string[];
}

export function assessThreat(params: {
  contacts: Array<{ detectionLevel: string; estimatedClass?: string; confidence: string }>;
  ownDamage: { flooding: number; fire: number; hullIntegrity: number }[];
  supplyStatus: { fuelState: string; ammoState: string }[];
  weather: string;
}): ThreatReport {
  const { contacts, ownDamage, supplyStatus, weather } = params;

  // Surface threat
  let surfaceThreat: 'low' | 'medium' | 'high' = 'low';
  const trackedContacts = contacts.filter(c => c.detectionLevel === 'tracked' || c.detectionLevel === 'identified');
  const classifiedContacts = contacts.filter(c => c.detectionLevel === 'classified');
  if (trackedContacts.length >= 2) surfaceThreat = 'high';
  else if (trackedContacts.length >= 1 || classifiedContacts.length >= 2) surfaceThreat = 'medium';
  const surfaceReason = surfaceThreat === 'high' ? `${trackedContacts.length} tracked contacts` : surfaceThreat === 'medium' ? 'Contacts present' : 'No significant surface contacts';

  // Submarine threat (heuristic)
  let subThreat: 'low' | 'medium' | 'high' = 'low';
  if (contacts.some(c => c.estimatedClass === 'submarine')) subThreat = 'high';
  const subReason = subThreat === 'high' ? 'Submarine contact detected' : 'No submarine contacts';

  // Air threat
  let airThreat: 'low' | 'medium' | 'high' = 'low';
  if (contacts.some(c => c.estimatedClass?.includes('carrier'))) airThreat = 'high';
  const airReason = airThreat === 'high' ? 'Enemy carrier detected' : 'No carrier contact';

  // Supply threat
  const criticalSupplies = supplyStatus.filter(s => s.fuelState === 'critical' || s.ammoState === 'critical');
  let supplyThreat: 'low' | 'medium' | 'high' = criticalSupplies.length > 1 ? 'high' : criticalSupplies.length > 0 ? 'medium' : 'low';
  const supplyReason = supplyThreat === 'high' ? `${criticalSupplies.length} fleets critical` : 'Supply adequate';

  // Overall
  const damageHigh = ownDamage.some(d => d.hullIntegrity < 30 || d.flooding > 50);
  const threats = [surfaceThreat, subThreat, airThreat];
  let overall: ThreatReport['overallThreat'] = 'low';
  if (damageHigh || threats.filter(t => t === 'high').length >= 2) overall = 'critical';
  else if (threats.some(t => t === 'high') || weather === 'storm') overall = 'high';
  else if (threats.some(t => t === 'medium')) overall = 'medium';

  const recommendations: string[] = [];
  if (overall === 'critical' || overall === 'high') recommendations.push('Consider withdrawal');
  if (airThreat === 'high') recommendations.push('Launch CAP immediately');
  if (surfaceThreat === 'high') recommendations.push('Maintain standoff distance');
  if (overall === 'low') recommendations.push('Continue patrol');

  return { overallThreat: overall, surface: { level: surfaceThreat, reason: surfaceReason }, submarine: { level: subThreat, reason: subReason }, air: { level: airThreat, reason: airReason }, supply: { level: supplyThreat, reason: supplyReason }, recommendations };
}
