/**
 * SidePanel - 中文侧边栏：部署 / 舰队 / 战役 / 报告
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavalStore } from '@/store/naval-store';

export function SidePanel() {
  const overlay = useNavalStore(s => s.overlay);
  const fleets = useNavalStore(s => s.fleets);
  const currentTurn = useNavalStore(s => s.currentTurn);
  const intel = useNavalStore(s => s.intel);
  const reports = useNavalStore(s => s.reports);
  const battleLog = useNavalStore(s => s.battleLog);
  const isCreating = useNavalStore(s => s.isCreatingScenario);
  const createScenario = useNavalStore(s => s.createNavalScenario);
  const advanceTurn = useNavalStore(s => s.advanceNavalTurn);
  const selectFleet = useNavalStore(s => s.selectFleet);

  const [running, setRunning] = useState(false);
  const [turns, setTurns] = useState(6);
  const [log, setLog] = useState<string[]>([]);
  const [report, setReport] = useState('');
  const lgRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (lgRef.current) lgRef.current.scrollTop = lgRef.current.scrollHeight; }, [log]);

  const addLog = useCallback((s: string) => setLog(p => [...p, s]), []);

  // ========== 运行战役 ==========
  const runCampaign = async () => {
    if (running) return;
    setRunning(true); setLog([]); setReport('');
    if (!overlay || fleets.length === 0) { createScenario(); await sleep(500); }

    const allKills: string[] = [];

    for (let t = 0; t < turns; t++) {
      const s = useNavalStore.getState();
      addLog(`\n══════ 第 ${s.currentTurn + 1} 回合 ══════`);

      // 舰队状态
      const pf = s.fleets.find(f => f.faction === 'player');
      if (pf) {
        addLog(`📍 我方舰队: ${pf.name} (${pf.ships.length}艘) [${pf.fuelState}]`);
        for (const sh of pf.ships) {
          const d = sh.damage.status !== 'combat_effective'
            ? ` ⚠️${sh.damage.status} 进水:${sh.damage.flooding.toFixed(0)}% 火灾:${sh.damage.fire.toFixed(0)}%`
            : '';
          addLog(`  ${sh.name} (${sh.shipClass}) HDG${sh.headingDeg}° SPD${sh.speedKts}kt${d}`);
        }
      }

      // 接触
      const contacts = s.intel.playerContacts;
      if (contacts.length > 0) {
        addLog(`📡 探测到 ${contacts.length} 个接触:`);
        for (const c of contacts) addLog(`  [${c.detectionLevel}] ${c.estimatedClass||'未知'} ±${c.uncertaintyRadius.toFixed(0)}`);
      } else addLog(`📡 无敌方接触`);

      // LLM决策
      try {
        const ctx = buildCtx(s);
        const resp = await askLLM(ctx);
        addLog(`🤖 AI决策: ${resp.slice(0, 150)}`);
      } catch { addLog(`🤖 AI离线, 使用规则决策`); }

      // 推进
      advanceTurn();
      await sleep(100);

      // 战斗事件
      const after = useNavalStore.getState();
      const newEvents = after.battleLog.filter(e => !s.battleLog.find(x => x.id === e.id));
      if (newEvents.length > 0) {
        addLog(`⚔️ 战斗事件 (${newEvents.length}):`);
        for (const e of newEvents.slice(0, 10)) addLog(`  ${e.description}`);
      }

      // 损伤变化
      if (pf) {
        for (const sa of after.fleets.find(f => f.id === pf.id)?.ships || []) {
          const sb = pf.ships.find(x => x.id === sa.id);
          if (!sb) continue;
          if (sa.damage.status !== sb.damage.status || sa.damage.flooding > 0 || sa.damage.fire > 0) {
            addLog(`💥 ${sa.name}: ${sa.damage.status} 进水:${sa.damage.flooding.toFixed(0)}% 火灾:${sa.damage.fire.toFixed(0)}% 船体:${sa.damage.hullIntegrity.toFixed(0)}%`);
          }
          if (sa.damage.status === 'sinking' || sa.damage.status === 'sunk') {
            allKills.push(`${sa.name}(${sa.shipClass})`);
          }
        }
      }
    }

    // 生成最终报告
    const s = useNavalStore.getState();
    let rpt = `\n\n═══════════════════════════════════════\n`;
    rpt += `  太 平 洋 海 战 报 告\n`;
    rpt += `  战役结束 — 共 ${turns} 回合\n`;
    rpt += `═══════════════════════════════════════\n\n`;

    const pf2 = s.fleets.find(f => f.faction === 'player');
    const ef2 = s.fleets.find(f => f.faction === 'enemy');
    if (pf2) {
      rpt += `🔵 我方舰队: ${pf2.name}\n`;
      for (const sh of pf2.ships) {
        const d = sh.damage.status !== 'combat_effective'
          ? ` 【${sh.damage.status}】进水${sh.damage.flooding.toFixed(0)}% 火灾${sh.damage.fire.toFixed(0)}% 船体${sh.damage.hullIntegrity.toFixed(0)}%`
          : '';
        rpt += `  ${sh.name} (${sh.shipClass})${d}\n`;
      }
    }
    if (ef2) {
      rpt += `\n🔴 敌方舰队: ${ef2.name}\n`;
      for (const sh of ef2.ships) {
        const d = sh.damage.status !== 'combat_effective'
          ? ` 【${sh.damage.status}】进水${sh.damage.flooding.toFixed(0)}% 火灾${sh.damage.fire.toFixed(0)}% 船体${sh.damage.hullIntegrity.toFixed(0)}%`
          : '';
        rpt += `  ${sh.name} (${sh.shipClass})${d}\n`;
      }
    }
    rpt += `\n💀 战损统计: 击沉 ${allKills.length} 艘\n`;
    rpt += allKills.length > 0 ? `  ${allKills.join(', ')}\n` : `  无损失\n`;
    rpt += `\n═══════════════════════════════════════\n`;
    setReport(rpt);
    setRunning(false);
  };

  // ========== 欢迎界面 ==========
  if (!overlay && fleets.length === 0) {
    return (
      <div className="w-[340px] flex flex-col items-center justify-center p-6 space-y-4 glass border-l border-blue-900/20 shrink-0">
        <div className="text-5xl">⚓</div>
        <h1 className="text-xl font-black text-white text-center">太平洋<br/>舰队司令部</h1>
        <div className="h-0.5 w-16 bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
        <p className="text-[11px] text-slate-400 text-center">航母特混舰队作战<br/>AI驾驶 · 探测制导 · 模块损伤</p>
        <button onClick={createScenario} disabled={isCreating}
          className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 text-white font-bold rounded-lg text-sm">
          {isCreating ? '正在生成...' : '部署舰队'}
        </button>
      </div>
    );
  }

  const playerFleet = fleets.find(f => f.faction === 'player');
  const damagedShips = playerFleet?.ships.filter(s => s.damage.status !== 'combat_effective') || [];

  return (
    <div className="w-[400px] flex flex-col glass border-l border-blue-900/20 shrink-0 text-xs">
      {/* 回合 + 推进 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/50">
        <div>
          <span className="text-amber-400 font-black text-lg">第 {currentTurn} 回合</span>
        </div>
        <button onClick={advanceTurn}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-sm font-bold">
          推进回合
        </button>
      </div>

      {/* 舰队状态 */}
      <div className="px-4 py-3 border-b border-slate-800/50">
        <div className="text-[11px] text-slate-400 uppercase mb-2">舰队</div>
        {fleets.filter(f => f.faction === 'player').map(f => (
          <div key={f.id} onClick={() => selectFleet(f.id)}
            className="cursor-pointer py-1 text-sm font-bold text-sky-300">{f.name} ({f.ships.length}艘)</div>
        ))}
        {playerFleet && (
          <div className="mt-2 space-y-1 max-h-[180px] overflow-auto">
            {playerFleet.ships.map(s => (
              <div key={s.id} className="flex items-center gap-2 text-[11px]">
                <span className={`w-2 h-2 rounded-full ${s.damage.status === 'combat_effective' ? 'bg-green-400' : s.damage.status === 'damaged' ? 'bg-yellow-400' : 'bg-red-500'}`} />
                <span className="text-slate-300">{s.name}</span>
                <span className="text-slate-500">{s.shipClass.replace(/_/g,' ')}</span>
                <span className="text-slate-600 ml-auto">{s.speedKts}节</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 损伤警告 — 大字 */}
      {damagedShips.length > 0 && (
        <div className="px-4 py-3 border-b border-red-900/30 bg-red-950/15">
          <div className="text-base font-black text-red-400 mb-2">⚠ 损 伤</div>
          {damagedShips.map(s => (
            <div key={s.id} className="text-sm text-red-300 mb-1">
              <span className="font-bold">{s.name}</span>
              <div className="text-xs text-red-400/80 mt-0.5">
                状态: {s.damage.status} | 进水: {s.damage.flooding.toFixed(0)}% | 火灾: {s.damage.fire.toFixed(0)}%
                <br />船体: {s.damage.hullIntegrity.toFixed(0)}% | 浮力: {s.damage.buoyancy.toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 情报 */}
      <div className="px-4 py-3 border-b border-slate-800/50">
        <div className="text-[11px] text-slate-400 uppercase mb-2">情报 (接触 {intel.playerContacts.length} 个)</div>
        {intel.playerContacts.length === 0 && <div className="text-slate-600 text-[11px]">无敌方接触</div>}
        {intel.playerContacts.slice(0, 5).map(c => (
          <div key={c.id} className="text-[11px] text-slate-400 py-0.5">
            [{c.detectionLevel}] {c.estimatedClass || '?'} ±{c.uncertaintyRadius.toFixed(0)}
          </div>
        ))}
      </div>

      {/* 自动战役 */}
      <div className="px-4 py-3 border-b border-slate-800/50 space-y-2">
        <div className="text-[11px] text-slate-400 uppercase">AI 自动战役</div>
        <div className="flex gap-2">
          <input type="number" value={turns} onChange={e => setTurns(Math.max(1, Math.min(20, +e.target.value)))}
            className="w-14 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-slate-200" disabled={running} />
          <button onClick={runCampaign} disabled={running}
            className="flex-1 py-2 bg-purple-700 hover:bg-purple-600 disabled:bg-slate-700 text-white rounded-lg text-sm font-bold">
            {running ? '运行中...' : '开始战役'}
          </button>
        </div>
      </div>

      {/* 战役日志 */}
      <div className="flex-1 overflow-auto border-b border-slate-800/50">
        <div ref={lgRef} className="p-4 space-y-1 font-mono text-[10px]">
          {log.length === 0 && <div className="text-slate-600 text-xs p-4 text-center">点击"开始战役"查看流程</div>}
          {log.map((l, i) => <div key={i} className="text-slate-400 leading-relaxed whitespace-pre-wrap">{l}</div>)}
        </div>
      </div>

      {/* 最终报告 — 大字醒目 */}
      {report && (
        <div className="p-4 bg-slate-900/90 text-base font-mono whitespace-pre-wrap leading-relaxed text-slate-300 max-h-[400px] overflow-auto">
          {report}
        </div>
      )}
    </div>
  );
}

// ============ LLM ============
function buildCtx(s: ReturnType<typeof useNavalStore.getState>) {
  const pf = s.fleets.find(f => f.faction === 'player');
  let ctx = `回合 ${s.currentTurn + 1}\n`;
  if (pf) {
    ctx += `舰队:${pf.ships.map(sh => `${sh.name}(${sh.shipClass}) HDG${sh.headingDeg} SPD${sh.speedKts} ${sh.damage.status}`).join(',')}\n`;
  }
  const cs = s.intel.playerContacts;
  ctx += `接触:${cs.length > 0 ? cs.map(c => `[${c.detectionLevel}]${c.estimatedClass||'?'}`).join(';') : '无'}\n`;
  ctx += `请给出战术命令(搜索/打击/撤退/巡逻):`;
  return ctx;
}

async function askLLM(ctx: string) {
  const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer sk-7abe53292a3f4698af3a1475d8f1cd19' },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: '你是太平洋舰队指挥官。用中文回复战术命令。' }, { role: 'user', content: ctx }], temperature: 0.7, max_tokens: 200 }),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return ((await r.json()) as any).choices?.[0]?.message?.content || '';
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
