# README_NAVAL_SMART_AI_NEXT_PATCH.md
# test2 更新审查：当前实现情况 + 下一轮让游戏更智能的功能补丁

## 0. 当前总判断

当前仓库已经实现了不少“让 LLM 根据自己手中信息决策”的基础文件。

已经有：

```txt
src/ai/information-filter.ts
src/ai/llm-decision-types.ts
src/ai/llm-decision-validator.ts
src/ai/llm-decision-executor.ts
src/ai/campaign-memory.ts
src/ai/llm-decision-debug.ts
src/components/LLMKnowledgePanel.tsx
src/ai/api-key.ts
```

这些说明上一轮的方向已经开始落地。

但是现在有两个严重问题：

```txt
1. 新的情报隔离 / validator / memory 还没有真正接入主游戏循环。
2. 老的 SidePanel / NavalCampaignPanel / campaign-runner 仍然在用旧式 LLM 调用方式。
```

现在项目状态是：

```txt
新系统文件存在，但主流程仍然大量使用旧逻辑。
```

下一轮不应该继续堆新 UI，而应该把 LLM 决策链统一起来。

---

## 1. 之前要求的功能实现检查

### 1.1 Vite 项目结构

已实现。

`package.json` 当前是 Vite 项目：

```txt
dev = vite
build = tsc --noEmit && vite build
test = npm run typecheck && esbuild tests/naval-regression.ts ...
```

但存在问题：

```txt
src/App.tsx 仍然像是不完整 JSX。
src/main.tsx 仍然像是不完整 render。
```

必须先修，否则 build 很可能失败。

---

### 1.2 API Key localStorage 管理

部分实现。

已经有：

```txt
src/ai/api-key.ts
```

其中提供：

```txt
getAPIKey
setAPIKey
clearAPIKey
```

并从：

```txt
localStorage.getItem('deepseek_api_key')
```

读取。

但是仍然有问题：

```txt
src/store/naval-store.ts 仍然有硬编码 sk-...
src/components/NavalCampaignPanel.tsx 仍然有硬编码 sk-...
src/campaign-runner.ts 仍然有硬编码 sk-...
```

这是必须立即修复的安全问题。

要求：

```txt
1. 删除所有源码中的 sk- 开头 key。
2. 已经提交到 GitHub 的 key 必须作废。
3. 所有 LLM 调用统一使用 src/ai/api-key.ts。
4. 如果没有 key，就显示“请先输入 API Key”，不要 fallback 到硬编码 key。
```

---

### 1.3 情报隔离 Information Filter

部分实现。

已经有：

```txt
src/ai/information-filter.ts
```

实现了：

```txt
buildFactionKnowledge
sanitizeKnowledgeForLLM
generateLegalActionHints
```

正确点：

```txt
1. player 只使用 playerFleets 作为 ownFleets。
2. enemy 只使用 enemyFleets 作为 ownFleets。
3. 敌情 contact 来自 intel.playerContacts / intel.enemyContacts。
4. sanitize 后输出 LLMDecisionContext。
```

问题：

```txt
1. buildFactionKnowledge 仍然接收 truth.enemyFleets，但理论上只在内部按 faction 取 own fleets。
2. 需要增加单元测试，证明 sanitize 后没有 enemyFleets / enemyShips / hidden / truth 字段。
3. memory 类型用了 any，需要改成 CampaignMemory。
4. knownBases 现在只返回本方基地，后续应支持“已侦察敌方基地”，不能完全隐藏所有敌基地。
```

---

### 1.4 LLM JSON 决策类型

已实现基础版本。

已经有：

```txt
src/ai/llm-decision-types.ts
```

里面定义了：

```txt
LLMDecisionContext
LLMCommanderDecision
LLMDecisionAction
LLMDecisionActionType
```

当前 action 包括：

```txt
assign_mission
move_fleet
launch_search
launch_cap
launch_strike
shadow_contact
intercept_contact
withdraw_fleet
repair_fleet
protect_base
protect_supply_line
support_landing
hold_position
```

问题：

```txt
这些类型存在，但 provider.ts / SidePanel.tsx / NavalCampaignPanel.tsx 还没有统一改成只用这个 schema。
```

