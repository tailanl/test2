/**
 * NavalCampaignPanel - LLM 自动战役 + JSON 回放
 */

import React, { useState, useRef, useEffect } from 'react';
import { useNavalStore } from '@/store/naval-store';
import { captureTurnSnapshot, downloadReplay, loadReplayFromFile } from '@/ai/replay-system';
import type { ReplayFile, ReplayTurnSnapshot } from '@/ai/replay-system';

export function NavalCampaignPanel() {
  const store = useNavalStore;
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [turns, setTurns] = useState(8);
  const [result, setResult] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  
  // 回放状态
  const [replayFile, setReplayFile] = useState<ReplayFile | null>(null);
  const [replayTurn, setReplayTurn] = useState(0);
  const [showReplay, setShowReplay] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  const addLog = (msg: string) => setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const runCampaign = async () => {
    if (running) return;
    setRunning(true); setLog([]); setResult('');
    const s = useNavalStore.getState();
    if (!s.overlay || s.fleets.length === 0) { s.createNavalScenario(); await sleep(300); }

    const snapshots: ReplayTurnSnapshot[] = [];
    const playerLost: string[] = [];
    const enemyLost: string[] = [];

    for (let t = 0; t < turns; t++) {
      const state = useNavalStore.getState();
      addLog(`===== TURN ${state.currentTurn + 1} =====`);

      // LLM decision
      let llmDecision: any = undefined;
      try {
        const { getLLMCampaignDecision } = await import('@/ai/campaign-controller');
        const ts = { turn: state.currentTurn, playerFleet: state.fleets.find((f:any) => f.faction === 'player'),
          enemyFleets: state.fleets.filter((f:any) => f.faction === 'enemy'),
          contacts: state.intel.playerContacts, environment: state.environment,
          recentReports: state.reports.slice(-5), battleLog: state.battleLog.slice(-10) };
        const d = await getLLMCampaignDecision({ ...state.aiConfig, apiKey: 'sk-b895a96126db4365ba217ef5b8d1d795' }, ts as any);
        llmDecision = { situation: d.situation, orders: d.shipOrders.length };
        addLog(`🤖 ${d.situation}`);
        for (const o of d.shipOrders) addLog(`  📋 ${(o as any).action}: ${(o as any).reason || ''}`);

        // Execute orders
        const { executeNavalAIActions } = await import('@/game/naval/ai/naval-action-executor');
        const ships: Record<string, any> = {};
        for (const f of state.fleets) for (const sh of f.ships) ships[sh.id] = sh;
        const actions = d.shipOrders.map((o: any, i: number) => ({
          id: `llm_${t}_${i}`, type: o.action || 'hold_fire',
          shipId: state.fleets[0]?.ships.find((s: any) => s.shipClass?.includes('carrier'))?.id || state.fleets[0]?.ships[0]?.id,
          fleetId: state.fleets[0]?.id,
          targetContactId: o.targetContactId, targetPosition: undefined, headingDeg: o.heading, targetSpeedKts: o.speed, rudderDeg: 0,
          reason: o.reason || '', basedOnContactIds: [],
        }));
        if (actions.length > 0) {
          const exec = executeNavalAIActions({ actions, fleets: state.fleets, shipMap: ships, intel: state.intel,
            environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, windDirectionDeg: 0, windSpeedKts: 0, visibilityModifier: 1 }, currentTurn: state.currentTurn });
          for (const e of exec.events) addLog(`  ⚡ ${e.description}`);
        }
      } catch (e: any) { addLog(`⚠️ LLM fallback: ${String(e).slice(0,60)}`); }

      // Advance
      state.advanceNavalTurn();
      await sleep(100);

      // Snapshot
      const after = useNavalStore.getState();
      const snap = captureTurnSnapshot(after.currentTurn, after.fleets, after.intel.playerContacts, after.reports, after.battleLog.slice(-20), llmDecision);
      snapshots.push(snap);

      // Track losses
      for (const f of after.fleets) for (const sh of f.ships) {
        if (sh.damage.status === 'sunk' || sh.damage.status === 'sinking') {
          (f.faction === 'player' ? playerLost : enemyLost).push(`${sh.name}(${sh.shipClass})`);
        }
      }

      addLog(`Turn complete: ${snap.events.length} events, ${snap.contacts.length} contacts`);
    }

    const replay: ReplayFile = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      totalTurns: snapshots.length,
      mapConfig: { width: 1024, height: 1024, seed: 0 },
      turns: snapshots,
      finalResult: { playerLosses: [...new Set(playerLost)], enemyLosses: [...new Set(enemyLost)], summary: `${snapshots.length} turns complete` },
    };

    // 自动下载
    downloadReplay(replay);
    addLog(`✅ Campaign complete. ${playerLost.length} player losses, ${enemyLost.length} enemy. JSON saved.`);
    setResult(`Done: ${snapshots.length} turns, ${playerLost.length} lost`);
    setRunning(false);
  };

  // 加载回放
  const handleLoadReplay = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const r = await loadReplayFromFile(file);
      setReplayFile(r);
      setReplayTurn(0);
      setShowReplay(false);
      setResult(`Loaded: ${r.totalTurns} turns from ${r.generatedAt}`);
    } catch { setResult('Failed to load replay'); }
  };

  // 回放导航
  const replaySnap = replayFile?.turns[replayTurn];
  const playerFleet = replaySnap?.fleets.find(f => f.faction === 'player');
  const enemyFleet = replaySnap?.fleets.find(f => f.faction === 'enemy');

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="p-3 border-b border-slate-800 space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <span className="font-bold text-purple-400 text-sm">CAMP + REPLAY</span>
          <span className="text-[10px] text-slate-600">{result}</span>
        </div>

        {/* Run campaign */}
        <div className="flex items-center gap-2">
          <input type="number" value={turns} onChange={e => setTurns(Math.max(1, Math.min(30, +e.target.value)))}
            className="w-14 px-1.5 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200" disabled={running} />
          <button onClick={runCampaign} disabled={running}
            className="flex-1 btn-gold py-2 rounded-lg font-bold text-sm text-white disabled:opacity-50">
            {running ? 'Running...' : 'Start LLM Campaign'}
          </button>
        </div>

        {/* Load replay */}
        <div className="flex gap-1">
          <input ref={fileRef} type="file" accept=".json" onChange={handleLoadReplay} className="hidden" />
          <button onClick={() => fileRef.current?.click()} className="flex-1 btn-navy py-1.5 rounded text-xs font-bold text-white">
            Load Replay JSON
          </button>
        </div>

        {/* Replay controls */}
        {replayFile && (
          <div className="flex items-center gap-2 text-[10px]">
            <button onClick={() => setReplayTurn(Math.max(0, replayTurn - 1))} className="px-2 py-1 bg-slate-800 rounded text-slate-300">◀</button>
            <span className="text-slate-400">Turn {replayTurn + 1}/{replayFile.totalTurns}</span>
            <button onClick={() => setReplayTurn(Math.min(replayFile.totalTurns - 1, replayTurn + 1))} className="px-2 py-1 bg-slate-800 rounded text-slate-300">▶</button>
            <button onClick={() => setShowReplay(!showReplay)} className="px-2 py-1 bg-slate-800 rounded text-slate-300 text-[9px]">{showReplay ? 'Hide' : 'View'}</button>
          </div>
        )}
      </div>

      {/* Replay detail view */}
      {showReplay && replaySnap && (
        <div className="p-2 border-b border-slate-800 bg-slate-900/50 text-[9px] max-h-[200px] overflow-auto space-y-1">
          <div className="font-bold text-amber-400">Turn {replaySnap.turn} Snapshot</div>
          {/* Ships */}
          <div className="text-slate-500">Player Fleet:</div>
          {playerFleet?.ships.map(s => (
            <div key={s.id} className="flex gap-1 ml-2">
              <span className={s.faction === 'player' ? 'text-sky-400' : 'text-red-400'}>{s.name}</span>
              <span className="text-slate-600">{s.shipClass} HDG{s.headingDeg}° SPD{s.speedKts}</span>
              {s.damage.status !== 'combat_effective' && <span className="text-red-400">[{s.damage.status} F{s.damage.flooding}%]</span>}
            </div>
          ))}
          {/* Contacts */}
          {replaySnap.contacts.length > 0 && <>
            <div className="text-slate-500">Contacts: {replaySnap.contacts.length}</div>
            {replaySnap.contacts.map(c => (
              <div key={c.id} className="ml-2 text-slate-400">[{c.detectionLevel}] {c.estimatedClass} (±{c.uncertaintyRadius})</div>
            ))}
          </>}
          {/* Events */}
          {replaySnap.events.filter(e => e.type !== 'change_course').length > 0 && <>
            <div className="text-slate-500">Events:</div>
            {replaySnap.events.slice(0, 5).map((e, i) => (
              <div key={i} className="ml-2 text-amber-400/70">{e.type}: {e.description.slice(0, 80)}</div>
            ))}
          </>}
          {/* LLM */}
          {replaySnap.llmDecision && <div className="text-purple-400">LLM: {replaySnap.llmDecision.situation} ({replaySnap.llmDecision.orders} orders)</div>}
        </div>
      )}

      {/* Log */}
      <div ref={logRef} className="flex-1 overflow-auto p-2 space-y-0.5 font-mono text-[9px]">
        {log.length === 0 && <div className="text-slate-600 p-4 text-center">Click Start to run LLM campaign.<br/>JSON auto-saved each run.<br/>Or Load Replay JSON to review.</div>}
        {log.map((l, i) => <div key={i} className="text-slate-400">{l}</div>)}
      </div>

      {/* Final result */}
      {replayFile && (
        <div className="p-2 border-t border-slate-800 glass text-xs">
          <div className="font-bold text-green-400">Replay: {replayFile.totalTurns} turns</div>
          {replayFile.finalResult.playerLosses.length > 0 && <div className="text-red-400 text-[10px]">Lost: {replayFile.finalResult.playerLosses.join(', ')}</div>}
          {replayFile.finalResult.enemyLosses.length > 0 && <div className="text-orange-400 text-[10px]">Enemy: {replayFile.finalResult.enemyLosses.join(', ')}</div>}
        </div>
      )}
    </div>
  );
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
