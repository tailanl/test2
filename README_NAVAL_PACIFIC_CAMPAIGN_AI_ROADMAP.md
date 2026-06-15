# README_NAVAL_PACIFIC_CAMPAIGN_AI_ROADMAP.md
# test2 下一阶段：太平洋战争进程系统 + 更强 LLM 参谋系统

## 0. 当前判断

当前 `test2` 已经从“海战功能集合”进入到“可以玩的太平洋海战原型”。

已经有：

```txt
1. Vite 项目结构。
2. 3D 海战场景 NavalScene3D。
3. 侧边栏 SidePanel。
4. 海战 store。
5. 独立海战地图 generateStratMap。
6. 岛屿、港口、机场、海军基地。
7. 舰队。
8. 舰船。
9. 航空任务。
10. 情报 contact。
11. DeepSeek LLM 顾问。
12. LLM 自动战役面板。
13. 回放 JSON。
```

但当前的问题是：

```txt
1. LLM 的“智慧”不够。
2. 游戏没有完整对应太平洋战争进程。
3. 现在更像单次遭遇战 / 沙盒战役。
4. 缺少长期战略推进。
5. 缺少岛屿占领、基地建设、补给线、舰队维修、造船补充、航空基地扩张。
6. 缺少日军/美军不同时期的战略目标差异。
7. 缺少历史阶段系统。
8. 缺少真正的作战计划和多层 AI。
```

---

## 1. 当前 LLM 为什么不聪明

### 1.1 LLM 当前只是“文本建议器”

当前 AI 主要通过：

```txt
src/ai/provider.ts
src/ai/campaign-controller.ts
src/ai/naval-campaign-policy.ts
src/components/NavalAIAdvisorPanel.tsx
src/components/NavalCampaignPanel.tsx
src/components/SidePanel.tsx
```

工作。

它现在能做：

```txt
1. 根据情报写 situationAssessment。
2. 生成 recommendations。
3. 生成 suggestedCommands。
4. 解析简单自然语言命令。
5. 在 CampaignPanel 中每回合给出 plan。
```

但它还不能做：

```txt
1. 维护长期战略目标。
2. 记住过去几回合计划是否成功。
3. 评估补给线是否安全。
4. 决定夺取哪个岛。
5. 分配航母、战列舰、运输船、潜艇、陆基航空兵。
6. 做多阶段作战计划。
7. 根据战争阶段切换战略。
8. 预测敌方下一步。
9. 根据战损决定修船、撤退、换旗舰、换路线。
10. 对太平洋战局有宏观判断。
```

所以它看起来会像：

```txt
有接触 → 打击
没接触 → 搜索
受损 → 撤退
```

这不是战略 AI，只是局部规则 + LLM 文本包装。

---

### 1.2 当前有“开天眼”风险

必须立刻检查和修复。

当前某些路径里，给 LLM 的上下文可能包含真实敌方舰队状态。  
特别是 `SidePanel.tsx` 的 `buildCtx` 里出现过类似逻辑：

```txt
敌方舰队(开天眼情报)
```

这会导致两个坏结果：

```txt
1. LLM 不是靠侦察和情报判断，而是直接知道敌人真实位置。
2. 游戏看起来不真实，战争迷雾失效。
```

必须修成：

```txt
LLM 只能看到：
  player fleets
  NavalContact[]
  recent reports
  own damage
  known facilities
  known objectives

LLM 不能看到：
  enemy fleet true position
  enemy ship true list
  enemy damage true state
```

唯一允许读取真实敌军的是：

```txt
detection resolver
battle resolver
debug test
```

---

### 1.3 当前 API Key 硬编码，必须立刻移除

当前代码中有硬编码 DeepSeek API key 的风险。

必须修：

```txt
1. 删除所有硬编码 API key。
2. GitHub 上已经暴露的 key 必须作废 / rotate。
3. 前端只能从 localStorage 手动读取用户输入。
4. 不要把真实 key commit 到仓库。
```