---

### 1.5 Validator

部分实现。

已经有：

```txt
src/ai/llm-decision-validator.ts
```

它已经能检查：

```txt
1. fleetId 是否属于 ownForces。
2. contactId 是否在 knownContacts。
3. suspected / detected contact 不能 strike。
4. protect_base / support_landing 的 baseId 必须已知。
5. damaged / exhausted / repairing fleet 不能进攻。
```

缺少：

```txt
1. 没有检查 decision JSON 里是否包含隐藏敌舰真实名字。
2. 没有检查 targetPosition 是否离已知 contact / objective 太远。
3. 没有检查 action.type 是否在 legalActionHints。
4. 没有检查 repair_fleet 必须有可用基地。
5. 没有检查 support_landing 必须满足制海权 / 制空权。
6. 没有给 rejected action 生成替代建议。
```

---

### 1.6 Executor

部分实现。

已经有：

```txt
src/ai/llm-decision-executor.ts
```

已执行：

```txt
assign_mission
move_fleet
launch_search
launch_cap
launch_strike
withdraw_fleet
hold_position
repair_fleet
```

问题：

```txt
1. shadow_contact 没有真正实现。
2. intercept_contact 没有真正实现。
3. protect_supply_line 没有真正实现。
4. support_landing 没有真正实现。
5. 未实现 action 直接返回 "Action type not implemented"，但仍算 executed，这不对。
```

要求：

```txt
未实现 action 必须进入 failed，不允许算 executed。
```

---

### 1.7 Campaign Memory

基础实现。

已经有：

```txt
src/ai/campaign-memory.ts
```

实现：

```txt
createCampaignMemory
recordPlan
updateCampaignMemory
getMemorySummary
```

问题：

```txt
1. 没看到主游戏循环每回合调用 updateCampaignMemory。
2. SidePanel / NavalCampaignPanel 没有把 memorySummary 放进 LLM 上下文。
3. memory 还不能影响下一回合策略。
```

---

### 1.8 LLMKnowledgePanel

部分实现。

已经有：

```txt
src/components/LLMKnowledgePanel.tsx
```

它能显示：

```txt
本方舰队数量
已知 contact 数量
报告数量
合法行动
```

问题：

```txt
1. SidePanel 中看起来只是写了注释“LLM 可见情报”，不确定是否真正渲染 <LLMKnowledgePanel />。
2. 需要在 UI 上明确显示：
   - hidden enemy leaked: false
   - context enemyShips count: 0
   - context enemyFleets count: 0
```

---

### 1.9 Debug 测试

部分实现。

已经有：

```txt
src/ai/llm-decision-debug.ts
```

实现：

```txt
debugLLMKnowledgeIsolation
debugLLMContactBasedDecision
```

问题：

```txt
1. 没有接入 Web debug 按钮。
2. 没有接入 npm test。
3. debug 里用了很多 as any，应该补真实 mock factory。
```

---

## 2. 现在最该补的智能功能

下面这些功能不是“多加一个 LLM prompt”，而是让游戏真的更智能。

---

# 功能 1：统一 LLM 决策管线

## 目标

所有 LLM 调用都必须走同一条链：

```txt
buildFactionKnowledge
→ sanitizeKnowledgeForLLM
→ requestLLMCommanderDecision
→ validateLLMCommanderDecision
→ executeLLMDecisionActions
→ updateCampaignMemory
```

禁止旧链：

```txt
buildCtx 字符串
→ askLLM 自由文本
→ resp.includes('搜索')
→ 手动 setState
```

---

## 要改文件

```txt
src/components/SidePanel.tsx
src/components/NavalCampaignPanel.tsx
src/ai/provider.ts
src/ai/campaign-controller.ts
src/store/naval-store.ts
```

---

## 具体要求

### A. provider.ts 新增 requestLLMCommanderDecision

```ts
export async function requestLLMCommanderDecision(params: {
  config: AIProviderConfig;
  context: LLMDecisionContext;
  role: 'player_advisor' | 'enemy_commander';
}): Promise<LLMCommanderDecision>
```

