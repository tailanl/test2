# README_NAVAL_SMART_AI_INTEGRATION_V2.md
# test2 最新更新检查：未完成项 + 下一轮智能化补丁

## 0. 当前总判断

这次更新后，项目确实新增了不少智能 AI 文件：

```txt
src/ai/api-key.ts
src/ai/information-filter.ts
src/ai/llm-commander-provider.ts
src/ai/llm-decision-types.ts
src/ai/llm-decision-validator.ts
src/ai/llm-decision-executor.ts
src/ai/llm-decision-debug.ts
src/ai/campaign-memory.ts
src/ai/search-planner.ts
src/ai/threat-assessment.ts
src/ai/operational-plan-state.ts
src/ai/naval-doctrine.ts
src/components/LLMKnowledgePanel.tsx
src/components/AfterActionReviewPanel.tsx
```

说明上一轮要求的“LLM 根据已知情报决策”已经开始实现。

但是现在最大问题是：

```txt
新系统已经写出来了，但很多还没有接到主游戏循环。
```

尤其是：

```txt
1. App.tsx / main.tsx 仍然是坏入口，可能直接无法 build。
2. NavalCampaignPanel 仍然绕过新 LLM 决策链。
3. SidePanel 里虽然用了部分新管线，但仍保留旧 buildCtx / askLLM 逻辑。
4. LLMKnowledgePanel 已经存在，但 SidePanel 里只是注释，没有真正渲染。
5. store 里 requestAIAdvice / submitACommand 仍然可能把真实 fleets 全部给旧 LLM 上下文。
6. 源码里仍然有硬编码 API key fallback，必须删除。
7. SearchPlanner / ThreatAssessment / OperationalPlanState / Doctrine 只是文件存在，还没有成为决策主流程。
8. IntelUncertaintyModel 和 CommanderIntent 还没有实现。
9. AI regression 测试不完整。
```

本 README 的目标：

```txt
把已经写出来的智能系统接进主流程。
删除旧逻辑。
补完缺失智能模块。
让 build/test 成为硬验收。
```

---

# 1. 最新实现检查

## 1.1 Vite 项目结构

已存在：

```txt
package.json
vite.config.ts
index.html
src/App.tsx
src/main.tsx
```

但是当前入口仍然不完整。

当前问题：

```txt
src/App.tsx:
  return ( );
  没有实际 JSX。

src/main.tsx:
  ReactDOM.createRoot(...).render( );
  没有渲染 <App />。
```

这属于 P0 问题。

必须修成：

```tsx
// src/App.tsx
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

```tsx
// src/main.tsx
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

## 1.2 API Key 管理

已实现：

```txt
src/ai/api-key.ts
```

有：

```txt
getAPIKey()
setAPIKey()
clearAPIKey()
```

这是对的。

但是仍然存在严重问题：

```txt
1. src/store/naval-store.ts 里仍然有硬编码 sk- fallback。
2. src/components/NavalCampaignPanel.tsx 里仍然直接传硬编码 sk-。
```

必须删除所有硬编码 key。

执行：

```bash
grep -R "sk-" -n src tests
```

结果必须为空。

如果曾经提交到 GitHub：

```txt
已经暴露的 key 必须作废 / rotate。
```

---

## 1.3 Information Filter

已实现：

```txt
src/ai/information-filter.ts
```

有：

```txt
buildFactionKnowledge
sanitizeKnowledgeForLLM
generateLegalActionHints
```

当前方向正确。

但还需要补：

```txt
1. memory 类型不能用 any，必须用 CampaignMemory。
2. knownBases 不能只看本方基地，后续要支持“已知/侦察到的敌方基地”。
3. sanitize 后必须有自动断言：
   - 不含 enemyShips
   - 不含 enemyFleets
   - 不含 hidden
   - 不含 truth
```

---

## 1.4 LLM Commander Provider

已实现：

```txt
src/ai/llm-commander-provider.ts
```

有：

```txt
requestLLMCommanderDecision
parseLLMDecision
buildDecisionPrompt
getAPIKey
```

问题：

```txt
1. JSON 解析失败时返回 null。
2. 没有 rule-based fallback decision。
3. 没有 schema-level validation。
4. 没有把 role 区分成不同 prompt。
```

必须补：

