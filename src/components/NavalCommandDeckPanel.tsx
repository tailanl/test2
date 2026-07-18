import { useEffect, useMemo, useState } from 'react';
import { useNavalStore } from '@/store/naval-store';
import type {
  FleetAutomationPriority,
  FleetAutomationWorkType,
  FleetFormationType,
  FleetNavigationMode,
  StrategicFleet,
} from '@/game/naval/naval-strategic-types';
import type { NavalShip, NavalShipClass } from '@/game/naval/ship/ship-types';
import {
  zhBattleDescription,
  zhBattleEventType,
  zhDetectionLevel,
  zhEngagementPolicy,
  zhFleetType,
  zhFormation,
  zhIntent,
  zhMission,
  zhNavigationMode,
  zhReadiness,
  zhRisk,
  zhShipClass,
  zhWeather,
} from './zh-labels';

const FORMATIONS: Array<{ type: FleetFormationType; label: string; short: string; hint: string }> = [
  { type: 'standard_screen', label: '警戒', short: '警', hint: '均衡航母警戒幕' },
  { type: 'circular_screen', label: '环护', short: '环', hint: '防空与鱼雷防御' },
  { type: 'scout_line', label: '侦察', short: '侦', hint: '扩大搜索正面' },
  { type: 'line_abreast', label: '横队', short: '横', hint: '水面扫荡队形' },
  { type: 'column', label: '纵队', short: '纵', hint: '高速航渡' },
];

const ROUTE_MODES: Array<{ mode: FleetNavigationMode; label: string }> = [
  { mode: 'combat_approach', label: '战斗' },
  { mode: 'safe_transit', label: '安全' },
  { mode: 'night_dash', label: '夜突' },
  { mode: 'withdrawal', label: '撤退' },
];

const WORK_PRIORITIES: Array<{ type: FleetAutomationWorkType; label: string; hint: string }> = [
  { type: 'damage_control', label: '损管', hint: '受损舰只脱离、保全与返航' },
  { type: 'smoke_screen', label: '烟幕', hint: '高威胁近距接触时遮蔽主力' },
  { type: 'evasive_maneuver', label: '规避', hint: '受威胁时自动绘制折线规避航向' },
  { type: 'formation', label: '编队', hint: '按态势自动切换环护、侦察线或纵队' },
  { type: 'combat_air_patrol', label: 'CAP', hint: '自动放飞短时战斗巡逻并返航' },
  { type: 'air_recovery', label: '回收', hint: '优先回收飞机、清理甲板循环' },
  { type: 'search', label: '侦察', hint: '舰载机扇区搜索与接触复核' },
  { type: 'radio_silence', label: '静默', hint: '低能见度或威胁区保持无线静默' },
  { type: 'contact_shadow', label: '影随', hint: '在安全距离外保持敌接触' },
  { type: 'rendezvous', label: '补给', hint: '燃油弹药或航空队不足时靠向补给点' },
  { type: 'routing', label: '航线', hint: '没有有效航线时自动规划下一段' },
  { type: 'strike_ready', label: '整备', hint: '只做攻击准备，不自动放飞打击' },
];

const DEFAULT_AUTOMATION_PRIORITIES: Record<FleetAutomationWorkType, FleetAutomationPriority> = {
  damage_control: 1,
  smoke_screen: 1,
  evasive_maneuver: 2,
  formation: 1,
  combat_air_patrol: 2,
  air_recovery: 2,
  search: 3,
  radio_silence: 3,
  contact_shadow: 3,
  rendezvous: 4,
  routing: 4,
  strike_ready: 0,
};

const NAVAL_ASSETS = {
  carrierForce: '/assets/naval-ui/carrier-force.png',
  destroyerScreen: '/assets/naval-ui/destroyer-screen.png',
  scoutSearch: '/assets/naval-ui/scout-search.png',
  strikeBomber: '/assets/naval-ui/strike-bomber.png',
  enemyContact: '/assets/naval-ui/enemy-contact.png',
  routeWaypoint: '/assets/naval-ui/route-waypoint.png',
};

