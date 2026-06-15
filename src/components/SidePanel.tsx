import React, { useState, useRef, useEffect } from 'react';
import { useNavalStore } from '@/store/naval-store';
import { getAPIKey, setAPIKey } from '@/ai/api-key';
import { LLMKnowledgePanel } from './LLMKnowledgePanel';
import { AfterActionReviewPanel } from './AfterActionReviewPanel';
import { buildFactionKnowledge, sanitizeKnowledgeForLLM } from '@/ai/information-filter';
import { requestLLMCommanderDecision } from '@/ai/llm-commander-provider';
import { validateLLMCommanderDecision } from '@/ai/llm-decision-validator';
import { executeLLMDecisionActions } from '@/ai/llm-decision-executor';
import { updateCampaignMemory, createCampaignMemory } from '@/ai/campaign-memory';
import type { CampaignMemory } from '@/ai/campaign-memory';

export function SidePanel() {
  const overlay = useNavalStore(s => s.overlay);
  const fleets = useNavalStore(s => s.fleets);
  const currentTurn = useNavalStore(s => s.currentTurn);
  const intel = useNavalStore(s => s.intel);
  const reports = useNavalStore(s => s.reports);
  const battleLog = useNavalStore(s => s.battleLog);
  const airOps = useNavalStore(s => s.airOperations);
  const landAfs = useNavalStore(s => s.landAirfields);
  const weather = useNavalStore(s => s.weather);
  const victory = useNavalStore(s => s.victory);
  const islands = useNavalStore(s => s.islands);
  const facilities = useNavalStore(s => s.facilities);
  const isCreating = useNavalStore(s => s.isCreatingScenario);
  const createScenario = useNavalStore(s => s.createNavalScenario);
  const advanceNavalTurn = useNavalStore(s => s.advanceNavalTurn);
  const selectFleet = useNavalStore(s => s.selectFleet);

  const [running, setRunning] = useState(false);
  const [campaignMem, setCampaignMem] = useState<CampaignMemory>(createCampaignMemory());
  const [turns, setTurns] = useState(30);
  const [log, setLog] = useState<string[]>([]);
  const [report, setReport] = useState('');
  const lgRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (lgRef.current) lgRef.current.scrollTop = lgRef.current.scrollHeight; }, [log]);

  const addLog = (s: string) => setLog(p => [...p, s]);

  const runCampaign = async () => {
    if (running) return; setRunning(true); setLog([]); setReport('');
    if (!overlay || fleets.length === 0) { createScenario(); await sleep(1000); }

    const allKills: string[] = [];
    const allEvents: string[] = [];

    for (let t = 0; t < turns; t++) {
      const s = useNavalStore.getState();
      addLog(`\n══════ 第 ${s.currentTurn + 1} 回合 ══════`);

      const pf = s.fleets.find(f => f.faction === 'player');
      if (pf) {
        addLog(`📍 ${pf.name} · ${pf.ships.length}艘 · [${pf.position.globalX},${pf.position.globalY}]`);
        pf.ships.forEach(sh => {
          const e = sh.damage.status !== 'combat_effective' ? ` ⚠${sh.damage.status}` : '';
          addLog(`  ${sh.name}(${sh.shipClass}) HDG${sh.headingDeg}° ${sh.speedKts}kt${e}`);
        });
      }

      const cs = s.intel.playerContacts;
      if (cs.length > 0) { addLog(`📡 接触:${cs.length}`); cs.forEach(c => addLog(`  [${c.detectionLevel}] ${c.estimatedClass||'?'} ±${c.uncertaintyRadius.toFixed(0)}`)); }
      else addLog(`📡 无敌方接触`);

      const ao = s.airOperations;
      if (ao.length > 0) { addLog(`✈️ 空中:${ao.length}批次`); ao.forEach(a => addLog(`  ${a.type} ${a.fleetName} ×${a.aircraft} (${a.x},${a.y})`)); }

      try {
        // 新LLM管线
        const truth = { turn: s.currentTurn, weather: 'clear', playerFleets: s.fleets.filter(f => f.faction === 'player') as any, enemyFleets: s.fleets.filter(f => f.faction === 'enemy') as any, allBases: [], allSupplyLines: [] };
        const knowledge = buildFactionKnowledge({ faction: 'player', truth, intel: s.intel, reports: s.reports, currentTurn: s.currentTurn, memory: campaignMem });
        const ctx = sanitizeKnowledgeForLLM(knowledge);
        addLog(`🤖 LLM: ${ctx.ownForces.length}舰队 ${ctx.knownContacts.length}接触 ${ctx.legalActionHints.length}合法行动`);

        const decision = await requestLLMCommanderDecision({ context: ctx, role: 'player_advisor' });
        if (decision) {
          addLog(`  📋 ${decision.assessment.slice(0,100)}`);
          const validation = validateLLMCommanderDecision({ decision, context: ctx, knowledge });
          addLog(`  ✅${validation.acceptedActions.length}/❌${validation.rejectedActions.length}`);
          validation.rejectedActions.forEach(r => addLog(`    ❌ ${r.reason}`));
          validation.acceptedActions.forEach(a => {
            if (a.type === 'launch_search' && pf) useNavalStore.setState(s2 => ({ airOperations: [...s2.airOperations, { id: `llm_${t}`, type: 'search', x: pf.position.globalX + 30, y: pf.position.globalY, heading: 315, fleetName: pf.name, status: '搜索中', aircraft: 4 }] }));
            if (a.type === 'launch_strike' && pf) useNavalStore.setState(s2 => ({ airOperations: [...s2.airOperations, { id: `st_${t}`, type: 'strike', x: pf.position.globalX + 50, y: pf.position.globalY + 30, heading: 270, fleetName: pf.name, status: '进攻中', aircraft: 6 }] }));
            addLog(`    ⚡ ${a.type}`);
          });
          setCampaignMem(newMem => updateCampaignMemory({ memory: newMem, previousDecision: decision, acceptedActions: validation.acceptedActions.map(a => a.type), rejectedActions: validation.rejectedActions.map(a => a.reason), reportsAfterTurn: [], turn: s.currentTurn }));
        } else { addLog('🤖 LLM离线'); if (pf) useNavalStore.setState(s2 => ({ airOperations: [...s2.airOperations, { id: `fb_${t}`, type: 'search', x: pf.position.globalX + 30, y: pf.position.globalY, heading: 315, fleetName: pf.name, status: '搜索中', aircraft: 4 }] })); }
      } catch (e: any) { addLog(`🤖 LLM错误: ${String(e).slice(0,80)}`); }

      // 敌方舰队自动向玩家靠近
      const ef2 = s.fleets.find(f => f.faction === 'enemy');
      if (ef2 && pf) {
        const edx = pf.position.globalX - ef2.position.globalX;
        const edy = pf.position.globalY - ef2.position.globalY;
        const edist = Math.sqrt(edx*edx + edy*edy);
        if (edist > 50) {
          const moveStep = Math.min(12, edist * 0.12);
          ef2.position.globalX += Math.round(edx / edist * moveStep);
          ef2.position.globalY += Math.round(edy / edist * moveStep);
          for (const sh of ef2.ships) {
            sh.position.x += Math.round(edx / edist * moveStep);
            sh.position.y += Math.round(edy / edist * moveStep);
          }
        }
      }
      const ao2 = useNavalStore.getState().airOperations.map(a => {
        const rad = a.heading * Math.PI / 180;
        return {
          ...a,
          x: a.x + Math.cos(rad) * 20,
          y: a.y + Math.sin(rad) * 20,
          status: a.x > Math.max(pf?.position.globalX || 0, (fleets.find(f2 => f2.faction === 'enemy')?.position.globalX || 1500)) + 300 ? '返航中' : a.status,
        };
      });
      useNavalStore.setState({ airOperations: ao2.filter(a => a.x < 2800 && a.y < 1800).slice(-20) });

      // 轰炸机场: 攻击机经过敌方机场时造成破坏
      const strikeOps = ao2.filter(a => a.type === 'strike');
      for (const so of strikeOps) {
        for (const af of landAfs) {
          const dx = so.x - af.x, dy = so.y - af.y;
          if (Math.abs(dx) < 30 && Math.abs(dy) < 30 && af.faction !== 'player' && Math.random() < 0.4) {
            af.bombers = Math.max(0, af.bombers - 2);
            af.fighters = Math.max(0, af.fighters - 1);
            addLog(`  💣 轰炸 ${af.name}! 剩余:F${af.fighters} B${af.bombers}`);
          }
        }
      }

      advanceNavalTurn();
      await sleep(50);

      const after = useNavalStore.getState();
      const newEvts = after.battleLog.filter(e => !s.battleLog.find(x => x.id === e.id));
      if (newEvts.length > 0) { addLog(`⚔️ 战斗(${newEvts.length}):`); newEvts.slice(0, 6).forEach(e => { addLog(`  ${e.description}`); allEvents.push(e.description); }); }

      if (pf) {
        const apf = after.fleets.find(f => f.id === pf.id);
        if (apf) apf.ships.forEach(sa => {
          const sb = pf.ships.find(x => x.id === sa.id);
          if (!sb) return;
          if (sa.damage.status !== 'combat_effective') addLog(`💥 ${sa.name}: ${sa.damage.status} 进水${sa.damage.flooding.toFixed(0)}% 火${sa.damage.fire.toFixed(0)}% 船体${sa.damage.hullIntegrity.toFixed(0)}%`);
          if (sa.damage.status === 'sinking' || sa.damage.status === 'sunk') allKills.push(sa.name);
        });
      }
    }

    const sf = useNavalStore.getState();
    let r = `\n\n══════════════════════════════\n  太 平 洋 海 战 报 告\n  战役结束 · 共 ${turns} 回合\n══════════════════════════════\n\n`;
    for (const f of sf.fleets) {
      r += `${f.faction === 'player' ? '🔵' : '🔴'} ${f.name} [${f.position.globalX},${f.position.globalY}]\n`;
      for (const sh of f.ships) {
        const d = sh.damage.status !== 'combat_effective' ? ` 【${sh.damage.status}】进水${sh.damage.flooding.toFixed(0)}% 火${sh.damage.fire.toFixed(0)}%` : '';
        r += `  ${sh.name}(${sh.shipClass})${d}\n`;
      }
    }
    r += `\n💀 战损: ${allKills.length}艘\n${allKills.length > 0 ? allKills.join(', ') : '无'}\n`;
    r += `\n⚔️ 战斗事件: ${allEvents.length}次\n${allEvents.slice(-10).join('\n')}\n`;
    r += `══════════════════════════════\n`;
    setReport(r); setRunning(false);
  };

  if (!overlay && fleets.length === 0) {
    return (
      <div className="w-[380px] flex flex-col items-center justify-center p-8 space-y-4 glass border-l border-blue-900/20 shrink-0">
        <div className="text-6xl">⚓</div>
        <h1 className="text-2xl font-black text-white text-center tracking-widest">太平洋<br/>舰队司令部</h1>
        <div className="h-0.5 w-20 bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
        <p className="text-xs text-slate-400 text-center leading-relaxed">战略图 1500×1000 · 1格≈2km<br/>16个岛链 · 美东日西 · 航母航空战<br/>遭遇战: 击沉敌方舰队即胜利</p>
        <input
          type="password"
          placeholder="DeepSeek API Key (sk-...)"
          defaultValue={getAPIKey()}
          onChange={e => setAPIKey(e.target.value)}
          className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-amber-500/50"
        />
        <button onClick={createScenario} disabled={isCreating}
          className="w-full py-3.5 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 text-white font-bold rounded-lg text-base transition-colors">
          {isCreating ? '正在生成太平洋...' : '⚡ 部署舰队'}
        </button>
      </div>
    );
  }

  const pf = fleets.find(f => f.faction === 'player');
  const damaged = pf?.ships.filter(s => s.damage.status !== 'combat_effective') || [];

  return (
    <div className="w-[440px] flex flex-col glass border-l border-blue-900/20 shrink-0 text-xs">
      {/* 胜利横幅 */}
      {victory !== 'none' && (
        <div className={`px-5 py-4 text-center font-black text-xl ${victory === 'player' ? 'bg-green-900/60 text-green-400' : 'bg-red-900/60 text-red-400'}`}>
          {victory === 'player' ? '🏆 美军胜利！敌方舰队全灭' : '💀 日军胜利！己方舰队全灭'}
        </div>
      )}
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800/50">
        <div>
          <span className="text-amber-400 font-black text-xl">第 {currentTurn} 回合</span>
          <div className="text-[10px] text-slate-500">{islands.length}群岛 · {facilities.length}设施 · {weather === 'clear' ? '☀️晴' : weather === 'rain' ? '🌧️雨' : weather === 'squall' ? '🌪️暴风' : weather === 'fog' ? '🌫️雾' : '⛈️风暴'}</div>
        </div>
        <button onClick={advanceNavalTurn} className="px-5 py-2.5 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-sm font-bold">推进</button>
      </div>

      {/* 舰队信息 */}
      <div className="px-5 py-3 border-b border-slate-800/50">
        <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">舰队</div>
        {fleets.map(f => (
          <div key={f.id} onClick={() => selectFleet(f.id)} className="cursor-pointer py-1.5">
            <div className="flex items-center gap-2">
              <span className={`text-base ${f.faction === 'player' ? 'text-sky-400' : 'text-red-400'} font-bold`}>{f.name}</span>
              <span className="text-slate-500">({f.ships.length}艘)</span>
              <span className={`ml-auto text-[10px] px-2 py-0.5 rounded ${f.fuelState === 'good' ? 'bg-green-900/30 text-green-400' : 'bg-yellow-900/30 text-yellow-400'}`}>{f.fuelState}</span>
            </div>
            <div className="text-[10px] text-slate-600">位置 [{f.position.globalX}, {f.position.globalY}]</div>
          </div>
        ))}
      </div>

      {/* 空中单位 */}
      <div className="px-5 py-3 border-b border-sky-900/20">
        <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">✈️ 航空任务 ({airOps.length})</div>
        {airOps.length === 0 && <div className="text-slate-600 text-[11px]">无空中任务</div>}
        <div className="max-h-[100px] overflow-auto space-y-1">
          {airOps.map(a => (
            <div key={a.id} className="flex items-center gap-2 text-[11px]">
              <span className={`w-2 h-2 rounded-full ${a.type === 'strike' ? 'bg-red-500 pulse' : a.type === 'search' ? 'bg-blue-400' : 'bg-green-400'}`} />
              <span className={a.type === 'strike' ? 'text-red-400 font-bold' : a.type === 'search' ? 'text-blue-400' : 'text-green-400'}>{a.type === 'strike' ? '攻击' : '搜索'}</span>
              <span className="text-slate-300 truncate max-w-[80px]">{a.fleetName}</span>
              <span className="text-slate-500">×{a.aircraft}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 陆地机场 */}
      <div className="px-5 py-3 border-b border-slate-800/50">
        <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">🏗️ 陆地机场 ({landAfs.length})</div>
        <div className="max-h-[100px] overflow-auto space-y-1">
          {landAfs.filter(a => a.faction === 'player').slice(0, 6).map(a => (
            <div key={a.id} className="flex items-center gap-2 text-[10px]">
              <span className={`w-1.5 h-1.5 rounded-full ${a.faction === 'player' ? 'bg-sky-400' : 'bg-red-400'}`} />
              <span className="text-slate-300 truncate max-w-[70px]">{a.name}</span>
              <span className="text-slate-600">F{a.fighters} B{a.bombers}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 损伤大字 */}
      {damaged.length > 0 && (
        <div className="px-5 py-4 border-b border-red-900/30 bg-red-950/15">
          <div className="text-xl font-black text-red-400 mb-3">⚠ 损 伤 报 告</div>
          {damaged.map(s => (
            <div key={s.id} className="mb-3">
              <div className="text-base font-bold text-red-300">{s.name} ({s.shipClass})</div>
              <div className="text-sm text-red-400/80 mt-1 leading-relaxed">
                进水 {s.damage.flooding.toFixed(0)}%　|　火灾 {s.damage.fire.toFixed(0)}%<br/>
                船体 {s.damage.hullIntegrity.toFixed(0)}%　|　浮力 {s.damage.buoyancy.toFixed(0)}%<br/>
                状态: {s.damage.status}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* LLM 可见情报 */}
      <LLMKnowledgePanel />

      {/* 战后复盘 */}
      <AfterActionReviewPanel />

      {/* 情报 */}
      <div className="px-5 py-3 border-b border-slate-800/50">
        <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">📡 情报 (接触 {intel.playerContacts.length})</div>
        {intel.playerContacts.length === 0 && <div className="text-slate-600 text-[11px]">无敌方接触</div>}
        {intel.playerContacts.slice(0, 6).map(c => (
          <div key={c.id} className="text-[11px] text-slate-400 py-0.5">[{c.detectionLevel}] {c.estimatedClass||'?'} ±{c.uncertaintyRadius.toFixed(0)} {c.stale ? '(旧)' : ''}</div>
        ))}
      </div>

      {/* 战役控制 */}
      <div className="px-5 py-4 border-b border-slate-800/50 space-y-2">
        <div className="text-xs text-slate-400 uppercase tracking-wider">AI 自动战役</div>
        <div className="flex gap-2">
          <input type="number" value={turns} onChange={e => setTurns(Math.max(1, Math.min(50, +e.target.value)))}
            className="w-16 px-2 py-2 bg-slate-800 border border-slate-700 rounded text-base text-slate-200 font-bold" disabled={running} />
          <button onClick={runCampaign} disabled={running}
            className="flex-1 py-2.5 bg-purple-700 hover:bg-purple-600 disabled:bg-slate-700 text-white rounded-lg text-base font-bold">
            {running ? '战役进行中...' : '开始战役'}
          </button>
        </div>
      </div>

      {/* 日志 */}
      <div className="flex-1 overflow-auto">
        <div ref={lgRef} className="p-4 space-y-1 font-mono text-[10px]">
          {log.length === 0 && <div className="text-slate-600 text-xs p-6 text-center">点击「开始战役」查看实时流程</div>}
          {log.map((l, i) => <div key={i} className="text-slate-400 leading-relaxed whitespace-pre-wrap">{l}</div>)}
        </div>
      </div>

      {/* 最终报告 — 大字醒目 */}
      {report && (
        <div className="p-5 bg-slate-950/95 text-base font-mono whitespace-pre-wrap leading-relaxed text-slate-200 max-h-[500px] overflow-auto font-bold border-t-2 border-amber-600">
          {report}
        </div>
      )}
    </div>
  );
}

function buildCtx(s: ReturnType<typeof useNavalStore.getState>) {
  const pf = s.fleets.find(f => f.faction === 'player');
  let c = `=== 第${s.currentTurn+1}回合 情报 ===\n\n`;

  // 舰队状态
  if (pf) {
    c += `【己方舰队】${pf.name} 位置[${pf.position.globalX},${pf.position.globalY}] ${pf.ships.length}艘\n`;
    for (const sh of pf.ships) {
      const dmg = sh.damage.status !== 'combat_effective'
        ? `⚠${sh.damage.status}(进水${sh.damage.flooding.toFixed(0)}% 火${sh.damage.fire.toFixed(0)}% 船体${sh.damage.hullIntegrity.toFixed(0)}%)`
        : '';
      const cv = sh.aircraft ? ` 舰载机:F${sh.aircraft.fighters}/DB${sh.aircraft.diveBombers}/TB${sh.aircraft.torpedoBombers}` : '';
      c += `  ${sh.name}(${sh.shipClass}) HDG${sh.headingDeg}° ${sh.speedKts}kt${cv} ${dmg}\n`;
    }
  }

  // 敌方接触 (仅从侦察获得，不泄露真实敌方)
  const cs = s.intel.playerContacts;
  c += `\n【敌方接触】${cs.length}个\n`;

  if (cs.length === 0) c += `  无敌方接触 — 需要搜索\n`;
  else for (const ct of cs) c += `  [${ct.detectionLevel}] ${ct.estimatedClass||'未知'} (${ct.lastKnownPosition.x.toFixed(0)},${ct.lastKnownPosition.y.toFixed(0)}) ±${ct.uncertaintyRadius.toFixed(0)}\n`;

  // 空中任务
  const ao = s.airOperations;
  c += `\n【空中】${ao.length}批次\n`;
  for (const a of ao.slice(-6)) c += `  ${a.type} ${a.fleetName} ${a.status} (${a.x.toFixed(0)},${a.y.toFixed(0)})\n`;

  // 命令格式
  c += `\n请按以下格式回复:\n`;
  c += `【敌情判断】(1句话)\n`;
  c += `【决心】(搜索/打击/撤退/机动)\n`;
  c += `【方向】(东北/西北/东南/西南/东/南/西/北)\n`;
  c += `【理由】(1句话)\n`;
  return c;
}

async function askLLM(ctx: string) {
  const key = getAPIKey();
  if (!key) return '请先输入 API Key';
  const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [
      { role: 'system', content: `你是太平洋舰队司令官。每回合你需要先分析敌情，再下决心。

决策原则:
1. 无接触→搜索。方向判断:日军基地在西侧(横须贺/冲绳/特鲁克),应优先搜索西方或西北
2. 有可疑接触[detected]→朝接触方向搜索以升级识别
3. 有分类目标[classified/tracked]→派舰载机打击
4. 己方舰船严重受损(进水>50%或船体<30%)→下令撤退
5. 日军舰船速度快(34节),美军航速较慢(32节),保持距离

回复格式必须包含:
【敌情判断】
【决心】
【方向】
【理由】` },
      { role: 'user', content: ctx },
    ], temperature: 0.7, max_tokens: 300 }),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return ((await r.json()) as any).choices?.[0]?.message?.content || '';
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function parseSearchDir(resp: string, contacts?: Array<{ estimatedClass?: string; lastKnownPosition: { x: number; y: number } }>, fleetX?: number, fleetY?: number): number[] {
  const lower = resp.toLowerCase();
  // 1. LLM 指定了方向 → 用 LLM 的方向
  if (lower.includes('东北') || lower.includes('ne')) return [30, 45, 60, 75];
  if (lower.includes('西北') || lower.includes('nw')) return [300, 315, 330, 345];
  if (lower.includes('东南') || lower.includes('se')) return [120, 135, 150, 165];
  if (lower.includes('西南') || lower.includes('sw')) return [210, 225, 240, 255];
  if (lower.includes('北') || lower.includes('north')) return [345, 0, 15, 30];
  if (lower.includes('南') || lower.includes('south')) return [165, 180, 195, 210];
  if (lower.includes('东') || lower.includes('east')) return [60, 75, 90, 105, 120];
  if (lower.includes('西') || lower.includes('west')) return [240, 255, 270, 285, 300];

  // 2. LLM 没说方向但有接触 → 朝最近接触搜索
  if (contacts && contacts.length > 0 && fleetX !== undefined && fleetY !== undefined) {
    const nearest = contacts.reduce((a, b) => {
      const da = Math.hypot(a.lastKnownPosition.x - fleetX, a.lastKnownPosition.y - fleetY);
      const db = Math.hypot(b.lastKnownPosition.x - fleetX, b.lastKnownPosition.y - fleetY);
      return da < db ? a : b;
    });
    const ang = Math.atan2(nearest.lastKnownPosition.y - fleetY, nearest.lastKnownPosition.x - fleetX) * 180 / Math.PI;
    const base = ((ang % 360) + 360) % 360;
    return [base - 30, base - 15, base, base + 15, base + 30].map(a => ((a % 360) + 360) % 360);
  }

  // 3. 都不知道 → 全周搜索
  return [0, 60, 120, 180, 240, 300];
}