```txt
1. parse 失败 → 返回 ruleBasedCommanderDecision(context)。
2. JSON 缺字段 → 补默认值。
3. decisions 为空时，根据 legalActionHints 给最小安全 action。
4. player_advisor 和 enemy_commander prompt 要不同。
```

---

## 1.5 Validator

已实现：

```txt
src/ai/llm-decision-validator.ts
```

当前已能检查：

```txt
1. fleetId 必须属于 ownForces。
2. contactId 必须在 knownContacts。
3. suspected / detected contact 不能 launch_strike。
4. unknown contact 不能 strike。
5. protect_base / support_landing 要求 known base。
6. damaged / exhausted / repairing fleet 不能进攻。
```

还缺：

```txt
1. 检查 action.type 是否在 legalActionHints。
2. 检查 targetPosition 是否离 known contact / known objective 太远。
3. 检查 support_landing 必须满足 seaControl / airControl。
4. 检查 repair_fleet 必须有可用基地。
5. 检查 decision 文本中是否泄露隐藏敌舰名。
6. 为 rejected action 生成 replacement action。
```

---

## 1.6 Executor

已实现：

```txt
src/ai/llm-decision-executor.ts
```

但必须确认：

```txt
未实现 action 不能放进 executed。
未实现 action 必须进入 failed。
```

同时还缺这些 action 的真实执行：

```txt
shadow_contact
intercept_contact
protect_supply_line
support_landing
repair_fleet
```

现在这些如果只是占位，不算完成。

---

## 1.7 SearchPlanner

已实现：

```txt
src/ai/search-planner.ts
```

当前功能：

```txt
1. 有 contact 时朝最近 contact 做扇形搜索。
2. 无 contact 时默认向西 / 西北 / 西南搜索。
```

但还太简单。

需要补：

```txt
1. lost contact search ellipse。
2. uncertaintyRadius 越大，搜索扇区越宽。
3. 根据天气降低搜索距离。
4. 根据飞机数量分配 aircraftAllocation。
5. 根据敌方可能速度预测搜索中心。
6. 输出 SearchSectorPlan 可直接给 UI 显示。
```

---

## 1.8 ThreatAssessment

已实现：

```txt
src/ai/threat-assessment.ts
```

当前只输出整体威胁：

```txt
surface
submarine
air
supply
overallThreat
recommendations
```

还需要补：

```txt
1. 每个 contact 的 threatScore。
2. 每个 contact 的 recommendedResponse。
3. 用 own fleet distance / carrier risk / confidence 影响分数。
4. threat assessment 接入 LLMDecisionContext。
5. threat assessment 接入 UI。
```

---

## 1.9 OperationalPlanState

已实现：

```txt
src/ai/operational-plan-state.ts
```

当前有：

```txt
createOperationalPlan
updateOpPhase
addOpAction
markActionExecuted
```

但还缺：

```txt
1. 主 store 没有保存 activeOperationalPlan。
2. LLM 每回合没有先检查 plan 是否仍有效。
3. contact 丢失不会自动退回 search phase。
4. 舰队受损不会触发 abort。
5. UI 没有 OperationPlanPanel。
```

---

## 1.10 NavalDoctrine

已实现：

```txt
src/ai/naval-doctrine.ts
```

当前有：

```txt
carrier_centric
surface_action
island_hopping
attrition_defense
decisive_battle
```

但有类型问题风险：

```ts
export const DOCTRINES: Record = { ... }
```

必须改成：

```ts
export const DOCTRINES: Record<DoctrineType, NavalDoctrine> = { ... }
```

还缺：

```txt
1. faction-specific doctrine。
2. enemy commander 没有读取 doctrine。
3. validator 没有根据 doctrine 限制行动。
4. LLM context 没有 doctrine summary。
```

---

## 1.11 AfterActionReviewPanel

已实现：

```txt
src/components/AfterActionReviewPanel.tsx
```

但目前只是显示：

```txt
回合
天气
双方存活数量
接触数量
战斗事件数量
报告数量
空中任务数量
设施数量
胜负
```

这不是完整 AAR。

还缺：

```txt
1. 上回合 LLM 计划。
2. accepted actions。
3. rejected actions。
4. actual outcome。
5. lesson。
6. memory records。
7. 下回合建议。
```

