import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavalStore } from '@/store/naval-store';
import { runAITurnPipeline } from '@/ai/ai-turn-pipeline';
import { createCampaignMemory, type CampaignMemory } from '@/ai/campaign-memory';
import type { LLMOutputTrace } from '@/ai/llm-output-trace';
import type { StrategicFleet } from '@/game/naval/naval-strategic-types';
import { getFleetCombatProfile } from '@/game/naval/ship/ship-combat-profile';

export function SidePanel() {
  const overlay = useNavalStore((s) => s.overlay);
  const fleets = useNavalStore((s) => s.fleets);
  const selectedFleetId = useNavalStore((s) => s.selectedFleetId);
  const currentTurn = useNavalStore((s) => s.currentTurn);
  const intel = useNavalStore((s) => s.intel);
  const reports = useNavalStore((s) => s.reports);
  const battleLog = useNavalStore((s) => s.battleLog);
  const airOps = useNavalStore((s) => s.airOperations);
  const weather = useNavalStore((s) => s.weather);
  const victory = useNavalStore((s) => s.victory);
  const facilities = useNavalStore((s) => s.facilities);
  const isCreating = useNavalStore((s) => s.isCreatingScenario);
  const commandHistory = useNavalStore((s) => s.commandHistory);
  const pendingAuthorizations = useNavalStore((s) => s.pendingAuthorizations);
  const fleetCommunications = useNavalStore((s) => s.fleetCommunications);
  const createScenario = useNavalStore((s) => s.createNavalScenario);
  const advanceNavalTurn = useNavalStore((s) => s.advanceNavalTurn);
  const selectFleet = useNavalStore((s) => s.selectFleet);
  const submitNavalCommand = useNavalStore((s) => s.submitNavalCommand);
  const confirmPendingDecision = useNavalStore((s) => s.confirmPendingDecision);

  const playerFleets = fleets.filter((fleet) => fleet.faction === 'player');
  const selectedFleet = fleets.find((fleet) => fleet.id === selectedFleetId) || playerFleets[0];
  const contacts = intel.playerContacts;

  const [running, setRunning] = useState(false);
  const [turns, setTurns] = useState(6);
  const [command, setCommand] = useState('');
  const [memory, setMemory] = useState<CampaignMemory>(() => createCampaignMemory());
  const [runLog, setRunLog] = useState<string[]>([]);
  const [lastCommandResult, setLastCommandResult] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [runLog, battleLog.length]);

  const latestBattleLines = useMemo(
    () => battleLog.slice(-30).map((event) => `T${event.turn} ${event.description}`),
    [battleLog],
  );

  const addRunLog = (line: string) => setRunLog((prev) => [...prev.slice(-120), line]);

  const submitCommand = (text = command) => {
    if (!text.trim()) return;
    const fleetIds = selectedFleet ? [selectedFleet.id] : playerFleets.map((fleet) => fleet.id);
    const receipt = submitNavalCommand(text, fleetIds);
    setLastCommandResult(receipt.resultSummary || receipt.summary);
    setCommand('');
  };

  const runCampaign = async () => {
    if (running) return;
    setRunning(true);
    setRunLog([]);

    if (!overlay || fleets.length === 0) {
      createScenario();
      await sleep(300);
    }

    let memoryCursor = memory;
    for (let i = 0; i < turns; i++) {
      const snapshot = useNavalStore.getState();
      const activeFleets = snapshot.fleets.filter((fleet) => fleet.faction === 'player');
      addRunLog(`Turn ${snapshot.currentTurn + 1}: ${activeFleets.length} fleet-level AI commander(s)`);

      for (const fleet of activeFleets) {
        const result = await runAITurnPipeline({
          faction: 'player',
          mode: 'commander',
          state: useNavalStore,
          memory: memoryCursor,
          fleetId: fleet.id,
          skipVisualAssessment: true,
          llmTraceSink: saveLLMTraceToLocalStorage,
        });
        memoryCursor = result.memory;
        const accepted = result.validation?.acceptedActions.length || 0;
        const rejected = result.validation?.rejectedActions.length || 0;
        const executed = result.execution?.executed.length || 0;
        const failed = result.execution?.failed.length || 0;
        addRunLog(`${fleet.name}: accepted ${accepted}, rejected ${rejected}, executed ${executed}, failed ${failed}`);
        result.validation?.rejectedActions.forEach((item) => addRunLog(`  reject ${item.action.type}: ${item.reason}`));
        result.stateDiff?.changes.forEach((change) => addRunLog(`  diff ${change}`));
      }

      setMemory(memoryCursor);
      useNavalStore.getState().advanceNavalTurn();
      await sleep(60);
    }

    setRunning(false);
  };

  if (!overlay && fleets.length === 0) {
    return (
      <aside className="w-[460px] h-screen shrink-0 border-l border-slate-800 bg-slate-950 text-slate-100 flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-5">
          <div className="text-xs uppercase tracking-[0.28em] text-amber-300">Pacific Command</div>
          <h1 className="text-3xl font-black leading-tight">Carrier Task Force Simulator</h1>
          <p className="max-w-sm text-sm leading-6 text-slate-400">
            Deploy a carrier force, run fleet-level local LLM turns, and test fog-of-war naval decisions.
          </p>
          <button
            onClick={createScenario}
            disabled={isCreating}
            className="w-full max-w-xs rounded-lg border border-amber-500/40 bg-amber-600 px-4 py-3 text-sm font-bold text-white hover:bg-amber-500 disabled:cursor-wait disabled:bg-slate-700"
          >
            {isCreating ? 'Generating scenario...' : 'Deploy Fleet'}
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-[500px] h-screen max-h-screen shrink-0 overflow-y-auto border-l border-slate-800 bg-slate-950 text-slate-100">
      {victory !== 'none' && (
        <div className={`px-5 py-3 text-center text-sm font-black ${victory === 'player' ? 'bg-emerald-950 text-emerald-300' : 'bg-red-950 text-red-300'}`}>
          {victory === 'player' ? 'Player victory' : 'Enemy victory'}
        </div>
      )}

      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-5 py-4 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Pacific Command</div>
            <div className="mt-1 text-xl font-black text-white">Turn {currentTurn}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={advanceNavalTurn}
              className="rounded-lg border border-sky-500/30 bg-sky-700 px-3 py-2 text-xs font-bold text-white hover:bg-sky-600"
            >
              Advance
            </button>
            <button
              onClick={runCampaign}
              disabled={running}
              className="rounded-lg border border-amber-500/40 bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-500 disabled:bg-slate-700"
            >
              {running ? 'Running...' : 'Start Campaign'}
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
          <StatusPill label="Weather" value={weather} tone="sky" />
          <StatusPill label="Contacts" value={String(contacts.length)} tone={contacts.length ? 'amber' : 'slate'} />
          <StatusPill label="Air Ops" value={String(airOps.length)} tone={airOps.length ? 'emerald' : 'slate'} />
          <StatusPill label="Bases" value={String(facilities.length)} tone="slate" />
        </div>
      </header>

      <div className="space-y-4 p-5">
        <section className="space-y-2">
          <SectionHeader title="Human Command" meta={selectedFleet?.name || 'No fleet'} />
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <textarea
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              rows={3}
              placeholder="Example: launch search west with 4 aircraft"
              className="h-20 w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs leading-5 text-slate-100 outline-none placeholder:text-slate-600 focus:border-amber-500/60"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[
                'launch search west with 4 aircraft',
                'launch CAP 4 fighters',
                'hold position',
                'withdraw to nearest base',
              ].map((item) => (
                <button
                  key={item}
                  onClick={() => submitCommand(item)}
                  className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-left text-[11px] text-slate-300 hover:border-slate-500"
                >
                  {item}
                </button>
              ))}
            </div>
            <button
              onClick={() => submitCommand()}
              disabled={!command.trim()}
              className="mt-2 w-full rounded-lg border border-amber-500/40 bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-500"
            >
              Send Command
            </button>
            {lastCommandResult && (
              <div className="mt-2 rounded-md border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-[11px] leading-5 text-emerald-200">
                {lastCommandResult}
              </div>
            )}
          </div>
        </section>

        {pendingAuthorizations.length > 0 && (
          <section className="space-y-2">
            <SectionHeader title="Authorization" meta={`${pendingAuthorizations.length} pending`} />
            {pendingAuthorizations.map((item) => (
              <div key={item.id} className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3">
                <div className="text-xs font-bold text-amber-200">{item.title}</div>
                <div className="mt-1 text-[11px] leading-5 text-slate-300">{item.question}</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      const result = confirmPendingDecision(item.id, true);
                      setLastCommandResult(result?.resultSummary || 'Authorized');
                    }}
                    className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-600"
                  >
                    {item.yesLabel}
                  </button>
                  <button
                    onClick={() => {
                      const result = confirmPendingDecision(item.id, false);
                      setLastCommandResult(result?.resultSummary || 'Cancelled');
                    }}
                    className="rounded-md bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700"
                  >
                    {item.noLabel}
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="space-y-2">
          <SectionHeader title="Fleet Board" meta={`${playerFleets.length} friendly`} />
          <div className="space-y-2">
            {playerFleets.map((fleet) => (
              <FleetCard
                key={fleet.id}
                fleet={fleet}
                selected={fleet.id === selectedFleet?.id}
                onSelect={() => selectFleet(fleet.id)}
              />
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <SectionHeader title="Contact Board" meta={`${contacts.length} known`} />
          <div className="space-y-2">
            {contacts.length === 0 && <EmptyLine text="No enemy contact. Search missions are needed." />}
            {contacts.slice(-8).reverse().map((contact) => (
              <div key={contact.id} className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-100">{contact.estimatedClass || 'unknown'}</span>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${contactTone(contact.detectionLevel)}`}>
                    {contact.detectionLevel}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  Pos {contact.lastKnownPosition.x.toFixed(0)},{contact.lastKnownPosition.y.toFixed(0)} | uncertainty {contact.uncertaintyRadius.toFixed(0)} | {contact.confidence}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <SectionHeader title="Air Operations" meta={`${airOps.length} active`} />
          <div className="space-y-1">
            {airOps.length === 0 && <EmptyLine text="No active sorties." />}
            {airOps.slice(-10).reverse().map((op) => (
              <div key={op.id} className="grid grid-cols-[72px_1fr_54px] gap-2 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-[11px]">
                <span className="font-bold uppercase text-sky-300">{op.type}</span>
                <span className="truncate text-slate-300">{op.fleetName} to {op.x.toFixed(0)},{op.y.toFixed(0)}</span>
                <span className="text-right text-slate-500">{op.aircraft} ac</span>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <SectionHeader title="Reports" meta={`${reports.length} total`} />
          <div className="space-y-2">
            {reports.length === 0 && <EmptyLine text="No reports yet." />}
            {[...reports].reverse().slice(0, 10).map((report, index) => (
              <div key={`${report.id}_${index}`} className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-100">{report.title}</span>
                  <span className="text-[10px] text-slate-500">T{report.turn}</span>
                </div>
                <div className="mt-1 text-[11px] leading-5 text-slate-400">{report.summary}</div>
                {report.recommendations[0] && (
                  <div className="mt-2 border-t border-slate-800 pt-2 text-[11px] text-amber-200">
                    {report.recommendations[0].text}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <SectionHeader title="Communications" meta={`${fleetCommunications.length} messages`} />
          <div className="space-y-1">
            {fleetCommunications.length === 0 && <EmptyLine text="No inter-fleet messages." />}
            {fleetCommunications.slice(-8).reverse().map((message) => (
              <div key={message.id} className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-[11px] text-slate-300">
                <span className={message.status === 'delivered' ? 'text-emerald-300' : 'text-amber-300'}>{message.status}</span>
                <span className="ml-2">{message.fromFleetId} to {message.toFleetId}: {message.message}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <SectionHeader title="Run Log" meta={`${runLog.length + latestBattleLines.length} lines`} />
            <label className="flex items-center gap-2 text-[11px] text-slate-500">
              Turns
              <input
                type="number"
                min={1}
                max={12}
                value={turns}
                onChange={(event) => setTurns(Math.max(1, Math.min(12, Number(event.target.value) || 1)))}
                className="w-14 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                disabled={running}
              />
            </label>
          </div>
          <div ref={logRef} className="max-h-[360px] overflow-y-auto rounded-lg border border-slate-800 bg-black/30 p-3 font-mono text-[11px] leading-5 text-slate-400">
            {runLog.length === 0 && latestBattleLines.length === 0 && <div className="text-slate-600">No log lines yet.</div>}
            {runLog.map((line, index) => <div key={`run_${index}`}>{line}</div>)}
            {latestBattleLines.map((line, index) => <div key={`battle_${index}`} className="text-slate-500">{line}</div>)}
          </div>
        </section>

        <section className="space-y-2 pb-4">
          <SectionHeader title="Command History" meta={`${commandHistory.length} orders`} />
          <div className="space-y-1">
            {commandHistory.length === 0 && <EmptyLine text="No human command history." />}
            {commandHistory.slice(-8).reverse().map((item) => (
              <div key={item.id} className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-200">{item.text}</span>
                  <span className={item.accepted ? 'text-emerald-300' : 'text-red-300'}>{item.accepted ? 'accepted' : 'blocked'}</span>
                </div>
                <div className="mt-1 text-slate-500">{item.resultSummary || item.summary}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}

function FleetCard({ fleet, selected, onSelect }: { fleet: StrategicFleet; selected: boolean; onSelect: () => void }) {
  const profile = getFleetCombatProfile(fleet);
  const carrier = fleet.ships.find((ship) => ship.aircraft);
  const damaged = fleet.ships.filter((ship) => ship.damage.status !== 'combat_effective').length;

  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-lg border p-3 text-left transition ${selected ? 'border-amber-500/60 bg-amber-950/20' : 'border-slate-800 bg-slate-900/50 hover:border-slate-600'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`truncate text-sm font-black ${fleet.faction === 'player' ? 'text-sky-200' : 'text-red-300'}`}>{fleet.name}</div>
          <div className="mt-1 text-[11px] text-slate-500">
            {fleet.type.replace(/_/g, ' ')} | {fleet.ships.length} ships | {fleet.position.globalX},{fleet.position.globalY}
          </div>
        </div>
        <span className="rounded bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-300">{fleet.mission}</span>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-[10px]">
        <Metric label="Ready" value={`${profile.readiness}%`} tone={profile.readiness > 70 ? 'emerald' : profile.readiness > 45 ? 'amber' : 'red'} />
        <Metric label="AA" value={String(profile.firepower.antiAir)} tone="sky" />
        <Metric label="Surf" value={String(profile.firepower.antiSurface)} tone="slate" />
        <Metric label="Strike" value={String(profile.firepower.aviationStrike)} tone="amber" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
        <SystemBar label="Mobility" value={profile.modules.mobility} />
        <SystemBar label="Sensors" value={profile.modules.sensors} />
        <SystemBar label="Weapons" value={profile.modules.firepower} />
        <SystemBar label="Hull" value={profile.modules.hull} />
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-500">
        <span>Fuel {fleet.fuelState}</span>
        <span>Ammo {fleet.ammoState}</span>
        {carrier?.aircraft && <span>Ready aircraft {carrier.aircraft.readyAircraft}</span>}
        {damaged > 0 && <span className="text-red-300">{damaged} damaged</span>}
      </div>
    </button>
  );
}

function SystemBar({ label, value }: { label: string; value: number }) {
  const tone = value > 70 ? 'bg-emerald-500' : value > 45 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div>
      <div className="mb-1 flex justify-between text-slate-500"><span>{label}</span><span>{value}%</span></div>
      <div className="h-1.5 overflow-hidden rounded bg-slate-800">
        <div className={`h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'amber' | 'red' | 'sky' | 'slate' }) {
  const colors = {
    emerald: 'text-emerald-300 bg-emerald-950/30',
    amber: 'text-amber-300 bg-amber-950/30',
    red: 'text-red-300 bg-red-950/30',
    sky: 'text-sky-300 bg-sky-950/30',
    slate: 'text-slate-300 bg-slate-800/70',
  };
  return (
    <div className={`rounded-md px-2 py-1.5 ${colors[tone]}`}>
      <div className="text-[9px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-xs font-black">{value}</div>
    </div>
  );
}

function StatusPill({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'amber' | 'red' | 'sky' | 'slate' }) {
  const colors = {
    emerald: 'border-emerald-500/30 text-emerald-200',
    amber: 'border-amber-500/30 text-amber-200',
    red: 'border-red-500/30 text-red-200',
    sky: 'border-sky-500/30 text-sky-200',
    slate: 'border-slate-700 text-slate-400',
  };
  return <span className={`rounded-full border px-2.5 py-1 ${colors[tone]}`}>{label}: {value}</span>;
}

function SectionHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{title}</h2>
      {meta && <span className="text-[11px] text-slate-600">{meta}</span>}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed border-slate-800 px-3 py-3 text-center text-[11px] text-slate-600">{text}</div>;
}

function contactTone(level: string): string {
  if (level === 'tracked' || level === 'identified') return 'bg-red-950 text-red-200';
  if (level === 'classified') return 'bg-amber-950 text-amber-200';
  if (level === 'detected') return 'bg-yellow-950 text-yellow-200';
  if (level === 'suspected') return 'bg-slate-800 text-slate-300';
  return 'bg-slate-900 text-slate-500';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function saveLLMTraceToLocalStorage(trace: LLMOutputTrace) {
  if (typeof window === 'undefined') return;
  const key = 'naval_llm_traces';
  const storedTrace = compactLLMTraceForStorage(trace);
  try {
    const existing = JSON.parse(window.localStorage.getItem(key) || '[]');
    const next = Array.isArray(existing) ? [...existing, storedTrace].slice(-120) : [storedTrace];
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    try {
      window.localStorage.setItem(key, JSON.stringify([storedTrace]));
    } catch {
      // Diagnostic-only storage; gameplay should keep running if storage is full.
    }
  }
}

function compactLLMTraceForStorage(trace: LLMOutputTrace): LLMOutputTrace {
  return {
    ...trace,
    prompt: trace.prompt ? {
      system: truncateOptionalTraceText(trace.prompt.system, 12000),
      user: truncateOptionalTraceText(trace.prompt.user, 20000),
    } : undefined,
    rawOutput: truncateNullableTraceText(trace.rawOutput, 20000),
  };
}

function truncateOptionalTraceText(value: string | undefined, max: number): string | undefined {
  if (!value || value.length <= max) return value;
  return `${value.slice(0, max)}\n...[truncated ${value.length - max} chars]`;
}

function truncateNullableTraceText(value: string | null, max: number): string | null {
  if (!value || value.length <= max) return value;
  return `${value.slice(0, max)}\n...[truncated ${value.length - max} chars]`;
}
