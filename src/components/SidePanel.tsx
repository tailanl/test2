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
  const landAfs = useNavalStore(s => s.landAirfields);
  const islands = useNavalStore(s => s.islands);
  const facilities = useNavalStore(s => s.facilities);
  const isCreating = useNavalStore(s => s.isCreatingScenario);
  const createScenario = useNavalStore(s => s.createNavalScenario);
  const advanceNavalTurn = useNavalStore(s => s.advanceNavalTurn);
  const selectFleet = useNavalStore(s => s.selectFleet);

  const [running, setRunning] = useState(false);
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
        const ctx = buildCtx(s);
        const resp = await askLLM(ctx);
        addLog(`🤖 AI: ${resp.slice(0, 160)}`);

        // 区域搜索：从航母和陆地机场扇形放出搜索机组
        if ((resp.includes('搜索') || resp.includes('侦察'))) {
          const dirs = parseSearchDir(resp);
          // From fleet
          if (pf) dirs.forEach((heading, i) => {
            useNavalStore.setState(s2 => ({ airOperations: [...s2.airOperations,
              { id: `s_fleet_${t}_${i}`, type: 'search', aircraft: 2, x: pf.position.globalX + 30, y: pf.position.globalY + (i - dirs.length / 2) * 12, heading, fleetName: pf.name, status: '搜索中' }
            ]}));
          });
          // From land airfields
          landAfs.filter(a => a.faction === 'player' && a.bombers > 0).slice(0, 2).forEach(af => {
            useNavalStore.setState(s2 => ({ airOperations: [...s2.airOperations,
              { id: `s_land_${t}_${af.id}`, type: 'search', aircraft: 2, x: af.x + 20, y: af.y, heading: dirs[0] || 45, fleetName: af.name, status: '搜索中' }
            ]}));
          });
          addLog(`  ✈️ 扇形搜索: ${dirs.length}方向, 航母+陆基`);
        }
        if ((resp.includes('打击') || resp.includes('攻击')) && pf) {
          useNavalStore.setState(s2 => ({ airOperations: [...s2.airOperations, { id: `st_${t}`, type: 'strike', x: pf.position.globalX + 60, y: pf.position.globalY + 40, heading: 50, fleetName: pf.name, status: '进攻中', aircraft: 6 }] }));
        }
      } catch { addLog('🤖 AI离线'); }

      // 飞机快速移动(50格/回合, 对应250km/h搜索机)
      const ao2 = useNavalStore.getState().airOperations.map(a => ({
        ...a,
        x: a.x + 50, y: a.y + 30,
        status: a.x > Math.max(pf?.position.globalX || 0, (fleets.find(f2 => f2.faction==='enemy')?.position.globalX || 1500)) + 300 ? '返航中' : a.status,
      }));
      useNavalStore.setState({ airOperations: ao2.filter(a => a.x < 2800 && a.y < 1800).slice(-20) });

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
        <p className="text-xs text-slate-400 text-center leading-relaxed">战略图 3000×2000<br/>12条岛链 · 港口 · 机场<br/>AI 自动驾驶战役</p>
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
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800/50">
        <div>
          <span className="text-amber-400 font-black text-xl">第 {currentTurn} 回合</span>
          <div className="text-[10px] text-slate-500">{islands.length}群岛 · {facilities.length}设施</div>
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
  let c = `回合${s.currentTurn+1}\n`;
  if (pf) c += `舰队:${pf.ships.map(sh => `${sh.name}(${sh.shipClass})`).join(',')} [${pf.position.globalX},${pf.position.globalY}]\n`;
  c += `接触:${s.intel.playerContacts.map(ct => `[${ct.detectionLevel}]`).join(',') || '无'}\n`;
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

function parseSearchDir(resp: string): number[] {
  const lower = resp.toLowerCase();
  // Fan-shaped search in multiple directions
  if (lower.includes('ne') || lower.includes('东北')) return [30, 45, 60, 75];
  if (lower.includes('nw') || lower.includes('西北')) return [300, 315, 330, 345];
  if (lower.includes('se') || lower.includes('东南')) return [120, 135, 150, 165];
  if (lower.includes('sw') || lower.includes('西南')) return [210, 225, 240, 255];
  if (lower.includes('n') || lower.includes('北')) return [345, 0, 15, 30];
  if (lower.includes('s') || lower.includes('南')) return [165, 180, 195, 210];
  if (lower.includes('e') || lower.includes('东')) return [60, 75, 90, 105, 120];
  if (lower.includes('w') || lower.includes('西')) return [240, 255, 270, 285, 300];
  // Default: all-around search
  return [0, 45, 90, 135, 180, 225, 270, 315];
}