---

## 1.12 LLMKnowledgePanel

已实现：

```txt
src/components/LLMKnowledgePanel.tsx
```

当前能显示：

```txt
本方舰队
已知接触
报告
合法行动
```

但存在两个问题：

```txt
1. SidePanel 里没有真正渲染 <LLMKnowledgePanel />。
2. 面板没有显示安全断言：
   - enemyShips leaked: false
   - enemyFleets leaked: false
   - hidden truth leaked: false
```

---

## 1.13 AI Tests

当前 tests 目录只有：

```txt
tests/ai-regression.ts
tests/naval-regression.ts
```

`naval-regression.ts` 测的是旧 policy：

```txt
parseCampaignDecision
normalizeCampaignDecision
campaignDecisionToActions
```

这说明：

```txt
新 LLM decision validator / search planner / threat assessment 没有进入 regression test。
```

需要新增：

```txt
tests/llm-knowledge-regression.ts
tests/llm-validator-regression.ts
tests/search-planner-regression.ts
tests/threat-assessment-regression.ts
tests/operational-plan-regression.ts
```

---

# 2. 现在还没有实现的关键项

## P0：会影响运行和安全

```txt
1. App.tsx 未完整渲染。
2. main.tsx 未完整渲染。
3. 源码仍有硬编码 API key。
4. NavalCampaignPanel 仍然直接传硬编码 key。
5. store.getDeepSeekApiKey 仍然 fallback 到硬编码 key。
6. SidePanel 没有真正显示 LLMKnowledgePanel。
7. SidePanel 仍然保留 buildCtx / askLLM 旧逻辑。
```

---

## P1：会影响“LLM 是否真的根据自己信息决策”

```txt
1. NavalCampaignPanel 没接入新 LLM 决策管线。
2. store.requestAIAdvice 仍然用 buildNavalLLMContext，并把所有 fleets 映射给上下文。
3. 敌方 commander 还不是基于 enemy FactionKnowledge。
4. LLM decisions 还没有统一走 validator → executor。
5. CampaignMemory 还只是 SidePanel 局部 state，不是全局持久战役记忆。
```

---

## P2：会影响“游戏是否真的更智能”

```txt
1. SearchPlanner 没有接入行动生成。
2. ThreatAssessment 没有接入 LLM context。
3. OperationalPlanState 没有接入 store。
4. NavalDoctrine 没有影响 LLM / validator。
5. CommanderIntent 未实现。
6. IntelUncertaintyModel 未实现。
7. AfterActionReviewPanel 不显示真实 LLM 计划效果。
```

---

# 3. 下一轮最应该补的功能

## 功能 A：统一 AI Turn Pipeline

新增：

```txt
src/ai/ai-turn-pipeline.ts
```

实现：

```ts
export async function runAITurnPipeline(params: {
  faction: 'player' | 'enemy';
  mode: 'advisor' | 'commander';
  state: NavalStoreState;
  memory: CampaignMemory;
}): Promise<{
  knowledge: FactionKnowledgeState;
  context: LLMDecisionContext;
  decision: LLMCommanderDecision;
  validation: ValidationResult;
  execution?: ExecutionResult;
  memory: CampaignMemory;
}>
```

流程：

```txt
1. buildFactionKnowledge
2. sanitizeKnowledgeForLLM
3. attachSearchPlan
4. attachThreatAssessment
5. attachDoctrine
6. attachCommanderIntent
7. requestLLMCommanderDecision
8. validateLLMCommanderDecision
9. executeLLMDecisionActions
10. updateCampaignMemory
```

目标：

```txt
SidePanel / NavalCampaignPanel / EnemyAI 都调用这个一个函数。
```

---

## 功能 B：Enemy Knowledge Commander

现在敌方舰队仍然有直接向玩家靠近的逻辑。

改成：

```txt
敌方也有 FactionKnowledgeState。
敌方也只看 intel.enemyContacts。
敌方也通过 runAITurnPipeline 决策。
```

新增：

```txt
src/ai/enemy-commander.ts
```

实现：

```ts
export async function runEnemyCommanderTurn(...)
```

验收：

```txt
1. enemy context 不含 playerShips。
2. enemy context 不含 playerFleets。
3. enemy 只能根据 enemyContacts 判断。
4. debugEnemyKnowledgeIsolation 通过。
```