必须：

```txt
1. system prompt 要求严格 JSON。
2. 不允许 Markdown。
3. JSON parse 失败要 fallback 到 ruleBasedCommanderDecision。
4. 返回必须符合 LLMCommanderDecision。
```

---

### B. SidePanel 删除 buildCtx / askLLM 旧逻辑

删除或停止使用：

```txt
buildCtx
askLLM
resp.includes('搜索')
resp.includes('打击')
resp.includes('撤退')
```

改成：

```txt
runLLMTurn(faction='player')
```

流程：

```txt
const knowledge = buildFactionKnowledge(...)
const context = sanitizeKnowledgeForLLM(knowledge)
const decision = await requestLLMCommanderDecision(...)
const validation = validateLLMCommanderDecision(...)
const exec = executeLLMDecisionActions(validation.acceptedActions, ...)
updateCampaignMemory(...)
```

---

### C. NavalCampaignPanel 删除硬编码 key

当前它直接传硬编码 key。

必须改成：

```txt
const apiKey = getAPIKey()
if (!apiKey) {
  addLog('请先输入 API Key')
  return
}
```

---

## 验收

```txt
1. SidePanel 不再有 askLLM。
2. SidePanel 不再有 resp.includes。
3. NavalCampaignPanel 不再有硬编码 key。
4. provider.ts 有 requestLLMCommanderDecision。
5. LLM 返回 JSON。
6. validator 拦截非法 action。
7. executor 只执行 accepted action。
8. memory 每回合更新。
```

---

# 功能 2：敌方也用“自己的情报”决策

## 目标

当前玩家 LLM 做建议，敌方多半还是简单追击或规则 AI。

需要让敌方也有自己的知识状态：

```txt
buildFactionKnowledge(faction='enemy')
```

敌方 LLM 只能看到：

```txt
enemy own fleets
enemy own ships
intel.enemyContacts
enemy reports
enemy memory
```

不能看到：

```txt
player real hidden fleet
player real damage
player real plan
```

---

## 要改文件

```txt
src/store/naval-store.ts
src/ai/information-filter.ts
src/ai/campaign-controller.ts
src/ai/llm-decision-debug.ts
```

---

## 新增

```ts
export async function runFactionCommanderDecision(params: {
  faction: 'player' | 'enemy';
  config: AIProviderConfig;
  truth: NavalWorldTruthState;
  intel: NavalIntelState;
  reports: NavalAIReport[];
  memory: CampaignMemory;
  currentTurn: number;
}): Promise<{
  context: LLMDecisionContext;
  decision: LLMCommanderDecision;
  validation: ValidationResult;
  execution?: ExecutionResult;
  memory: CampaignMemory;
}>
```

---

## 验收

```txt
1. player commander context 不含 enemyShips。
2. enemy commander context 不含 playerShips。
3. enemy commander 只根据 intel.enemyContacts 行动。
4. debugEnemyKnowledgeIsolation 通过。
```

---

# 功能 3：侦察计划智能化

## 目标

现在搜索比较粗糙。

需要新增“搜索计划器”：

```txt
SearchPlanner
```

它根据：

```txt
1. 上次 contact 位置。
2. uncertaintyRadius。
3. 敌方可能速度。
4. 敌方可能航向。
5. 航母/陆基飞机航程。
6. 天气。
7. 当前搜索覆盖空白。
```

生成：

```txt
search arcs
search routes
search priorities
```

---

## 新增文件

```txt
src/ai/search-planner.ts
```

---

## 数据结构

```ts
export interface SearchSectorPlan {
  id: string;
  originFleetId?: string;
  originBaseId?: string;

  centerHeadingDeg: number;
  arcDeg: number;
  range: number;

  reason: string;

  priority: number;

  basedOnContactId?: string;
}
```

---

## 规则

```txt
无 contact：
  全周搜索，但优先敌方基地方向 / 航道方向。

suspected contact：
  围绕 lastKnownPosition + uncertaintyRadius 扇形搜索。

lost contact：
  按可能速度扩大搜索椭圆。

weather bad：
  缩小有效搜索半径，需要更多架次。

航母危险：
  优先陆基搜索或远距扇区。
```

