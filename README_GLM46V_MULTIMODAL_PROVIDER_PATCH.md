# README_GLM46V_MULTIMODAL_PROVIDER_PATCH.md
# test2：GLM-4.6V / GLM-4.6V-FlashX 多模态 Provider 接入与配置修复

## 0. 本 README 目标

当前 `test2` 已经有一个 `glm-provider.ts`，但它还不是干净的 GLM-4.6V 多模态接入。

当前问题大致是：

```txt
1. GLM API Key 硬编码在源码中。
2. 使用的模型还是 glm-4-flash，不是 GLM-4.6V / GLM-4.6V-FlashX。
3. endpoint 可能仍是 open.bigmodel.cn，而不是 Z.AI 国际通用 endpoint。
4. 当前 GLM 只接收文本态势，不支持图片输入。
5. GLM 审查结果被塞进 legalActionHints，不干净。
6. AIProviderKind 里可能还没有 glm / z_ai 类型。
7. 项目入口 App.tsx / main.tsx 仍可能是空壳，需要一起修。
```

本补丁目标：

```txt
把 GLM 改成一个可配置、多模态、安全、不硬编码 key 的视觉态势分析 provider。
```

---

## 1. 最终目标架构

建议保留 DeepSeek 作为文字主决策模型，GLM 作为视觉态势分析模型。

```txt
DeepSeek V4:
  - 主文字推理
  - 回合策略
  - JSON 决策
  - 便宜高频调用

GLM-4.6V-FlashX:
  - 高频视觉态势分析
  - 地图截图
  - UI 截图
  - 舰队状态截图

GLM-4.6V:
  - 关键回合视觉分析
  - 复杂战场截图
  - 航母战关键判断
```

不要把 GLM 当成所有回合的主决策模型。

正确流程：

```txt
游戏状态 / 战场截图
  → GLM visual assessment
  → context.visualAssessment
  → DeepSeek / Commander LLM JSON decision
  → validator
  → executor
```

错误流程：

```txt
GLM 输出文本
  → 塞进 legalActionHints
  → 决策模型把它当合法动作
```

---

## 2. 第一优先级：删除硬编码 API Key

### 2.1 必须检查

运行：

```bash
grep -R "sk-" -n src tests
grep -R "API_KEY" -n src tests
grep -R "glm" -n src/ai src/components src/store
```

所有源码中的真实 key 必须删除。

如果 key 已经提交到 GitHub：

```txt
必须去对应平台作废 / rotate。
不要继续使用已经泄露的 key。
```

---

### 2.2 修改 `src/ai/api-key.ts`

当前可能只支持：

```txt
deepseek_api_key
```

改成支持多个 provider：

```ts
export type AIProviderKeyName =
  | 'deepseek'
  | 'glm'
  | 'zai';

const STORAGE_KEYS: Record<AIProviderKeyName, string> = {
  deepseek: 'deepseek_api_key',
  glm: 'glm_api_key',
  zai: 'glm_api_key',
};

export function getAPIKey(provider: AIProviderKeyName = 'deepseek'): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(STORAGE_KEYS[provider]) ?? '';
}

export function setAPIKey(provider: AIProviderKeyName, key: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS[provider], key.trim());
}

export function clearAPIKey(provider: AIProviderKeyName): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEYS[provider]);
}
```

如果已有函数签名被大量调用，不要破坏旧调用。可以保留兼容：

```ts
export function getDeepSeekAPIKey() {
  return getAPIKey('deepseek');
}

export function getGLMAPIKey() {
  return getAPIKey('glm');
}
```

---

### 2.3 禁止 fallback hardcoded key

所有这些写法都必须删除：

```ts
const API_KEY = 'sk-...';
const key = getAPIKey() || 'sk-...';
const fallbackKey = 'sk-...';
```

正确写法：

```ts
const apiKey = getAPIKey('glm');

if (!apiKey) {
  throw new Error('Missing GLM API key. Please set glm_api_key first.');
}
```

UI 中显示：

```txt
请先在设置中输入 GLM API Key
```

---

## 3. 第二优先级：新增 GLM Provider 配置

### 3.1 新增文件

```txt
src/ai/glm-config.ts
```