---

## 功能 C：SearchPlanner 接入

当前只是文件存在。

接入：

```txt
sanitizeKnowledgeForLLM → context.searchPlan
SidePanel / NavalScene3D → 显示 search sectors
LLM legalActionHints → 加入 recommended search sectors
execute launch_search → 使用 SearchPlanner 输出的扇区
```

---

## 功能 D：ThreatAssessment 接入

当前只是整体威胁文本。

改成：

```txt
每个 contact 都有 threatScore。
LLM context 里 knownContacts 带 threatScore。
UI 显示威胁颜色。
Validator 根据 threat 和 confidence 拒绝低置信度高风险 strike。
```

---

## 功能 E：OperationalPlanState 接入

Store 新增：

```ts
activeOperationalPlan?: OperationalPlanState;
```

每回合：

```txt
1. 如果没有 plan，LLM 创建 plan。
2. 如果有 plan，先检查是否仍有效。
3. 如果 contact lost，退回 search phase。
4. 如果 fleet damaged，abort。
5. 执行当前 phase actions。
```

---

## 功能 F：CommanderIntent

新增：

```txt
src/ai/commander-intent.ts
```

玩家选择：

```txt
保守保护航母
积极寻找决战
优先搜索
优先保护补给
优先占岛
避免夜战
```

LLM context 必须包含：

```txt
commanderIntent
```

validator 必须拒绝违反 intent 的 action。

---

## 功能 G：IntelUncertaintyModel

新增：

```txt
src/game/naval/intel/intel-uncertainty-model.ts
```

实现：

```txt
suspected contact 可能是误报。
estimatedClass 可能错误。
bad weather 提高误判。
重复探测降低误判。
LLM 只能根据 confidence 决策。
```

---

## 功能 H：AI Regression Tests

新增：

```txt
tests/llm-knowledge-regression.ts
tests/llm-validator-regression.ts
tests/search-planner-regression.ts
tests/threat-assessment-regression.ts
tests/operational-plan-regression.ts
```

package.json 新增：

```json
{
  "scripts": {
    "test:ai": "npm run typecheck && esbuild tests/llm-knowledge-regression.ts --bundle --platform=node --format=esm --outfile=dist/llm-knowledge-regression.mjs && node dist/llm-knowledge-regression.mjs"
  }
}
```

---

# 4. 具体执行顺序

## 第一轮：P0 修能跑 + 安全

必须先做：

```txt
1. 修 src/App.tsx。
2. 修 src/main.tsx。
3. 删除所有硬编码 sk-。
4. NavalCampaignPanel 改用 getAPIKey。
5. store.getDeepSeekApiKey 不允许 fallback 到硬编码 key。
6. SidePanel 真正渲染 <LLMKnowledgePanel />。
7. SidePanel 真正渲染 <AfterActionReviewPanel />。
8. 未实现 action 进入 failed。
9. npm run build。
10. npm run test。
```

---

## 第二轮：统一 AI 决策管线

```txt
1. 新增 src/ai/ai-turn-pipeline.ts。
2. SidePanel 改用 runAITurnPipeline。
3. NavalCampaignPanel 改用 runAITurnPipeline。
4. store.requestAIAdvice 改用 FactionKnowledge。
5. 删除旧 buildCtx / askLLM / resp.includes。
6. campaign memory 从局部 state 改为 store 或持久对象。
```

---

## 第三轮：敌方也用自己的信息决策

```txt
1. 新增 src/ai/enemy-commander.ts。
2. buildFactionKnowledge(faction='enemy')。
3. enemy LLM context 只看 enemyContacts。
4. 删除敌方舰队“直接朝玩家移动”的作弊逻辑。
5. debugEnemyKnowledgeIsolation。
```

---

## 第四轮：智能插件接入

```txt
1. SearchPlanner 接入 context / executor / UI。
2. ThreatAssessment 接入 context / UI / validator。
3. OperationalPlanState 接入 store。
4. NavalDoctrine 接入 context / validator。
5. CommanderIntent 接入 UI / context / validator。
6. IntelUncertaintyModel 接入 contact update。
```

---

## 第五轮：Regression Tests

