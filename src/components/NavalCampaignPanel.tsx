/**
 * NavalCampaignPanel - LLM 驱动的战役运行面板
 * 自动周回：LLM决策 → 执行 → 记录日志
 */

import React, { useState, useRef, useEffect } from 'react';
import { useNavalStore } from '@/store/naval-store';
import type { CampaignLogEntry, CampaignResult, CampaignTurnResult } from '@/ai/campaign-controller';

export function NavalCampaignPanel() {
  const {
    fleets,
    intel,
    currentTurn,
    environment,
    reports,
    battleLog,
    advanceNavalTurn,
    aiConfig,
    createNavalScenario,
    overlay,
    facilities,
  } = useNavalStore();

  const [running, setRunning] = useState(false);
  const [campaignLog, setCampaignLog] = useState<CampaignLogEntry[]>([]);
  const [campaignResult, setCampaignResult] = useState<CampaignResult | null>(null);
  const [totalTurns, setTotalTurns] = useState(10);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [campaignLog]);

  const logEntry = (entry: CampaignLogEntry) => {
    setCampaignLog((prev) => [...prev, entry]);
  };

  const runCampaign = async () => {
    if (running) return;
    setRunning(true);
    setCampaignLog([]);
    setCampaignResult(null);

    // Ensure scenario exists
    if (!overlay || fleets.length === 0) {
      createNavalScenario();
      await sleep(200);
    }

    const results: CampaignTurnResult[] = [];
    const playerLosses: string[] = [];
    const enemyLosses: string[] = [];

    for (let t = 0; t < totalTurns; t++) {
      const turnNum = useNavalStore.getState().currentTurn;
      const state = useNavalStore.getState();

      logEntry({
        turn: turnNum,
        timestamp: new Date().toISOString(),
        phase: 'planning_player',
        faction: 'player',
        content: `=== TURN ${turnNum + 1} === Requesting DeepSeek AI orders...`,
      });

      // Build turn state summary
      const turnState = buildTurnState(state);

      // Get LLM decision
      let playerPlan = '';
      try {
        const { getLLMCampaignDecision } = await import('@/ai/campaign-controller');
        const apiKey = 'sk-b895a96126db4365ba217ef5b8d1d795';
        const config = { ...aiConfig, apiKey };
        const decision = await getLLMCampaignDecision(config, turnState);

        playerPlan = decision.situation;
        logEntry({
          turn: turnNum, timestamp: new Date().toISOString(),
          phase: 'planning_player', faction: 'player',
          content: `AI: ${decision.situation}`,
          data: { orders: decision.shipOrders.length, priorityTargets: decision.priorityTargets },
        });

        // Apply ship orders via the action executor
        const { executeNavalAIActions } = await import('@/game/naval/ai/naval-action-executor');
        const fleets = state.fleets;
        const shipMap: Record<string, any> = {};
        for (const f of fleets) for (const s of f.ships) shipMap[s.id] = s;

        const actions = decision.shipOrders.map((o: any) => ({
          id: `llm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          shipId: findShipIdByName(fleets, o.shipName),
          fleetId: fleets[0]?.id,
          type: o.action || 'hold_fire',
          targetContactId: undefined,
          targetPosition: undefined,
          headingDeg: o.heading,
          targetSpeedKts: o.speed,
          rudderDeg: 0,
          reason: o.reason || 'LLM order',
          basedOnContactIds: [],
        }));

        if (actions.length > 0) {
          const execResult = executeNavalAIActions({
            actions, fleets, shipMap, intel,
            environment: { timeOfDay: 'day', weather: 'clear', seaState: 1, windDirectionDeg: 0, windSpeedKts: 0, visibilityModifier: 1 },
            currentTurn: turnNum,
          });
          logEntry({
            turn: turnNum, timestamp: new Date().toISOString(),
            phase: 'execution', faction: 'player',
            content: `${execResult.events.length} action events`,
          });
        }
      } catch (e) {
        playerPlan = `LLM error: ${String(e).slice(0, 100)}`;
        logEntry({
          turn: turnNum, timestamp: new Date().toISOString(),
          phase: 'planning_player', faction: 'player',
          content: `LLM call failed, using rule-based fallback. ${String(e).slice(0, 80)}`,
        });
      }

      logEntry({
        turn: turnNum, timestamp: new Date().toISOString(),
        phase: 'execution', faction: 'both',
        content: 'Advancing turn...',
      });

      // Advance the actual game turn
      advanceNavalTurn();
      await sleep(100);

      // Collect results
      const afterState = useNavalStore.getState();
      const turnEvents = afterState.battleLog.slice(-20);
      const turnReports = afterState.reports.slice(-5);

      results.push({
        turn: turnNum,
        events: turnEvents,
        reports: turnReports,
        contacts: afterState.intel.playerContacts.map((c) => ({
          level: c.detectionLevel,
          class: (c.estimatedClass as string) || 'unknown',
          position: `(${c.lastKnownPosition.x.toFixed(0)},${c.lastKnownPosition.y.toFixed(0)})`,
        })),
        playerPlan,
        enemyPlan: 'Rule-based',
        summary: `T${turnNum}: ${turnEvents.length} events, ${turnReports.length} reports, ${afterState.intel.playerContacts.length} contacts`,
      });

      // Track losses
      for (const f of afterState.fleets) {
        for (const s of f.ships) {
          if (s.damage.status === 'sunk' || s.damage.status === 'sinking') {
            if (f.faction === 'player') playerLosses.push(`${s.name} (${s.shipClass})`);
            else enemyLosses.push(`${s.name} (${s.shipClass})`);
          }
        }
      }
    }

    setCampaignResult({
      totalTurns: results.length,
      turns: results,
      playerLosses: [...new Set(playerLosses)],
      enemyLosses: [...new Set(enemyLosses)],
      playerDamage: {} as Record<string, string>,
      enemyDamage: {} as Record<string, string>,
      finalSummary: `Campaign complete: ${results.length} turns, ${playerLosses.length} player losses, ${enemyLosses.length} enemy losses`,
    });

    logEntry({
      turn: currentTurn + totalTurns,
      timestamp: new Date().toISOString(),
      phase: 'report',
      faction: 'player',
      content: `=== CAMPAIGN COMPLETE ===\n${results.length} turns run.\nPlayer losses: ${playerLosses.length}\nEnemy losses: ${enemyLosses.length}`,
    });

    setRunning(false);
  };

  const getPhaseColor = (phase: string) => {
    switch (phase) {
      case 'intel': return 'text-cyan-400';
      case 'planning_player': return 'text-blue-400';
      case 'planning_enemy': return 'text-red-400';
      case 'execution': return 'text-amber-400';
      case 'report': return 'text-green-400';
      default: return 'text-gray-400';
    }
  };

  return (
    <div className="flex flex-col h-full text-xs">
      {/* Controls */}
      <div className="p-3 border-b border-gray-700 space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-bold text-purple-400">Campaign Mode</span>
          <span className="text-gray-500 text-[10px]">LLM Auto-Play</span>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-gray-400 text-[10px]">Turns:</label>
          <input
            type="number"
            value={totalTurns}
            onChange={(e) => setTotalTurns(Math.max(1, Math.min(50, Number(e.target.value))))}
            className="w-16 px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200"
            disabled={running}
          />
          <button
            onClick={runCampaign}
            disabled={running}
            className="flex-1 py-2 bg-purple-700 hover:bg-purple-600 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded font-semibold text-sm"
          >
            {running ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin" />
                Running Turn {useNavalStore.getState().currentTurn}/{currentTurn + totalTurns}...
              </span>
            ) : (
              'Start Campaign'
            )}
          </button>
        </div>

        <div className="text-[10px] text-gray-600">
          DeepSeek V3 controls both sides. {facilities.length} facilities, {fleets.length} fleets on map.
        </div>
      </div>

      {/* Log output */}
      <div ref={logRef} className="flex-1 overflow-auto p-2 space-y-0.5 font-mono text-[9px]">
        {campaignLog.length === 0 && (
          <div className="text-gray-600 p-4 text-center">
            Campaign log will appear here.<br/>Click "Start Campaign" to begin.
          </div>
        )}
        {campaignLog.map((entry, i) => (
          <div key={i} className="flex gap-1.5 py-0.5 border-b border-gray-800/30">
            <span className="text-gray-600 w-8 shrink-0">T{entry.turn}</span>
            <span className={`w-14 shrink-0 ${getPhaseColor(entry.phase)}`}>[{entry.phase}]</span>
            <span className="text-gray-300 truncate">{entry.content}</span>
          </div>
        ))}
      </div>

      {/* Campaign summary */}
      {campaignResult && (
        <div className="p-2 border-t border-gray-700 bg-gray-900/50 max-h-[200px] overflow-auto">
          <div className="font-bold text-green-400 mb-1">Campaign Result</div>
          <div className="text-gray-400 mb-1">{campaignResult.finalSummary}</div>
          {campaignResult.playerLosses.length > 0 && (
            <div className="text-[9px] text-red-400">
              Losses: {campaignResult.playerLosses.join(', ')}
            </div>
          )}
          {campaignResult.enemyLosses.length > 0 && (
            <div className="text-[9px] text-orange-400">
              Enemy losses: {campaignResult.enemyLosses.join(', ')}
            </div>
          )}
          <div className="text-[8px] text-gray-600 mt-1">
            {campaignResult.turns.map((t) => (
              <div key={t.turn}>T{t.turn}: {t.summary} | Plan: {t.playerPlan.slice(0, 60)}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function buildTurnState(state: ReturnType<typeof useNavalStore.getState>): any {
  return {
    turn: state.currentTurn,
    playerFleet: state.fleets.find((f) => f.faction === 'player'),
    enemyFleets: state.fleets.filter((f) => f.faction === 'enemy'),
    contacts: state.intel.playerContacts,
    environment: state.environment,
    recentReports: state.reports.slice(-5),
    battleLog: state.battleLog.slice(-10),
  };
}

function findShipIdByName(fleets: any[], name: string): string | undefined {
  for (const f of fleets) {
    const ship = f.ships.find((s: any) => s.name.toLowerCase().includes(name?.toLowerCase()?.slice(0, 10) || ''));
    if (ship) return ship.id;
  }
  // Fallback: return first carrier
  for (const f of fleets) {
    const cv = f.ships.find((s: any) => s.shipClass?.includes('carrier'));
    if (cv) return cv.id;
  }
  return fleets[0]?.ships[0]?.id;
}
