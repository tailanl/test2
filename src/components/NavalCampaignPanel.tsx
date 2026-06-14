import React, { useState, useRef, useEffect } from 'react';
import { useNavalStore } from '@/store/naval-store';
import type { CampaignLogEntry, CampaignResult } from '@/ai/campaign-controller';

export function NavalCampaignPanel() {
  const { fleets, intel, currentTurn, advanceNavalTurn, aiConfig, createNavalScenario, overlay, facilities } = useNavalStore();
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<CampaignLogEntry[]>([]);
  const [result, setResult] = useState<CampaignResult | null>(null);
  const [turns, setTurns] = useState(10);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  const run = async () => {
    if (running) return; setRunning(true); setLog([]); setResult(null);
    if (!overlay || fleets.length === 0) { createNavalScenario(); await sleep(300); }
    const turnResults: any[] = [];
    const playerLost: string[] = [];
    const enemyLost: string[] = [];

    for (let t = 0; t < turns; t++) {
      const s = useNavalStore.getState();
      const turnNum = s.currentTurn;
      addLog(`T${turnNum+1} ⚡ Requesting DeepSeek AI orders...`, 'planning_player', 'player');

      try {
        const { getLLMCampaignDecision } = await import('@/ai/campaign-controller');
        const ts = { turn: turnNum, playerFleet: s.fleets.find((f:any) => f.faction === 'player'),
          enemyFleets: s.fleets.filter((f:any) => f.faction === 'enemy'), contacts: s.intel.playerContacts,
          environment: s.environment, recentReports: s.reports.slice(-5), battleLog: s.battleLog.slice(-10) };
        const d = await getLLMCampaignDecision({ ...aiConfig, apiKey: 'sk-b895a96126db4365ba217ef5b8d1d795' }, ts);
        addLog(`🧠 ${d.situation}`, 'planning_player', 'player');
        addLog(`📋 ${d.shipOrders.length} orders, targets: ${d.priorityTargets.join(',') || 'none'}`, 'execution', 'player');
      } catch (e: any) { addLog(`⚠️ LLM fallback: ${String(e).slice(0,60)}`, 'planning_player', 'player'); }

      advanceNavalTurn();
      await sleep(50);

      const after = useNavalStore.getState();
      const evts = after.battleLog.slice(-10);
      for (const e of evts) addLog(e.description, 'execution', 'both');
      addLog(`Turn complete: ${evts.length} events, ${after.intel.playerContacts.length} contacts`, 'report', 'player');

      turnResults.push({ turn: turnNum, events: evts.length, contacts: after.intel.playerContacts.length });
      for (const f of after.fleets) for (const sh of f.ships) {
        if (sh.damage.status === 'sunk'||sh.damage.status==='sinking') {
          const arr = f.faction==='player' ? playerLost : enemyLost;
          if (!arr.includes(sh.name)) arr.push(sh.name);
        }
      }
    }

    setResult({ totalTurns: turns, turns: turnResults, playerLosses: playerLost, enemyLosses: enemyLost, playerDamage: {}, enemyDamage: {}, finalSummary: `${turns} turns. Player lost: ${playerLost.length||0}, Enemy lost: ${enemyLost.length||0}` });
    addLog(`🏁 CAMPAIGN END. Player losses: ${playerLost.length}, Enemy: ${enemyLost.length}`, 'report', 'player');
    setRunning(false);
  };

  const addLog = (content: string, phase: string, faction: string) => {
    setLog((prev) => [...prev, { turn: useNavalStore.getState().currentTurn, timestamp: new Date().toISOString(), phase: phase as any, faction, content }]);
  };

  const pc = (p: string) => p==='intel'?'text-cyan-400':p==='planning_player'?'text-blue-400':p==='planning_enemy'?'text-red-400':p==='execution'?'text-amber-400':p==='report'?'text-green-400':'text-slate-400';

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-slate-800 space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <span className="font-bold text-purple-400">⚔️ CAMPAIGN MODE</span>
          <span className="text-[10px] text-slate-600">LLM Auto-Play</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-slate-400 text-[10px]">Turns:</label>
          <input type="number" value={turns} onChange={(e) => setTurns(Math.max(1,Math.min(50,+e.target.value)))}
            className="w-14 px-1.5 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 outline-none" disabled={running} />
          <button onClick={run} disabled={running}
            className="flex-1 btn-gold py-2 rounded-lg font-bold text-sm text-white disabled:opacity-50">
            {running ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin"/>Running T{useNavalStore.getState().currentTurn}/{currentTurn+turns}</span> : '⚡ START CAMPAIGN'}
          </button>
        </div>
      </div>
      <div ref={logRef} className="flex-1 overflow-auto p-2 space-y-0.5 font-mono text-[9px]">
        {log.length===0 && <div className="text-slate-600 p-4 text-center">Campaign log appears here.<br/>Click Start Campaign</div>}
        {log.map((e,i) => (
          <div key={i} className="flex gap-1.5 py-0.5 border-b border-slate-800/20">
            <span className="text-slate-700 w-7 shrink-0">T{e.turn}</span>
            <span className={`${pc(e.phase)} w-16 shrink-0`}>[{e.phase}]</span>
            <span className="text-slate-300 truncate">{e.content}</span>
          </div>
        ))}
      </div>
      {result && (
        <div className="p-2 border-t border-slate-800 glass text-xs max-h-[150px] overflow-auto">
          <div className="font-bold text-green-400">Campaign Complete</div>
          <div className="text-slate-400 mt-0.5">{result.finalSummary}</div>
          {result.playerLosses.length>0 && <div className="text-red-400 text-[10px] mt-1">💀 Lost: {result.playerLosses.join(', ')}</div>}
          {result.enemyLosses.length>0 && <div className="text-orange-400 text-[10px]">🎯 Enemy lost: {result.enemyLosses.join(', ')}</div>}
        </div>
      )}
    </div>
  );
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