内容：

```ts
export type GLMModelId =
  | 'glm-4.6v-flashx'
  | 'glm-4.6v'
  | 'glm-4.6v-flash';

export interface GLMProviderConfig {
  provider: 'z_ai';
  endpoint: string;
  model: GLMModelId;
  temperature: number;
  maxTokens: number;
}

export const DEFAULT_GLM_PROVIDER_CONFIG: GLMProviderConfig = {
  provider: 'z_ai',
  endpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
  model: 'glm-4.6v-flashx',
  temperature: 0.2,
  maxTokens: 1200,
};

export const HIGH_QUALITY_GLM_PROVIDER_CONFIG: GLMProviderConfig = {
  provider: 'z_ai',
  endpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
  model: 'glm-4.6v',
  temperature: 0.2,
  maxTokens: 1600,
};
```

说明：

```txt
glm-4.6v-flashx:
  默认开发用。
  便宜、高频、看图够用。

glm-4.6v:
  关键回合用。
  更适合复杂战场截图。

glm-4.6v-flash:
  如果你的平台允许免费/低价测试，可以作为手动选项。
```

---

### 3.2 扩展 `AIProviderKind`

修改：

```txt
src/ai/types.ts
```

把：

```ts
export type AIProviderKind = 'none' | 'rule_based' | 'deepseek';
```

改成：

```ts
export type AIProviderKind =
  | 'none'
  | 'rule_based'
  | 'deepseek'
  | 'glm'
  | 'z_ai';
```

如果已有 `AIProviderConfig`，增加：

```ts
model?: string;
endpoint?: string;
apiKeyStorageKey?: string;
```

---

## 4. 第三优先级：重写 `glm-provider.ts`

### 4.1 目标

把旧的硬编码 `glm-provider.ts` 改成：

```txt
1. 不硬编码 key。
2. 不硬编码旧模型。
3. 支持文本态势分析。
4. 支持图片输入。
5. 返回结构化 VisualAssessment。
6. 不直接参与 executor。
```

---

### 4.2 类型设计

在 `src/ai/glm-provider.ts` 中新增：

```ts
import { getAPIKey } from './api-key';
import {
  DEFAULT_GLM_PROVIDER_CONFIG,
  GLMProviderConfig,
} from './glm-config';

export interface GLMVisualAssessmentInput {
  textualContext: string;

  imageBase64?: string;

  imageMimeType?: 'image/png' | 'image/jpeg' | 'image/webp';

  task:
    | 'battlefield_screenshot_review'
    | 'map_review'
    | 'fleet_status_review'
    | 'contact_review'
    | 'strike_planning_review';

  forceJson?: boolean;
}

export interface GLMVisualAssessment {
  summary: string;

  observedFacts: string[];

  tacticalRisks: string[];

  recommendedFocus: string[];

  confidence: 'low' | 'medium' | 'high';

  shouldEscalateToHighQualityModel: boolean;
}
```

---

### 4.3 实现 `requestGLMVisualAssessment`

