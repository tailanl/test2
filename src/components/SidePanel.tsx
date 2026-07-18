import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavalStore } from '@/store/naval-store';
import { runAITurnPipeline } from '@/ai/ai-turn-pipeline';
import { createCampaignMemory, type CampaignMemory } from '@/ai/campaign-memory';
import type { LLMOutputTrace } from '@/ai/llm-output-trace';
import type { StrategicFleet, FleetFormationType } from '@/game/naval/naval-strategic-types';
import { getFleetCombatProfile } from '@/game/naval/ship/ship-combat-profile';

const FORMATION_OPTIONS: Array<{ type: FleetFormationType; label: string; hint: string }> = [
  { type: 'standard_screen', label: 'Standard', hint: 'balanced screen' },
  { type: 'line_abreast', label: 'Line', hint: 'wide search front' },
  { type: 'circular_screen', label: 'Ring', hint: 'best central AA' },
  { type: 'column', label: 'Column', hint: 'compact movement' },
  { type: 'scout_line', label: 'Scout', hint: 'maximum search width' },
];
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
  const localMultiplayer = useNavalStore((s) => s.localMultiplayer);
  const createScenario = useNavalStore((s) => s.createNavalScenario);
  const advanceNavalTurn = useNavalStore((s) => s.advanceNavalTurn);
  const selectFleet = useNavalStore((s) => s.selectFleet);
  const submitNavalCommand = useNavalStore((s) => s.submitNavalCommand);
  const confirmPendingDecision = useNavalStore((s) => s.confirmPendingDecision);
  const sendFleetMessage = useNavalStore((s) => s.sendFleetMessage);
  const assignFleetObjective = useNavalStore((s) => s.assignFleetObjective);
  const setControlMode = useNavalStore((s) => s.setControlMode);
  const setActiveLocalPlayer = useNavalStore((s) => s.setActiveLocalPlayer);
  const addLocalPlayer = useNavalStore((s) => s.addLocalPlayer);
  const setLocalVisibilityMode = useNavalStore((s) => s.setLocalVisibilityMode);
  const setLocalCrossControl = useNavalStore((s) => s.setLocalCrossControl);
  const markLocalPlayerReady = useNavalStore((s) => s.markLocalPlayerReady);
  const approveLocalPendingOrder = useNavalStore((s) => s.approveLocalPendingOrder);
  const assignFleetToLocalPlayer = useNavalStore((s) => s.assignFleetToLocalPlayer);
  const assignShipToLocalPlayer = useNavalStore((s) => s.assignShipToLocalPlayer);
  const splitFleetToLocalPlayer = useNavalStore((s) => s.splitFleetToLocalPlayer);
  const directControlShipsAsLocalPlayer = useNavalStore((s) => s.directControlShipsAsLocalPlayer);
  const setFleetDestination = useNavalStore((s) => s.setFleetDestination);
  const launchAirSearchSector = useNavalStore((s) => s.launchAirSearchSector);
  const launchAirStrikeGroup = useNavalStore((s) => s.launchAirStrikeGroup);
  const setFleetFormation = useNavalStore((s) => s.setFleetFormation);
  const detachShipsToWithdraw = useNavalStore((s) => s.detachShipsToWithdraw);
  const detachDamagedShips = useNavalStore((s) => s.detachDamagedShips);

  const playerFleets = fleets.filter((fleet) => fleet.faction === 'player');
  const humanMode = localMultiplayer.mode === 'human_multiplayer';
  const activePlayer = localMultiplayer.players.find((player) => player.id === localMultiplayer.activePlayerId) || localMultiplayer.players[0];
  const visibleFleets = humanMode ? filterVisibleFleets(fleets, localMultiplayer, activePlayer) : playerFleets;
  const selectedFleet = visibleFleets.find((fleet) => fleet.id === selectedFleetId) || visibleFleets[0];
  const contacts = humanMode ? contactsForLocalPlayer(intel, localMultiplayer, activePlayer) : intel.playerContacts;
  const visibleReports = humanMode ? filterVisibleReports(reports, visibleFleets, activePlayer) : reports;
  const visibleCommunications = humanMode ? filterVisibleMessages(fleetCommunications, visibleFleets, activePlayer) : fleetCommunications;
  const readyCount = localMultiplayer.readyPlayerIds.length;
  const commandPlayers = localMultiplayer.players.filter((player) => player.role !== 'umpire');
  const activeReady = localMultiplayer.readyPlayerIds.includes(localMultiplayer.activePlayerId);
  const communicationTargets = selectedFleet
    ? visibleFleets.filter((fleet) => fleet.id !== selectedFleet.id && fleet.faction === selectedFleet.faction)
    : [];
  const highConfidenceContacts = useMemo(
    () => contacts.filter((contact) => ['tracked', 'identified', 'classified', 'confirmed'].includes(contact.detectionLevel)),
    [contacts],
  );
  const selectedFleetCarrier = selectedFleet?.ships.find((ship) => ship.aircraft);
  const selectedFleetProfile = selectedFleet ? getFleetCombatProfile(selectedFleet) : undefined;

  const [running, setRunning] = useState(false);
  const [turns, setTurns] = useState(6);
  const [command, setCommand] = useState('');
  const [activePanel, setActivePanel] = useState<'orders' | 'force' | 'intel' | 'comms' | 'crew'>('orders');
  const [selectedShipIds, setSelectedShipIds] = useState<string[]>([]);
  const [directHeading, setDirectHeading] = useState(270);
  const [directSpeed, setDirectSpeed] = useState(24);
  const [destinationX, setDestinationX] = useState(0);
  const [destinationY, setDestinationY] = useState(0);
  const [searchHeading, setSearchHeading] = useState(270);
  const [searchRange, setSearchRange] = useState(180);
  const [searchArcWidth, setSearchArcWidth] = useState(70);
  const [searchFighters, setSearchFighters] = useState(0);
  const [searchDiveBombers, setSearchDiveBombers] = useState(4);
  const [searchTorpedoBombers, setSearchTorpedoBombers] = useState(0);
  const [strikeContactId, setStrikeContactId] = useState('');
  const [strikeFighters, setStrikeFighters] = useState(4);
  const [strikeDiveBombers, setStrikeDiveBombers] = useState(8);
  const [strikeTorpedoBombers, setStrikeTorpedoBombers] = useState(4);
  const [damageWithdrawThreshold, setDamageWithdrawThreshold] = useState(70);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerFaction, setNewPlayerFaction] = useState<'player' | 'enemy' | 'neutral'>('player');
  const [newPlayerRole, setNewPlayerRole] = useState<'theater_commander' | 'fleet_commander' | 'ship_captain' | 'umpire'>('fleet_commander');
  const [newPlayerQq, setNewPlayerQq] = useState('');
  const [messageText, setMessageText] = useState('');
  const [messageTargetFleetId, setMessageTargetFleetId] = useState('');
  const [networkUrl, setNetworkUrl] = useState('ws://127.0.0.1:8787');
  const [networkRoomId, setNetworkRoomId] = useState('naval-room');
  const [networkStatus, setNetworkStatus] = useState('offline');
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [datasetScenario, setDatasetScenario] = useState('human_multiplayer_training');
  const [datasetInstruction, setDatasetInstruction] = useState('');
  const [datasetLabel, setDatasetLabel] = useState('accepted');
  const [datasetTags, setDatasetTags] = useState('human,naval');
  const [datasetNotes, setDatasetNotes] = useState('');
  const [datasetBeforeSnapshot, setDatasetBeforeSnapshot] = useState<ReturnType<typeof buildTrainingSnapshot> | null>(null);
  const [datasetSamples, setDatasetSamples] = useState<Array<{ id: string; instruction?: string; label?: string; notes?: string; tags?: string[] }>>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [datasetStatus, setDatasetStatus] = useState('idle');
  const [qqDispatchText, setQqDispatchText] = useState('');
  const [memory, setMemory] = useState<CampaignMemory>(() => createCampaignMemory());
  const [runLog, setRunLog] = useState<string[]>([]);
  const [lastCommandResult, setLastCommandResult] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const networkClientId = useRef(`web_${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [runLog, battleLog.length]);

  useEffect(() => {
    setSelectedShipIds([]);
    if (selectedFleet) {
      setDestinationX(Math.round(selectedFleet.targetPosition?.x ?? selectedFleet.position.globalX));
      setDestinationY(Math.round(selectedFleet.targetPosition?.y ?? selectedFleet.position.globalY));
    }
  }, [selectedFleet?.id, selectedFleet?.targetPosition?.x, selectedFleet?.targetPosition?.y]);

  useEffect(() => {
    if (!communicationTargets.some((fleet) => fleet.id === messageTargetFleetId)) {
      setMessageTargetFleetId(communicationTargets[0]?.id || '');
    }
  }, [communicationTargets, messageTargetFleetId]);

  useEffect(() => {
    if (!highConfidenceContacts.some((contact) => contact.id === strikeContactId)) {
      setStrikeContactId(highConfidenceContacts[0]?.id || '');
    }
  }, [highConfidenceContacts, strikeContactId]);

  const latestBattleLines = useMemo(
    () => battleLog.slice(-30).map((event) => `T${event.turn} ${event.description}`),
    [battleLog],
  );

  const addRunLog = (line: string) => setRunLog((prev) => [...prev.slice(-120), line]);

  const toggleShipSelection = (shipId: string) => {
    setSelectedShipIds((prev) => prev.includes(shipId)
      ? prev.filter((id) => id !== shipId)
      : [...prev, shipId]);
  };

  const activePlayerName = activePlayer?.name || 'No active player';
  const sideNavItems: Array<{ id: typeof activePanel; label: string; meta: string }> = [
    { id: 'orders', label: 'Orders', meta: selectedFleet ? selectedFleet.name : 'No fleet' },
    { id: 'force', label: 'Force', meta: `${visibleFleets.length} fleets` },
    { id: 'intel', label: 'Intel', meta: `${contacts.length} contacts` },
    { id: 'comms', label: 'Comms', meta: `${visibleReports.length + visibleCommunications.length} items` },
    { id: 'crew', label: 'Crew', meta: humanMode ? `${readyCount}/${commandPlayers.length} ready` : 'LLM' },
  ];

  const sendNetworkEnvelope = (payload: Record<string, unknown>): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setNetworkStatus('not connected');
      return false;
    }
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch (error) {
      setNetworkStatus(`send failed: ${String(error)}`);
      return false;
    }
  };

  const recordServerEvent = (kind: string, payload: Record<string, unknown>, visibility: 'public' | 'private' = 'private') => {
    if (!recordingEnabled) return;
    sendNetworkEnvelope({
      type: 'record_event',
      roomId: networkRoomId,
      kind,
      visibility,
      payload: {
        turn: currentTurn,
        actorPlayerId: activePlayer?.id,
        ...payload,
      },
    });
  };

  const captureDatasetBefore = () => {
    setDatasetBeforeSnapshot(buildTrainingSnapshot());
    setDatasetStatus(`captured before T${currentTurn}`);
  };

  const saveDatasetSample = () => {
    const lastCommand = commandHistory[commandHistory.length - 1];
    const sample = {
      scenario: datasetScenario,
      instruction: datasetInstruction || command || lastCommand?.text || lastCommandResult,
      fleetIds: selectedFleet ? [selectedFleet.id] : [],
      actorPlayerId: activePlayer?.id,
      beforeSnapshot: datasetBeforeSnapshot,
      afterSnapshot: buildTrainingSnapshot(),
      action: {
        selectedFleetId: selectedFleet?.id,
        selectedShipIds,
        commandText: command || lastCommand?.text,
        lastResult: lastCommandResult,
        directHeading,
        directSpeed,
      },
      label: datasetLabel,
      tags: datasetTags.split(',').map((tag) => tag.trim()).filter(Boolean),
      notes: datasetNotes,
    };
    if (sendNetworkEnvelope({ type: 'dataset_create', roomId: networkRoomId, sample })) {
      setDatasetStatus('saving to server');
      return;
    }
    const localSample = { ...sample, id: `local_${Date.now().toString(36)}` };
    const next = [...loadLocalDatasetSamples(), localSample];
    saveLocalDatasetSamples(next);
    setDatasetSamples(next.map(compactDatasetSample));
    setSelectedDatasetId(localSample.id);
    setDatasetStatus('saved locally');
  };

  const requestDatasetList = () => {
    if (sendNetworkEnvelope({ type: 'dataset_list', roomId: networkRoomId })) {
      setDatasetStatus('listing server dataset');
      return;
    }
    const local = loadLocalDatasetSamples().map(compactDatasetSample);
    setDatasetSamples(local);
    setDatasetStatus(`loaded ${local.length} local sample(s)`);
  };

  const updateDatasetSample = () => {
    if (!selectedDatasetId) {
      setDatasetStatus('select a sample first');
      return;
    }
    const patch = {
      instruction: datasetInstruction,
      label: datasetLabel,
      tags: datasetTags.split(',').map((tag) => tag.trim()).filter(Boolean),
      notes: datasetNotes,
    };
    if (sendNetworkEnvelope({ type: 'dataset_update', roomId: networkRoomId, id: selectedDatasetId, patch })) {
      setDatasetStatus('updating server sample');
      return;
    }
    const next = loadLocalDatasetSamples().map((sample) => sample.id === selectedDatasetId ? { ...sample, ...patch } : sample);
    saveLocalDatasetSamples(next);
    setDatasetSamples(next.map(compactDatasetSample));
    setDatasetStatus('updated local sample');
  };

  const deleteDatasetSample = () => {
    if (!selectedDatasetId) {
      setDatasetStatus('select a sample first');
      return;
    }
    if (sendNetworkEnvelope({ type: 'dataset_delete', roomId: networkRoomId, id: selectedDatasetId })) {
      setDatasetStatus('deleting server sample');
      return;
    }
    const next = loadLocalDatasetSamples().filter((sample) => sample.id !== selectedDatasetId);
    saveLocalDatasetSamples(next);
    setDatasetSamples(next.map(compactDatasetSample));
    setSelectedDatasetId(next[0]?.id || '');
    setDatasetStatus('deleted local sample');
  };

  const dispatchQQVisibilityMessage = (visibility: 'all' | 'player' | 'enemy') => {
    const text = qqDispatchText.trim() || messageText.trim() || lastCommandResult || `Turn ${currentTurn} update from ${activePlayerName}`;
    const payload = visibility === 'all'
      ? { type: 'qq_dispatch', roomId: networkRoomId, visibility: 'all', text }
      : { type: 'qq_dispatch', roomId: networkRoomId, visibility: 'private', faction: visibility, text };
    if (sendNetworkEnvelope(payload)) setNetworkStatus(`QQ dispatch ${visibility}`);
  };

  const connectNetworkRoom = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close();
      wsRef.current = null;
      setNetworkStatus('offline');
      return;
    }
    try {
      const ws = new WebSocket(networkUrl);
      wsRef.current = ws;
      setNetworkStatus('connecting');
      ws.onopen = () => {
        setNetworkStatus('connected');
        ws.send(JSON.stringify({ type: 'join', roomId: networkRoomId, clientId: networkClientId.current }));
      };
      ws.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type === 'snapshot' && message.snapshot && message.senderId !== networkClientId.current) {
          if (!Array.isArray(message.snapshot.fleets) || message.snapshot.fleets.length === 0) {
            setNetworkStatus('ignored empty snapshot');
            return;
          }
          applyNetworkSnapshot(message.snapshot);
          setNetworkStatus(`synced T${message.snapshot.currentTurn ?? '?'}`);
          return;
        }
        if (message.type === 'joined') setNetworkStatus(`connected ${message.peers || 1} peer(s)`);
        if (message.type === 'snapshot_ack') setNetworkStatus(`pushed T${message.turn ?? '?'}`);
        if (message.type === 'snapshot_empty') setNetworkStatus('connected empty room');
        if (message.type === 'record_ack') setNetworkStatus(`recorded ${message.eventId}`);
        if (message.type === 'dataset_ack') {
          const compact = compactDatasetSample(message.sample);
          setDatasetSamples((prev) => [compact, ...prev.filter((item) => item.id !== compact.id)].slice(0, 20));
          setSelectedDatasetId(compact.id);
          setDatasetStatus(`saved ${compact.id}`);
        }
        if (message.type === 'dataset_list') {
          const samples = Array.isArray(message.samples) ? message.samples.map(compactDatasetSample) : [];
          setDatasetSamples(samples);
          setSelectedDatasetId(samples[0]?.id || '');
          setDatasetStatus(`loaded ${samples.length} sample(s)`);
        }
        if (message.type === 'dataset_update_ack') {
          const compact = compactDatasetSample(message.sample);
          setDatasetSamples((prev) => prev.map((item) => item.id === compact.id ? compact : item));
          setDatasetStatus(`updated ${compact.id}`);
        }
        if (message.type === 'dataset_delete_ack') {
          setDatasetSamples((prev) => prev.filter((item) => item.id !== message.id));
          setSelectedDatasetId('');
          setDatasetStatus(`deleted ${message.id}`);
        }
        if (message.type === 'qq_route_plan') {
          const routes = Array.isArray(message.routes) ? message.routes.length : 0;
          setNetworkStatus(`QQ ${message.dryRun ? 'preview' : 'sent'} ${routes} route(s)`);
        }
        if (message.type === 'error') setNetworkStatus(`error: ${message.message}`);
      };
      ws.onerror = () => setNetworkStatus('connection error');
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        setNetworkStatus('offline');
      };
    } catch (error) {
      setNetworkStatus(`error: ${String(error)}`);
    }
  };

  const pushNetworkSnapshot = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setNetworkStatus('not connected');
      return;
    }
    ws.send(JSON.stringify({
      type: 'snapshot',
      roomId: networkRoomId,
      clientId: networkClientId.current,
      snapshot: buildNetworkSnapshot(),
    }));
    recordServerEvent('snapshot_pushed', { turn: currentTurn }, 'public');
    setNetworkStatus(`pushing T${currentTurn}`);
  };

  const requestNetworkSnapshot = () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setNetworkStatus('not connected');
      return;
    }
    ws.send(JSON.stringify({ type: 'request_snapshot', roomId: networkRoomId, clientId: networkClientId.current }));
    setNetworkStatus('pulling snapshot');
  };

  const submitCommand = (text = command) => {
    if (!text.trim()) return;
    if (isAnnihilateCommand(text) && isBothSidesCommand(text)) {
      const fleetIds = useNavalStore.getState().fleets
        .filter((fleet) => fleet.faction !== 'neutral')
        .map((fleet) => fleet.id);
      const ok = assignFleetObjective(fleetIds, 'annihilate_enemy');
      setLastCommandResult(ok
        ? `Assigned annihilate_enemy to ${fleetIds.length} fleet(s).`
        : 'No fleet accepted annihilate_enemy objective.');
      setCommand('');
      return;
    }
    const fleetIds = selectedFleet
      ? [selectedFleet.id]
      : humanMode
        ? visibleFleets.map((fleet) => fleet.id)
        : playerFleets.map((fleet) => fleet.id);
    const receipt = submitNavalCommand(text, fleetIds);
    setLastCommandResult(receipt.resultSummary || receipt.summary);
    recordServerEvent('human_command', { text, fleetIds, receipt }, receipt.accepted ? 'public' : 'private');
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
      if (snapshot.localMultiplayer.mode === 'human_multiplayer') {
        addRunLog(`Turn ${snapshot.currentTurn + 1}: local multiplayer resolution, no LLM/AI orders generated`);
        recordServerEvent('human_turn_resolution', { turn: snapshot.currentTurn + 1 }, 'public');
        useNavalStore.getState().advanceNavalTurn();
        await sleep(60);
        continue;
      }
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
      <aside className="flex h-[42vh] min-h-[320px] w-full shrink-0 flex-col border-t border-sky-950/80 bg-[#07111f] text-slate-100 min-[900px]:h-full min-[900px]:w-[430px] min-[900px]:border-l min-[900px]:border-t-0">
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
      <aside className="flex h-[42vh] max-h-[50vh] min-h-[320px] w-full shrink-0 flex-col overflow-hidden border-t border-sky-950/80 bg-[#07111f] text-slate-100 shadow-[-18px_0_38px_rgba(0,0,0,0.22)] min-[900px]:h-full min-[900px]:max-h-full min-[900px]:w-[440px] min-[900px]:border-l min-[900px]:border-t-0">
      {victory !== 'none' && (
        <div className={`px-5 py-3 text-center text-sm font-black ${victory === 'player' ? 'bg-emerald-950 text-emerald-300' : 'bg-red-950 text-red-300'}`}>
          {victory === 'player' ? 'Player victory' : 'Enemy victory'}
        </div>
      )}

      <header className="shrink-0 border-b border-sky-950/80 bg-[#081624]/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Pacific Command</div>
            <div className="mt-1 text-xl font-black text-white">Turn {currentTurn}</div>
            <div className="mt-1 text-[11px] text-slate-500">{humanMode ? `Hotseat: ${activePlayerName}` : 'LLM commander mode'}</div>
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
              {running ? 'Running...' : humanMode ? 'Run Human Turns' : 'Start Campaign'}
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
          <StatusPill label="Weather" value={weather} tone="sky" />
          <StatusPill label="Mode" value={humanMode ? 'Human' : 'LLM'} tone={humanMode ? 'emerald' : 'amber'} />
          {humanMode && <StatusPill label="Ready" value={`${readyCount}/${commandPlayers.length}`} tone={readyCount >= commandPlayers.length ? 'emerald' : 'slate'} />}
          <StatusPill label="Contacts" value={String(contacts.length)} tone={contacts.length ? 'amber' : 'slate'} />
          <StatusPill label="Air Ops" value={String(airOps.length)} tone={airOps.length ? 'emerald' : 'slate'} />
          <StatusPill label="Bases" value={String(facilities.length)} tone="slate" />
        </div>
      </header>

      <nav className="shrink-0 border-b border-sky-950/70 bg-[#07111f]/95 px-3 py-2.5">
        <div className="side-nav-scroll flex gap-2 overflow-x-auto pb-1.5">
          {sideNavItems.map((item) => (
            <button
              key={item.id}
              data-panel={item.id}
              onClick={() => setActivePanel(item.id)}
              className={`min-w-[96px] rounded-md border px-3 py-2 text-left transition ${
                activePanel === item.id
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-100 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.18)]'
                  : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:border-slate-600 hover:text-slate-200'
              }`}
            >
              <div className="text-xs font-black uppercase tracking-[0.14em]">{item.label}</div>
              <div className="mt-1 truncate text-[10px] text-slate-500">{item.meta}</div>
            </button>
          ))}
        </div>
      </nav>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {activePanel === 'orders' && (
        <section className="space-y-2">
          <SectionHeader title="Fleet Orders" meta={selectedFleet?.name || 'No fleet'} />
          <div className="rounded-lg border border-sky-900/50 bg-slate-900/70 p-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="min-w-0 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Destination X
                <input
                  type="number"
                  value={destinationX}
                  onChange={(event) => setDestinationX(Number(event.target.value) || 0)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100 outline-none focus:border-sky-500/70"
                />
              </label>
              <label className="min-w-0 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Destination Y
                <input
                  type="number"
                  value={destinationY}
                  onChange={(event) => setDestinationY(Number(event.target.value) || 0)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100 outline-none focus:border-sky-500/70"
                />
              </label>
              <button
                onClick={() => {
                  if (!selectedFleet) return;
                  const ok = setFleetDestination(selectedFleet.id, { x: destinationX, y: destinationY });
                  setLastCommandResult(ok ? `Destination assigned to ${selectedFleet.name}.` : 'Destination order failed.');
                }}
                disabled={!selectedFleet}
                className="col-span-2 rounded-md border border-sky-500/40 bg-sky-700 px-3 py-2 text-xs font-bold text-white hover:bg-sky-600 disabled:border-slate-800 disabled:bg-slate-800 disabled:text-slate-600"
              >
                Plot Route
              </button>
            </div>

            <div className="mt-4 rounded-md border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">Sector Search</div>
                <div className="text-[10px] text-slate-500">
                  Ready air {selectedFleetCarrier?.aircraft?.readyAircraft ?? 0}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <NumberField label="Heading" value={searchHeading} min={0} max={359} onChange={setSearchHeading} />
                <NumberField label="Arc" value={searchArcWidth} min={20} max={180} onChange={setSearchArcWidth} />
                <NumberField label="Range" value={searchRange} min={40} max={700} onChange={setSearchRange} />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <NumberField label="Fighters" value={searchFighters} min={0} max={24} onChange={setSearchFighters} />
                <NumberField label="Dive Bombers" value={searchDiveBombers} min={0} max={24} onChange={setSearchDiveBombers} />
                <NumberField label="Torpedo" value={searchTorpedoBombers} min={0} max={24} onChange={setSearchTorpedoBombers} />
              </div>
              <button
                onClick={() => {
                  if (!selectedFleet) return;
                  const ok = launchAirSearchSector(selectedFleet.id, {
                    headingDeg: searchHeading,
                    arcWidthDeg: searchArcWidth,
                    range: searchRange,
                    fighters: searchFighters,
                    diveBombers: searchDiveBombers,
                    torpedoBombers: searchTorpedoBombers,
                  });
                  setLastCommandResult(ok ? `Sector search launched ${searchHeading}deg/${searchArcWidth}deg; aircraft will return after sweep.` : 'Sector search failed.');
                }}
                disabled={!selectedFleet || !selectedFleetCarrier?.aircraft?.readyAircraft}
                className="mt-3 w-full rounded-md border border-amber-500/40 bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-500 disabled:border-slate-800 disabled:bg-slate-800 disabled:text-slate-600"
              >
                Scout Sector
              </button>
            </div>

            <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-red-300">Strike Group</div>
                <div className="text-[10px] text-slate-500">{highConfidenceContacts.length} valid targets</div>
              </div>
              <select
                value={strikeContactId}
                onChange={(event) => setStrikeContactId(event.target.value)}
                disabled={highConfidenceContacts.length === 0}
                className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100 outline-none focus:border-red-500/70 disabled:text-slate-600"
              >
                {highConfidenceContacts.length === 0 && <option value="">No tracked or confirmed contact</option>}
                {highConfidenceContacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.id} | {contact.estimatedClass || 'unknown'} | {contact.detectionLevel} | {Math.round(contact.lastKnownPosition.x)},{Math.round(contact.lastKnownPosition.y)}
                  </option>
                ))}
              </select>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <NumberField label="Fighters" value={strikeFighters} min={0} max={36} onChange={setStrikeFighters} />
                <NumberField label="Dive Bombers" value={strikeDiveBombers} min={0} max={36} onChange={setStrikeDiveBombers} />
                <NumberField label="Torpedo" value={strikeTorpedoBombers} min={0} max={24} onChange={setStrikeTorpedoBombers} />
              </div>
              <button
                onClick={() => {
                  if (!selectedFleet || !strikeContactId) return;
                  const ok = launchAirStrikeGroup(selectedFleet.id, {
                    contactId: strikeContactId,
                    fighters: strikeFighters,
                    diveBombers: strikeDiveBombers,
                    torpedoBombers: strikeTorpedoBombers,
                  });
                  setLastCommandResult(ok ? `Strike group launched against ${strikeContactId}.` : 'Strike launch failed.');
                }}
                disabled={!selectedFleet || !strikeContactId || !selectedFleetCarrier?.aircraft?.readyAircraft}
                className="mt-3 w-full rounded-md border border-red-500/40 bg-red-700 px-3 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:border-slate-800 disabled:bg-slate-800 disabled:text-slate-600"
              >
                Launch Strike
              </button>
            </div>

            <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2 text-[11px] text-slate-400">
              <div className="flex items-center justify-between gap-3">
                <span>Route</span>
                <span className="text-slate-200">
                  {selectedFleet?.navigation
                    ? `${selectedFleet.navigation.status} ${Math.min(selectedFleet.navigation.pathIndex + 1, selectedFleet.navigation.path.length)}/${selectedFleet.navigation.path.length}`
                    : 'no plotted route'}
                </span>
              </div>
              {selectedFleet?.targetPosition && (
                <div className="mt-1 flex items-center justify-between gap-3">
                  <span>Destination</span>
                  <span className="text-amber-200">{selectedFleet.targetPosition.x},{selectedFleet.targetPosition.y}</span>
                </div>
              )}
            </div>
          </div>
        </section>
        )}

        {activePanel === 'crew' && (
        <section className="space-y-2">
          <SectionHeader title="Control Mode" meta={humanMode ? 'No LLM orders' : 'LLM enabled'} />
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setControlMode('llm_commander')}
                className={`rounded-md border px-3 py-2 text-xs font-bold ${!humanMode ? 'border-amber-500/50 bg-amber-600 text-white' : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500'}`}
              >
                LLM Campaign
              </button>
              <button
                onClick={() => setControlMode('human_multiplayer')}
                className={`rounded-md border px-3 py-2 text-xs font-bold ${humanMode ? 'border-emerald-500/50 bg-emerald-700 text-white' : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500'}`}
              >
                Human Hotseat
              </button>
            </div>

            {humanMode && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {localMultiplayer.players.map((player) => (
                    <button
                      key={player.id}
                      onClick={() => setActiveLocalPlayer(player.id)}
                      className={`rounded-md border px-2 py-2 text-left text-[11px] ${player.id === localMultiplayer.activePlayerId ? 'border-emerald-400/60 bg-emerald-950/40 text-emerald-100' : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-500'}`}
                    >
                      <div className="font-bold">{player.name}</div>
                      <div className="mt-0.5 text-[10px] opacity-70">{player.role.replace(/_/g, ' ')}</div>
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => markLocalPlayerReady(localMultiplayer.activePlayerId, !activeReady)}
                    className={`rounded-md border px-3 py-2 text-xs font-bold ${activeReady ? 'border-emerald-500/50 bg-emerald-700 text-white' : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500'}`}
                  >
                    {activeReady ? 'Ready' : 'Mark Ready'}
                  </button>
                  <button
                    onClick={() => setLocalVisibilityMode(localMultiplayer.visibilityMode === 'role_fog_of_war' ? 'shared_map' : 'role_fog_of_war')}
                    className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-300 hover:border-slate-500"
                  >
                    {localMultiplayer.visibilityMode === 'role_fog_of_war' ? 'Fog View' : 'Shared Map'}
                  </button>
                  <button
                    onClick={() => setLocalCrossControl(!localMultiplayer.allowCrossControl)}
                    className={`col-span-2 rounded-md border px-3 py-2 text-xs font-bold ${localMultiplayer.allowCrossControl ? 'border-sky-500/40 bg-sky-950/40 text-sky-200' : 'border-amber-500/40 bg-amber-950/40 text-amber-200'}`}
                  >
                    {localMultiplayer.allowCrossControl ? 'Cross-control Free' : 'Cross-control Approval'}
                  </button>
                </div>

                <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <input
                      value={newPlayerName}
                      onChange={(event) => setNewPlayerName(event.target.value)}
                      placeholder="New player name"
                      className="rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-600"
                    />
                    <button
                      onClick={() => {
                        const id = addLocalPlayer(newPlayerName, newPlayerFaction, newPlayerRole, newPlayerQq);
                        setLastCommandResult(`Added ${id}.`);
                        setNewPlayerName('');
                        setNewPlayerQq('');
                      }}
                      className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-900/40"
                    >
                      Add
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <select
                      value={newPlayerFaction}
                      onChange={(event) => setNewPlayerFaction(event.target.value as 'player' | 'enemy' | 'neutral')}
                      className="rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100"
                    >
                      <option value="player">Blue side</option>
                      <option value="enemy">Red side</option>
                      <option value="neutral">Umpire</option>
                    </select>
                    <select
                      value={newPlayerRole}
                      onChange={(event) => setNewPlayerRole(event.target.value as 'theater_commander' | 'fleet_commander' | 'ship_captain' | 'umpire')}
                      className="rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100"
                    >
                      <option value="theater_commander">Theater commander</option>
                      <option value="fleet_commander">Fleet commander</option>
                      <option value="ship_captain">Ship captain</option>
                      <option value="umpire">Umpire</option>
                    </select>
                  </div>
                  <input
                    value={newPlayerQq}
                    onChange={(event) => setNewPlayerQq(event.target.value)}
                    placeholder="QQ user id for private reports"
                    className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-600"
                  />
                </div>

                <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
                  <SectionHeader title="Network Room" meta={networkStatus} />
                  <div className="mt-2 grid grid-cols-[1fr_96px] gap-2">
                    <input
                      value={networkUrl}
                      onChange={(event) => setNetworkUrl(event.target.value)}
                      className="rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100 outline-none"
                    />
                    <input
                      value={networkRoomId}
                      onChange={(event) => setNetworkRoomId(event.target.value)}
                      className="rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100 outline-none"
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <button
                      onClick={connectNetworkRoom}
                      className="rounded-md border border-sky-500/30 bg-sky-950/30 px-2 py-2 text-[11px] font-bold text-sky-200 hover:bg-sky-900/40"
                    >
                      {wsRef.current?.readyState === WebSocket.OPEN ? 'Disconnect' : 'Connect'}
                    </button>
                    <button
                      onClick={pushNetworkSnapshot}
                      className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-2 py-2 text-[11px] font-bold text-emerald-200 hover:bg-emerald-900/40"
                    >
                      Push
                    </button>
                    <button
                      onClick={requestNetworkSnapshot}
                      className="rounded-md border border-amber-500/30 bg-amber-950/30 px-2 py-2 text-[11px] font-bold text-amber-200 hover:bg-amber-900/40"
                    >
                      Pull
                    </button>
                  </div>
                </div>

                <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
                  <SectionHeader title="QQ Dispatch" meta="group or private route" />
                  <textarea
                    value={qqDispatchText}
                    onChange={(event) => setQqDispatchText(event.target.value)}
                    rows={2}
                    placeholder="Visible battlefield report to send through the QQ bridge"
                    className="mt-2 h-16 w-full resize-none rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs leading-5 text-slate-100 outline-none placeholder:text-slate-600"
                  />
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <button
                      onClick={() => dispatchQQVisibilityMessage('all')}
                      className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-2 py-2 text-[11px] font-bold text-emerald-200 hover:bg-emerald-900/40"
                    >
                      Group
                    </button>
                    <button
                      onClick={() => dispatchQQVisibilityMessage('player')}
                      className="rounded-md border border-sky-500/30 bg-sky-950/30 px-2 py-2 text-[11px] font-bold text-sky-200 hover:bg-sky-900/40"
                    >
                      Blue
                    </button>
                    <button
                      onClick={() => dispatchQQVisibilityMessage('enemy')}
                      className="rounded-md border border-red-500/30 bg-red-950/30 px-2 py-2 text-[11px] font-bold text-red-200 hover:bg-red-900/40"
                    >
                      Red
                    </button>
                  </div>
                </div>

                <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
                  <SectionHeader title="Dataset Recorder" meta={datasetStatus} />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setRecordingEnabled(!recordingEnabled)}
                      className={`rounded-md border px-2 py-2 text-[11px] font-bold ${recordingEnabled ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200' : 'border-slate-700 bg-slate-900 text-slate-400'}`}
                    >
                      {recordingEnabled ? 'Recording On' : 'Recording Off'}
                    </button>
                    <button
                      onClick={captureDatasetBefore}
                      className="rounded-md border border-sky-500/30 bg-sky-950/30 px-2 py-2 text-[11px] font-bold text-sky-200 hover:bg-sky-900/40"
                    >
                      Capture Before
                    </button>
                  </div>
                  <input
                    value={datasetScenario}
                    onChange={(event) => setDatasetScenario(event.target.value)}
                    className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100 outline-none"
                  />
                  <textarea
                    value={datasetInstruction}
                    onChange={(event) => setDatasetInstruction(event.target.value)}
                    rows={2}
                    placeholder="Training instruction: given this scene, what should the human do?"
                    className="mt-2 h-16 w-full resize-none rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs leading-5 text-slate-100 outline-none placeholder:text-slate-600"
                  />
                  <div className="mt-2 grid grid-cols-[1fr_1fr] gap-2">
                    <input
                      value={datasetLabel}
                      onChange={(event) => setDatasetLabel(event.target.value)}
                      className="rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100 outline-none"
                    />
                    <input
                      value={datasetTags}
                      onChange={(event) => setDatasetTags(event.target.value)}
                      className="rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100 outline-none"
                    />
                  </div>
                  <textarea
                    value={datasetNotes}
                    onChange={(event) => setDatasetNotes(event.target.value)}
                    rows={2}
                    placeholder="Reviewer notes or correction"
                    className="mt-2 h-14 w-full resize-none rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs leading-5 text-slate-100 outline-none placeholder:text-slate-600"
                  />
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    <button onClick={saveDatasetSample} className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-2 py-2 text-[11px] font-bold text-emerald-200 hover:bg-emerald-900/40">Save</button>
                    <button onClick={requestDatasetList} className="rounded-md border border-sky-500/30 bg-sky-950/30 px-2 py-2 text-[11px] font-bold text-sky-200 hover:bg-sky-900/40">List</button>
                    <button onClick={updateDatasetSample} className="rounded-md border border-amber-500/30 bg-amber-950/30 px-2 py-2 text-[11px] font-bold text-amber-200 hover:bg-amber-900/40">Update</button>
                    <button onClick={deleteDatasetSample} className="rounded-md border border-red-500/30 bg-red-950/30 px-2 py-2 text-[11px] font-bold text-red-200 hover:bg-red-900/40">Delete</button>
                  </div>
                  {datasetSamples.length > 0 && (
                    <div className="mt-2 max-h-28 space-y-1 overflow-y-auto pr-1">
                      {datasetSamples.slice(0, 8).map((sample) => (
                        <button
                          key={sample.id}
                          onClick={() => {
                            setSelectedDatasetId(sample.id);
                            setDatasetInstruction(sample.instruction || '');
                            setDatasetLabel(sample.label || 'accepted');
                            setDatasetTags((sample.tags || []).join(','));
                            setDatasetNotes(sample.notes || '');
                          }}
                          className={`w-full rounded border px-2 py-1.5 text-left text-[10px] ${selectedDatasetId === sample.id ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200' : 'border-slate-800 bg-slate-900/60 text-slate-400'}`}
                        >
                          <span className="block truncate">{sample.instruction || sample.id}</span>
                          <span className="text-slate-600">{sample.label || 'unlabeled'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {localMultiplayer.pendingOrders.length > 0 && (
                  <div className="space-y-2">
                    <SectionHeader title="Local Approvals" meta={`${localMultiplayer.pendingOrders.length} queued`} />
                    {localMultiplayer.pendingOrders.slice(-4).reverse().map((order) => {
                      const canApprove = activePlayer?.id === order.approverPlayerId || activePlayer?.role === 'umpire';
                      return (
                        <div key={order.id} className="rounded-md border border-amber-500/30 bg-amber-950/20 p-3">
                          <div className="text-xs font-bold text-amber-200">{order.title}</div>
                          <div className="mt-1 text-[11px] leading-5 text-slate-300">{order.summary}</div>
                          <div className="mt-1 text-[10px] text-slate-500">
                            Approver: {playerName(order.approverPlayerId, localMultiplayer.players)}
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              onClick={() => {
                                const ok = approveLocalPendingOrder(order.id, true);
                                setLastCommandResult(ok ? 'Local order approved.' : 'Approval failed.');
                              }}
                              disabled={!canApprove}
                              className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-600 disabled:bg-slate-800 disabled:text-slate-600"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => {
                                const ok = approveLocalPendingOrder(order.id, false);
                                setLastCommandResult(ok ? 'Local order rejected.' : 'Rejection failed.');
                              }}
                              disabled={!canApprove}
                              className="rounded-md bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:text-slate-600"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {selectedFleet && (
                  <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-black text-slate-100">{selectedFleet.name}</div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Fleet owner: {playerName(localMultiplayer.fleetOwners[selectedFleet.id], localMultiplayer.players)}
                        </div>
                      </div>
                      <button
                        onClick={() => assignFleetToLocalPlayer(selectedFleet.id, localMultiplayer.activePlayerId)}
                        className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-2 py-1.5 text-[11px] font-bold text-emerald-200 hover:bg-emerald-900/40"
                      >
                        Give Fleet
                      </button>
                    </div>

                    <div className="mt-3 max-h-52 overflow-y-auto space-y-1 pr-1">
                      {selectedFleet.ships.map((ship) => (
                        <label key={ship.id} className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/50 px-2 py-2 text-[11px]">
                          <input
                            type="checkbox"
                            checked={selectedShipIds.includes(ship.id)}
                            onChange={() => toggleShipSelection(ship.id)}
                            className="h-3.5 w-3.5 accent-emerald-500"
                          />
                          <span className="min-w-0 flex-1 truncate text-slate-200">{ship.name}</span>
                          <span className="text-slate-500">{ship.headingDeg.toFixed(0)}deg/{ship.targetSpeedKts.toFixed(0)}kt</span>
                          <span className="w-20 truncate text-right text-slate-500">{playerName(localMultiplayer.shipOwners[ship.id], localMultiplayer.players)}</span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              assignShipToLocalPlayer(selectedFleet.id, ship.id, localMultiplayer.activePlayerId);
                            }}
                            className="rounded border border-slate-700 px-1.5 py-1 text-[10px] text-slate-300 hover:border-emerald-500/50"
                          >
                            Give
                          </button>
                        </label>
                      ))}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          if (!selectedFleet || selectedShipIds.length === 0) return;
                          const ok = splitFleetToLocalPlayer(selectedFleet.id, selectedShipIds, localMultiplayer.activePlayerId, `${activePlayerName} Detachment`);
                          setLastCommandResult(ok ? `Detached ${selectedShipIds.length} ship(s) to ${activePlayerName}.` : 'Split failed.');
                          if (ok) setSelectedShipIds([]);
                        }}
                        disabled={selectedShipIds.length === 0 || selectedShipIds.length >= selectedFleet.ships.length}
                        className="rounded-md border border-sky-500/30 bg-sky-950/30 px-2 py-2 text-[11px] font-bold text-sky-200 hover:bg-sky-900/40 disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-600"
                      >
                        Split To Player
                      </button>
                      <button
                        onClick={() => {
                          for (const shipId of selectedShipIds) assignShipToLocalPlayer(selectedFleet.id, shipId, localMultiplayer.activePlayerId);
                          setLastCommandResult(selectedShipIds.length ? `Assigned ${selectedShipIds.length} ship(s) to ${activePlayerName}.` : 'No ships selected.');
                        }}
                        disabled={selectedShipIds.length === 0}
                        className="rounded-md border border-emerald-500/30 bg-emerald-950/30 px-2 py-2 text-[11px] font-bold text-emerald-200 hover:bg-emerald-900/40 disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-600"
                      >
                        Give Ships
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
                      <label className="text-[10px] text-slate-500">
                        Heading
                        <input
                          type="number"
                          min={0}
                          max={359}
                          value={directHeading}
                          onChange={(event) => setDirectHeading(Math.max(0, Math.min(359, Number(event.target.value) || 0)))}
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
                        />
                      </label>
                      <label className="text-[10px] text-slate-500">
                        Speed
                        <input
                          type="number"
                          min={0}
                          max={40}
                          value={directSpeed}
                          onChange={(event) => setDirectSpeed(Math.max(0, Math.min(40, Number(event.target.value) || 0)))}
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
                        />
                      </label>
                      <button
                        onClick={() => {
                          const ok = directControlShipsAsLocalPlayer(selectedFleet.id, selectedShipIds, {
                            headingDeg: directHeading,
                            speedKts: directSpeed,
                            reason: `${activePlayerName} direct control`,
                          });
                          setLastCommandResult(ok ? `Direct control applied to ${selectedShipIds.length} ship(s).` : 'Direct control failed.');
                        }}
                        disabled={selectedShipIds.length === 0}
                        className="self-end rounded-md border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-[11px] font-bold text-amber-200 hover:bg-amber-900/40 disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-600"
                      >
                        Direct
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
        )}

        {activePanel === 'orders' && (
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
                'annihilate enemy',
                'both sides annihilate enemy',
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
        )}

        {activePanel === 'orders' && pendingAuthorizations.length > 0 && (
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

        {activePanel === 'force' && (
        <section className="space-y-2">
          <SectionHeader title="Fleet Board" meta={humanMode ? `${visibleFleets.length} human fleets` : `${playerFleets.length} friendly`} />
          <div className="space-y-2">
            {visibleFleets.map((fleet) => (
              <FleetCard
                key={fleet.id}
                fleet={fleet}
                selected={fleet.id === selectedFleet?.id}
                ownerName={humanMode ? playerName(localMultiplayer.fleetOwners[fleet.id], localMultiplayer.players) : undefined}
                onSelect={() => selectFleet(fleet.id)}
              />
            ))}
          </div>
        </section>
        )}

        {activePanel === 'force' && selectedFleet && (
        <section className="space-y-2">
          <SectionHeader title="Fleet Control" meta={selectedFleet.name} />
          <div className="rounded-lg border border-slate-800 bg-slate-900/55 p-3">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Formation</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {FORMATION_OPTIONS.map((option) => (
                <button
                  key={option.type}
                  onClick={() => {
                    const ok = setFleetFormation(selectedFleet.id, option.type);
                    setLastCommandResult(ok ? `${selectedFleet.name} formation set to ${option.label}.` : 'Formation order failed.');
                  }}
                  className={`rounded-md border px-2 py-2 text-left text-[11px] transition ${selectedFleet.formation?.type === option.type ? 'border-emerald-400/60 bg-emerald-950/40 text-emerald-100' : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-500'}`}
                >
                  <div className="font-bold">{option.label}</div>
                  <div className="mt-0.5 text-[10px] opacity-70">{option.hint}</div>
                </button>
              ))}
            </div>
            {selectedFleetProfile?.formationEffects && (
              <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                <Metric label="Search Arc" value={`${selectedFleetProfile.formationEffects.searchArcModifier.toFixed(2)}x`} tone="sky" />
                <Metric label="Search Range" value={`${selectedFleetProfile.formationEffects.searchRangeModifier.toFixed(2)}x`} tone="slate" />
                <Metric label="Center AA" value={`${selectedFleetProfile.formationEffects.effectiveAntiAir}`} tone="emerald" />
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900/55 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Ships In Fleet</div>
              <div className="text-[10px] text-slate-500">{selectedShipIds.length} selected</div>
            </div>
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
              {selectedFleet.ships.map((ship) => (
                <label key={ship.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/70 px-2 py-2 text-[11px] text-slate-300">
                  <span className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedShipIds.includes(ship.id)}
                      onChange={() => toggleShipSelection(ship.id)}
                      className="h-3.5 w-3.5 accent-amber-500"
                    />
                    <span className="truncate font-bold">{ship.name}</span>
                  </span>
                  <span className={ship.damage.hullIntegrity < 70 || ship.damage.status !== 'combat_effective' ? 'text-red-300' : 'text-slate-500'}>
                    {ship.shipClass.replace(/_/g, ' ')} | hull {Math.round(ship.damage.hullIntegrity)}%
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
              <NumberField label="Damage Hull" value={damageWithdrawThreshold} min={10} max={95} onChange={setDamageWithdrawThreshold} />
              <button
                onClick={() => {
                  if (!selectedFleet) return;
                  const ok = detachDamagedShips(selectedFleet.id, damageWithdrawThreshold);
                  setLastCommandResult(ok ? `Damaged ships detached from ${selectedFleet.name}.` : 'No damaged ship could detach.');
                }}
                disabled={selectedFleet.ships.length <= 1}
                className="self-end rounded-md border border-red-500/35 bg-red-950/40 px-3 py-2 text-xs font-bold text-red-100 hover:bg-red-900/50 disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-600"
              >
                Detach Damaged
              </button>
              <button
                onClick={() => {
                  if (!selectedFleet || selectedShipIds.length === 0) return;
                  const ok = detachShipsToWithdraw(selectedFleet.id, selectedShipIds);
                  setLastCommandResult(ok ? `Selected ships detached from ${selectedFleet.name}.` : 'Detach selected failed.');
                  if (ok) setSelectedShipIds([]);
                }}
                disabled={selectedShipIds.length === 0 || selectedShipIds.length >= selectedFleet.ships.length}
                className="self-end rounded-md border border-amber-500/35 bg-amber-950/40 px-3 py-2 text-xs font-bold text-amber-100 hover:bg-amber-900/50 disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-600"
              >
                Detach Selected
              </button>
            </div>
          </div>
        </section>
        )}
        {activePanel === 'intel' && (
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
        )}

        {activePanel === 'force' && (
        <section className="space-y-2">
          <SectionHeader title="Air Operations" meta={`${airOps.length} active`} />
          <div className="space-y-1">
            {airOps.length === 0 && <EmptyLine text="No active sorties." />}
            {airOps.slice(-10).reverse().map((op) => (
              <div key={op.id} className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-[11px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold uppercase text-sky-300">{op.type}</span>
                  <span className="text-slate-500">{op.status} | {op.aircraft} ac</span>
                </div>
                <div className="mt-1 truncate text-slate-300">
                  {op.missionLabel || `${op.fleetName} sortie`} {op.targetContactId ? `-> ${op.targetContactId}` : `to ${op.x.toFixed(0)},${op.y.toFixed(0)}`}
                </div>
                <div className="mt-1 text-[10px] text-slate-500">
                  {op.fleetName} | {airMixLabel(op.aircraftMix)}{op.arcWidthDeg ? ` | arc ${op.arcWidthDeg}deg` : ''}
                </div>
              </div>
            ))}
          </div>
        </section>
        )}

        {activePanel === 'intel' && (
        <section className="space-y-2">
          <SectionHeader title="Reports" meta={`${visibleReports.length} visible`} />
          <div className="space-y-2">
            {visibleReports.length === 0 && <EmptyLine text="No reports yet." />}
            {[...visibleReports].reverse().slice(0, 10).map((report, index) => (
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
        )}

        {activePanel === 'comms' && (
        <section className="space-y-2">
          <SectionHeader title="Communications" meta={`${visibleCommunications.length} visible`} />
          {humanMode && selectedFleet && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <select
                  value={messageTargetFleetId}
                  onChange={(event) => setMessageTargetFleetId(event.target.value)}
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100"
                  disabled={communicationTargets.length === 0}
                >
                  {communicationTargets.length === 0 && <option value="">No same-side receiver</option>}
                  {communicationTargets.map((fleet) => (
                    <option key={fleet.id} value={fleet.id}>{fleet.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    if (!selectedFleet || !messageTargetFleetId || !messageText.trim()) return;
                    const ok = sendFleetMessage(selectedFleet.id, messageTargetFleetId, messageText.trim());
                    setLastCommandResult(ok ? 'Fleet message queued.' : 'Message failed.');
                    if (ok) setMessageText('');
                  }}
                  disabled={!messageTargetFleetId || !messageText.trim()}
                  className="rounded-md border border-sky-500/30 bg-sky-950/30 px-3 py-2 text-xs font-bold text-sky-200 hover:bg-sky-900/40 disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-600"
                >
                  Send
                </button>
              </div>
              <input
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
                placeholder={`Signal from ${selectedFleet.name}`}
                className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-600"
              />
            </div>
          )}
          <div className="space-y-1">
            {visibleCommunications.length === 0 && <EmptyLine text="No inter-fleet messages." />}
            {visibleCommunications.slice(-8).reverse().map((message) => (
              <div key={message.id} className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-[11px] text-slate-300">
                <span className={message.status === 'delivered' ? 'text-emerald-300' : 'text-amber-300'}>{message.status}</span>
                <span className="ml-2">{fleetLabel(message.fromFleetId, fleets)} to {fleetLabel(message.toFleetId, fleets)}: {message.message}</span>
                {message.deliveredTurn !== undefined && <span className="ml-2 text-slate-500">T{message.deliveredTurn}</span>}
              </div>
            ))}
          </div>
        </section>
        )}

        {activePanel === 'comms' && (
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
        )}

        {activePanel === 'crew' && humanMode && (
          <section className="space-y-2">
            <SectionHeader title="Local Command Log" meta={`${localMultiplayer.commandLog.length} entries`} />
            <div className="space-y-1">
              {localMultiplayer.commandLog.length === 0 && <EmptyLine text="No local multiplayer control events." />}
              {localMultiplayer.commandLog.slice(-8).reverse().map((item) => (
                <div key={item.id} className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-slate-200">{item.summary}</span>
                    <span className="text-slate-500">T{item.turn}</span>
                  </div>
                  <div className="mt-1 text-slate-500">
                    {playerName(item.actorPlayerId, localMultiplayer.players)} | {item.action}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activePanel === 'comms' && (
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
        )}
      </div>
    </aside>
  );
}
function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || 0)))}
        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100 outline-none focus:border-amber-500/70"
      />
    </label>
  );
}

function airMixLabel(selection?: { fighters?: number; diveBombers?: number; torpedoBombers?: number; scouts?: number }): string {
  if (!selection) return 'aircraft mix n/a';
  const parts = [
    selection.fighters ? `F${selection.fighters}` : '',
    selection.diveBombers ? `DB${selection.diveBombers}` : '',
    selection.torpedoBombers ? `TB${selection.torpedoBombers}` : '',
    selection.scouts ? `SC${selection.scouts}` : '',
  ].filter(Boolean);
  return parts.join('/') || 'no aircraft mix';
}
function FleetCard({ fleet, selected, ownerName, onSelect }: { fleet: StrategicFleet; selected: boolean; ownerName?: string; onSelect: () => void }) {
  const profile = getFleetCombatProfile(fleet);
  const carrier = fleet.ships.find((ship) => ship.aircraft);
  const damaged = fleet.ships.filter((ship) => ship.damage.status !== 'combat_effective').length;
  const operation = fleet.operation;

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
          {ownerName && <div className="mt-1 text-[11px] text-emerald-300">Owner: {ownerName}</div>}
        </div>
        <span className="rounded bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-300">{fleet.mission}</span>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-[10px]">
        <Metric label="Ready" value={`${profile.readiness}%`} tone={profile.readiness > 70 ? 'emerald' : profile.readiness > 45 ? 'amber' : 'red'} />
        <Metric label="AA" value={String(profile.formationEffects?.effectiveAntiAir ?? profile.firepower.antiAir)} tone="sky" />
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
        {profile.formationEffects && <span className="text-emerald-300">{profile.formationEffects.label}</span>}
        {damaged > 0 && <span className="text-red-300">{damaged} damaged</span>}
      </div>

      {profile.formationEffects && (
        <div className="mt-2 text-[10px] text-slate-500">
          Search arc x{profile.formationEffects.searchArcModifier.toFixed(2)} | range x{profile.formationEffects.searchRangeModifier.toFixed(2)} | screen x{profile.formationEffects.screenCoverageModifier.toFixed(2)}
        </div>
      )}

      {fleet.navigation && (
        <div className={`mt-3 rounded-md border px-2 py-1.5 text-[10px] ${routeToneClass(fleet.navigation.routeRisk)}`}>
          <div className="flex items-center justify-between gap-2 font-black uppercase tracking-wide">
            <span>{fleet.navigation.mode || 'route'} route</span>
            <span>ETA T{fleet.navigation.etaTurns ?? '?'}</span>
          </div>
          <div className="mt-0.5 text-slate-300/85">
            {fleet.navigation.status} | {fleet.navigation.path.length} waypoint(s) | risk {fleet.navigation.routeRisk ?? 'unknown'}
          </div>
          {fleet.navigation.currentLegNote && (
            <div className="mt-1 line-clamp-2 text-slate-500">{fleet.navigation.currentLegNote}</div>
          )}
        </div>
      )}

      {operation && (
        <div className={`mt-3 rounded-md border px-2 py-1.5 text-[10px] ${operationToneClass(operation.posture)}`}>
          <div className="font-black uppercase tracking-wide">{operationLabel(operation.posture)}</div>
          <div className="mt-0.5 text-slate-300/80">{operation.description}</div>
        </div>
      )}
    </button>
  );
}

function operationLabel(posture: NonNullable<StrategicFleet['operation']>['posture']): string {
  switch (posture) {
    case 'strike_preparation': return 'Strike prep';
    case 'aircraft_recovery': return 'Recovering air';
    case 'fighter_direction': return 'Fighter direction';
    case 'smoke_screen': return 'Smoke screen';
    case 'surface_engagement': return 'Surface action';
    case 'torpedo_attack': return 'Torpedo attack';
    case 'radio_silence': return 'Radio silence';
    case 'shore_bombardment': return 'Shore bombardment';
    case 'underway_replenishment': return 'Replenishing';
    case 'transport_run': return 'Transport run';
    case 'normal': return 'Normal';
    default: {
      const _exhaustive: never = posture;
      return _exhaustive;
    }
  }
}

function operationToneClass(posture: NonNullable<StrategicFleet['operation']>['posture']): string {
  switch (posture) {
    case 'strike_preparation':
    case 'torpedo_attack':
    case 'shore_bombardment':
      return 'border-red-500/40 bg-red-950/30 text-red-200';
    case 'aircraft_recovery':
    case 'underway_replenishment':
      return 'border-emerald-500/40 bg-emerald-950/25 text-emerald-200';
    case 'fighter_direction':
      return 'border-sky-500/40 bg-sky-950/30 text-sky-200';
    case 'smoke_screen':
    case 'radio_silence':
      return 'border-slate-500/40 bg-slate-800/40 text-slate-200';
    case 'surface_engagement':
      return 'border-amber-500/40 bg-amber-950/30 text-amber-200';
    case 'transport_run':
      return 'border-violet-500/40 bg-violet-950/25 text-violet-200';
    case 'normal':
      return 'border-slate-700 bg-slate-900/40 text-slate-300';
    default: {
      const _exhaustive: never = posture;
      return _exhaustive;
    }
  }
}

function routeToneClass(risk?: NonNullable<StrategicFleet['navigation']>['routeRisk']): string {
  if (risk === 'high') return 'border-red-500/35 bg-red-950/25 text-red-200';
  if (risk === 'medium') return 'border-amber-500/35 bg-amber-950/25 text-amber-200';
  if (risk === 'low') return 'border-emerald-500/35 bg-emerald-950/20 text-emerald-200';
  return 'border-slate-700 bg-slate-900/40 text-slate-300';
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
  if (level === 'tracked' || level === 'identified' || level === 'confirmed') return 'bg-red-950 text-red-200';
  if (level === 'classified') return 'bg-amber-950 text-amber-200';
  if (level === 'detected') return 'bg-yellow-950 text-yellow-200';
  if (level === 'suspected') return 'bg-slate-800 text-slate-300';
  return 'bg-slate-900 text-slate-500';
}

function playerName(playerId: string | undefined, players: Array<{ id: string; name: string }>): string {
  return players.find((player) => player.id === playerId)?.name || 'Unassigned';
}

type PanelPlayer = {
  id: string;
  name: string;
  faction: 'player' | 'enemy' | 'neutral';
  role: string;
  qqUserId?: string;
};

type PanelMultiplayer = {
  visibilityMode: 'role_fog_of_war' | 'shared_map';
  fleetOwners: Record<string, string>;
  shipOwners: Record<string, string>;
  players: PanelPlayer[];
};

function filterVisibleFleets(fleets: StrategicFleet[], multiplayer: PanelMultiplayer, activePlayer?: PanelPlayer): StrategicFleet[] {
  if (!activePlayer) return [];
  if (activePlayer.role === 'umpire' || activePlayer.faction === 'neutral' || multiplayer.visibilityMode === 'shared_map') {
    return fleets.filter((fleet) => fleet.faction !== 'neutral');
  }
  return fleets.filter((fleet) => {
    if (fleet.faction === activePlayer.faction) return true;
    if (multiplayer.fleetOwners[fleet.id] === activePlayer.id) return true;
    return fleet.ships.some((ship) => multiplayer.shipOwners[ship.id] === activePlayer.id);
  });
}

function contactsForLocalPlayer(
  intel: { playerContacts: any[]; enemyContacts: any[] },
  multiplayer: PanelMultiplayer,
  activePlayer?: PanelPlayer,
): any[] {
  if (!activePlayer) return [];
  if (activePlayer.role === 'umpire' || activePlayer.faction === 'neutral' || multiplayer.visibilityMode === 'shared_map') {
    return [
      ...intel.playerContacts.map((contact) => ({ ...contact, sideLabel: 'Blue' })),
      ...intel.enemyContacts.map((contact) => ({ ...contact, sideLabel: 'Red' })),
    ];
  }
  return activePlayer.faction === 'enemy' ? intel.enemyContacts : intel.playerContacts;
}

function filterVisibleReports<T extends { fromFleetId?: string }>(reports: T[], visibleFleets: StrategicFleet[], activePlayer?: PanelPlayer): T[] {
  if (!activePlayer || activePlayer.role === 'umpire' || activePlayer.faction === 'neutral') return reports;
  const visibleFleetIds = new Set(visibleFleets.map((fleet) => fleet.id));
  return reports.filter((report) => !report.fromFleetId || visibleFleetIds.has(report.fromFleetId));
}

function filterVisibleMessages<T extends { fromFleetId: string; toFleetId: string }>(messages: T[], visibleFleets: StrategicFleet[], activePlayer?: PanelPlayer): T[] {
  if (!activePlayer || activePlayer.role === 'umpire' || activePlayer.faction === 'neutral') return messages;
  const visibleFleetIds = new Set(visibleFleets.map((fleet) => fleet.id));
  return messages.filter((message) => visibleFleetIds.has(message.fromFleetId) || visibleFleetIds.has(message.toFleetId));
}

function fleetLabel(fleetId: string, fleets: StrategicFleet[]): string {
  return fleets.find((fleet) => fleet.id === fleetId)?.name || fleetId;
}

function buildNetworkSnapshot() {
  const state = useNavalStore.getState();
  return {
    navalMode: state.navalMode,
    localMultiplayer: state.localMultiplayer,
    overlay: state.overlay,
    fleets: state.fleets,
    selectedFleetId: state.selectedFleetId,
    selectedOperationView: state.selectedOperationView,
    selectedCombatViewport: state.selectedCombatViewport,
    battleMap: state.battleMap,
    facilities: state.facilities,
    shippingLanes: state.shippingLanes,
    islands: state.islands,
    tacticalMaps: state.tacticalMaps,
    airOperations: state.airOperations,
    landAirfields: state.landAirfields,
    weather: state.weather,
    victory: state.victory,
    intel: state.intel,
    reports: state.reports,
    commandHistory: state.commandHistory,
    pendingAuthorizations: state.pendingAuthorizations,
    fleetCommunications: state.fleetCommunications,
    currentTurn: state.currentTurn,
    environment: state.environment,
    battleLog: state.battleLog,
    isCreatingScenario: false,
  };
}

function buildTrainingSnapshot() {
  const state = useNavalStore.getState();
  return {
    currentTurn: state.currentTurn,
    weather: state.weather,
    victory: state.victory,
    selectedFleetId: state.selectedFleetId,
    activePlayerId: state.localMultiplayer.activePlayerId,
    players: state.localMultiplayer.players,
    fleetOwners: state.localMultiplayer.fleetOwners,
    shipOwners: state.localMultiplayer.shipOwners,
    fleets: state.fleets.map((fleet) => ({
      id: fleet.id,
      name: fleet.name,
      faction: fleet.faction,
      type: fleet.type,
      mission: fleet.mission,
      position: fleet.position,
      fuelState: fleet.fuelState,
      ammoState: fleet.ammoState,
      command: fleet.command,
      ships: fleet.ships.map((ship) => ({
        id: ship.id,
        name: ship.name,
        shipClass: ship.shipClass,
        faction: ship.faction,
        position: ship.position,
        headingDeg: ship.headingDeg,
        targetSpeedKts: ship.targetSpeedKts,
        damage: ship.damage,
        commandState: ship.commandState,
        aircraft: ship.aircraft ? {
          readyAircraft: ship.aircraft.readyAircraft,
          fighters: ship.aircraft.fighters,
          diveBombers: ship.aircraft.diveBombers,
          torpedoBombers: ship.aircraft.torpedoBombers,
          damagedAircraft: ship.aircraft.damagedAircraft,
          lostAircraft: ship.aircraft.lostAircraft,
          deckCycleState: ship.aircraft.deckCycleState,
        } : undefined,
      })),
    })),
    intel: {
      playerContacts: state.intel.playerContacts,
      enemyContacts: state.intel.enemyContacts,
      searchMissions: state.intel.searchMissions,
    },
    reports: state.reports.slice(-20),
    commandHistory: state.commandHistory.slice(-20),
    fleetCommunications: state.fleetCommunications.slice(-20),
    battleLog: state.battleLog.slice(-40),
  };
}

function applyNetworkSnapshot(snapshot: ReturnType<typeof buildNetworkSnapshot>) {
  useNavalStore.setState({
    ...snapshot,
    isCreatingScenario: false,
  });
}

function compactDatasetSample(sample: any): { id: string; instruction?: string; label?: string; notes?: string; tags?: string[] } {
  return {
    id: String(sample?.id || `sample_${Date.now().toString(36)}`),
    instruction: sample?.instruction,
    label: sample?.label,
    notes: sample?.notes,
    tags: Array.isArray(sample?.tags) ? sample.tags : [],
  };
}

function loadLocalDatasetSamples(): any[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem('naval_dataset_samples') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalDatasetSamples(samples: any[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem('naval_dataset_samples', JSON.stringify(samples.slice(-200)));
  } catch {
    // Dataset capture is optional; gameplay should continue if browser storage is full.
  }
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

function isAnnihilateCommand(text: string): boolean {
  return /(annihilate|destroy|decisive battle|seek decisive|歼灭|消灭|摧毁|决战|寻求决战)/i.test(text);
}

function isBothSidesCommand(text: string): boolean {
  return /(both sides|both fleets|双方|敌我|敌我双方)/i.test(text);
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