应该改成：

```txt
用户在 Web UI 中输入 API key
→ localStorage 保存
→ fetch 时读取
```

或者：

```txt
后端代理 API
→ .env.local
→ 前端不直接拿 key
```

但当前是纯 Vite 前端项目，最简单先用 localStorage。

---

## 2. 要完整对应太平洋战争，需要哪些系统

要完整对应太平洋战争，不是只加几艘船，而是要有“战争进程系统”。

太平洋战争至少要覆盖这些层级：

```txt
1. 战略阶段。
2. 战区地图。
3. 岛屿 / 基地 / 机场。
4. 制海权。
5. 制空权。
6. 补给线。
7. 舰队任务。
8. 登陆作战。
9. 基地建设。
10. 舰船维修。
11. 航母航空兵补充。
12. 潜艇战。
13. 情报和侦察。
14. 历史阶段事件。
15. 双方战略 AI。
```

---

## 3. 太平洋战争阶段系统

新增：

```txt
src/game/naval/campaign/
  pacific-war-phase-types.ts
  pacific-war-phases.ts
  pacific-campaign-state.ts
  pacific-campaign-engine.ts
```

---

### 3.1 PacificWarPhase

```ts
export type PacificWarPhaseId =
  | 'japanese_offensive_1941_1942'
  | 'carrier_turning_point_1942'
  | 'solomons_attrition_1942_1943'
  | 'central_pacific_offensive_1943_1944'
  | 'philippines_leyte_1944'
  | 'iwo_okinawa_1945'
  | 'home_islands_approach_1945';
```

---

### 3.2 Phase 定义

```ts
export interface PacificWarPhase {
  id: PacificWarPhaseId;

  name: string;

  startDate: string;
  endDate: string;

  description: string;

  playerStrategicPosture:
    | 'defense'
    | 'counterattack'
    | 'limited_offensive'
    | 'major_offensive'
    | 'decisive_offensive';

  japaneseStrategicPosture:
    | 'offensive'
    | 'expansion'
    | 'defensive_perimeter'
    | 'attrition_defense'
    | 'desperate_defense';

  availableOperations: PacificOperationTemplate[];

  reinforcementRules: ReinforcementRule[];

  historicalEvents: PacificHistoricalEvent[];

  victoryPressure: {
    player: number;
    enemy: number;
  };
}
```

---

### 3.3 推荐阶段

```txt
Phase 1：日本攻势，1941-1942
  日本扩张，美军防御，玩家主要保护航线、撤退受损舰队、守住关键基地。

Phase 2：航母转折，1942
  珊瑚海、中途岛。重点是搜索扇区、航母隐藏、舰载机打击窗口。

Phase 3：瓜岛 / 所罗门消耗战，1942-1943
  机场争夺、夜战、补给线、驱逐舰和巡洋舰交战。

Phase 4：中太平洋攻势，1943-1944
  吉尔伯特、马绍尔、马里亚纳。岛屿跳跃、航母掩护登陆、基地建设。

Phase 5：菲律宾 / 莱特湾，1944
  大规模舰队决战，多方向威胁，登陆船队保护。

Phase 6：硫磺岛 / 冲绳，1945
  岸基航空、神风威胁、雷达哨舰、CAP、防空和登陆支援。
```

---

## 4. 战争进程状态 PacificCampaignState

新增：

```ts
export interface PacificCampaignState {
  currentDate: string;

  currentPhaseId: PacificWarPhaseId;

  turn: number;

  map: PacificTheaterMap;

  playerSide: PacificSideState;

  japaneseSide: PacificSideState;

  activeOperations: PacificOperation[];

  completedOperations: PacificOperation[];

  globalIntel: StrategicIntelState;

  victoryState: PacificVictoryState;

  eventLog: PacificCampaignEvent[];
}
```

---

## 5. 太平洋战区地图

新增：

```txt
src/game/naval/campaign/pacific-theater-map.ts
```

