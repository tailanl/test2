import React, { useState, useRef, useEffect } from 'react';
import { useNavalStore } from '@/store/naval-store';

export function SidePanel() {
  const overlay = useNavalStore(s => s.overlay);
  const fleets = useNavalStore(s => s.fleets);
  const currentTurn = useNavalStore(s => s.currentTurn);
  const intel = useNavalStore(s => s.intel);
  const reports = useNavalStore(s => s.reports);
  const battleLog = useNavalStore(s => s.battleLog);
  const airOps = useNavalStore(s => s.airOperations);
  const islands = useNavalStore(s => s.islands);
  const facilities = useNavalStore(s => s.facilities);
  const isCreating = useNavalStore(s => s.isCreatingScenario);
  const createScenario = useNavalStore(s => s.createNavalScenario);
  const advanceNavalTurn = useNavalStore(s => s.advanceNavalTurn);
  const selectFleet = useNavalStore(s => s.selectFleet);

  const [running, setRunning] = useState(false);
  const [turns, setTurns] = useState(6);
  const [log, setLog] = useState<string[]>([]);
  const [report, setReport] = useState('');
  const lgRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (lgRef.current) lgRef.current.scrollTop = lgRef.current.scrollHeight; }, [log]);

  const runCampaign = async () => {
    if (running) return; setRunning(true); setLog([]); setReport('');
    if (!overlay || fleets.length === 0) { createScenario(); await sleep(800); }

    const allKills: string[] = [];

    for (let t = 0; t < turns; t++) {
      const s = useNavalStore.getState();
      addLog(`\n══════ 第 ${s.currentTurn + 1} 回合 ══════`);

      // 舰队
      const pf = s.fleets.find(f => f.faction === 'player');
      if (pf) {
        addLog(`📍 ${pf.name} (${pf.ships.length}艘) [${pf.position.globalX},${pf.position.globalY}] ${pf.fuelState}`);
        for (const sh of pf.ships) {
          const d = sh.damage.status !== 'combat_effective' ? ` ⚠${sh.damage.status} 进水:${sh.damage.flooding.toFixed(0)}% 火:${sh.damage.fire.toFixed(0)}%` : '';
          addLog(`  ${sh.name}(${sh.shipClass}) HDG${sh.headingDeg} ${sh.speedKts}kt${d}`);
        }
      }

      // 接触
      const cs = s.intel.playerContacts;
      if (cs.length > 0) { addLog(`📡 接触:${cs.length}`); cs.forEach(c => addLog(`  [${c.detectionLevel}] ${c.estimatedClass||'?'} ±${c.uncertaintyRadius.toFixed(0)}`)); }
      else addLog(`📡 无敌方接触`);

      // 飞机
      const aops = s.airOperations;
      if (aops.length > 0) { addLog(`✈️ 空中:${aops.length}批次`); aops.forEach(a => addLog(`  ${a.type} ${a.fleetName} ${a.status} (${a.x},${a.y}) ×${a.aircraft}`)); }

      // LLM
      try {
        const ctx = buildCtx(s);
        const resp = await askLLM(ctx);
        addLog(`🤖 AI: ${resp.slice(0, 160)}`);
        // Parse air ops from LLM
        if (resp.includes('搜索') && pf) s.airOperations.push({ id: `s_${t}`, type: 'search', x: pf.position.globalX + 100, y: pf.position.globalY, heading: 45, fleetName: pf.name, status: '搜索中', aircraft: 4 });
        if (resp.includes('打击') && pf) s.airOperations.push({ id: `st_${t}`, type: 'strike', x: pf.position.globalX + 50, y: pf.position.globalY + 30, heading: 60, fleetName: pf.name, status: '进攻中', aircraft: 6 });
      } catch { addLog(`🤖 AI离线`); }

      // 模拟航空任务推进
      const ao = useNavalStore.getState().airOperations.map(a => ({ ...a, x: a.x + 15, y: a.y + 8, status: a.status === '搜索中' ? '搜索中' : a.status === '进攻中' ? '进攻中' : '返航中' }));
      useNavalStore.setState({ airOperations: ao.slice(-10) });

      advanceNavalTurn();
      await sleep(100);

      // 战斗
      const after = useNavalStore.getState();
      const newEvts = after.battleLog.filter(e => !s.battleLog.find(x => x.id === e.id));
      if (newEvts.length > 0) addLog(`⚔️ 战斗事件(${newEvts.length}):`), newEvts.slice(0, 8).forEach(e => addLog(`  ${e.description}`));

      // 损伤
      if (pf) {
        const apf = after.fleets.find(f => f.id === pf.id);
        if (apf) for (const sa of apf.ships) {
          const sb = pf.ships.find(x => x.id === sa.id);
          if (!sb) continue;
          if (sa.damage.status !== 'combat_effective') {
            addLog(`💥 ${sa.name}: ${sa.damage.status} 进水:${sa.damage.flooding.toFixed(0)}% 火:${sa.damage.fire.toFixed(0)}% 船体:${sa.damage.hullIntegrity.toFixed(0)}%`);
          }
          if (sa.damage.status === 'sinking' || sa.damage.status === 'sunk') allKills.push(`${sa.name}`);
        }
      }
    }

    // 报告
    const sf = useNavalStore.getState();
    let r = `\n\n══════════════════════════════\n  太 平 洋 海 战 报 告\n  共 ${turns} 回合\n══════════════════════════════\n\n`;
    for (const f of sf.fleets) {
      const icon = f.faction === 'player' ? '🔵' : '🔴';
      r += `${icon} ${f.name} [${f.position.globalX},${f.position.globalY}]\n`;
      for (const sh of f.ships) {
        const d = sh.damage.status !== 'combat_effective' ? ` 【${sh.damage.status}】进水${sh.damage.flooding.toFixed(0)}% 火灾${sh.damage.fire.toFixed(0)}% 船体${sh.damage.hullIntegrity.toFixed(0)}%` : '';
        r += `  ${sh.name}(${sh.shipClass})${d}\n`;
      }
    }
    r += `\n💀 战损: ${allKills.length}艘\n${allKills.length > 0 ? allKills.join(', ') : '无'}\n`;
    r += `══════════════════════════════\n`;
    setReport(r); setRunning(false);
  };

  const addLog = (s: string) => setLog(p => [...p, s]);

  if (!overlay && fleets.length === 0) {
    return (
      <div className="w-[360px] flex flex-col items-center justify-center p-6 space-y-4 glass border-l border-blue-900/20 shrink-0">
        <div className="text-5xl">⚓</div>
        <h1 className="text-xl font-black text-white text-center">太平洋<br/>舰队司令部</h1>
        <div className="h-0.5 w-16 bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
        <p className="text-[11px] text-slate-400 text-center">战略地图 · 岛链设施 · AI战役<br/>航母航空作战</p>
        <button onClick={createScenario} disabled={isCreating}
          className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 text-white font-bold rounded-lg text-sm">
          {isCreating ? '正在生成...' : '部署舰队'}
        </button>
      </div>
    );
  }

  const pf = fleets.find(f => f.faction === 'player');
  const damaged = pf?.ships.filter(s => s.damage.status !== 'combat_effective') || [];

  return (
    <div className="w-[420px] flex flex-col glass border-l border-blue-900/20 shrink-0 text-xs">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/50">
        <span className="text-amber-400 font-black text-lg">第 {currentTurn} 回合</span>
        <button onClick={advanceNavalTurn} className="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-sm font-bold">推进回合</button>
      </div>

      {/* 舰队 */}
      <div className="px-4 py-2 border-b border-slate-800/50">
        <div className="text-[11px] text-slate-400 uppercase mb-1">舰队 ({islands.length}个岛链 · {facilities.length}设施)</div>
        {fleets.filter(f => f.faction === 'player').map(f => (
          <div key={f.id} className="cursor-pointer py-1 text-sm font-bold text-sky-300">{f.name} ({f.ships.length}艘) [{f.position.globalX},{f.position.globalY}]</div>
        ))}
        {pf && <div className="mt-1 space-y-0.5 max-h-[120px] overflow-auto">{pf.ships.map(s => (
          <div key={s.id} className="flex gap-1 text-[10px]"><span className={`w-1.5 h-1.5 mt-0.5 rounded-full ${s.damage.status==='combat_effective'?'bg-green-400':s.damage.status==='damaged'?'bg-yellow-400':'bg-red-500'}`}/><span className="text-slate-300">{s.name}</span><span className="text-slate-500">{s.shipClass.replace(/_/g,' ')}</span><span className="text-slate-600 ml-auto">{s.speedKts}节</span></div>
        ))}</div>}
      </div>

      {/* 飞机 */}
      <div className="px-4 py-2 border-b border-slate-800/50">
        <div className="text-[11px] text-slate-400 uppercase mb-1">✈️ 航空任务 ({airOps.length})</div>
        {airOps.length === 0 && <div className="text-slate-600 text-[10px]">无空中任务</div>}
        {airOps.map(a => (
          <div key={a.id} className="text-[10px] text-slate-400 flex gap-1">
            <span className={a.type === 'strike' ? 'text-red-400' : a.type === 'search' ? 'text-blue-400' : 'text-green-400'}>{a.type}</span>
            <span>{a.fleetName}</span>
            <span className="text-slate-600">({a.x},{a.y}) ×{a.aircraft}</span>
            <span className="text-slate-500">{a.status}</span>
          </div>
        ))}
      </div>

      {/* 损伤 — 大字 */}
      {damaged.length > 0 && (
        <div className="px-4 py-3 border-b border-red-900/30 bg-red-950/15">
          <div className="text-lg font-black text-red-400 mb-2">⚠ 损 伤</div>
          {damaged.map(s => (
            <div key={s.id} className="text-sm text-red-300 mb-1">
              <span className="font-bold">{s.name}</span>
              <div className="text-xs text-red-400/80 mt-0.5">
                进水{s.damage.flooding.toFixed(0)}% 火灾{s.damage.fire.toFixed(0)}% 船体{s.damage.hullIntegrity.toFixed(0)}% 浮力{s.damage.buoyancy.toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 情报 */}
      <div className="px-4 py-2 border-b border-slate-800/50">
        <div className="text-[11px] text-slate-400 uppercase mb-1">情报 (接触 {intel.playerContacts.length})</div>
        {intel.playerContacts.length === 0 && <div className="text-slate-600 text-[10px]">无敌方接触</div>}
        {intel.playerContacts.slice(0, 5).map(c => (
          <div key={c.id} className="text-[10px] text-slate-400">[{c.detectionLevel}] {c.estimatedClass||'?'} ±{c.uncertaintyRadius.toFixed(0)}</div>
        ))}
      </div>

      {/* 战役 */}
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

      {/* 日志 */}
      <div className="flex-1 overflow-auto border-b border-slate-800/50">
        <div ref={lgRef} className="p-3 space-y-1 font-mono text-[9px]">
          {log.length === 0 && <div className="text-slate-600 text-xs p-4 text-center">点击"开始战役"查看流程</div>}
          {log.map((l, i) => <div key={i} className="text-slate-400 leading-relaxed whitespace-pre-wrap">{l}</div>)}
        </div>
      </div>

      {/* 报告 — 大字 */}
      {report && (
        <div className="p-4 bg-slate-900/90 text-[15px] font-mono whitespace-pre-wrap leading-relaxed text-slate-200 max-h-[400px] overflow-auto font-bold">
          {report}
        </div>
      )}
    </div>
  );
}

function buildCtx(s: ReturnType<typeof useNavalStore.getState>) {
  const pf = s.fleets.find(f => f.faction === 'player');
  let c = `回合${s.currentTurn+1}\n`;
  if (pf) c += `舰队:${pf.ships.map(sh=>`${sh.name}(${sh.shipClass})`).join(',')} [${pf.position.globalX},${pf.position.globalY}]\n`;
  c += `接触:${s.intel.playerContacts.map(ct=>`[${ct.detectionLevel}]`).join(',')||'无'}\n`;
  c += `空中:${s.airOperations.length}批次\n请给战术命令(搜索/打击/撤退):`;
  return c;
}

async function askLLM(ctx: string) {
  const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer sk-7abe53292a3f4698af3a1475d8f1cd19' },
    body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: '你是太平洋舰队指挥官。用中文回复战术命令。' }, { role: 'user', content: ctx }], temperature: 0.7, max_tokens: 200 }),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return ((await r.json()) as any).choices?.[0]?.message?.content || '';
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
