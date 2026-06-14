/**
 * SidePanel - 精简侧边栏：部署、舰队、回合、战役
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavalStore } from '@/store/naval-store';
import { captureTurnSnapshot, downloadReplay, loadReplayFromFile } from '@/ai/replay-system';
import type { ReplayFile } from '@/ai/replay-system';

export function SidePanel() {
  const overlay = useNavalStore(s => s.overlay);
  const fleets = useNavalStore(s => s.fleets);
  const currentTurn = useNavalStore(s => s.currentTurn);
  const intel = useNavalStore(s => s.intel);
  const reports = useNavalStore(s => s.reports);
  const battleLog = useNavalStore(s => s.battleLog);
  const isCreatingScenario = useNavalStore(s => s.isCreatingScenario);
  const createNavalScenario = useNavalStore(s => s.createNavalScenario);
  const advanceNavalTurn = useNavalStore(s => s.advanceNavalTurn);
  const selectFleet = useNavalStore(s => s.selectFleet);
  const selectedFleetId = useNavalStore(s => s.selectedFleetId);

  const [running, setRunning] = useState(false);
  const [turns, setTurns] = useState(6);
  const [log, setLog] = useState<string[]>([]);
  const [replay, setReplay] = useState<ReplayFile | null>(null);
  const [replayTurn, setReplayTurn] = useState(0);
  const lgRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { lgRef.current && (lgRef.current.scrollTop = lgRef.current.scrollHeight); }, [log]);

  const alog = useCallback((s: string) => setLog(p => [...p, s]), []);

  // ============ 战役运行 ============
  const runCampaign = async () => {
    if (running) return;
    setRunning(true); setLog([]);
    if (!overlay || fleets.length === 0) { createNavalScenario(); await sleep(500); }

    const snaps: any[] = [];
    const pLost: string[] = [], eLost: string[] = [];

    for (let t = 0; t < turns; t++) {
      const s = useNavalStore.getState();
      alog(`--- TURN ${s.currentTurn + 1} ---`);

      // LLM 调用
      try {
        const ctx = buildContext(s);
        const decision = await callLLM(ctx);
        alog(`LLM: ${decision.situation || 'no assessment'}`);
        for (const o of (decision.orders || [])) alog(`  → ${o.type}: ${o.reason || ''}`);
        // 执行
        const exec = executeOrders(s, decision.orders || []);
        for (const e of exec) alog(`  ⚡ ${e.description || ''}`);
      } catch (e: any) { alog(`LLM err: ${String(e).slice(0,80)}`); }

      advanceNavalTurn();
      await sleep(50);

      const after = useNavalStore.getState();
      const snap = captureTurnSnapshot(after.currentTurn, after.fleets, after.intel.playerContacts, after.reports, after.battleLog.slice(-20));
      snaps.push(snap);

      for (const f of after.fleets) for (const sh of f.ships) {
        if (sh.damage.status === 'sunk' || sh.damage.status === 'sinking')
          (f.faction === 'player' ? pLost : eLost).push(`${sh.name}`);
      }
    }

    const rf: ReplayFile = { version: '1.0', generatedAt: new Date().toISOString(), totalTurns: snaps.length, mapConfig: { width: 1024, height: 1024, seed: 0 }, turns: snaps, finalResult: { playerLosses: [...new Set(pLost)], enemyLosses: [...new Set(eLost)], summary: `${snaps.length} turns` } };
    downloadReplay(rf);
    setReplay(rf);
    alog(`DONE: ${pLost.length} lost, ${eLost.length} enemy lost. JSON saved.`);
    setRunning(false);
  };

  // 回放加载
  const loadReplay = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { const r = await loadReplayFromFile(f); setReplay(r); setReplayTurn(0); alog(`Loaded replay: ${r.totalTurns} turns`); }
    catch { alog('Failed to load replay'); }
  };

  // ============ 欢迎界面 ============
  if (!overlay && fleets.length === 0) {
    return (
      <div className="w-[300px] flex flex-col items-center justify-center p-6 space-y-4 glass border-l border-blue-900/20 shrink-0">
        <div className="text-4xl">⚓</div>
        <h1 className="text-lg font-black text-white text-center">PACIFIC<br/>COMMAND</h1>
        <p className="text-[10px] text-slate-500 text-center">WWII Carrier Task Force<br/>AI-Driven Operations</p>
        <button onClick={createNavalScenario} disabled={isCreatingScenario}
          className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 text-white font-bold rounded text-sm">
          {isCreatingScenario ? 'Generating...' : 'DEPLOY FLEET'}
        </button>
      </div>
    );
  }

  // ============ 主面板 ============
  const playerFleet = fleets.find(f => f.faction === 'player');
  const contacts = intel.playerContacts;
  const damagedShips = playerFleet?.ships.filter(s => s.damage.status !== 'combat_effective') || [];

  return (
    <div className="w-[320px] flex flex-col glass border-l border-blue-900/20 shrink-0 text-xs">
      {/* 回合控制 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/50">
        <span className="font-bold text-amber-400">TURN {currentTurn}</span>
        <button onClick={advanceNavalTurn}
          className="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded text-[10px] font-bold">
          ADVANCE
        </button>
      </div>

      {/* 舰队 */}
      <div className="px-3 py-2 border-b border-slate-800/50">
        <div className="text-[10px] text-slate-500 uppercase mb-1">Fleet</div>
        {fleets.filter(f=>f.faction==='player').map(f => (
          <div key={f.id} onClick={() => selectFleet(f.id)}
            className={`cursor-pointer py-1 ${f.id === selectedFleetId ? 'text-amber-400' : 'text-slate-300'}`}>
            <span className="font-bold">{f.name}</span>
            <span className="text-slate-600 ml-1">({f.ships.length}s)</span>
            <span className={`ml-1 text-[9px] ${f.fuelState==='good'?'text-green-500':f.fuelState==='limited'?'text-yellow-500':'text-red-500'}`}>{f.fuelState}</span>
          </div>
        ))}
        {playerFleet && (
          <div className="mt-1 space-y-0.5 max-h-[200px] overflow-auto">
            {playerFleet.ships.map(s => (
              <div key={s.id} className="flex items-center gap-1 text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                <span className="text-slate-300 truncate">{s.name}</span>
                <span className="text-slate-600">{s.shipClass.replace(/_/g,' ')}</span>
                <span className="text-slate-500">{s.speedKts}kt</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 损伤 */}
      {damagedShips.length > 0 && (
        <div className="px-3 py-2 border-b border-red-900/20 bg-red-950/10">
          <div className="text-[10px] text-red-400 uppercase mb-1">Damage</div>
          {damagedShips.map(s => (
            <div key={s.id} className="text-[10px] text-red-300">
              {s.name}: {s.damage.status} (flood {s.damage.flooding.toFixed(0)}%, fire {s.damage.fire.toFixed(0)}%)
            </div>
          ))}
        </div>
      )}

      {/* 接触 */}
      <div className="px-3 py-2 border-b border-slate-800/50">
        <div className="text-[10px] text-slate-500 uppercase mb-1">Intel ({contacts.length})</div>
        {contacts.length === 0 && <div className="text-slate-700 text-[10px]">No contacts</div>}
        {contacts.slice(0,5).map(c => (
          <div key={c.id} className="text-[9px] text-slate-400">
            [{c.detectionLevel}] {c.estimatedClass || '?'} ±{c.uncertaintyRadius.toFixed(0)}
          </div>
        ))}
        {contacts.length > 5 && <div className="text-[9px] text-slate-600">+{contacts.length - 5} more</div>}
      </div>

      {/* 战役 */}
      <div className="px-3 py-2 border-b border-slate-800/50 space-y-1.5">
        <div className="text-[10px] text-slate-500 uppercase">LLM Campaign</div>
        <div className="flex gap-1">
          <input type="number" value={turns} onChange={e => setTurns(Math.max(1,Math.min(20,+e.target.value)))}
            className="w-12 px-1 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] text-slate-200" />
          <button onClick={runCampaign} disabled={running}
            className="flex-1 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:bg-slate-700 text-white rounded text-[10px] font-bold">
            {running ? 'Running...' : 'START CAMPAIGN'}
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".json" onChange={loadReplay} className="hidden" />
        <button onClick={() => fileRef.current?.click()} className="w-full py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded text-[9px]">
          Load Replay JSON
        </button>
        {replay && (
          <div className="flex items-center gap-1 text-[9px]">
            <button onClick={() => setReplayTurn(Math.max(0, replayTurn - 1))} className="text-slate-400">◀</button>
            <span className="text-slate-500">T{replayTurn+1}/{replay.totalTurns}</span>
            <button onClick={() => setReplayTurn(Math.min(replay.totalTurns-1, replayTurn+1))} className="text-slate-400">▶</button>
          </div>
        )}
      </div>

      {/* 日志 */}
      <div className="flex-1 overflow-auto">
        <div ref={lgRef} className="p-2 space-y-0.5 font-mono text-[8px]">
          {log.length === 0 && <div className="text-slate-700 p-2">Campaign log appears here</div>}
          {log.map((l, i) => <div key={i} className="text-slate-500">{l}</div>)}
        </div>
      </div>

      {/* 回放详情 */}
      {replay && replay.turns[replayTurn] && (
        <div className="max-h-[150px] overflow-auto px-2 py-1 border-t border-slate-800 bg-slate-900/50 text-[8px] space-y-0.5">
          <div className="text-amber-400 font-bold">Replay T{replayTurn + 1}</div>
          {replay.turns[replayTurn].events.slice(0,5).map((e, i) => (
            <div key={i} className="text-slate-500 truncate">{e.type}: {e.description}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ LLM 调用 ============

function buildContext(s: ReturnType<typeof useNavalStore.getState>) {
  const pf = s.fleets.find(f => f.faction === 'player');
  const ships = pf?.ships.map(sh => `${sh.name}(${sh.shipClass}) HDG${sh.headingDeg} SPD${sh.speedKts} ${sh.damage.status}`).join(', ') || '';
  const contacts = s.intel.playerContacts.map(c => `[${c.detectionLevel}] ${c.estimatedClass || '?'} at (${c.lastKnownPosition.x.toFixed(0)},${c.lastKnownPosition.y.toFixed(0)})`).join('; ') || 'NONE';
  return `TURN ${s.currentTurn + 1}\nShips: ${ships}\nContacts: ${contacts}\n\nIssue orders. Respond ONLY with JSON: {"situation":"...","orders":[{"type":"search|strike|move","target":"...","reason":"..."}]}`;
}

async function callLLM(ctx: string) {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer sk-7abe53292a3f4698af3a1475d8f1cd19' },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You control a WWII carrier task force. Reply JSON with situation and orders.' },
        { role: 'user', content: ctx },
      ],
      temperature: 0.7, max_tokens: 400,
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const d = await res.json();
  const text = d.choices?.[0]?.message?.content || '';
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : { situation: text, orders: [] };
}

function executeOrders(s: ReturnType<typeof useNavalStore.getState>, orders: any[]) {
  const evts: Array<{ description: string }> = [];
  for (const o of orders) {
    const act = o.type || 'search';
    if (act === 'search' || act === 'strike') {
      evts.push({ description: `${act}: ${o.reason || ''}` });
    } else if (act === 'move') {
      evts.push({ description: `move: heading ${o.heading || 0} speed ${o.speed || 20}` });
    }
  }
  return evts;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