```ts
export type PacificRegionId =
  | 'hawaii'
  | 'coral_sea'
  | 'midway'
  | 'solomons'
  | 'new_guinea'
  | 'gilberts'
  | 'marshalls'
  | 'truk'
  | 'marianas'
  | 'philippines'
  | 'iwo_jima'
  | 'okinawa'
  | 'home_islands';

export interface PacificRegion {
  id: PacificRegionId;

  name: string;

  owner: 'player' | 'enemy' | 'contested' | 'neutral';

  seaControl: {
    player: number;
    enemy: number;
  };

  airControl: {
    player: number;
    enemy: number;
  };

  supplyLevel: {
    player: number;
    enemy: number;
  };

  bases: PacificBase[];

  activeFleets: string[];

  threatLevel: number;
}
```

---

## 6. 基地系统

新增：

```txt
src/game/naval/campaign/base-system.ts
```

```ts
export interface PacificBase {
  id: string;
  name: string;

  regionId: PacificRegionId;

  type:
    | 'port'
    | 'naval_base'
    | 'airfield'
    | 'anchorage'
    | 'submarine_base'
    | 'supply_depot';

  owner: 'player' | 'enemy' | 'neutral';

  level: 1 | 2 | 3 | 4 | 5;

  repairCapacity: number;
  fuelCapacity: number;
  ammoCapacity: number;
  aircraftCapacity: number;

  constructionProgress: number;

  damage: number;

  isolated: boolean;
}
```

基地必须影响：

```txt
1. 舰队补给。
2. 舰船维修。
3. 航母补充舰载机。
4. 陆基航空搜索范围。
5. 登陆后能否继续推进。
6. 补给线是否稳定。
```

---

## 7. 补给线系统

新增：

```txt
src/game/naval/campaign/supply-line-system.ts
```

```ts
export interface SupplyLine {
  id: string;

  fromBaseId: string;
  toBaseId: string;

  route: Array<{ x: number; y: number }>;

  owner: 'player' | 'enemy';

  capacity: number;

  interdictionRisk: number;

  submarineThreat: number;

  airThreat: number;

  surfaceRaidThreat: number;

  status:
    | 'open'
    | 'contested'
    | 'interdicted'
    | 'cut';
}
```

补给线作用：

```txt
open:
  基地燃油/弹药恢复，舰队可维修补给。

contested:
  恢复速度降低，运输船可能损失。

interdicted:
  基地 supplyLevel 降低，舰队出击受限。

cut:
  基地孤立，舰队无法补给。
```

---

## 8. 登陆 / 岛屿占领系统

新增：

```txt
src/game/naval/campaign/amphibious-operation-system.ts
```

```ts
export interface AmphibiousOperation {
  id: string;

  targetBaseId: string;

  phase:
    | 'planning'
    | 'assembly'
    | 'approach'
    | 'shore_bombardment'
    | 'landing'
    | 'securing_airfield'
    | 'base_construction'
    | 'completed'
    | 'failed';

  requiredSeaControl: number;
  requiredAirControl: number;

  landingForceStrength: number;
  transportCapacity: number;

  navalSupportFleetIds: string[];

  carrierCoverFleetIds: string[];

  risk: number;

  progress: number;
}
```

登陆要求：

```txt
1. 必须有运输船队。
2. 目标海区制海权不能太低。
3. 目标海区制空权不能太低。
4. 需要火力支援舰队。
5. 需要航母或陆基航空掩护。
6. 补给线必须能延伸到目标区域。
```

---

## 9. 舰队长期状态

新增：

```txt
src/game/naval/campaign/fleet-readiness-system.ts
```

```ts
export interface FleetReadiness {
  fleetId: string;

  fuel: number;
  ammo: number;

  aircraftReplacement: number;

  crewFatigue: number;

  maintenanceNeed: number;

  repairDaysRemaining: number;

  sortieCooldown: number;

  readiness:
    | 'ready'
    | 'limited'
    | 'exhausted'
    | 'repairing'
    | 'refitting';
}
```

