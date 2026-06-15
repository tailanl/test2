# README_LLM_KNOWLEDGE_BASED_DECISION_SYSTEM.md
# 让大模型只根据自己手中的信息进行决策：情报隔离 + 受约束决策 + 验证执行系统

## 0. 目标

当前目标不是简单“让 LLM 更聪明”。

真正目标是：

```txt
LLM 只能根据自己阵营已经知道的信息决策。
LLM 不能读取真实敌军状态。
LLM 不能看到未侦察敌舰。
LLM 不能知道隐藏舰队位置。
LLM 不能知道敌方真实损伤。
LLM 不能直接修改游戏状态。
```

正确流程应该是：

```txt
真实世界状态
  → 情报系统生成本方已知信息
  → information filter 过滤
  → LLM 获得本方情报包
  → LLM 输出 JSON 决策
  → validator 检查是否合法
  → executor 执行合法命令
  → battle log / reports / memory 更新
```

错误流程是：

```txt
真实 enemy fleets / enemy ships
  → 直接塞给 LLM
  → LLM 开天眼决策
```

这个 README 的任务是把 `test2` 的 LLM 改成 **基于本方信息的战争参谋 / 指挥官系统**。

---

## 1. 核心概念

### 1.1 真实世界状态

真实世界状态是游戏内部用的，包含所有真实信息：

```ts
export interface NavalWorldTruthState {
  turn: number;

  playerFleets: StrategicFleet[];
  enemyFleets: StrategicFleet[];

  playerShips: NavalShip[];
  enemyShips: NavalShip[];

  allBases: PacificBase[];
  allSupplyLines: SupplyLine[];

  weather: NavalWeatherState;

  hiddenEvents: NavalHiddenEvent[];
}
```

这个状态只能给：

```txt
1. 探测系统 detection resolver
2. 战斗结算 battle resolver
3. debug 测试
4. 存档系统
```

不能给：

```txt
1. LLM
2. UI 中的敌情显示
3. AI planner
4. report writer
```

---

### 1.2 某一方已知情报状态

新增：

```txt
src/game/naval/intel/faction-knowledge-types.ts
```

```ts
export type FactionId = 'player' | 'enemy';

export interface FactionKnowledgeState {
  faction: FactionId;

  turn: number;

  knownOwnFleets: KnownOwnFleet[];

  knownOwnShips: KnownOwnShip[];

  knownContacts: NavalContact[];

  knownBases: KnownBase[];

  knownSupplyLines: KnownSupplyLine[];

  knownAirMissions: KnownAirMission[];

  recentReports: NavalAIReport[];

  recentBattleEvents: KnownBattleEvent[];

  assumptions: IntelligenceAssumption[];

  memory: CampaignMemory;
}
```

这个状态是 LLM 的唯一输入来源。

---

### 1.3 Contact 不是敌舰真身

LLM 看到的敌人必须是：

```ts
NavalContact
```

不是：

```ts
NavalShip
StrategicFleet
```

`NavalContact` 只包含：

```txt
1. 估计位置
2. 不确定半径
3. detectionLevel
4. confidence
5. 估计类型
6. 最后发现回合
7. 探测来源
8. track history
```

不能包含：

```txt
1. 真实 HP
2. 真实舰名
3. 真实模块损伤
4. 真实弹药
5. 真实航向，除非已被 tracked
6. 真实舰队编成，除非已被 identified
```

---

## 2. 必须删除的错误设计

检查并修复所有给 LLM 的上下文构建。

重点检查：

```txt
src/ai/provider.ts
src/ai/types.ts
src/ai/campaign-controller.ts
src/ai/naval-campaign-policy.ts
src/components/SidePanel.tsx
src/components/NavalAIAdvisorPanel.tsx
src/components/NavalCampaignPanel.tsx
src/store/naval-store.ts
```

禁止出现：

```txt
敌方舰队(开天眼情报)
enemyFleets.map(...)
enemyShips.map(...)
fleet.faction === 'enemy' && 直接塞给 LLM
ship.faction === 'enemy' && 直接塞给 LLM
```

允许出现：

```txt
contacts.map(...)
knownContacts.map(...)
recentReports.map(...)
lastKnownPosition
uncertaintyRadius
confidence
detectionLevel
```

---

## 3. 新增 Information Filter

### 3.1 文件

新增：

```txt
src/ai/information-filter.ts
```

---

### 3.2 buildFactionKnowledge

实现：

