import { useNavalStore } from '@/store/naval-store';
import { zhBattleDescription, zhDetectionLevel, zhEngagementPolicy, zhIntent, zhMission, zhNavigationMode, zhNavigationStatus, zhRisk } from './zh-labels';

export function NavalOodaTimeline() {
  const fleets = useNavalStore((state) => state.fleets);
  const selectedFleetId = useNavalStore((state) => state.selectedFleetId);
  const contacts = useNavalStore((state) => state.intel.playerContacts);
  const airOperations = useNavalStore((state) => state.airOperations);
  const battleLog = useNavalStore((state) => state.battleLog);
  const selectedFleet = fleets.find((fleet) => fleet.id === selectedFleetId) ?? fleets.find((fleet) => fleet.faction === 'player');
  const knownContacts = contacts.filter((contact) => contact.detectionLevel !== 'none' && contact.detectionLevel !== 'lost');
  const latest = battleLog[battleLog.length - 1];

  return (
    <section className="hidden shrink-0 border-t border-sky-500/15 bg-[#06101d]/95 px-4 py-3 shadow-[0_-12px_28px_rgba(0,0,0,0.24)] min-[900px]:block">
      <div className="grid grid-cols-4 gap-3">
        <OodaCard
          label="观察"
          value={`${knownContacts.length} 个接触`}
          detail={knownContacts[0] ? `${knownContacts[0].estimatedClass ?? '未知'} / ${zhDetectionLevel(knownContacts[0].detectionLevel)}` : '搜索扇区等待回报'}
          tone={knownContacts.length ? 'amber' : 'slate'}
        />
        <OodaCard
          label="判断"
          value={selectedFleet ? (selectedFleet.navigation?.currentLegNote ?? zhMission(selectedFleet.mission)) : '未部署舰队'}
          detail={selectedFleet?.navigation ? `${zhNavigationMode(selectedFleet.navigation.mode ?? 'direct')} / 风险 ${zhRisk(selectedFleet.navigation.routeRisk ?? 'low')}` : '在指挥台绘制作战航线'}
          tone="sky"
        />
        <OodaCard
          label="决策"
          value={zhIntent(selectedFleet?.command?.commanderIntent ?? 'hold_sea_area')}
          detail={zhEngagementPolicy(selectedFleet?.command?.engagementPolicy ?? 'engage_if_advantage')}
          tone="emerald"
        />
        <OodaCard
          label="行动"
          value={airOperations.length ? `${airOperations.length} 个空中行动` : selectedFleet?.navigation ? zhNavigationStatus(selectedFleet.navigation.status) : '等待命令'}
          detail={latest ? zhBattleDescription(latest.description) : '推进回合以结算航行与侦察'}
          tone={airOperations.length ? 'amber' : 'slate'}
        />
      </div>
    </section>
  );
}

function OodaCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'amber' | 'sky' | 'emerald' | 'slate' }) {
  const toneClasses = {
    amber: 'border-amber-400/25 bg-amber-950/25 text-amber-100',
    sky: 'border-sky-400/25 bg-sky-950/25 text-sky-100',
    emerald: 'border-emerald-400/25 bg-emerald-950/20 text-emerald-100',
    slate: 'border-slate-700 bg-slate-950/65 text-slate-200',
  };

  return (
    <div className={`min-w-0 rounded-md border px-3 py-2 ${toneClasses[tone]}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-black">{value}</div>
      <div className="mt-1 truncate text-xs text-slate-400">{detail}</div>
    </div>
  );
}