export function NavalCommandDeckPanel() {
  const {
    overlay,
    fleets,
    selectedFleetId,
    currentTurn,
    weather,
    autoTurnEnabled,
    autoDoctrineEnabled,
    autoPauseOnCritical,
    battleLog,
    airOperations,
    intel,
    createNavalScenario,
    advanceNavalTurn,
    selectFleet,
    setFleetDestination,
    setFleetFormation,
    editCarrierAirGroup,
    setFleetAutomationPriority,
    resetFleetAutomationPriorities,
    setAutoTurnEnabled,
    setAutoDoctrineEnabled,
    setAutoPauseOnCritical,
    runPlayerAutomationPulse,
    launchAirSearchSector,
    launchAirStrikeGroup,
    detachDamagedShips,
  } = useNavalStore();

  const playerFleets = fleets.filter((fleet) => fleet.faction === 'player');
  const selectedFleet = playerFleets.find((fleet) => fleet.id === selectedFleetId) ?? playerFleets[0];
  const contacts = useMemo(
    () => intel.playerContacts.filter((contact) => contact.detectionLevel !== 'none' && contact.detectionLevel !== 'lost'),
    [intel.playerContacts],
  );
  const strikeLegalContacts = useMemo(
    () => contacts.filter((contact) => ['tracked', 'identified', 'classified', 'confirmed'].includes(contact.detectionLevel)),
    [contacts],
  );
  const [routeMode, setRouteMode] = useState<FleetNavigationMode>('combat_approach');
  const [destinationX, setDestinationX] = useState(1880);
  const [destinationY, setDestinationY] = useState(1180);
  const [airMode, setAirMode] = useState<'search' | 'strike'>('search');
  const [searchHeading, setSearchHeading] = useState(285);
  const [searchArc, setSearchArc] = useState(70);
  const [searchRange, setSearchRange] = useState(360);
  const [searchTeams, setSearchTeams] = useState(5);
  const [strikeContactId, setStrikeContactId] = useState('');
  const [deckTab, setDeckTab] = useState<'status' | 'orders' | 'log'>('status');
  const [airEditFighters, setAirEditFighters] = useState(0);
  const [airEditDiveBombers, setAirEditDiveBombers] = useState(0);
  const [airEditTorpedoBombers, setAirEditTorpedoBombers] = useState(0);
  const [airEditReady, setAirEditReady] = useState(0);
  const selectedCarrier = useMemo(() => selectedFleet?.ships.find((ship) => ship.aircraft), [selectedFleet]);

  useEffect(() => {
    if (!selectedFleet) return;
    const destination = selectedFleet.navigation?.destination ?? selectedFleet.targetPosition;
    if (!destination) return;
    setDestinationX(Math.round(destination.x));
    setDestinationY(Math.round(destination.y));
  }, [selectedFleet?.id, selectedFleet?.navigation?.destination?.x, selectedFleet?.navigation?.destination?.y, selectedFleet?.targetPosition?.x, selectedFleet?.targetPosition?.y]);

  useEffect(() => {
    if (strikeLegalContacts.length === 0) {
      setStrikeContactId('');
      return;
    }
    if (!strikeLegalContacts.some((contact) => contact.id === strikeContactId)) {
      setStrikeContactId(strikeLegalContacts[0].id);
    }
  }, [strikeLegalContacts, strikeContactId]);

  useEffect(() => {
    const airGroup = selectedCarrier?.aircraft;
    if (!airGroup) {
      setAirEditFighters(0);
      setAirEditDiveBombers(0);
      setAirEditTorpedoBombers(0);
      setAirEditReady(0);
      return;
    }
    setAirEditFighters(airGroup.fighters);
    setAirEditDiveBombers(airGroup.diveBombers);
    setAirEditTorpedoBombers(airGroup.torpedoBombers);
    setAirEditReady(airGroup.readyAircraft);
  }, [selectedCarrier?.id, selectedCarrier?.aircraft?.fighters, selectedCarrier?.aircraft?.diveBombers, selectedCarrier?.aircraft?.torpedoBombers, selectedCarrier?.aircraft?.readyAircraft]);

  const fleetReadiness = useMemo(() => (selectedFleet ? calculateFleetReadiness(selectedFleet) : 0), [selectedFleet]);
  const carrierAir = useMemo(() => selectedFleet ? summarizeCarrierAir(selectedFleet) : { ready: 0, total: 0 }, [selectedFleet]);
  const latestLog = battleLog.slice(-6).reverse();
  const activeAirOps = airOperations.filter((op) => op.status !== 'recovered').length;
  const highConfidenceContact = strikeLegalContacts[0];
  const damagedShips = selectedFleet
    ? selectedFleet.ships.filter((ship) => ship.damage.status !== 'combat_effective' || ship.damage.hullIntegrity <= 70 || ship.damage.flooding >= 30 || ship.damage.fire >= 30)
    : [];
  const deckTabs: Array<{ id: typeof deckTab; label: string; meta: string }> = [
    { id: 'status', label: '态势', meta: `${playerFleets.length} 支舰队` },
    { id: 'orders', label: '命令', meta: autoTurnEnabled ? '自动推进' : '已暂停' },
    { id: 'log', label: '记录', meta: `${latestLog.length} 条` },
  ];

  if (!overlay || !selectedFleet) {
    return (
      <aside className="flex min-h-0 w-full basis-[54%] shrink-0 flex-col border-t border-sky-500/15 bg-[#07111f] min-[900px]:h-full min-[900px]:basis-auto min-[900px]:border-l min-[900px]:border-t-0 min-[900px]:w-[430px] min-[1280px]:w-[470px]">
        <PanelHeader currentTurn={currentTurn} weather={weather} autoTurnEnabled={autoTurnEnabled} autoDoctrineEnabled={autoDoctrineEnabled} />
        <div className="flex min-h-0 flex-1 flex-col justify-between gap-5 p-5">
          <div className="rounded-md border border-sky-400/20 bg-slate-950/60 p-5 shadow-2xl">
            <div className="flex items-start gap-4">
              <GeneratedIcon src={NAVAL_ASSETS.carrierForce} alt="" size="xl" />
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-300">航母特混舰队模拟器</div>
                <h2 className="mt-3 text-2xl font-black text-slate-50">部署太平洋司令部</h2>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  初始化瓜达尔卡纳尔作战图、舰队名册、岛屿基地、接触迷雾、运输航线与指挥控制。
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={createNavalScenario}
            className="rounded-md border border-amber-300/40 bg-amber-500 px-4 py-3 text-sm font-black uppercase tracking-[0.16em] text-slate-950 shadow-[0_0_24px_rgba(245,158,11,0.28)] transition hover:bg-amber-300"
          >
            部署舰队
          </button>
        </div>
      </aside>
    );
  }

  const route = selectedFleet.navigation;
  const command = selectedFleet.command;
  const automationPriorities = {
    ...defaultAutomationPrioritiesForFleet(selectedFleet.type),
    ...(command?.automation?.priorities ?? {}),
  };
  const lastAutomationTask = command?.automation?.lastTask;
  const maxX = overlay[0]?.length ? overlay[0].length - 1 : 3000;
  const maxY = overlay.length ? overlay.length - 1 : 2000;
  const smartAction = buildSmartAction({
    selectedFleet,
    route,
    autoTurnEnabled,
    autoDoctrineEnabled,
    activeAirOps,
    carrierAirReady: carrierAir.ready,
    highConfidenceContactId: highConfidenceContact?.id,
    damagedShipCount: damagedShips.length,
      onExecute: {
        resumeAuto: () => setAutoTurnEnabled(true),
        enableDoctrine: () => setAutoDoctrineEnabled(true),
        runAutomation: () => {
          runPlayerAutomationPulse();
          setDeckTab('status');
        },
      singleStep: () => {
        runPlayerAutomationPulse();
        advanceNavalTurn();
      },
      openAirOrders: () => {
        setAirMode(highConfidenceContact ? 'strike' : 'search');
        if (highConfidenceContact) setStrikeContactId(highConfidenceContact.id);
        setDeckTab('orders');
      },
      launchStrike: () => {
        if (!highConfidenceContact) return;
        launchAirStrikeGroup(selectedFleet.id, {
          contactId: highConfidenceContact.id,
          fighters: 6,
          diveBombers: 12,
          torpedoBombers: 6,
        });
        setDeckTab('log');
      },
      detachDamaged: () => {
        detachDamagedShips(selectedFleet.id, 70);
        setDeckTab('status');
      },
    },
  });

  return (
    <aside className="flex min-h-0 w-full basis-[54%] shrink-0 flex-col border-t border-sky-500/15 bg-[#07111f] shadow-[0_-18px_42px_rgba(0,0,0,0.32)] min-[900px]:h-full min-[900px]:basis-auto min-[900px]:border-l min-[900px]:border-t-0 min-[900px]:shadow-[-18px_0_42px_rgba(0,0,0,0.35)] min-[900px]:w-[430px] min-[1280px]:w-[470px]">
      <PanelHeader currentTurn={currentTurn} weather={weather} autoTurnEnabled={autoTurnEnabled} autoDoctrineEnabled={autoDoctrineEnabled} />

      <nav className="shrink-0 border-b border-sky-500/15 bg-[#07111f]/95 px-4 py-3">
        <div className="grid grid-cols-3 gap-2">
          {deckTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setDeckTab(tab.id)}
              className={`rounded-md border px-3 py-2 text-left transition ${
                deckTab === tab.id
                  ? 'border-amber-300/70 bg-amber-400/15 text-amber-100'
                  : 'border-slate-800 bg-slate-950/55 text-slate-400 hover:border-cyan-300/45 hover:text-cyan-100'
              }`}
            >
              <span className="block text-xs font-black tracking-[0.16em]">{tab.label}</span>
              <span className="mt-1 block truncate text-[10px] font-bold text-slate-500">{tab.meta}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="side-nav-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {deckTab === 'status' && (
        <section className="rounded-md border border-cyan-400/20 bg-slate-950/70 p-4 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 gap-3">
              <GeneratedIcon src={NAVAL_ASSETS.carrierForce} alt="" size="lg" />
              <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300">当前舰队</div>
              <select
                value={selectedFleet.id}
                onChange={(event) => selectFleet(event.target.value)}
                className="mt-2 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm font-black text-slate-100"
              >
                {playerFleets.map((fleet) => (
                  <option key={fleet.id} value={fleet.id}>{fleet.name}</option>
                ))}
              </select>
              <div className="mt-2 text-xs uppercase tracking-[0.14em] text-slate-500">{formatFleetType(selectedFleet.type)} / {zhMission(selectedFleet.mission)}</div>
              </div>
            </div>
            <Gauge value={fleetReadiness} label="战备" />
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2">
            <Metric label="燃油" value={zhReadiness(selectedFleet.fuelState)} tone={stateTone(selectedFleet.fuelState)} />
            <Metric label="弹药" value={zhReadiness(selectedFleet.ammoState)} tone={stateTone(selectedFleet.ammoState)} />
            <Metric label="航空" value={carrierAir.total ? `${carrierAir.ready}/${carrierAir.total}` : zhReadiness(selectedFleet.airGroupState)} tone={carrierAir.ready > 0 ? 'sky' : 'slate'} />
            <Metric label="风险" value={zhRisk(route?.routeRisk ?? 'none')} tone={riskTone(route?.routeRisk)} />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
            <RouteBadge label="ETA" value={route?.etaTurns ? `T+${route.etaTurns}` : '--'} />
            <RouteBadge label="航程" value={route?.totalDistance ? `${Math.round(route.totalDistance)}` : '--'} />
            <RouteBadge label="空中行动" value={`${activeAirOps}`} />
          </div>

          {selectedCarrier?.aircraft && (
            <div className="mt-4 rounded-md border border-slate-800 bg-slate-900/55 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">机群编辑</div>
                  <div className="mt-1 truncate text-[10px] text-slate-500">
                    {selectedCarrier.name} / 甲板 {zhReadiness(selectedFleet.airGroupState)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => editCarrierAirGroup(selectedFleet.id, selectedCarrier.id, {
                    fighters: airEditFighters,
                    diveBombers: airEditDiveBombers,
                    torpedoBombers: airEditTorpedoBombers,
                    readyAircraft: Math.min(airEditReady, airEditFighters + airEditDiveBombers + airEditTorpedoBombers),
                  })}
                  className="shrink-0 rounded-md border border-cyan-300/35 bg-cyan-400 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-950 transition hover:bg-cyan-300"
                >
                  保存
                </button>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                <NumberInput label="F" value={airEditFighters} min={0} max={96} onChange={setAirEditFighters} />
                <NumberInput label="DB" value={airEditDiveBombers} min={0} max={96} onChange={setAirEditDiveBombers} />
                <NumberInput label="TB" value={airEditTorpedoBombers} min={0} max={72} onChange={setAirEditTorpedoBombers} />
                <NumberInput
                  label="就绪"
                  value={Math.min(airEditReady, airEditFighters + airEditDiveBombers + airEditTorpedoBombers)}
                  min={0}
                  max={Math.max(0, airEditFighters + airEditDiveBombers + airEditTorpedoBombers)}
                  onChange={setAirEditReady}
                />
              </div>
              <div className="mt-2 text-[10px] font-bold text-slate-500">
                总数 {airEditFighters + airEditDiveBombers + airEditTorpedoBombers} / 当前可用 {selectedCarrier.aircraft.readyAircraft}
              </div>
            </div>
          )}
        </section>
        )}

        {deckTab === 'status' && (
        <section className="mt-4 rounded-md border border-slate-700/80 bg-slate-950/55 p-4">
          <SectionTitle icon={NAVAL_ASSETS.destroyerScreen} title="编队面板" meta={selectedFleet.formation ? zhFormation(selectedFleet.formation.type) : '无编队命令'} />
          <div className="mt-3 grid grid-cols-5 gap-2">
            {FORMATIONS.map((formation) => {
              const active = selectedFleet.formation?.type === formation.type;
              return (
                <button
                  key={formation.type}
                  type="button"
                  title={formation.hint}
                  onClick={() => setFleetFormation(selectedFleet.id, formation.type)}
                  className={`rounded-md border px-2 py-2 text-center text-[11px] font-black uppercase tracking-[0.08em] transition ${active ? 'border-amber-300 bg-amber-400 text-slate-950' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-300/70 hover:text-cyan-100'}`}
                >
                  <span className="block text-xs">{formation.short}</span>
                  <span className="mt-1 block text-[9px] font-bold opacity-75">{formation.label}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 space-y-2">
            {selectedFleet.ships.slice(0, 7).map((ship) => (
              <ShipRow key={ship.id} ship={ship} />
            ))}
            {selectedFleet.ships.length > 7 && (
              <div className="text-center text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">另有 {selectedFleet.ships.length - 7} 艘舰</div>
            )}
          </div>
        </section>
        )}

        {deckTab === 'orders' && (
        <section className={`rounded-md border p-4 shadow-xl ${smartAction.tone === 'red' ? 'border-red-300/35 bg-red-950/25' : smartAction.tone === 'amber' ? 'border-amber-300/35 bg-amber-950/25' : 'border-cyan-300/25 bg-slate-950/70'}`}>
          <SectionTitle icon={smartAction.icon} title="参谋建议" meta={smartAction.meta} />
          <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/65 px-3 py-3">
            <div className="text-sm font-black text-slate-100">{smartAction.title}</div>
            <div className="mt-1 text-xs leading-5 text-slate-400">{smartAction.detail}</div>
          </div>
          <button
            type="button"
            onClick={smartAction.execute}
            className={`mt-3 w-full rounded-md border px-3 py-2 text-xs font-black tracking-[0.16em] text-slate-950 transition ${smartAction.tone === 'red' ? 'border-red-300/40 bg-red-300 hover:bg-red-200' : smartAction.tone === 'amber' ? 'border-amber-300/40 bg-amber-300 hover:bg-amber-200' : 'border-cyan-300/35 bg-cyan-300 hover:bg-cyan-200'}`}
          >
            {smartAction.button}
          </button>
        </section>
        )}

        {deckTab === 'orders' && (
        <section className="rounded-md border border-amber-400/25 bg-slate-950/65 p-4">
          <SectionTitle icon={NAVAL_ASSETS.routeWaypoint} title="自动化" meta={autoTurnEnabled ? '运行中' : '已暂停'} />
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setAutoTurnEnabled(!autoTurnEnabled)}
              className={`rounded-md border px-2 py-2 text-xs font-black tracking-[0.12em] transition ${autoTurnEnabled ? 'border-amber-300 bg-amber-400 text-slate-950' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-amber-300/60'}`}
            >
              {autoTurnEnabled ? '暂停推进' : '继续推进'}
            </button>
            <button
              type="button"
              onClick={() => setAutoDoctrineEnabled(!autoDoctrineEnabled)}
              className={`rounded-md border px-2 py-2 text-xs font-black tracking-[0.12em] transition ${autoDoctrineEnabled ? 'border-cyan-300 bg-cyan-400 text-slate-950' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-300/60'}`}
            >
              {autoDoctrineEnabled ? '例行命令' : '仅走时间'}
            </button>
            <button
              type="button"
              onClick={() => setAutoPauseOnCritical(!autoPauseOnCritical)}
              className={`rounded-md border px-2 py-2 text-xs font-black tracking-[0.12em] transition ${autoPauseOnCritical ? 'border-red-300 bg-red-300 text-slate-950' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-red-300/60'}`}
            >
              {autoPauseOnCritical ? '关键暂停' : '不停顿'}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <RouteBadge label="航线" value={route?.status === 'active' ? '执行' : route?.status ? zhNavigationMode(route.mode) : '自动'} />
            <RouteBadge label="侦察" value={activeAirOps ? `${activeAirOps} 架次` : autoDoctrineEnabled ? '待命' : '关闭'} />
            <RouteBadge label="节拍" value={autoTurnEnabled ? '3.2秒' : '手动'} />
          </div>
          <div className="mt-4 rounded-md border border-slate-800 bg-slate-950/55 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">优先级条令</div>
                <div className="mt-1 text-[10px] text-slate-500">0 禁用，1 最高，4 最低；每次自动脉冲只接一个最高优先级任务。</div>
              </div>
              <button
                type="button"
                onClick={() => resetFleetAutomationPriorities(selectedFleet.id)}
                className="shrink-0 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-[10px] font-black text-slate-300 transition hover:border-cyan-300/60 hover:text-cyan-100"
              >
                重置
              </button>
            </div>
            <div className="mt-3 grid gap-2">
              {WORK_PRIORITIES.map((work) => (
                <div key={work.type} className="grid grid-cols-[54px_1fr_auto] items-center gap-2 rounded-md border border-slate-800 bg-slate-900/65 px-2 py-2">
                  <div className="text-xs font-black text-slate-100">{work.label}</div>
                  <div className="min-w-0 truncate text-[10px] text-slate-500" title={work.hint}>{work.hint}</div>
                  <div className="flex items-center gap-1">
                    {[0, 1, 2, 3, 4].map((priority) => {
                      const active = automationPriorities[work.type] === priority;
                      return (
                        <button
                          key={`${work.type}_${priority}`}
                          type="button"
                          onClick={() => setFleetAutomationPriority(selectedFleet.id, work.type, priority as FleetAutomationPriority)}
                          className={`grid h-7 w-7 place-items-center rounded border text-[10px] font-black transition ${active ? 'border-cyan-300 bg-cyan-300 text-slate-950' : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-cyan-300/60 hover:text-cyan-100'}`}
                          title={`${work.label} 优先级 ${priority === 0 ? '禁用' : priority}`}
                        >
                          {priority}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10px] font-bold text-slate-500">
              最近自动任务：{lastAutomationTask ? automationWorkText(lastAutomationTask) : '尚未执行'}
              {command?.automation?.lastTaskTurn !== undefined ? ` / T${command.automation.lastTaskTurn}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              runPlayerAutomationPulse();
              advanceNavalTurn();
            }}
            className="mt-3 w-full rounded-md border border-sky-300/35 bg-sky-400 px-3 py-2 text-xs font-black tracking-[0.16em] text-slate-950 transition hover:bg-sky-300"
          >
            单步自动
          </button>
        </section>
        )}

        {deckTab === 'orders' && (
        <section className="mt-4 rounded-md border border-slate-700/80 bg-slate-950/55 p-4">
          <SectionTitle icon={NAVAL_ASSETS.routeWaypoint} title="条令与航线" meta={zhEngagementPolicy(command?.engagementPolicy ?? 'engage_if_advantage')} />
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <Metric label="意图" value={zhIntent(command?.commanderIntent ?? 'hold_sea_area')} tone="sky" />
            <Metric label="交战" value={zhEngagementPolicy(command?.engagementPolicy ?? 'engage_if_advantage')} tone="slate" />
            <Metric label="风险" value={zhRisk(command?.riskTolerance ?? 'medium')} tone={riskTone(command?.riskTolerance)} />
            <Metric label="主力舰" value={command?.preserveCapitalShips ? '保存' : '自由'} tone={command?.preserveCapitalShips ? 'emerald' : 'amber'} />
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2">
            {ROUTE_MODES.map((mode) => (
              <button
                key={mode.mode}
                type="button"
                onClick={() => setRouteMode(mode.mode)}
                className={`rounded-md border px-2 py-2 text-[10px] font-black uppercase tracking-[0.08em] transition ${routeMode === mode.mode ? 'border-cyan-300 bg-cyan-400 text-slate-950' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-300/70'}`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-[1fr_1fr_auto] gap-2">
            <NumberInput label="X" value={destinationX} min={0} max={maxX} onChange={setDestinationX} />
            <NumberInput label="Y" value={destinationY} min={0} max={maxY} onChange={setDestinationY} />
            <button
              type="button"
              onClick={() => setFleetDestination(selectedFleet.id, { x: destinationX, y: destinationY }, { mode: routeMode })}
              className="self-end rounded-md border border-amber-300/40 bg-amber-400 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-950 transition hover:bg-amber-300"
              title={`按${zhNavigationMode(routeMode)}绘制航线`}
            >
              规划
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {(route?.segments ?? []).slice(0, 4).map((segment, index) => (
              <div key={`${segment.from.x}-${segment.to.x}-${index}`} className="grid grid-cols-[28px_1fr_auto] items-center gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-2 py-2 text-xs">
                <span className="relative grid h-7 w-7 place-items-center">
                  <img src={NAVAL_ASSETS.routeWaypoint} alt="" className="absolute inset-0 h-full w-full object-contain" />
                  <span className="relative text-[10px] font-black text-amber-100 [text-shadow:0_1px_3px_#020617]">{index + 1}</span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-bold text-slate-200">{segment.note}</span>
                  <span className="block text-[11px] text-slate-500">方位 {Math.round(segment.bearingDeg)} / {Math.round(segment.distance)} 海里</span>
                </span>
                <span className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase ${riskClass(segment.risk)}`}>{zhRisk(segment.risk)}</span>
              </div>
            ))}
            {(!route?.segments || route.segments.length === 0) && (
              <div className="rounded-md border border-dashed border-slate-700 px-3 py-3 text-xs text-slate-500">暂无航线。点击海图或输入坐标。</div>
            )}
          </div>
        </section>
        )}

        {deckTab === 'orders' && (
        <section className="mt-4 rounded-md border border-slate-700/80 bg-slate-950/55 p-4">
          <SectionTitle icon={airMode === 'strike' ? NAVAL_ASSETS.strikeBomber : NAVAL_ASSETS.scoutSearch} title="空中行动" meta={`${strikeLegalContacts.length}/${contacts.length} 个可打击接触`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAirMode('search')}
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-black uppercase tracking-[0.12em] ${airMode === 'search' ? 'border-cyan-300 bg-cyan-400 text-slate-950' : 'border-slate-700 bg-slate-900 text-slate-300'}`}
            >
              <img src={NAVAL_ASSETS.scoutSearch} alt="" className="h-5 w-5 object-contain" />
              搜索
            </button>
            <button
              type="button"
              onClick={() => setAirMode('strike')}
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-black uppercase tracking-[0.12em] ${airMode === 'strike' ? 'border-red-300 bg-red-400 text-slate-950' : 'border-slate-700 bg-slate-900 text-slate-300'}`}
            >
              <img src={NAVAL_ASSETS.strikeBomber} alt="" className="h-5 w-5 object-contain" />
              打击
            </button>
          </div>

          {airMode === 'search' ? (
            <div className="mt-4 grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2">
              <NumberInput label="方位" value={searchHeading} min={0} max={359} onChange={setSearchHeading} />
              <NumberInput label="扇宽" value={searchArc} min={20} max={140} onChange={setSearchArc} />
              <NumberInput label="航程" value={searchRange} min={120} max={620} onChange={setSearchRange} />
              <NumberInput label="分队" value={searchTeams} min={1} max={9} onChange={setSearchTeams} />
              <button
                type="button"
                onClick={() => launchAirSearchSector(selectedFleet.id, {
                  headingDeg: searchHeading,
                  arcWidthDeg: searchArc,
                  range: searchRange,
                  teams: searchTeams,
                  scouts: 4,
                  fighters: 2,
                })}
                className="self-end rounded-md border border-cyan-300/40 bg-cyan-400 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-950 transition hover:bg-cyan-300"
              >
                发起
              </button>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
              <label className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                接触
                <select
                  value={strikeContactId}
                  onChange={(event) => setStrikeContactId(event.target.value)}
                  disabled={strikeLegalContacts.length === 0}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-xs font-bold text-slate-100"
                >
                  {strikeLegalContacts.length === 0 && <option value="">需要已分类/跟踪接触</option>}
                  {strikeLegalContacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.id} / {contact.estimatedClass ?? '未知'} / {zhDetectionLevel(contact.detectionLevel)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!strikeContactId || carrierAir.ready <= 0}
                onClick={() => strikeContactId && launchAirStrikeGroup(selectedFleet.id, {
                  contactId: strikeContactId,
                  fighters: 6,
                  diveBombers: 12,
                  torpedoBombers: 6,
                })}
                className="self-end rounded-md border border-red-300/40 bg-red-400 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-950 transition hover:bg-red-300 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
              >
                打击
              </button>
              {strikeLegalContacts.length === 0 && (
                <div className="col-span-2 rounded-md border border-dashed border-slate-700 px-3 py-2 text-[11px] leading-5 text-slate-500">
                  当前只有低可信接触。先放飞扇区搜索，把敌舰提升到“已分类”或“持续跟踪”后才能组织航空打击。
                </div>
              )}
            </div>
          )}
        </section>
        )}

        {deckTab === 'log' && (
        <section className="rounded-md border border-slate-700/80 bg-slate-950/55 p-4">
          <SectionTitle icon={NAVAL_ASSETS.enemyContact} title="战斗日志" meta="最新事件" />
          <div className="mt-3 space-y-2">
            {latestLog.map((entry) => (
              <div key={entry.id} className="rounded-md border border-slate-800 bg-slate-900/65 px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">回合 {entry.turn} / {zhBattleEventType(entry.type)}</div>
                <div className="mt-1 text-xs leading-5 text-slate-300">{zhBattleDescription(entry.description)}</div>
              </div>
            ))}
            {latestLog.length === 0 && (
              <div className="rounded-md border border-dashed border-slate-700 px-3 py-3 text-xs text-slate-500">暂无战斗日志。</div>
            )}
          </div>
        </section>
        )}
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-2 border-t border-sky-500/15 bg-slate-950/80 p-4">
        <button
          type="button"
          onClick={() => setAutoTurnEnabled(!autoTurnEnabled)}
          className="rounded-md border border-amber-300/40 bg-amber-400 px-2 py-3 text-xs font-black tracking-[0.12em] text-slate-950 transition hover:bg-amber-300"
        >
          {autoTurnEnabled ? '暂停自动' : '继续自动'}
        </button>
        <button
          type="button"
          onClick={() => {
            runPlayerAutomationPulse();
            advanceNavalTurn();
          }}
          className="rounded-md border border-cyan-300/35 bg-cyan-400 px-2 py-3 text-xs font-black tracking-[0.12em] text-slate-950 transition hover:bg-cyan-300"
        >
          单步
        </button>
        <button
          type="button"
          onClick={createNavalScenario}
          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-3 text-xs font-black tracking-[0.12em] text-slate-200 transition hover:border-amber-300/60 hover:text-amber-200"
        >
          重新部署
        </button>
      </div>
    </aside>
  );
}

function buildSmartAction(params: {
  selectedFleet: StrategicFleet;
  route: StrategicFleet['navigation'];
  autoTurnEnabled: boolean;
  autoDoctrineEnabled: boolean;
  activeAirOps: number;
  carrierAirReady: number;
  highConfidenceContactId?: string;
  damagedShipCount: number;
  onExecute: {
    resumeAuto: () => void;
    enableDoctrine: () => void;
    runAutomation: () => void;
    singleStep: () => void;
    openAirOrders: () => void;
    launchStrike: () => void;
    detachDamaged: () => void;
  };
}): {
  title: string;
  detail: string;
  button: string;
  meta: string;
  icon: string;
  tone: 'cyan' | 'amber' | 'red';
  execute: () => void;
} {
  if (params.damagedShipCount > 0) {
    return {
      title: '先处理受损舰只',
      detail: `${params.selectedFleet.name} 有 ${params.damagedShipCount} 艘舰需要脱离、修理或重新编组，继续高速推进会扩大风险。`,
      button: '自动分离撤修',
      meta: '损管优先',
      icon: NAVAL_ASSETS.destroyerScreen,
      tone: 'red',
      execute: params.onExecute.detachDamaged,
    };
  }

  if (params.highConfidenceContactId && params.carrierAirReady >= 12) {
    return {
      title: '可对高可信接触发起打击',
      detail: `已获得 ${params.highConfidenceContactId} 的较高可信接触，当前可用舰载机足以组织一次保守打击。`,
      button: '发起保守打击',
      meta: '需要授权',
      icon: NAVAL_ASSETS.strikeBomber,
      tone: 'red',
      execute: params.onExecute.launchStrike,
    };
  }

  if (params.highConfidenceContactId) {
    return {
      title: '保持接触并等待甲板循环',
      detail: `目标 ${params.highConfidenceContactId} 已进入可判断区间，但可用舰载机不足，先切到空中行动面板检查航空整备。`,
      button: '查看空中行动',
      meta: '接触保持',
      icon: NAVAL_ASSETS.scoutSearch,
      tone: 'amber',
      execute: params.onExecute.openAirOrders,
    };
  }

  if (!params.selectedFleet.formation) {
    return {
      title: '补齐默认编队',
      detail: '当前舰队还没有明确编队。例行命令会按任务自动选择侦察线、环形警戒或标准警戒。',
      button: '执行智能编队',
      meta: '减少手点',
      icon: NAVAL_ASSETS.destroyerScreen,
      tone: 'cyan',
      execute: params.onExecute.runAutomation,
    };
  }

  if (!params.route || params.route.status === 'arrived' || params.route.status === 'blocked') {
    return {
      title: '让参谋自动规划下一段航线',
      detail: '当前没有有效航线或航线已经结束，例行命令会按接触、风险和舰队类型选择安全目的地。',
      button: '自动规划航线',
      meta: '航路建议',
      icon: NAVAL_ASSETS.routeWaypoint,
      tone: 'cyan',
      execute: params.onExecute.runAutomation,
    };
  }

  if (!params.autoDoctrineEnabled) {
    return {
      title: '开启例行命令以减少重复操作',
      detail: '例行命令只处理低风险动作：编队、航线、侦察与搜索保持；打击仍需要明确授权。',
      button: '开启例行命令',
      meta: '智能化',
      icon: NAVAL_ASSETS.routeWaypoint,
      tone: 'cyan',
      execute: params.onExecute.enableDoctrine,
    };
  }

  if (!params.autoTurnEnabled) {
    return {
      title: '自动推进已暂停',
      detail: '当前状态稳定，可以继续自动推进；若刚发生关键接触，先确认打击或侦察命令。',
      button: '继续自动推进',
      meta: '节奏控制',
      icon: NAVAL_ASSETS.routeWaypoint,
      tone: 'amber',
      execute: params.onExecute.resumeAuto,
    };
  }

  return {
    title: params.activeAirOps > 0 ? '等待侦察回报' : '维持当前自动节奏',
    detail: params.activeAirOps > 0
      ? `已有 ${params.activeAirOps} 个空中行动在执行，下一步最有价值的是推进一回合并观察回报。`
      : '航线、编队和自动侦察都已就绪，可以单步观察，也可以保持自动推进。',
    button: '单步观察',
    meta: '态势稳定',
    icon: NAVAL_ASSETS.scoutSearch,
    tone: 'cyan',
    execute: params.onExecute.singleStep,
  };
}

function PanelHeader({
  currentTurn,
  weather,
  autoTurnEnabled,
  autoDoctrineEnabled,
}: {
  currentTurn: number;
  weather: string;
  autoTurnEnabled: boolean;
  autoDoctrineEnabled: boolean;
}) {
  return (
    <div className="shrink-0 border-b border-sky-500/15 bg-[#081827] px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.32em] text-cyan-300">太平洋司令部</div>
          <div className="mt-1 text-lg font-black text-slate-50">舰队作战</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">回合</div>
          <div className="text-2xl font-black text-amber-300">{currentTurn}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-md border border-sky-400/15 bg-slate-950/50 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
        <span>天气</span>
        <span className="text-sky-200">{zhWeather(weather)}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] font-black tracking-[0.12em]">
        <span className={`rounded-md border px-2 py-1.5 text-center ${autoTurnEnabled ? 'border-amber-300/35 bg-amber-950/35 text-amber-200' : 'border-slate-700 bg-slate-900 text-slate-500'}`}>
          {autoTurnEnabled ? '自动推进' : '推进暂停'}
        </span>
        <span className={`rounded-md border px-2 py-1.5 text-center ${autoDoctrineEnabled ? 'border-cyan-300/35 bg-cyan-950/35 text-cyan-200' : 'border-slate-700 bg-slate-900 text-slate-500'}`}>
          {autoDoctrineEnabled ? '例行命令' : '人工命令'}
        </span>
      </div>
    </div>
  );
}

function SectionTitle({ icon, title, meta }: { icon?: string; title: string; meta?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {icon && <GeneratedIcon src={icon} alt="" size="sm" />}
        <h3 className="truncate text-xs font-black uppercase tracking-[0.2em] text-slate-100">{title}</h3>
      </div>
      {meta && <span className="max-w-[190px] truncate text-right text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{meta}</span>}
    </div>
  );
}

function GeneratedIcon({ src, alt, size }: { src: string; alt: string; size: 'sm' | 'lg' | 'xl' }) {
  const sizes = {
    sm: 'h-7 w-7',
    lg: 'h-16 w-16',
    xl: 'h-24 w-24',
  };
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-md border border-cyan-300/20 bg-cyan-950/20 ${sizes[size]}`}>
      <img src={src} alt={alt} className="h-full w-full object-contain p-1" draggable={false} />
    </span>
  );
}

function Gauge({ value, label }: { value: number; label: string }) {
  const size = 58;
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference * (1 - Math.max(0, Math.min(100, value)) / 100);
  return (
    <div className="relative grid h-[58px] w-[58px] place-items-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1e293b" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f59e0b" strokeWidth={stroke} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <div className="absolute text-center">
        <div className="text-sm font-black text-amber-200">{value}</div>
        <div className="text-[8px] font-black uppercase tracking-[0.08em] text-slate-500">{label}</div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone: 'slate' | 'sky' | 'emerald' | 'amber' | 'red' }) {
  return (
    <div className={`min-w-0 rounded-md border px-2 py-2 ${toneClass(tone)}`}>
      <div className="truncate text-[9px] font-black uppercase tracking-[0.12em] opacity-70">{label}</div>
      <div className="mt-1 truncate text-xs font-black uppercase">{value}</div>
    </div>
  );
}

function RouteBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/70 px-2 py-2">
      <div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-black text-slate-100">{value}</div>
    </div>
  );
}

function NumberInput({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || 0)))}
        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-xs font-bold text-slate-100"
      />
    </label>
  );
}

function ShipRow({ ship }: { ship: NavalShip }) {
  return (
    <div className="grid grid-cols-[32px_1fr_48px] items-center gap-2 rounded-md border border-slate-800 bg-slate-900/65 px-2 py-2">
      <div className="grid h-8 w-8 place-items-center rounded-md border border-slate-700 bg-slate-950 text-[10px] font-black text-cyan-200">
        {shipClassCode(ship.shipClass)}
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-bold text-slate-200">{ship.name}</div>
        <div className="truncate text-[11px] text-slate-500">{formatShipClass(ship.shipClass)} / {ship.speedKts.toFixed(0)} 节</div>
      </div>
      <div className="text-right">
        <div className={ship.damage.hullIntegrity < 55 ? 'text-xs font-black text-red-300' : ship.damage.hullIntegrity < 78 ? 'text-xs font-black text-amber-300' : 'text-xs font-black text-emerald-300'}>
          {Math.round(ship.damage.hullIntegrity)}
        </div>
        <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">舰体</div>
      </div>
    </div>
  );
}

function calculateFleetReadiness(fleet: StrategicFleet): number {
  if (fleet.ships.length === 0) return 0;
  const hull = fleet.ships.reduce((sum, ship) => sum + ship.damage.hullIntegrity, 0) / fleet.ships.length;
  const crew = fleet.ships.reduce((sum, ship) => sum + ship.damage.crewEfficiency, 0) / fleet.ships.length;
  const logisticsPenalty = (fleet.fuelState === 'critical' ? 18 : fleet.fuelState === 'limited' ? 8 : 0)
    + (fleet.ammoState === 'critical' ? 16 : fleet.ammoState === 'limited' ? 7 : 0);
  return Math.max(0, Math.min(100, Math.round((hull * 0.55) + (crew * 0.45) - logisticsPenalty)));
}

function summarizeCarrierAir(fleet: StrategicFleet): { ready: number; total: number } {
  return fleet.ships.reduce((acc, ship) => {
    if (!ship.aircraft) return acc;
    return {
      ready: acc.ready + ship.aircraft.readyAircraft,
      total: acc.total + ship.aircraft.fighters + ship.aircraft.diveBombers + ship.aircraft.torpedoBombers,
    };
  }, { ready: 0, total: 0 });
}

function formatFleetType(type: string): string {
  return zhFleetType(type);
}

function formatShipClass(shipClass: NavalShipClass): string {
  return zhShipClass(shipClass);
}

function shipClassCode(shipClass: NavalShipClass): string {
  switch (shipClass) {
    case 'fleet_carrier': return 'CV';
    case 'light_carrier': return 'CVL';
    case 'escort_carrier': return 'CVE';
    case 'battleship': return 'BB';
    case 'heavy_cruiser': return 'CA';
    case 'light_cruiser': return 'CL';
    case 'destroyer': return 'DD';
    case 'submarine': return 'SS';
    case 'transport': return 'AP';
    case 'oiler': return 'AO';
    case 'landing_ship': return 'LS';
    default: return 'SH';
  }
}

function automationWorkText(workType: FleetAutomationWorkType): string {
  switch (workType) {
    case 'damage_control': return '损管';
    case 'formation': return '编队';
    case 'routing': return '航线';
    case 'search': return '侦察';
    case 'combat_air_patrol': return 'CAP';
    case 'contact_shadow': return '影随';
    case 'evasive_maneuver': return '规避';
    case 'radio_silence': return '静默';
    case 'smoke_screen': return '烟幕';
    case 'rendezvous': return '补给';
    case 'air_recovery': return '回收';
    case 'strike_ready': return '整备';
    default: {
      const _exhaustive: never = workType;
      return _exhaustive;
    }
  }
}

function defaultAutomationPrioritiesForFleet(fleetType: StrategicFleet['type']): Record<FleetAutomationWorkType, FleetAutomationPriority> {
  if (fleetType === 'carrier_task_force') return DEFAULT_AUTOMATION_PRIORITIES;
  return {
    ...DEFAULT_AUTOMATION_PRIORITIES,
    combat_air_patrol: 0,
    search: 4,
    air_recovery: 0,
    strike_ready: 0,
  };
}

function riskTone(risk?: string): 'slate' | 'sky' | 'emerald' | 'amber' | 'red' {
  if (risk === 'high' || risk === 'critical') return 'red';
  if (risk === 'medium' || risk === 'limited') return 'amber';
  if (risk === 'low' || risk === 'good') return 'emerald';
  return 'slate';
}

function stateTone(state: string): 'slate' | 'sky' | 'emerald' | 'amber' | 'red' {
  if (state === 'critical') return 'red';
  if (state === 'limited' || state === 'recovering') return 'amber';
  if (state === 'good' || state === 'ready') return 'emerald';
  return 'slate';
}

function toneClass(tone: 'slate' | 'sky' | 'emerald' | 'amber' | 'red'): string {
  switch (tone) {
    case 'sky': return 'border-sky-400/25 bg-sky-950/30 text-sky-200';
    case 'emerald': return 'border-emerald-400/25 bg-emerald-950/25 text-emerald-200';
    case 'amber': return 'border-amber-400/25 bg-amber-950/30 text-amber-200';
    case 'red': return 'border-red-400/25 bg-red-950/30 text-red-200';
    case 'slate':
    default:
      return 'border-slate-700 bg-slate-900/70 text-slate-300';
  }
}

function riskClass(risk: 'low' | 'medium' | 'high'): string {
  if (risk === 'high') return 'border-red-400/30 bg-red-950/35 text-red-200';
  if (risk === 'medium') return 'border-amber-400/30 bg-amber-950/35 text-amber-200';
  return 'border-emerald-400/30 bg-emerald-950/25 text-emerald-200';
}