```ts
export function buildFactionKnowledge(params: {
  faction: FactionId;

  truth: NavalWorldTruthState;

  intel: NavalIntelState;

  reports: NavalAIReport[];

  memory: CampaignMemory;

  currentTurn: number;
}): FactionKnowledgeState
```

规则：

```txt
如果 faction = player：
  ownFleets = playerFleets 真实信息
  ownShips = playerShips 真实信息
  contacts = intel.playerContacts
  不包含 enemyFleets 真实信息
  不包含 enemyShips 真实信息

如果 faction = enemy：
  ownFleets = enemyFleets 真实信息
  ownShips = enemyShips 真实信息
  contacts = intel.enemyContacts
  不包含 playerFleets 真实信息
  不包含 playerShips 真实信息
```

注意：

```txt
本方真实信息可以知道。
敌方只能通过 contacts 知道。
```

---

### 3.3 sanitizeKnowledgeForLLM

实现：

```ts
export function sanitizeKnowledgeForLLM(
  knowledge: FactionKnowledgeState
): LLMDecisionContext
```

该函数负责把游戏对象压缩成 LLM 可读摘要。

输出里必须没有：

```txt
enemyShips
enemyFleets
hidden
truth
omniscient
debugOnly
```

---

### 3.4 CHECKPOINT INFO-1

必须输出：

```txt
[CHECKPOINT INFO-1]
- buildFactionKnowledge exists:
- sanitizeKnowledgeForLLM exists:
- player LLM context contains player own fleets:
- player LLM context contains contacts:
- player LLM context does not contain enemyShips:
- player LLM context does not contain enemyFleets:
- enemy LLM context does not contain playerShips:
- enemy LLM context does not contain playerFleets:
```

---

## 4. LLM 决策上下文

### 4.1 文件

新增：

```txt
src/ai/llm-decision-types.ts
```

---

### 4.2 LLMDecisionContext

```ts
export interface LLMDecisionContext {
  faction: FactionId;

  turn: number;

  currentPhase?: PacificWarPhaseId;

  strategicSituation: {
    posture: 'defense' | 'raid' | 'search' | 'offensive' | 'withdraw' | 'landing_support';
    currentObjectives: string[];
    riskTolerance: 'low' | 'medium' | 'high';
  };

  ownForces: Array<{
    fleetId: string;
    name: string;
    type: string;
    position: { x: number; y: number };
    readiness: string;
    damageSummary: string;
    fuelState: string;
    ammoState: string;
    aircraftState?: string;
    currentMission?: string;
  }>;

  knownContacts: Array<{
    contactId: string;
    contactType: string;
    detectionLevel: string;
    confidence: string;
    estimatedClass?: string;
    estimatedCount?: number;
    lastKnownPosition: { x: number; y: number };
    uncertaintyRadius: number;
    lastDetectedTurn: number;
    detectedBy: string[];
  }>;

  knownBases: Array<{
    baseId: string;
    name: string;
    owner: string;
    type: string;
    level?: number;
    knownDamage?: number;
    supplyKnown?: string;
  }>;

  knownSupplyLines: Array<{
    supplyLineId: string;
    from: string;
    to: string;
    status: string;
    riskEstimate: string;
  }>;

  recentReports: Array<{
    turn: number;
    type: string;
    summary: string;
    facts: string[];
    estimates: string[];
  }>;

  memorySummary: {
    previousPlan?: string;
    previousOutcome?: string;
    recurringProblems: string[];
    enemyPatternEstimates: string[];
  };

  legalActionHints: string[];
}
```

---

### 4.3 legalActionHints

根据当前情报生成可行动作提示。

示例：

```txt
如果没有 contacts：
  legalActionHints:
    - launch_search
    - reposition
    - protect_supply_line
    - hold_position

如果 contact = suspected：
  legalActionHints:
    - launch_search_toward_contact
    - shadow_contact
    - avoid_contact
  不允许:
    - launch_strike

如果 contact = classified / identified / tracked：
  legalActionHints:
    - launch_strike
    - intercept
    - shadow_contact
    - withdraw
```

注意：

```txt
legalActionHints 不是最终命令。
只是告诉 LLM 当前情报下哪些动作合理。
```

---

## 5. LLM 输出必须是 JSON

不要再让 LLM 自由写一段中文建议再靠关键词解析。

新增：

```txt
src/ai/llm-decision-schema.ts
```

---

### 5.1 LLMCommanderDecision

