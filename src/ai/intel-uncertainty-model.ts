/**
 * Intel Uncertainty Model - 情报不确定性建模
 */

export interface IntelUncertaintyReport {
  contactReliability: Array<{ contactId: string; reliability: number; stale: boolean; recommendedAction: string }>;
  overallSituationalAwareness: 'poor' | 'fair' | 'good' | 'excellent';
  recommendation: string;
}

export function assessIntelUncertainty(params: {
  contacts: Array<{ id: string; detectionLevel: string; lastDetectedTurn: number; confidence: string; stale: boolean }>;
  currentTurn: number;
  ownSensorStatus: { radarOperational: boolean; cicOperational: boolean; crewQuality: string };
}): IntelUncertaintyReport {
  const { contacts, currentTurn, ownSensorStatus } = params;

  const contactReliability = contacts.map(c => {
    const turnsSince = currentTurn - c.lastDetectedTurn;
    let reliability = 100;

    // Detection level affects reliability
    if (c.detectionLevel === 'tracked') reliability -= 0;
    else if (c.detectionLevel === 'identified') reliability -= 5;
    else if (c.detectionLevel === 'classified') reliability -= 15;
    else if (c.detectionLevel === 'detected') reliability -= 25;
    else if (c.detectionLevel === 'suspected') reliability -= 40;
    else reliability -= 60;

    // Time decay
    reliability -= turnsSince * 10;

    // Confidence
    if (c.confidence === 'low') reliability -= 10;
    else if (c.confidence === 'high') reliability += 5;

    const stale = turnsSince > 3 || c.stale;
    let recommendedAction = 'monitor';
    if (reliability < 30) recommendedAction = 'recon';
    else if (reliability < 60) recommendedAction = 'search';
    if (c.detectionLevel === 'tracked') recommendedAction = 'engage';

    return { contactId: c.id, reliability: Math.max(0, Math.min(100, reliability)), stale, recommendedAction };
  });

  // Overall awareness
  const avgReliability = contactReliability.length > 0 ? contactReliability.reduce((a, b) => a + b.reliability, 0) / contactReliability.length : 0;
  const hasRadar = ownSensorStatus.radarOperational;
  const hasCIC = ownSensorStatus.cicOperational;
  let awareness: IntelUncertaintyReport['overallSituationalAwareness'] = 'poor';
  if (avgReliability > 70 && hasRadar && hasCIC) awareness = 'excellent';
  else if (avgReliability > 50 && hasRadar) awareness = 'good';
  else if (avgReliability > 30) awareness = 'fair';

  const recommendation = awareness === 'poor' ? 'Launch intensive search operations' : awareness === 'fair' ? 'Expand search sector' : awareness === 'good' ? 'Continue monitoring' : 'Situation well understood';

  return { contactReliability, overallSituationalAwareness: awareness, recommendation };
}