```txt
1. llm-knowledge-regression。
2. llm-validator-regression。
3. search-planner-regression。
4. threat-assessment-regression。
5. operational-plan-regression。
6. npm run test:ai。
```

---

# 5. 给 OpenCode Plan Mode 的提示词

```txt
你现在处于 Plan Mode。

不要修改代码。
不要创建文件。
不要运行会改动项目的命令。

请阅读 README_NAVAL_SMART_AI_INTEGRATION_V2.md 和当前 test2 仓库，检查：

1. App.tsx / main.tsx 是否还是空壳。
2. 源码是否还有 sk- 硬编码 key。
3. SidePanel 是否真正渲染 LLMKnowledgePanel。
4. SidePanel 是否仍然有 buildCtx / askLLM / resp.includes 旧逻辑。
5. NavalCampaignPanel 是否仍然使用 getLLMCampaignDecision 旧链路。
6. NavalCampaignPanel 是否仍然给 LLM 传 enemyFleets。
7. store.requestAIAdvice 是否仍然把所有 fleets 给 LLM。
8. SearchPlanner 是否接入主流程。
9. ThreatAssessment 是否接入主流程。
10. OperationalPlanState 是否接入 store。
11. NavalDoctrine 是否影响决策。
12. CommanderIntent 是否存在。
13. IntelUncertaintyModel 是否存在。
14. 新 AI tests 是否存在。
15. 你准备按哪些阶段修改。
16. 每阶段修改哪些文件。
17. 每阶段验收标准。

只输出计划，不修改代码。
```

---

# 6. 给 OpenCode Build Mode 的提示词

```txt
你现在进入 Build Mode。

请严格按照 README_NAVAL_SMART_AI_INTEGRATION_V2.md 执行。

目标：
把已经实现的 LLM 情报隔离、validator、executor、memory、search planner、threat assessment、doctrine、plan state 真正接入游戏主流程，并补齐缺失智能模块。

不要重写海战核心。
不要新增 naval-v2。
不要让 LLM 开天眼。
不要让 LLM 直接读取 enemyFleets / enemyShips。
不要在源码中硬编码 API key。
不要跳过 build / test。

第一阶段 P0：
1. 修 App.tsx。
2. 修 main.tsx。
3. 删除所有 sk- 硬编码 key。
4. NavalCampaignPanel 改用 getAPIKey。
5. store.getDeepSeekApiKey 不允许 fallback 到硬编码 key。
6. SidePanel 渲染 LLMKnowledgePanel。
7. SidePanel 渲染 AfterActionReviewPanel。
8. 未实现 action 进入 failed。
9. npm run build。
10. npm run test。

第二阶段：统一 AI Turn Pipeline
1. 新增 src/ai/ai-turn-pipeline.ts。
2. 实现 runAITurnPipeline。
3. SidePanel 改用 runAITurnPipeline。
4. NavalCampaignPanel 改用 runAITurnPipeline。
5. store.requestAIAdvice 改用 FactionKnowledge。
6. 删除旧 buildCtx / askLLM / resp.includes。
7. CampaignMemory 放入 store 或统一持久对象。

第三阶段：敌方独立情报 Commander
1. 新增 src/ai/enemy-commander.ts。
2. enemy 用 buildFactionKnowledge(faction='enemy')。
3. enemy 只看 intel.enemyContacts。
4. 删除敌方舰队直接朝玩家移动的作弊逻辑。
5. 新增 debugEnemyKnowledgeIsolation。

第四阶段：智能插件接入
1. SearchPlanner 接入 context / executor / UI。
2. ThreatAssessment 接入 context / UI / validator。
3. OperationalPlanState 接入 store。
4. NavalDoctrine 接入 context / validator。
5. 新增 CommanderIntent 并接入 UI / context / validator。
6. 新增 IntelUncertaintyModel 并接入 contact update。

第五阶段：AI Regression Tests
1. tests/llm-knowledge-regression.ts。
2. tests/llm-validator-regression.ts。
3. tests/search-planner-regression.ts。
4. tests/threat-assessment-regression.ts。
5. tests/operational-plan-regression.ts。
6. package.json 增加 test:ai。
7. npm run test:ai。

每完成一阶段输出 CHECKPOINT：
- 修改文件
- 新增文件
- 实现内容
- build/test 结果
- 未完成项
```