```ts
export interface LLMCommanderDecision {
  assessment: string;

  intent:
    | 'search'
    | 'shadow'
    | 'intercept'
    | 'strike'
    | 'withdraw'
    | 'protect'
    | 'raid'
    | 'support_landing'
    | 'repair'
    | 'hold';

  confidence: 'low' | 'medium' | 'high';

  risk: 'low' | 'medium' | 'high';

  decisions: LLMDecisionAction[];

  assumptions: string[];

  informationGaps: string[];

  abortConditions: string[];

  nextReviewTurn: number;
}
```

---

### 5.2 LLMDecisionAction

```ts
export type LLMDecisionActionType =
  | 'assign_mission'
  | 'move_fleet'
  | 'launch_search'
  | 'launch_cap'
  | 'launch_strike'
  | 'shadow_contact'
  | 'intercept_contact'
  | 'withdraw_fleet'
  | 'repair_fleet'
  | 'protect_base'
  | 'protect_supply_line'
  | 'support_landing'
  | 'hold_position';

export interface LLMDecisionAction {
  type: LLMDecisionActionType;

  fleetId?: string;

  contactId?: string;

  baseId?: string;

  supplyLineId?: string;

  targetPosition?: {
    x: number;
    y: number;
  };

  priority: number;

  reason: string;
}
```

---

### 5.3 Prompt 要求

Prompt 必须明确：

```txt
你是某一方的海军指挥官。
你只能根据下面给出的已知情报决策。
你不能假设存在未列出的敌舰。
你不能使用真实隐藏信息。
如果情报不足，优先搜索、侦察、保护和保持距离。
你必须返回严格 JSON。
不要返回 Markdown。
不要返回解释文字。
```

---

## 6. Validator：比 LLM 更重要

### 6.1 文件

新增：

```txt
src/ai/llm-decision-validator.ts
```

---

### 6.2 validateLLMCommanderDecision

```ts
export function validateLLMCommanderDecision(params: {
  decision: LLMCommanderDecision;

  context: LLMDecisionContext;

  knowledge: FactionKnowledgeState;
}): {
  valid: boolean;

  acceptedActions: LLMDecisionAction[];

  rejectedActions: Array<{
    action: LLMDecisionAction;
    reason: string;
  }>;

  correctedDecision?: LLMCommanderDecision;
}
```

---

### 6.3 Validator 规则

#### 规则 1：fleetId 必须是本方已知舰队

```txt
如果 action.fleetId 不在 ownForces：
  reject
```

---

#### 规则 2：contactId 必须在 knownContacts

```txt
如果 action.contactId 不在 knownContacts：
  reject
```

---

#### 规则 3：strike 需要足够情报

```txt
launch_strike 只允许 contact.detectionLevel in:
  classified
  identified
  tracked

如果 contact 是 suspected / detected：
  reject，建议 launch_search / shadow_contact
```

---

#### 规则 4：intercept 至少需要 detected

```txt
intercept_contact 需要:
  detected / classified / identified / tracked

suspected 只能 shadow 或 search。
```

---

#### 规则 5：不能对未知基地行动

```txt
protect_base / support_landing 需要 baseId 在 knownBases。
```

---

#### 规则 6：受损舰队不能强攻

```txt
如果 fleet readiness = repairing / exhausted：
  reject launch_strike / intercept
  allow withdraw / repair / protect
```

---

#### 规则 7：不能开天眼

检查 decision JSON 中是否包含：

```txt
enemyShips
enemyFleets
Yamato
Enterprise
真实舰名
隐藏舰队坐标
```

除非这些信息出现在 knownContacts 或 ownForces。

---

### 6.4 CHECKPOINT VALIDATOR-1

输出：

```txt
[CHECKPOINT VALIDATOR-1]
- unknown contact strike rejected:
- suspected contact strike rejected:
- classified contact strike accepted:
- unknown fleet action rejected:
- damaged fleet strike rejected:
- legal search accepted:
```

---

## 7. Executor：LLM 不直接改 store

### 7.1 文件

新增：

```txt
src/ai/llm-decision-executor.ts
```

---

### 7.2 executeLLMDecisionActions

```ts
export function executeLLMDecisionActions(params: {
  actions: LLMDecisionAction[];

  storeActions: {
    assignMission: (...args: any[]) => void;
    moveFleet: (...args: any[]) => void;
    launchSearch: (...args: any[]) => void;
    launchCap: (...args: any[]) => void;
    launchStrike: (...args: any[]) => void;
    withdrawFleet: (...args: any[]) => void;
  };

  currentTurn: number;
}): {
  executed: Array<{
    action: LLMDecisionAction;
    result: string;
  }>;

  failed: Array<{
    action: LLMDecisionAction;
    reason: string;
  }>;
}
```

LLM 只能输出动作请求。

真正执行必须走：

