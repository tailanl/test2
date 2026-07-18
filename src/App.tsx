import React, { useEffect } from 'react';
import { NavalStrategicMapPanel } from './components/NavalStrategicMapPanel';
import { NavalCommandDeckPanel } from './components/NavalCommandDeckPanel';
import { NavalOodaTimeline } from './components/NavalOodaTimeline';
import { useNavalStore } from './store/naval-store';
import { zhRisk, zhWeather } from './components/zh-labels';

export function App() {
  const currentTurn = useNavalStore((state) => state.currentTurn);
  const weather = useNavalStore((state) => state.weather);
  const fleets = useNavalStore((state) => state.fleets);
  const overlay = useNavalStore((state) => state.overlay);
  const victory = useNavalStore((state) => state.victory);
  const autoTurnEnabled = useNavalStore((state) => state.autoTurnEnabled);
  const contacts = useNavalStore((state) => state.intel.playerContacts);
  const selectedFleetId = useNavalStore((state) => state.selectedFleetId);
  const selectedFleet = fleets.find((fleet) => fleet.id === selectedFleetId) || fleets.find((fleet) => fleet.faction === 'player');
  const activeContacts = contacts.filter((contact) => contact.detectionLevel !== 'none' && contact.detectionLevel !== 'lost').length;
  const scenarioReady = Boolean(overlay && fleets.some((fleet) => fleet.faction === 'player'));

  useEffect(() => {
    if (!autoTurnEnabled || !scenarioReady || victory !== 'none') return undefined;
    const tick = () => {
      const state = useNavalStore.getState();
      if (!state.autoTurnEnabled || !state.overlay || state.victory !== 'none') return;
      if (!state.fleets.some((fleet) => fleet.faction === 'player')) return;
      state.runPlayerAutomationPulse();
      state.advanceNavalTurn();
    };
    const firstTick = window.setTimeout(tick, 850);
    const timer = window.setInterval(tick, 2600);
    return () => {
      window.clearTimeout(firstTick);
      window.clearInterval(timer);
    };
  }, [autoTurnEnabled, scenarioReady, victory]);

  return (
    <div className="flex h-full w-full flex-col bg-[#050b14] text-slate-100">
      <header className="flex min-h-[64px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-sky-950/80 bg-[#07111f]/95 px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.28)] backdrop-blur min-[900px]:px-6">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.26em] text-cyan-300">太平洋舰队司令部</div>
          <div className="mt-1 truncate text-lg font-black text-slate-50">二战海军作战推演台</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em]">
          <StatusChip label="回合" value={String(currentTurn)} tone="amber" />
          <StatusChip label="天气" value={zhWeather(weather)} tone="sky" />
          <StatusChip label="接触" value={String(activeContacts)} tone={activeContacts ? 'red' : 'slate'} />
          <StatusChip label="舰队" value={selectedFleet?.name ?? '未部署'} tone="emerald" />
          <StatusChip label="航线" value={zhRisk(selectedFleet?.navigation?.routeRisk ?? 'none')} tone={routeTone(selectedFleet?.navigation?.routeRisk)} />
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col min-[900px]:flex-row">
        <section className="flex min-h-0 min-w-0 basis-[46%] flex-col min-[900px]:min-h-[48vh] min-[900px]:flex-1">
          <div className="min-h-0 flex-1">
            <NavalStrategicMapPanel />
          </div>
          <NavalOodaTimeline />
        </section>
        <NavalCommandDeckPanel />
      </main>
    </div>
  );
}

function StatusChip({ label, value, tone }: { label: string; value: string; tone: 'amber' | 'sky' | 'red' | 'emerald' | 'slate' }) {
  const colors = {
    amber: 'border-amber-400/30 bg-amber-950/25 text-amber-200',
    sky: 'border-sky-400/30 bg-sky-950/30 text-sky-200',
    red: 'border-red-400/30 bg-red-950/30 text-red-200',
    emerald: 'border-emerald-400/30 bg-emerald-950/25 text-emerald-200',
    slate: 'border-slate-700 bg-slate-900/60 text-slate-400',
  };
  return (
    <span className={`rounded-md border px-2.5 py-1.5 ${colors[tone]}`}>
      <span className="text-slate-500">{label}</span> {value}
    </span>
  );
}

function routeTone(risk?: string): 'amber' | 'sky' | 'red' | 'emerald' | 'slate' {
  if (risk === 'high') return 'red';
  if (risk === 'medium') return 'amber';
  if (risk === 'low') return 'emerald';
  return 'slate';
}