---

## 验收

```txt
1. 无 contact 时生成全周搜索。
2. suspected contact 时搜索扇区指向 lastKnownPosition。
3. lost contact 时根据 uncertaintyRadius 扩大搜索范围。
4. 搜索计划可以传给 LLMDecisionContext.legalActionHints。
5. UI 能显示搜索扇区。
```

---

# 功能 4：威胁评估系统

## 目标

LLM 需要知道“哪个 contact 更危险”。

新增：

```txt
ThreatAssessment
```

不要让 LLM 自己乱猜。

---

## 新增文件

```txt
src/ai/threat-assessment.ts
```

---

## 类型

```ts
export interface ContactThreatAssessment {
  contactId: string;

  threatLevel: 'low' | 'medium' | 'high' | 'critical';

  threatScore: number;

  reasons: string[];

  recommendedResponse:
    | 'ignore'
    | 'shadow'
    | 'search'
    | 'strike'
    | 'intercept'
    | 'withdraw';
}
```

---

## 评分规则

```txt
tracked carrier contact:
  +80

identified battleship within surface range:
  +60

classified destroyer close to carrier:
  +50

submarine suspected near carrier:
  +70

contact uncertainty very high:
  -20 to direct strike
  +20 to search/shadow

own carrier damaged:
  +30 to withdraw/defensive response
```

---

## 验收

```txt
1. 每个 knownContact 都有 threatScore。
2. high threat contact 会优先进入 LLM context。
3. suspected contact 不会直接变成 strike。
4. threat assessment 出现在 LLMKnowledgePanel。
```

---

# 功能 5：作战计划状态机

## 目标

现在 LLM 每回合容易“即兴发挥”。

需要让它生成并遵守一个 plan：

```txt
OperationalPlan
```

例如：

```txt
Phase 1: search
Phase 2: shadow
Phase 3: strike
Phase 4: egress / withdraw
```

---

## 新增文件

```txt
src/ai/operational-plan-state.ts
```

---

## 类型

```ts
export interface OperationalPlanState {
  id: string;

  ownerFaction: 'player' | 'enemy';

  objective: string;

  currentPhaseIndex: number;

  phases: Array<{
    id: string;
    name: string;

    goal: string;

    requiredIntelLevel?: 'suspected' | 'detected' | 'classified' | 'identified' | 'tracked';

    tasks: LLMDecisionAction[];

    successConditions: string[];

    abortConditions: string[];
  }>;

  status:
    | 'draft'
    | 'active'
    | 'paused'
    | 'completed'
    | 'aborted'
    | 'failed';

  createdTurn: number;
  lastUpdatedTurn: number;
}
```

---

## 验收

```txt
1. LLM 第一次生成 plan。
2. 后续回合先检查 plan 是否还有效。
3. 如果 contact 丢失，plan 退回 search phase。
4. 如果航母受损，plan 触发 abort。
5. UI 显示当前计划阶段。
```

---

# 功能 6：敌方行为模型 / Doctrine

## 目标

让敌方不是单纯追击。

增加 doctrine：

```txt
JapaneseDoctrine
USDoctrine
```

---

## 新增文件

```txt
src/ai/naval-doctrine.ts
```

---

## 类型

```ts
export interface NavalDoctrine {
  faction: 'player' | 'enemy';

  carrierRiskTolerance: 'low' | 'medium' | 'high';

  surfaceBattlePreference: number;

  nightAttackPreference: number;

  torpedoAttackPreference: number;

  submarineRaidPreference: number;

  retreatThreshold: number;

  searchAggressiveness: number;

  preserveCapitalShips: boolean;
}
```

---

## 例子

```txt
US doctrine:
  carrierRiskTolerance = low
  searchAggressiveness = high
  preserveCapitalShips = true
  surfaceBattlePreference = medium

Japanese doctrine:
  nightAttackPreference = high
  torpedoAttackPreference = high
  surfaceBattlePreference = high
  carrierRiskTolerance = medium/high
```

---

## 验收