```ts
export async function requestGLMVisualAssessment(
  input: GLMVisualAssessmentInput,
  config: GLMProviderConfig = DEFAULT_GLM_PROVIDER_CONFIG,
): Promise<GLMVisualAssessment> {
  const apiKey = getAPIKey('glm');

  if (!apiKey) {
    throw new Error('Missing GLM API key. Please set glm_api_key first.');
  }

  const content: any[] = [
    {
      type: 'text',
      text: buildGLMVisualPrompt(input),
    },
  ];

  if (input.imageBase64) {
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${input.imageMimeType ?? 'image/png'};base64,${input.imageBase64}`,
      },
    });
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'system',
          content:
            'You are a naval warfare visual assessment assistant. Return strict JSON only. Do not invent hidden information.',
        },
        {
          role: 'user',
          content,
        },
      ],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GLM request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content ?? '';

  return parseGLMVisualAssessment(raw);
}
```

---

### 4.4 实现 prompt

```ts
function buildGLMVisualPrompt(input: GLMVisualAssessmentInput): string {
  return `
你是海战游戏的视觉态势分析模型。

你只能根据输入文字和截图进行判断。
不要使用未提供的信息。
不要假设隐藏敌舰。
不要输出 Markdown。
必须返回严格 JSON。

任务类型:
${input.task}

文字上下文:
${input.textualContext}

返回 JSON 格式:
{
  "summary": "一句话态势总结",
  "observedFacts": ["只写你能从输入中看到的事实"],
  "tacticalRisks": ["战术风险"],
  "recommendedFocus": ["建议主决策模型重点关注什么"],
  "confidence": "low | medium | high",
  "shouldEscalateToHighQualityModel": false
}
`;
}
```

---

### 4.5 JSON parse fallback

```ts
function parseGLMVisualAssessment(raw: string): GLMVisualAssessment {
  try {
    const cleaned = raw
      .replace(/^```json/i, '')
      .replace(/^```/i, '')
      .replace(/```$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    return {
      summary: String(parsed.summary ?? ''),
      observedFacts: Array.isArray(parsed.observedFacts) ? parsed.observedFacts.map(String) : [],
      tacticalRisks: Array.isArray(parsed.tacticalRisks) ? parsed.tacticalRisks.map(String) : [],
      recommendedFocus: Array.isArray(parsed.recommendedFocus) ? parsed.recommendedFocus.map(String) : [],
      confidence:
        parsed.confidence === 'high' || parsed.confidence === 'low'
          ? parsed.confidence
          : 'medium',
      shouldEscalateToHighQualityModel: Boolean(parsed.shouldEscalateToHighQualityModel),
    };
  } catch {
    return {
      summary: raw.slice(0, 600),
      observedFacts: [],
      tacticalRisks: ['GLM output was not valid JSON.'],
      recommendedFocus: ['Do not rely on this assessment without validation.'],
      confidence: 'low',
      shouldEscalateToHighQualityModel: true,
    };
  }
}
```

---

## 5. 第四优先级：不要把 GLM Review 塞进 legalActionHints

### 5.1 当前错误

如果现在有类似：

```ts
context.legalActionHints.push(`glm_review:${review}`);
```

必须删除。

`legalActionHints` 只允许放：

```txt
launch_search
launch_cap
launch_strike
shadow_contact
withdraw
repair_fleet
```

不允许放模型评论。

---

### 5.2 修改 `LLMDecisionContext`

修改：

```txt
src/ai/llm-decision-types.ts
```

给 context 增加：

```ts
visualAssessment?: {
  source: 'glm';
  model: string;
  summary: string;
  observedFacts: string[];
  tacticalRisks: string[];
  recommendedFocus: string[];
  confidence: 'low' | 'medium' | 'high';
};
```

---

### 5.3 修改 `ai-turn-pipeline.ts`

正确接法：

```ts
let visualAssessment;

if (shouldRunGLMVisualAssessment(context)) {
  const glmReview = await requestGLMVisualAssessment({
    textualContext: buildTextualContextForGLM(context),
    imageBase64: params.screenshotBase64,
    imageMimeType: 'image/png',
    task: 'battlefield_screenshot_review',
  });

  visualAssessment = {
    source: 'glm',
    model: DEFAULT_GLM_PROVIDER_CONFIG.model,
    ...glmReview,
  };
}

context.visualAssessment = visualAssessment;
```

不要：

```ts
context.legalActionHints.push(`glm_review:${...}`);
```

---

## 6. 第五优先级：截图输入

### 6.1 新增截图获取工具

新增：

```txt
src/ai/screenshot-capture.ts
```

如果是在浏览器里，可用 `html2canvas`。如果当前项目不想加依赖，先做接口占位：

```ts
export async function captureBattlefieldScreenshotBase64(): Promise<string | undefined> {
  return undefined;
}
```

以后再接 `html2canvas`。

---

### 6.2 GLM 调用策略

不要每回合都看图。

新增：

```ts
export function shouldRunGLMVisualAssessment(params: {
  turn: number;
  hasNewContact: boolean;
  contactUpgraded: boolean;
  carrierDamaged: boolean;
  strikePlanned: boolean;
  playerRequested: boolean;
}): boolean {
  return (
    params.playerRequested ||
    params.hasNewContact ||
    params.contactUpgraded ||
    params.carrierDamaged ||
    params.strikePlanned ||
    params.turn % 5 === 0
  );
}
```

建议：

```txt
普通回合:
  不调用 GLM。

有新 contact:
  调用 GLM-4.6V-FlashX。

关键回合:
  调用 GLM-4.6V。

玩家手动点击“视觉分析”:
  调用 GLM-4.6V-FlashX 或 GLM-4.6V。
```

---

## 7. 第六优先级：UI 设置面板

### 7.1 新增组件

```txt
src/components/AIProviderSettingsPanel.tsx
```

显示：

```txt
DeepSeek API Key
GLM API Key
GLM Endpoint
GLM Model
GLM Mode:
  Disabled
  FlashX
  High Quality
GLM Visual Assessment:
  Manual only
  On new contact
  On critical events
  Every 5 turns
```

---

### 7.2 API key 保存

使用：

```ts
setAPIKey('deepseek', key)
setAPIKey('glm', key)
```

不要写入源码。

---

## 8. 第七优先级：Debug / Test

### 8.1 新增 debug

新增：

```txt
src/ai/glm-provider-debug.ts
```

```ts
export async function debugGLMProviderConfig() {
  return {
    hasGLMKey: Boolean(getAPIKey('glm')),
    endpoint: DEFAULT_GLM_PROVIDER_CONFIG.endpoint,
    model: DEFAULT_GLM_PROVIDER_CONFIG.model,
    hardcodedKeyDetected: false,
  };
}
```

---

### 8.2 新增测试

新增：

```txt
tests/glm-provider-regression.ts
```

测试：

```txt
1. src 中不含 sk-。
2. DEFAULT_GLM_PROVIDER_CONFIG.endpoint 是 https://api.z.ai/api/paas/v4/chat/completions。
3. 默认 model 是 glm-4.6v-flashx。
4. GLM assessment 不写入 legalActionHints。
5. LLMDecisionContext 支持 visualAssessment。
```

---

### 8.3 package.json 新增 script

```json
{
  "scripts": {
    "test:glm": "npm run typecheck && esbuild tests/glm-provider-regression.ts --bundle --platform=node --format=esm --outfile=dist/glm-provider-regression.mjs && node dist/glm-provider-regression.mjs"
  }
}
```

---

## 9. 必须一起修的项目入口

如果当前仍然存在：

```txt
src/App.tsx 空壳
src/main.tsx 空 render
```

必须修。

`src/App.tsx`：

```tsx
import React from 'react';
import { NavalScene3D } from './components/NavalScene3D';
import { SidePanel } from './components/SidePanel';

export function App() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 text-slate-100">
      <NavalScene3D />
      <SidePanel />
    </div>
  );
}
```

`src/main.tsx`：

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

---

## 10. 最终验收标准

完成后必须满足：

```txt
1. grep -R "sk-" -n src tests 结果为空。
2. GLM key 从 localStorage 读取。
3. api-key.ts 支持 deepseek 和 glm。
4. glm-provider.ts 不硬编码 endpoint/model/key。
5. 默认 GLM 模型是 glm-4.6v-flashx。
6. 高质量 GLM 模型是 glm-4.6v。
7. endpoint 是 https://api.z.ai/api/paas/v4/chat/completions。
8. GLM 支持文本输入。
9. GLM 支持 imageBase64 输入。
10. GLM 输出 GLMVisualAssessment。
11. GLM 输出 JSON parse 失败有 fallback。
12. legalActionHints 不再包含 glm_review。
13. LLMDecisionContext 有 visualAssessment。
14. ai-turn-pipeline 把 GLM 结果放入 context.visualAssessment。
15. 有 shouldRunGLMVisualAssessment。
16. 有 AIProviderSettingsPanel。
17. App.tsx 真正渲染 NavalScene3D 和 SidePanel。
18. main.tsx 真正渲染 App。
19. npm run build 通过。
20. npm run test 通过。
21. npm run test:glm 通过。
```

---

# 给 OpenCode Plan Mode 的提示词

```txt
你现在处于 Plan Mode。

不要修改代码。
不要创建文件。
不要运行会改动项目的命令。

请阅读 README_GLM46V_MULTIMODAL_PROVIDER_PATCH.md 和当前 test2 仓库，先检查：

1. glm-provider.ts 是否硬编码 API key。
2. glm-provider.ts 当前 endpoint 是什么。
3. glm-provider.ts 当前 model 是什么。
4. 当前是否真正支持 GLM-4.6V / GLM-4.6V-FlashX。
5. 当前是否支持图片输入 imageBase64 / image_url。
6. 当前 GLM review 是否被塞进 legalActionHints。
7. api-key.ts 是否支持 glm_api_key。
8. AIProviderKind 是否支持 glm / z_ai。
9. LLMDecisionContext 是否有 visualAssessment。
10. ai-turn-pipeline 是否正确接入 GLM。
11. App.tsx / main.tsx 是否仍然是空壳。
12. 源码是否仍有 sk-。
13. 你准备按哪些阶段修。
14. 每个阶段修改哪些文件。
15. 每个阶段验收标准。

只输出计划，不修改代码。
```

---

# 给 OpenCode Build Mode 的提示词

```txt
你现在进入 Build Mode。

请严格按照 README_GLM46V_MULTIMODAL_PROVIDER_PATCH.md 执行。

目标：
把当前 test2 的旧 GLM 文本审查器，改成安全、可配置、支持 GLM-4.6V / GLM-4.6V-FlashX、多模态 image input 的视觉态势分析 provider。

不要重写海战核心。
不要新增 naval-v2。
不要硬编码 API key。
不要把 GLM review 塞进 legalActionHints。
不要跳过 build/test。

第一阶段：安全和配置
1. 全文删除 sk- 硬编码 key。
2. 已有硬编码 key 不再使用。
3. api-key.ts 支持 deepseek 和 glm。
4. 新增 glm-config.ts。
5. 默认 endpoint 设置为 https://api.z.ai/api/paas/v4/chat/completions。
6. 默认 model 设置为 glm-4.6v-flashx。
7. 高质量 model 设置为 glm-4.6v。
8. AIProviderKind 增加 glm / z_ai。

第二阶段：重写 GLM Provider
1. glm-provider.ts 不再硬编码 key。
2. glm-provider.ts 接收 GLMProviderConfig。
3. 新增 requestGLMVisualAssessment。
4. 支持 textualContext。
5. 支持 imageBase64 + imageMimeType。
6. messages content 使用 text + image_url 结构。
7. 返回 GLMVisualAssessment。
8. JSON parse 失败时 fallback。
9. 缺少 GLM key 时抛出明确错误，不 fallback。

第三阶段：接入 AI Turn Pipeline
1. LLMDecisionContext 增加 visualAssessment。
2. ai-turn-pipeline 调用 requestGLMVisualAssessment。
3. GLM 结果放入 context.visualAssessment。
4. 删除所有 legalActionHints 中的 glm_review。
5. 新增 shouldRunGLMVisualAssessment。
6. 只在新 contact、contact 升级、航母受损、strike planned、玩家手动请求、每 5 回合等情况下调用 GLM。

第四阶段：UI 设置
1. 新增 AIProviderSettingsPanel。
2. 支持输入 DeepSeek API key。
3. 支持输入 GLM API key。
4. 支持选择 GLM model：
   - glm-4.6v-flashx
   - glm-4.6v
   - glm-4.6v-flash
5. 支持选择 GLM 调用策略：
   - disabled
   - manual_only
   - critical_events
   - every_5_turns
6. key 保存到 localStorage，不进源码。

第五阶段：项目入口和测试
1. 修 App.tsx，渲染 NavalScene3D 和 SidePanel。
2. 修 main.tsx，渲染 App。
3. 新增 glm-provider-debug.ts。
4. 新增 tests/glm-provider-regression.ts。
5. package.json 增加 test:glm。
6. 运行：
   - npm run build
   - npm run test
   - npm run test:glm

每完成一阶段输出 CHECKPOINT：
- 修改文件
- 新增文件
- 删除硬编码 key 结果
- GLM endpoint
- GLM model
- 是否支持图片输入
- 是否删除 legalActionHints glm_review
- build/test 结果
- 未完成项
```