影响：

```txt
连续出击：
  crewFatigue 上升。
  maintenanceNeed 上升。
  aircraftReplacement 下降。

补给不足：
  sortieCooldown 上升。
  最大速度下降。
  航空任务数量下降。

维修：
  舰队必须回港。
  修理需要若干天。
```

---

## 10. 战争目标系统

新增：

```txt
src/game/naval/campaign/objective-system.ts
```

```ts
export interface PacificObjective {
  id: string;

  name: string;

  type:
    | 'hold_base'
    | 'capture_base'
    | 'destroy_fleet'
    | 'protect_convoy'
    | 'cut_supply_line'
    | 'establish_airfield'
    | 'support_landing'
    | 'raid_shipping'
    | 'neutralize_airbase';

  targetRegionId?: PacificRegionId;
  targetBaseId?: string;
  targetFleetId?: string;
  targetSupplyLineId?: string;

  priority: number;

  deadlineTurn?: number;

  status:
    | 'inactive'
    | 'active'
    | 'completed'
    | 'failed';
}
```

---

## 11. 让 LLM 更聪明：三层 AI 架构

现在 LLM 太“笨”，不能只靠一个 prompt。

改成三层：

```txt
1. Strategic Director
2. Operational Planner
3. Tactical Executor
```

---

### 11.1 Strategic Director

负责长期战略：

```txt
1. 选择下一个战役目标。
2. 决定是进攻、守势、消耗还是撤退。
3. 管理补给线。
4. 决定夺取哪个岛。
5. 决定保留还是冒险使用航母。
```

输出：

```ts
export interface StrategicDirective {
  objectiveId: string;

  intent:
    | 'defend'
    | 'raid'
    | 'interdict'
    | 'capture'
    | 'support_landing'
    | 'seek_decisive_battle'
    | 'avoid_decisive_battle';

  targetRegionId?: PacificRegionId;
  targetBaseId?: string;

  riskTolerance: 'low' | 'medium' | 'high';

  reason: string;
}
```

---

### 11.2 Operational Planner

负责把战略目标变成作战计划：

```txt
1. 分配舰队。
2. 规划航线。
3. 安排搜索扇区。
4. 安排航母打击。
5. 安排护航和补给。
6. 安排登陆阶段。
```

输出：

```ts
export interface OperationalPlan {
  id: string;

  directiveId: string;

  phases: Array<{
    name: string;
    durationTurns: number;
    assignedFleetIds: string[];
    tasks: OperationalTask[];
  }>;

  abortConditions: string[];

  successConditions: string[];
}
```

---

### 11.3 Tactical Executor

负责每回合实际操作：

```txt
1. 根据计划推进舰队。
2. 根据 contact 调整路线。
3. 派搜索机。
4. 派 CAP。
5. 发起攻击。
6. 受损后撤退。
```

输出：

```txt
NavalAIAction[]
```

---

## 12. Prompt 必须改成“受约束 JSON 决策”

不要让 LLM 直接自由写中文。

必须给它固定 schema：

```ts
export interface PacificStrategicDecision {
  assessment: string;

  selectedObjectiveId: string;

  directive: StrategicDirective;

  assumptions: string[];

  risks: string[];

  requiredIntel: string[];

  nextReviewTurn: number;
}
```

约束：

```txt
1. 必须返回 JSON。
2. 不能使用未侦察敌舰。
3. 不能指定不存在的基地。
4. 不能指定不可用舰队。
5. 不能在补给线 cut 的情况下命令深远攻势。
6. 航母损伤严重时不能强行 strike。
7. 登陆前必须满足制海权/制空权阈值。
```

---

## 13. Validator 必须比 LLM 更重要

新增：

```txt
src/ai/decision-validator.ts
```

实现：

```ts
export function validateStrategicDecision(
  decision: PacificStrategicDecision,
  state: PacificCampaignState
): ValidationResult;
```

检查：

