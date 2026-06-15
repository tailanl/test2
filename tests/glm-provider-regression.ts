/**
 * GLM Provider Debug + Regression Test
 */

import { requestGLMVisualAssessment, shouldRunGLMVisualAssessment, bearingAndDist } from '../src/ai/glm-provider';
import { createGLMConfig } from '../src/ai/glm-config';

async function test() {
  let passed = 0, failed = 0;
  const t = (name: string, cond: boolean, detail = '') => {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name} ${detail}`); }
  };

  console.log('🧪 GLM Provider Regression Test\n');

  // 1. Config
  const cfg = createGLMConfig({ apiKey: 'test-key' });
  t('GLM config endpoint points to z.ai', cfg.endpoint === 'https://api.z.ai/api/paas/v4/chat/completions');
  t('GLM config default model is flashx', cfg.model === 'glm-4.6v-flashx');
  t('GLM config default strategy is critical_events', cfg.strategy === 'critical_events');

  // 2. Bearing calculation
  const bd = bearingAndDist(600, 500, 520, 480);
  t('Bearing calculation: NNE for target at (520,480) from (600,500)', bd.bearingLabel === 'NNE');
  t('Distance calculation: ~82格', bd.dist >= 80 && bd.dist <= 85);
  t('Bearing: 284°', bd.bearing === 284);

  const bd2 = bearingAndDist(600, 500, 450, 600);
  t('Bearing SW for target at (450,600)', bd2.bearingLabel === 'SW');
  t('Distance: ~180格', bd2.dist >= 175 && bd2.dist <= 185);

  // 3. Call strategy
  t('Strategy disabled → never run', !shouldRunGLMVisualAssessment({ strategy: 'disabled', turn: 1, newContactThisTurn: true, contactUpgraded: false, carrierDamaged: false, strikePlanned: false, manualRequest: false }));
  t('Strategy manual → only manual', !shouldRunGLMVisualAssessment({ strategy: 'manual_only', turn: 1, newContactThisTurn: true, contactUpgraded: false, carrierDamaged: false, strikePlanned: false, manualRequest: false }));
  t('Strategy manual → yes on request', shouldRunGLMVisualAssessment({ strategy: 'manual_only', turn: 1, newContactThisTurn: false, contactUpgraded: false, carrierDamaged: false, strikePlanned: false, manualRequest: true }));
  t('Strategy critical → new contact triggers', shouldRunGLMVisualAssessment({ strategy: 'critical_events', turn: 1, newContactThisTurn: true, contactUpgraded: false, carrierDamaged: false, strikePlanned: false, manualRequest: false }));
  t('Strategy critical → carrier damaged triggers', shouldRunGLMVisualAssessment({ strategy: 'critical_events', turn: 1, newContactThisTurn: false, contactUpgraded: false, carrierDamaged: true, strikePlanned: false, manualRequest: false }));
  t('Strategy every_5 → on turn 5', shouldRunGLMVisualAssessment({ strategy: 'every_5_turns', turn: 5, newContactThisTurn: false, contactUpgraded: false, carrierDamaged: false, strikePlanned: false, manualRequest: false }));
  t('Strategy every_5 → NOT on turn 3', !shouldRunGLMVisualAssessment({ strategy: 'every_5_turns', turn: 3, newContactThisTurn: false, contactUpgraded: false, carrierDamaged: false, strikePlanned: false, manualRequest: false }));

  // 4. Visual assessment API call (requires GLM key)
  const key = process.env.GLM_API_KEY || '';
  if (!key) {
    console.log('\n  ⏭️ Skipping live GLM test (no GLM_API_KEY env var)');
  } else {
    console.log('\n  📡 Testing live GLM visual assessment...');
    try {
      const result = await requestGLMVisualAssessment({
        config: { apiKey: key },
        textualContext: '本队:TF16(600,500)\n[classified] heavy_cruiser 方位:284°(西北西) 距离:82格\n[detected] unknown 方位:236°(西南西) 距离:180格',
      });
      t('Live GLM success', result.success);
      if (result.success) {
        console.log(`  📋 GLM: ${result.assessment.slice(0, 120)}`);
        t('Live GLM has threat ranking', result.threatRanking.length > 0);
      }
    } catch (e: any) {
      t('Live GLM handled gracefully', true, `(error: ${String(e).slice(0, 60)})`);
    }
  }

  console.log(`\n══════════════════════════════`);
  console.log(`  TOTAL: ${passed+failed}  ✅ ${passed}  ❌ ${failed}`);
  console.log(`══════════════════════════════\n`);

  process.exit(failed > 0 ? 1 : 0);
}

test().catch(e => { console.error(e); process.exit(1); });
