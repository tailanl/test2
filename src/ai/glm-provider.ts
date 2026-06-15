/**
 * GLM Provider - ChatGLM-4.6V-Flash (免费)
 * 在 DeepSeek 决策前先做快速审查
 * 包含精确方位距离计算
 */

const GLM_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const GLM_MODEL = 'glm-4-flash';
const GLM_API_KEY = 'cb9757fb1bde4d8c8db0eb4a45a6a84a.3R6GL7jdz67wUDxY';

export async function callGLMAPI(system: string, user: string): Promise<string> {
  try {
    const r = await fetch(GLM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GLM_API_KEY}` },
      body: JSON.stringify({ model: GLM_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.6, max_tokens: 400 }),
    });
    if (!r.ok) { const err = await r.text(); console.warn(`GLM API error ${r.status}: ${err.slice(0, 150)}`); return ''; }
    const data = await r.json() as any;
    return data.choices?.[0]?.message?.content || '';
  } catch (e: any) { console.warn(`GLM offline: ${String(e).slice(0, 80)}`); return ''; }
}

// ========== 计算方位和距离 ==========

function bearingAndDist(ox: number, oy: number, tx: number, ty: number): { bearing: number; bearingLabel: string; dist: number } {
  const dx = tx - ox, dy = ty - oy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  let bearing = Math.atan2(dx, -dy) * 180 / Math.PI; // 0=N, 90=E
  if (bearing < 0) bearing += 360;
  const labels = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const label = labels[Math.round(bearing / 22.5) % 16];
  return { bearing: Math.round(bearing), bearingLabel: label, dist: Math.round(dist) };
}

// ========== 主审查函数 ==========

export async function getGLMReview(params: {
  ownPosition: { name: string; x: number; y: number };
  ownShips: Array<{ name: string; cls: string; hdg: number; spd: number; damaged?: string }>;
  contacts: Array<{ id: string; level: string; estClass: string; x: number; y: number; radius: number; conf: string }>;
  weather: string;
  turn: number;
}): Promise<string> {
  const { ownShips, contacts, ownPosition, weather, turn } = params;
  if (!contacts.length && !ownShips.length) return '';

  // 计算每个接触的方位距离
  const contactDetails = contacts.map(c => {
    const bd = bearingAndDist(ownPosition.x, ownPosition.y, c.x, c.y);
    return `[${c.level}] ${c.estClass} ══ 方位:${bd.bearing}°(${bd.bearingLabel}) 距离:${bd.dist}格 位置:(${c.x},${c.y}) 不确定半径:±${c.radius} 置信:${c.conf}`;
  }).join('\n');

  // 计算舰船间距
  const shipLines = ownShips.map(s => {
    const dmg = s.damaged ? ` ⚠${s.damaged}` : '';
    return `${s.name}(${s.cls}) 航向:${s.hdg}° 航速:${s.spd}kt${dmg}`;
  }).join('\n');

  const system = `你是太平洋舰队高级战术分析官。你会收到精确的方位和距离数据。
你必须使用具体的方位角(0-360°)和距离(格)来描述态势, 不许用模糊词如"附近""较远"。
回复格式:
【态势评估】明确写出每个接触相对于本舰队的方位角和距离
【威胁排序】从高到低, 每项包含方位距离
【侦察建议】写明搜索方向和理由
【行动建议】写明具体行动`;

  const user = `第${turn}回合 | 天气:${weather} | 本队:${ownPosition.name}(${ownPosition.x},${ownPosition.y})

【本队舰船】
${shipLines}

【接触详情(精确方位距离)】
${contactDetails || '无敌方接触'}

请严格使用方位角和距离进行分析。`;

  const resp = await callGLMAPI(system, user);
  return resp || '';
}
