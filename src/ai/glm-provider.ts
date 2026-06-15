/**
 * GLM Provider - ChatGLM-4.6V-Flash (免费)
 * 在 DeepSeek 决策前先做快速审查
 */

const GLM_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const GLM_MODEL = 'glm-4-flash'; // GLM-4.6V-Flash 免费模型

const GLM_API_KEY = 'cb9757fb1bde4d8c8db0eb4a45a6a84a.3R6GL7jdz67wUDxY';

export async function callGLMAPI(system: string, user: string): Promise<string> {
  try {
    const r = await fetch(GLM_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: GLM_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.6,
        max_tokens: 300,
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.warn(`GLM API error ${r.status}: ${err.slice(0, 150)}`);
      return '';
    }

    const data = await r.json() as any;
    return data.choices?.[0]?.message?.content || '';
  } catch (e: any) {
    console.warn(`GLM offline: ${String(e).slice(0, 80)}`);
    return '';
  }
}

/**
 * GLM 快速审查：在 DeepSeek 决策前，先用 GLM 分析局势
 * 返回简洁的审查意见，附在 DeepSeek context 中
 */
export async function getGLMReview(context: string): Promise<string> {
  if (!context.trim()) return '';

  const system = `你是太平洋舰队快速分析官。用1-2句话总结当前最关键的战术要点和风险。
回复格式: 【要点】... 【风险】...`;

  const user = `请快速分析以下战术情报，指出最关键的一点:\n${context.slice(0, 2000)}`;

  const resp = await callGLMAPI(system, user);
  return resp || '';
}