```txt
validator → executor → store action
```

禁止：

```txt
LLM response 直接 set state
LLM response 直接修改 fleets
LLM response 直接修改 ships
```

---

## 8. Memory：让 LLM 记住自己的计划效果

### 8.1 文件

新增：

```txt
src/ai/campaign-memory.ts
```

---

### 8.2 CampaignMemory

```ts
export interface CampaignMemory {
  records: Array<{
    turn: number;

    decisionIntent: string;

    acceptedActions: string[];

    rejectedActions: string[];

    expectedOutcome: string;

    actualOutcome?: string;

    success?: boolean;

    lesson?: string;
  }>;

  recurringProblems: string[];

  enemyPatternEstimates: string[];

  commanderPreferences: string[];
}
```

---

### 8.3 updateCampaignMemory

```ts
export function updateCampaignMemory(params: {
  memory: CampaignMemory;

  previousDecision: LLMCommanderDecision;

  validation: ReturnType<typeof validateLLMCommanderDecision>;

  reportsAfterTurn: NavalAIReport[];

  turn: number;
}): CampaignMemory
```

---

### 8.4 作用

每回合结束后记录：

```txt
上回合想做什么？
哪些动作被接受？
哪些动作被拒绝？
实际发生了什么？
哪些判断失败？
下次要避免什么？
```

这样 LLM 下一回合会看到：

```txt
上一回合攻击失败，因为 contact 已丢失。
上一回合航母受损，不能继续强攻。
敌方常从西南方向接近。
搜索扇区需要扩大。
```

---

## 9. 两种 LLM 角色

### 9.1 Player Advisor

玩家顾问：

```txt
只给建议。
不自动执行。
玩家可以接受或忽略。
```

流程：

```txt
buildFactionKnowledge(player)
→ sanitizeKnowledgeForLLM
→ askLLM
→ validate
→ show accepted/rejected recommendation
```

---

### 9.2 Enemy Commander

敌方指挥官：

```txt
自动执行。
但仍然不能开天眼。
```

流程：

```txt
buildFactionKnowledge(enemy)
→ sanitizeKnowledgeForLLM
→ askLLM
→ validate
→ execute accepted actions
```

敌方 LLM 只能知道：

```txt
enemy own fleets
enemy own ships
enemy contacts about player
enemy reports
enemy memory
```

不能知道：

```txt
player real hidden fleet
player real damage
player real plan
```

---

## 10. 接入现有文件

### 10.1 provider.ts

修改：

```txt
src/ai/provider.ts
```

新增：

```ts
export async function requestLLMCommanderDecision(params: {
  provider: AIProvider;
  context: LLMDecisionContext;
  role: 'player_advisor' | 'enemy_commander';
}): Promise<LLMCommanderDecision>
```

---

### 10.2 campaign-controller.ts

修改：

```txt
src/ai/campaign-controller.ts
```

当前如果是：

```txt
generateNavalCampaignPlan
```

改成调用新流程：

```txt
buildFactionKnowledge
sanitizeKnowledgeForLLM
requestLLMCommanderDecision
validateLLMCommanderDecision
executeLLMDecisionActions
updateCampaignMemory
```

---

### 10.3 SidePanel.tsx

修改：

```txt
src/components/SidePanel.tsx
```

不要在这里手写“开天眼上下文”。

改成：

```ts
const knowledge = buildFactionKnowledge(...);
const context = sanitizeKnowledgeForLLM(knowledge);
```

然后显示：

```txt
LLM saw:
  own forces count
  contacts count
  reports count
  memory entries count
```

方便玩家确认 LLM 没开天眼。

---

## 11. UI 显示：LLM 到底看到了什么

新增组件：

```txt
src/components/LLMKnowledgePanel.tsx
```

显示：

```txt
LLM 当前可见信息：
- 本方舰队数量
- 已知 contact 数量
- contact detectionLevel
- 最近报告
- 已知基地
- 已知补给线
- memory 摘要
```

不要显示真实敌军。

---

## 12. Debug 测试

新增：

```txt
src/ai/llm-decision-debug.ts
```

---

### 12.1 debugLLMKnowledgeIsolation

```ts
export function debugLLMKnowledgeIsolation()
```

测试：

```txt
1. 真实世界里有 1 支隐藏敌方舰队。
2. playerContacts = []。
3. buildFactionKnowledge(player)。
4. sanitizeKnowledgeForLLM。
5. 确认 context 不含 hidden enemy。
6. LLM decision 如果试图 strike hidden enemy，validator reject。
```

返回：