```txt
1. 目标是否存在。
2. 舰队是否可用。
3. 补给是否允许。
4. 情报是否足够。
5. 风险是否超出限制。
6. 是否违反战争迷雾。
7. 是否违反当前阶段战略。
```

如果不合法：

```txt
不执行 LLM 输出。
退回 rule-based fallback。
```

---

## 14. Memory / After Action Review

LLM 需要记住自己的计划结果。

新增：

```txt
src/ai/campaign-memory.ts
```

```ts
export interface CampaignMemory {
  plans: Array<{
    turn: number;
    objectiveId: string;
    intendedAction: string;
    expectedResult: string;
    actualResult?: string;
    success?: boolean;
    lesson?: string;
  }>;

  recurringProblems: string[];

  enemyPatternEstimates: string[];

  playerDoctrine: string[];
}
```

每回合结束后写入：

```txt
本回合计划是什么？
结果是什么？
有没有成功？
为什么失败？
下一次要避免什么？
```

---

## 15. 太平洋战争流程要有“事件推进”

新增：

```txt
src/game/naval/campaign/historical-event-system.ts
```

事件例子：

```txt
Pearl Harbor aftermath
Coral Sea check
Midway opportunity
Guadalcanal airfield race
Tokyo Express night supply
Tarawa lessons
Marshalls offensive
Truk neutralization
Marianas carrier battle
Leyte invasion
Kamikaze threat
Iwo Jima airfield objective
Okinawa radar picket crisis
```

每个事件影响：

```txt
1. 可用舰队。
2. 可用基地。
3. 敌方战略姿态。
4. 补给压力。
5. 航空兵数量。
6. 胜利条件。
```

---

## 16. 新增场景：完整太平洋战争剧本

新增：

```txt
src/game/naval/scenarios/pacific-war-campaign.ts
```

```ts
export interface CampaignScenario {
  id: string;
  name: string;

  startDate: string;
  endDate: string;

  initialPhaseId: PacificWarPhaseId;

  map: PacificTheaterMap;

  playerInitialForces: StrategicFleet[];

  enemyInitialForces: StrategicFleet[];

  initialBases: PacificBase[];

  initialSupplyLines: SupplyLine[];

  objectives: PacificObjective[];

  historicalEvents: PacificHistoricalEvent[];
}
```

---

## 17. UI 需要补什么

### 17.1 Campaign Map Panel

显示：

```txt
太平洋区域
区域控制
基地
机场
港口
补给线
当前作战目标
战役阶段
```

### 17.2 Strategic Directive Panel

显示：

```txt
当前战略目标
LLM 给出的战略判断
Validator 是否通过
风险
下一步计划
```

### 17.3 Operation Plan Panel

显示：

```txt
作战计划阶段
分配舰队
搜索扇区
登陆计划
撤退条件
成功条件
```

### 17.4 Logistics Panel

显示：

```txt
燃油
弹药
舰载机补充
维修天数
基地补给
运输船队
补给线状态
```

### 17.5 War Progress Timeline

显示：

```txt
1941
1942
1943
1944
1945
当前阶段
已完成战役
失败战役
历史事件
```

---

## 18. 当前必须立刻修的技术问题

### 18.1 App.tsx / main.tsx 语法空壳

当前 `src/App.tsx` 和 `src/main.tsx` 可能不完整。

必须修成能 build 的 Vite 入口：