```txt
1. enemy commander 决策受到 doctrine 影响。
2. Japanese doctrine 更偏夜战和鱼雷。
3. US doctrine 更偏航母搜索和远程打击。
4. LLM context 中包含 own doctrine summary。
```

---

# 功能 7：情报置信度和误判

## 目标

游戏更智能不等于更准确。  
真实战争中会误判。

新增：

```txt
IntelUncertaintyModel
```

---

## 新增文件

```txt
src/game/naval/intel/intel-uncertainty-model.ts
```

---

## 功能

```txt
1. suspected contact 可能是误报。
2. estimatedClass 可能错误。
3. estimatedCount 可能错误。
4. bad weather 提高误判。
5. 连续观测可以修正误判。
6. LLM 必须根据 confidence 决策。
```

---

## 验收

```txt
1. suspected contact 有 falsePositiveChance。
2. low confidence 不允许 strike。
3. repeated detection 可以提高 confidence。
4. report 显示“可能是巡洋舰/可能是航母”。
```

---

# 功能 8：Commander's Intent / 玩家意图

## 目标

玩家不是每回合微操，而是给战略意图。

新增：

```txt
CommanderIntent
```

例如：

```txt
保守保护航母
积极寻找决战
优先保护登陆船队
优先切断补给线
避免夜战
```

---

## 新增文件

```txt
src/ai/commander-intent.ts
```

---

## 类型

```ts
export interface CommanderIntent {
  riskTolerance: 'low' | 'medium' | 'high';

  priorities: Array<
    | 'preserve_carriers'
    | 'destroy_enemy_carriers'
    | 'protect_convoys'
    | 'capture_islands'
    | 'cut_supply_lines'
    | 'avoid_night_battle'
    | 'seek_decisive_battle'
  >;

  forbiddenActions: Array<
    | 'surface_duel_with_carrier_tf'
    | 'strike_low_confidence_contact'
    | 'operate_beyond_air_cover'
  >;
}
```

---

## 验收

```txt
1. 玩家可以选择 commander intent。
2. LLM context 包含 commander intent。
3. validator 拒绝违反 forbiddenActions 的命令。
4. AI 行为明显受 intent 影响。
```

---

# 功能 9：After Action Review 面板

## 目标

让 LLM 自我总结，而不是失忆。

新增：

```txt
src/components/AfterActionReviewPanel.tsx
```

---

## 显示

```txt
本回合计划
被接受的动作
被拒绝的动作
实际结果
成功/失败
下回合教训
```

---

## 验收

```txt
1. 每回合结束生成 AAR。
2. 下一回合 LLM 能看到 AAR memory。
3. 玩家可以查看历史。
```

---

# 功能 10：智能测试 / Regression

## 目标

不要每次靠肉眼。

把关键智能机制接入测试：

```txt
tests/llm-knowledge-regression.ts
tests/llm-validator-regression.ts
tests/search-planner-regression.ts
tests/threat-assessment-regression.ts
tests/operational-plan-regression.ts
```

---

## npm script

修改 package.json：

```json
{
  "scripts": {
    "test:ai": "npm run typecheck && esbuild tests/llm-knowledge-regression.ts --bundle --platform=node --format=esm --outfile=dist/llm-knowledge-regression.mjs && node dist/llm-knowledge-regression.mjs"
  }
}
```

---

# 必须立刻修的 P0 问题

## P0-1：修 Vite 入口

当前：

```txt
src/App.tsx
src/main.tsx
```

看起来是不完整 JSX。

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

## P0-2：删除所有硬编码 API Key

必须全文搜索：

```bash
grep -R "sk-" -n src tests
```

修复：

```txt
src/store/naval-store.ts
src/components/NavalCampaignPanel.tsx
src/campaign-runner.ts
```

全部改成：

```ts
import { getAPIKey } from './ai/api-key';
```

或者对应相对路径。

---

## P0-3：把 LLMKnowledgePanel 真正挂到 SidePanel

在 SidePanel 中加入：

```tsx
<LLMKnowledgePanel />
```

不要只是注释。

---

## P0-4：修未实现 action 不能算成功

在 `llm-decision-executor.ts` 中：

```txt
default:
  failed.push(...)
```