```ts
{
  hiddenEnemyExists: true,
  playerContacts: 0,
  contextMentionsHiddenEnemy: false,
  illegalStrikeRejected: true,
  passed: true
}
```

---

### 12.2 debugLLMContactBasedDecision

测试：

```txt
1. playerContacts 有 suspected contact。
2. LLM 尝试 launch_strike。
3. validator reject。
4. validator 建议 search / shadow。
5. playerContacts 升级为 classified。
6. LLM launch_strike 被接受。
```

---

### 12.3 CHECKPOINT DEBUG-1

输出：

```txt
[CHECKPOINT DEBUG-1]
- hidden enemy not in context:
- suspected strike rejected:
- classified strike accepted:
- enemy commander only sees enemy knowledge:
- player advisor only sees player knowledge:
```

---

## 13. 最终完成标准

完成后必须满足：

```txt
1. LLM 输入来自 FactionKnowledgeState。
2. LLM 不再直接读取真实 enemyFleets。
3. LLM 不再直接读取真实 enemyShips。
4. 玩家顾问只知道玩家阵营知道的信息。
5. 敌方指挥官只知道敌方阵营知道的信息。
6. knownContacts 是敌情唯一来源。
7. LLM 输出严格 JSON。
8. Validator 拒绝非法动作。
9. suspected contact 不能 strike。
10. classified / identified / tracked contact 可以 strike。
11. unknown hidden enemy 不能被攻击。
12. LLM 不能直接修改 store。
13. Executor 只执行 validator 接受的动作。
14. CampaignMemory 记录决策和结果。
15. UI 可以显示 LLM 当前看到的信息摘要。
16. debugLLMKnowledgeIsolation 通过。
17. debugLLMContactBasedDecision 通过。
18. npm run build 通过。
```

---

# 给 OpenCode Plan Mode 的提示词

```txt
你现在处于 Plan Mode。

不要修改代码。
不要创建文件。
不要运行会改动项目的命令。

请阅读 README_LLM_KNOWLEDGE_BASED_DECISION_SYSTEM.md 和当前 test2 仓库，先分析：

1. 当前 LLM 上下文在哪里构建。
2. 是否仍然把真实 enemyFleets / enemyShips 传给 LLM。
3. 当前 NavalContact 是否是敌情唯一来源。
4. 当前 LLM 是否自由文本输出。
5. 当前是否有 JSON decision schema。
6. 当前是否有 validator。
7. 当前是否有 executor。
8. 当前是否有 campaign memory。
9. 当前玩家 advisor 和敌方 commander 是否隔离情报。
10. 需要改哪些文件。
11. 每一步如何验证 LLM 没有开天眼。

只输出计划，不修改代码。
```

---

# 给 OpenCode Build Mode 的提示词

```txt
你现在进入 Build Mode。

请严格按照 README_LLM_KNOWLEDGE_BASED_DECISION_SYSTEM.md 执行。

目标：
让大模型只能根据自己阵营手中已有的信息进行决策。

不要重写海战核心。
不要新增 naval-v2。
不要让 LLM 开天眼。
不要让 LLM 直接读取 enemyFleets / enemyShips。
不要让 LLM 直接修改 store。
不要跳过 build。

必须实现：

1. 新增 FactionKnowledgeState。
2. 新增 buildFactionKnowledge。
3. 新增 sanitizeKnowledgeForLLM。
4. LLM 输入只能来自 LLMDecisionContext。
5. LLMDecisionContext 只能包含：
   - own forces
   - known contacts
   - known bases
   - known supply lines
   - recent reports
   - memory summary
   - legal action hints

6. 删除所有给 LLM 的真实 enemyFleets / enemyShips。
7. 新增 LLMCommanderDecision JSON schema。
8. provider.ts 新增 requestLLMCommanderDecision。
9. 新增 validateLLMCommanderDecision。
10. validator 必须拒绝：
   - unknown contact strike
   - suspected contact strike
   - unknown fleet action
   - damaged fleet forced strike
   - action using hidden enemy

11. 新增 executeLLMDecisionActions。
12. LLM 只能提出 action，不能直接改 state。
13. 新增 CampaignMemory。
14. 每回合后 updateCampaignMemory。
15. 新增 LLMKnowledgePanel，显示 LLM 当前看到的信息摘要。
16. 新增 debugLLMKnowledgeIsolation。
17. 新增 debugLLMContactBasedDecision。
18. 最后运行 npm run build。

每完成一轮输出 CHECKPOINT：
- 修改文件
- 新增文件
- 验证结果
- build 结果
- 未完成项
```