```tsx
// src/App.tsx
import React from 'react';
import { NavalModeRoot } from './components/NavalModeRoot';

export function App() {
  return <NavalModeRoot />;
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

### 18.2 移除硬编码 API Key

必须：

```txt
1. 删除所有源码里的 sk-...
2. 从 localStorage 或 UI 输入读取。
3. 已经泄露的 DeepSeek key 必须作废。
4. 不要再 commit key。
```

---

### 18.3 移除 LLM 开天眼上下文

`buildCtx` 不能包含真实敌方舰队列表。

只能包含：

```txt
contacts
reports
已知基地
己方舰队
己方损伤
空中任务
```

---

## 19. 推荐执行顺序

### 第一轮：修能跑

```txt
1. 修 App.tsx。
2. 修 main.tsx。
3. 跑 npm run build。
4. 删除硬编码 API key。
5. 删除 LLM 开天眼。
```

### 第二轮：让 LLM 不傻

```txt
1. 拆成 Strategic Director / Operational Planner / Tactical Executor。
2. 增加 JSON schema。
3. 增加 validator。
4. 增加 campaign memory。
5. 增加 after-action review。
```

### 第三轮：太平洋战争进程

```txt
1. PacificWarPhase。
2. PacificRegion。
3. PacificBase。
4. SupplyLine。
5. Objective。
6. HistoricalEvent。
```

### 第四轮：岛屿攻防

```txt
1. AmphibiousOperation。
2. Base construction。
3. Airfield expansion。
4. SeaControl / AirControl。
```

### 第五轮：UI

```txt
1. War Progress Timeline。
2. Campaign Map Panel。
3. Logistics Panel。
4. Directive Panel。
5. Operation Plan Panel。
```

---

## 20. 给 OpenCode Plan Mode 的提示词

```txt
你现在处于 Plan Mode。

不要修改代码。
不要创建文件。
不要运行会改动项目的命令。

请阅读 README_NAVAL_PACIFIC_CAMPAIGN_AI_ROADMAP.md 和当前 test2 仓库，先分析：

1. 当前项目是否已经是 Vite。
2. App.tsx / main.tsx 是否能正常渲染。
3. 是否存在硬编码 DeepSeek API key。
4. LLM 上下文是否包含真实敌方舰队。
5. 当前 AI 是否只是局部建议器。
6. 当前是否有 PacificWarPhase。
7. 当前是否有 PacificRegion / Base / SupplyLine。
8. 当前是否有登陆作战。
9. 当前是否有长期舰队维修和补给。
10. 当前是否有 Strategic Director / Operational Planner / Tactical Executor。
11. 哪些功能必须先补。
12. 每一轮要改哪些文件。
13. 每一轮验收标准。

只输出计划，不修改代码。
```

---

## 21. 给 OpenCode Build Mode 的提示词

```txt
你现在进入 Build Mode。

请严格按照 README_NAVAL_PACIFIC_CAMPAIGN_AI_ROADMAP.md 执行。

目标：
把当前 test2 从“单次太平洋海战沙盒”升级为“能表达太平洋战争进程的战役系统”，并让 LLM 不再只是简单建议器。

不要重写已经完成的海战核心。
不要新增 naval-v2。
不要让 LLM 开天眼。
不要在源码里硬编码 API key。
不要跳过 build。

第一优先级：
1. 修 App.tsx / main.tsx，使 Vite 项目能正常启动。
2. 删除所有硬编码 API key。
3. 修 LLM 上下文，禁止真实 enemy fleet/ships 泄露。
4. 跑 npm run build。

第二优先级：
1. 新增三层 AI：
   - Strategic Director
   - Operational Planner
   - Tactical Executor
2. LLM 输出必须是 JSON schema。
3. 增加 decision-validator。
4. 增加 campaign-memory / after-action review。

第三优先级：
1. 新增 PacificWarPhase。
2. 新增 PacificRegion。
3. 新增 PacificBase。
4. 新增 SupplyLine。
5. 新增 PacificObjective。
6. 新增 HistoricalEvent。

第四优先级：
1. 新增 AmphibiousOperation。
2. 新增 Base Construction。
3. 新增 SeaControl / AirControl。
4. 新增 FleetReadiness / Repair / Refit。

第五优先级：
1. 新增 CampaignMapPanel。
2. 新增 WarProgressTimeline。
3. 新增 LogisticsPanel。
4. 新增 StrategicDirectivePanel。
5. 新增 OperationPlanPanel。

每完成一轮输出 CHECKPOINT：
- 修改文件
- 新增文件
- 验证结果
- build 结果
- 未完成项
```