不要：

```txt
executed.push({ result: 'Action type not implemented' })
```

---

## P0-5：运行 build 和 test

必须跑：

```bash
npm run build
npm run test
```

如果失败，先修失败，不要继续堆新功能。

---

# 推荐执行顺序

```txt
第一轮：P0 修能跑 + 安全
  1. 修 App.tsx / main.tsx
  2. 删除硬编码 key
  3. LLMKnowledgePanel 真正挂上
  4. 未实现 action 算 failed
  5. npm run build / npm run test

第二轮：统一 LLM 管线
  1. provider.ts requestLLMCommanderDecision
  2. SidePanel 删除旧 askLLM
  3. NavalCampaignPanel 使用 validator/executor/memory
  4. 玩家/敌方都用 FactionKnowledge

第三轮：智能插件
  1. SearchPlanner
  2. ThreatAssessment
  3. OperationalPlanState
  4. NavalDoctrine
  5. IntelUncertaintyModel
  6. CommanderIntent

第四轮：UI
  1. LLMKnowledgePanel 增强
  2. OperationPlanPanel
  3. ThreatPanel
  4. AfterActionReviewPanel

第五轮：Regression Tests
  1. llm-knowledge-regression
  2. llm-validator-regression
  3. search-planner-regression
  4. threat-assessment-regression
```

---

# 给 OpenCode Plan Mode 的提示词

```txt
你现在处于 Plan Mode。

不要修改代码。
不要创建文件。
不要运行会改动项目的命令。

请阅读 README_NAVAL_SMART_AI_NEXT_PATCH.md 和当前 test2 仓库，先检查：

1. App.tsx / main.tsx 是否能 build。
2. src 中是否仍有硬编码 sk-。
3. LLMKnowledgePanel 是否真正挂在 SidePanel。
4. SidePanel 是否仍有 buildCtx / askLLM / resp.includes 旧逻辑。
5. NavalCampaignPanel 是否仍直接传硬编码 key。
6. information-filter 是否已经实现。
7. llm-decision-types 是否已经实现。
8. validator 是否已经实现且够严格。
9. executor 是否把未实现 action 当成 failed。
10. memory 是否接入主回合循环。
11. debug 是否接入 test。
12. 下一步最小修复计划。

只输出计划，不修改代码。
```

---

# 给 OpenCode Build Mode 的提示词

```txt
你现在进入 Build Mode。

请严格按照 README_NAVAL_SMART_AI_NEXT_PATCH.md 执行。

目标：
检查上一轮 LLM 情报隔离系统是否真正接入，并补充让游戏更智能的功能。

不要重写海战核心。
不要新增 naval-v2。
不要让 LLM 开天眼。
不要让 LLM 直接读取 enemyFleets / enemyShips。
不要在源码中硬编码 API key。
不要跳过 build / test。

第一优先级 P0：
1. 修 App.tsx / main.tsx。
2. 全文删除硬编码 sk-。
3. SidePanel 真正渲染 LLMKnowledgePanel。
4. llm-decision-executor 中未实现 action 必须 failed。
5. npm run build。
6. npm run test。

第二优先级：统一 LLM 决策管线
1. provider.ts 新增 requestLLMCommanderDecision。
2. SidePanel 删除旧 buildCtx / askLLM / resp.includes。
3. NavalCampaignPanel 改用：
   buildFactionKnowledge
   sanitizeKnowledgeForLLM
   requestLLMCommanderDecision
   validateLLMCommanderDecision
   executeLLMDecisionActions
   updateCampaignMemory
4. 玩家和敌方都用 FactionKnowledgeState。

第三优先级：智能功能
1. 新增 SearchPlanner。
2. 新增 ThreatAssessment。
3. 新增 OperationalPlanState。
4. 新增 NavalDoctrine。
5. 新增 IntelUncertaintyModel。
6. 新增 CommanderIntent。
7. 新增 AfterActionReviewPanel。
8. 新增 AI regression tests。

每完成一个阶段输出 CHECKPOINT：
- 修改文件
- 新增文件
- 实现内容
- build/test 结果
- 未完成项
```
