import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { WebSocketServer } from 'ws';

const config = await loadConfig();
const rooms = new Map();
const dataDir = resolve(config.dataDir);
const eventsFile = join(dataDir, config.eventsFile);
const datasetFile = join(dataDir, config.datasetFile);

await mkdir(dataDir, { recursive: true });

const httpServer = createServer(async (req, res) => {
  try {
    await handleHttp(req, res);
  } catch (error) {
    sendHttp(res, 500, { error: String(error instanceof Error ? error.message : error) });
  }
});
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  ws.roomId = 'default';
  ws.clientId = `client_${Math.random().toString(36).slice(2, 10)}`;
  let room = roomFor(ws.roomId);
  room.clients.add(ws);

  ws.on('message', async (buffer) => {
    let message;
    try {
      message = JSON.parse(String(buffer));
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON message' });
      return;
    }

    try {
      room = await handleMessage(ws, roomFor(ws.roomId), message);
    } catch (error) {
      send(ws, { type: 'error', message: String(error instanceof Error ? error.message : error) });
    }
  });

  ws.on('close', () => {
    const currentRoom = roomFor(ws.roomId);
    currentRoom.clients.delete(ws);
    broadcast(currentRoom, ws, { type: 'peer_left', roomId: ws.roomId, clientId: ws.clientId, peers: currentRoom.clients.size });
  });
});

httpServer.listen(config.port, config.host, () => {
  console.log(`Naval multiplayer sync server listening on ws://${config.host}:${config.port}`);
  console.log(`Data directory: ${dataDir}`);
});

async function handleMessage(ws, currentRoom, message) {
  if (message.type === 'join') {
    currentRoom.clients.delete(ws);
    ws.roomId = String(message.roomId || 'default');
    ws.clientId = String(message.clientId || ws.clientId);
    const room = roomFor(ws.roomId);
    room.clients.add(ws);
    send(ws, { type: 'joined', roomId: ws.roomId, clientId: ws.clientId, peers: room.clients.size, config: publicConfig() });
    if (room.snapshot) send(ws, { type: 'snapshot', roomId: ws.roomId, senderId: 'server', snapshot: room.snapshot });
    broadcast(room, ws, { type: 'peer_joined', roomId: ws.roomId, clientId: ws.clientId, peers: room.clients.size });
    await recordEvent('join', ws, { peers: room.clients.size });
    return room;
  }

  if (message.type === 'room_config') {
    currentRoom.config = { ...currentRoom.config, ...(message.config || {}) };
    send(ws, { type: 'room_config_ack', roomId: ws.roomId, config: currentRoom.config });
    await recordEvent('room_config', ws, currentRoom.config);
    return currentRoom;
  }

  if (message.type === 'snapshot') {
    const size = Buffer.byteLength(JSON.stringify(message.snapshot || {}), 'utf8');
    if (size > config.maxSnapshotBytes) {
      send(ws, { type: 'error', message: `Snapshot too large: ${size} > ${config.maxSnapshotBytes}` });
      return currentRoom;
    }
    currentRoom.snapshot = message.snapshot;
    broadcast(currentRoom, ws, {
      type: 'snapshot',
      roomId: ws.roomId,
      senderId: ws.clientId,
      snapshot: message.snapshot,
    });
    send(ws, { type: 'snapshot_ack', roomId: ws.roomId, turn: message.snapshot?.currentTurn, bytes: size });
    await recordEvent('snapshot', ws, summarizeSnapshot(message.snapshot));
    return currentRoom;
  }

  if (message.type === 'request_snapshot') {
    send(ws, currentRoom.snapshot
      ? { type: 'snapshot', roomId: ws.roomId, senderId: 'server', snapshot: currentRoom.snapshot }
      : { type: 'snapshot_empty', roomId: ws.roomId });
    return currentRoom;
  }

  if (message.type === 'record_event') {
    const event = await recordEvent(message.kind || 'client_event', ws, message.payload || {}, message.visibility || 'private');
    send(ws, { type: 'record_ack', roomId: ws.roomId, eventId: event.id });
    return currentRoom;
  }

  if (message.type === 'dataset_create') {
    const sample = await createDatasetSample(ws, message.sample || {});
    send(ws, { type: 'dataset_ack', roomId: ws.roomId, sample });
    return currentRoom;
  }

  if (message.type === 'dataset_list') {
    send(ws, { type: 'dataset_list', roomId: ws.roomId, samples: await listDatasetSamples(message.includeDeleted === true) });
    return currentRoom;
  }

  if (message.type === 'dataset_update') {
    const sample = await updateDatasetSample(message.id, message.patch || {});
    send(ws, { type: 'dataset_update_ack', roomId: ws.roomId, sample });
    return currentRoom;
  }

  if (message.type === 'dataset_delete') {
    const ok = await deleteDatasetSample(message.id);
    send(ws, { type: 'dataset_delete_ack', roomId: ws.roomId, id: message.id, ok });
    return currentRoom;
  }

  if (message.type === 'qq_dispatch') {
    const plan = await buildAndMaybeSendQQPlan(currentRoom, message);
    send(ws, { type: 'qq_route_plan', roomId: ws.roomId, ...plan });
    await recordEvent('qq_dispatch', ws, plan);
    return currentRoom;
  }

  send(ws, { type: 'error', message: `Unsupported message type: ${message.type}` });
  return currentRoom;
}

async function handleHttp(req, res) {
  const url = new URL(req.url || '/', `http://${config.host}:${config.port}`);
  if (req.method === 'OPTIONS') {
    sendHttp(res, 200, { ok: true });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    sendHttp(res, 200, {
      ok: true,
      config: publicConfig(),
      rooms: [...rooms.entries()].map(([id, room]) => roomSummary(id, room)),
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/rooms') {
    sendHttp(res, 200, { rooms: [...rooms.entries()].map(([id, room]) => roomSummary(id, room)) });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/dataset') {
    sendHttp(res, 200, { samples: await listDatasetSamples(url.searchParams.get('includeDeleted') === 'true') });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/qq/health') {
    sendHttp(res, 200, await checkOneBotHealth());
    return;
  }
  if (req.method === 'POST' && url.pathname === '/qq/dispatch') {
    const body = await readJsonBody(req);
    const roomId = String(body.roomId || config.qq.defaultRoomId);
    const room = roomFor(roomId);
    const plan = await buildAndMaybeSendQQPlan(room, body);
    await recordServerEvent('qq_dispatch_http', roomId, 'http', plan, body.visibility || 'private');
    sendHttp(res, 200, { roomId, ...plan });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/onebot/event') {
    if (!config.qq.inboundEnabled) {
      sendHttp(res, 403, { ok: false, error: 'QQ inbound bridge is disabled' });
      return;
    }
    if (!oneBotTokenAccepted(req, url)) {
      sendHttp(res, 401, { ok: false, error: 'Invalid OneBot access token' });
      return;
    }
    const roomId = String(url.searchParams.get('roomId') || config.qq.defaultRoomId);
    const room = roomFor(roomId);
    const event = normalizeOneBotEvent(await readJsonBody(req));
    const visibility = event.messageType === 'group' ? 'group' : 'private';
    const recorded = await recordServerEvent('qq_inbound', roomId, 'onebot', event, visibility);
    broadcast(room, undefined, { type: 'qq_inbound', roomId, senderId: 'onebot', event });
    sendHttp(res, 200, { ok: true, roomId, eventId: recorded.id });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/dataset') {
    const sample = await createDatasetSample({ roomId: 'http', clientId: 'http' }, await readJsonBody(req));
    sendHttp(res, 201, { sample });
    return;
  }
  const datasetPatch = url.pathname.match(/^\/dataset\/([^/]+)$/);
  if (datasetPatch && req.method === 'PATCH') {
    sendHttp(res, 200, { sample: await updateDatasetSample(datasetPatch[1], await readJsonBody(req)) });
    return;
  }
  if (datasetPatch && req.method === 'DELETE') {
    sendHttp(res, 200, { ok: await deleteDatasetSample(datasetPatch[1]), id: datasetPatch[1] });
    return;
  }
  sendHttp(res, 404, { error: 'not found' });
}

async function recordServerEvent(kind, roomId, clientId, payload, visibility = 'private') {
  return recordEvent(kind, { roomId, clientId }, payload, visibility);
}

function oneBotTokenAccepted(req, url) {
  if (!config.qq.accessToken) return true;
  const header = String(req.headers.authorization || '');
  const queryToken = url.searchParams.get('access_token');
  return header === `Bearer ${config.qq.accessToken}` || queryToken === config.qq.accessToken;
}

function normalizeOneBotEvent(payload) {
  const rawMessage = String(payload.raw_message ?? payload.message ?? '').slice(0, config.qq.maxMessageChars);
  const messageType = String(payload.message_type || payload.messageType || (payload.group_id ? 'group' : 'private'));
  return {
    id: payload.message_id ? String(payload.message_id) : randomUUID(),
    receivedAt: new Date().toISOString(),
    time: typeof payload.time === 'number' ? new Date(payload.time * 1000).toISOString() : undefined,
    postType: String(payload.post_type || payload.postType || 'message'),
    messageType,
    subType: payload.sub_type || payload.subType,
    groupId: payload.group_id ? String(payload.group_id) : undefined,
    userId: payload.user_id ? String(payload.user_id) : undefined,
    rawMessage,
    commandText: extractQQCommand(rawMessage),
    original: payload,
  };
}

function extractQQCommand(rawMessage) {
  const text = String(rawMessage || '').trim();
  if (!text) return '';
  const prefix = config.qq.commandPrefix;
  if (!prefix) return text;
  return text.startsWith(prefix) ? text.slice(prefix.length).trim() : '';
}

async function checkOneBotHealth() {
  const endpoint = config.qq.endpoint.replace(/\/$/, '');
  if (!endpoint) {
    return { ok: false, endpointConfigured: false, error: 'NAVAL_ONEBOT_ENDPOINT is not configured' };
  }
  try {
    const response = await fetch(endpoint + '/get_login_info', {
      method: 'POST',
      headers: oneBotHeaders(),
    });
    const body = await readResponseBody(response);
    return {
      ok: response.ok,
      endpointConfigured: true,
      status: response.status,
      loginInfo: body?.data || body,
    };
  } catch (error) {
    return {
      ok: false,
      endpointConfigured: true,
      error: String(error instanceof Error ? error.message : error),
    };
  }
}

function oneBotHeaders() {
  return {
    'content-type': 'application/json',
    ...(config.qq.accessToken ? { authorization: `Bearer ${config.qq.accessToken}` } : {}),
  };
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function roomFor(roomId) {
  const id = String(roomId || 'default');
  if (!rooms.has(id)) rooms.set(id, { clients: new Set(), snapshot: undefined, config: {} });
  return rooms.get(id);
}

function roomSummary(id, room) {
  return {
    id,
    peers: room.clients.size,
    hasSnapshot: Boolean(room.snapshot),
    turn: room.snapshot?.currentTurn,
    fleets: Array.isArray(room.snapshot?.fleets) ? room.snapshot.fleets.length : 0,
    players: room.snapshot?.localMultiplayer?.players?.length || 0,
  };
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(room, sender, payload) {
  for (const client of room.clients) {
    if (client !== sender) send(client, payload);
  }
}

function sendHttp(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function recordEvent(kind, ws, payload, visibility = 'private') {
  if (!config.recordingEnabled) return { id: 'recording_disabled' };
  const entry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    roomId: ws.roomId,
    clientId: ws.clientId,
    kind,
    visibility,
    payload,
  };
  await appendJsonl(eventsFile, entry);
  return entry;
}

async function createDatasetSample(ws, sample) {
  const now = new Date().toISOString();
  const entry = {
    id: sample.id || randomUUID(),
    createdAt: sample.createdAt || now,
    updatedAt: now,
    deleted: false,
    roomId: sample.roomId || ws.roomId,
    clientId: sample.clientId || ws.clientId,
    source: sample.source || 'human_ui',
    scenario: sample.scenario || 'unspecified',
    instruction: sample.instruction || '',
    fleetIds: Array.isArray(sample.fleetIds) ? sample.fleetIds : [],
    actorPlayerId: sample.actorPlayerId,
    beforeSnapshot: sample.beforeSnapshot,
    afterSnapshot: sample.afterSnapshot,
    action: sample.action,
    label: sample.label || 'accepted',
    tags: Array.isArray(sample.tags) ? sample.tags : [],
    notes: sample.notes || '',
  };
  const samples = await listDatasetSamples(true);
  samples.push(entry);
  await writeDatasetSamples(samples);
  return entry;
}

async function listDatasetSamples(includeDeleted = false) {
  if (!existsSync(datasetFile)) return [];
  const text = await readFile(datasetFile, 'utf8');
  const samples = text.split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return includeDeleted ? samples : samples.filter((sample) => !sample.deleted);
}

async function writeDatasetSamples(samples) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(datasetFile, samples.map((sample) => JSON.stringify(sample)).join('\n') + (samples.length ? '\n' : ''), 'utf8');
}

async function updateDatasetSample(id, patch) {
  const samples = await listDatasetSamples(true);
  const index = samples.findIndex((sample) => sample.id === id);
  if (index < 0) throw new Error(`Dataset sample not found: ${id}`);
  samples[index] = {
    ...samples[index],
    ...patch,
    id: samples[index].id,
    updatedAt: new Date().toISOString(),
  };
  await writeDatasetSamples(samples);
  return samples[index];
}

async function deleteDatasetSample(id) {
  await updateDatasetSample(id, { deleted: true });
  return true;
}

async function appendJsonl(file, entry) {
  await mkdir(dataDir, { recursive: true });
  await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
}

function summarizeSnapshot(snapshot) {
  return {
    currentTurn: snapshot?.currentTurn,
    weather: snapshot?.weather,
    fleetCount: Array.isArray(snapshot?.fleets) ? snapshot.fleets.length : 0,
    reportCount: Array.isArray(snapshot?.reports) ? snapshot.reports.length : 0,
    commandCount: Array.isArray(snapshot?.commandHistory) ? snapshot.commandHistory.length : 0,
  };
}

async function buildAndMaybeSendQQPlan(room, message) {
  const text = String(message.text || '').slice(0, config.qq.maxMessageChars);
  const routes = buildQQRoutes(room, {
    visibility: message.visibility || 'all',
    faction: message.faction,
    playerIds: message.playerIds,
    text,
  });
  const dryRun = config.qq.dryRun || !config.qq.enabled || !config.qq.endpoint;
  const results = [];
  if (!dryRun) {
    for (const route of routes) {
      results.push(await sendOneBotMessage(route, text));
    }
  }
  return { text, routes, dryRun, results };
}

function buildQQRoutes(room, request) {
  const playerMap = {
    ...config.qq.playerMap,
    ...(room.config?.qqPlayerMap || {}),
  };
  const players = room.snapshot?.localMultiplayer?.players || [];
  for (const player of players) {
    if (player.qqUserId) playerMap[player.id] = String(player.qqUserId);
  }

  if (request.visibility === 'all' || request.visibility === 'group') {
    return config.qq.groupId
      ? [{ channel: 'group', groupId: String(config.qq.groupId) }]
      : [{ channel: 'group_missing', reason: 'QQ group id is not configured' }];
  }

  const targetPlayers = Array.isArray(request.playerIds)
    ? players.filter((player) => request.playerIds.includes(player.id))
    : players.filter((player) => player.faction === request.faction);
  const routes = targetPlayers.map((player) => {
    const userId = playerMap[player.id];
    return userId
      ? { channel: 'private', playerId: player.id, userId: String(userId) }
      : { channel: 'private_missing', playerId: player.id, reason: 'QQ user id is not configured' };
  });
  return routes.length > 0 ? routes : [{ channel: 'private_missing', reason: 'No matching player recipients' }];
}

async function sendOneBotMessage(route, text) {
  if (route.channel !== 'group' && route.channel !== 'private') return { route, ok: false, skipped: true };
  const endpoint = config.qq.endpoint.replace(/\/$/, '');
  const path = route.channel === 'group' ? '/send_group_msg' : '/send_private_msg';
  const body = route.channel === 'group'
    ? { group_id: route.groupId, message: text }
    : { user_id: route.userId, message: text };
  try {
    const response = await fetch(endpoint + path, {
      method: 'POST',
      headers: oneBotHeaders(),
      body: JSON.stringify(body),
    });
    return { route, ok: response.ok, status: response.status, response: await readResponseBody(response) };
  } catch (error) {
    return { route, ok: false, error: String(error instanceof Error ? error.message : error) };
  }
}

async function loadConfig() {
  const args = parseArgs(process.argv.slice(2));
  const fileConfig = args.config ? JSON.parse((await readFile(resolve(args.config), 'utf8')).replace(/^\uFEFF/, '')) : {};
  const envPlayerMap = process.env.NAVAL_QQ_PLAYER_MAP ? JSON.parse(process.env.NAVAL_QQ_PLAYER_MAP) : {};
  return {
    host: args.host || process.env.NAVAL_MULTIPLAYER_HOST || fileConfig.host || '127.0.0.1',
    port: Number(args.port || process.env.NAVAL_MULTIPLAYER_PORT || process.env.PORT || fileConfig.port || 8787),
    dataDir: args.dataDir || process.env.NAVAL_MULTIPLAYER_DATA_DIR || fileConfig.dataDir || 'artifacts/multiplayer',
    eventsFile: fileConfig.eventsFile || 'events.jsonl',
    datasetFile: fileConfig.datasetFile || 'dataset.jsonl',
    maxSnapshotBytes: Number(process.env.NAVAL_MAX_SNAPSHOT_BYTES || fileConfig.maxSnapshotBytes || 8_000_000),
    recordingEnabled: process.env.NAVAL_RECORDING_ENABLED
      ? process.env.NAVAL_RECORDING_ENABLED !== '0'
      : fileConfig.recordingEnabled !== false,
    qq: {
      enabled: process.env.NAVAL_QQ_ENABLED === '1' || fileConfig.qq?.enabled === true,
      dryRun: process.env.NAVAL_QQ_DRY_RUN
        ? process.env.NAVAL_QQ_DRY_RUN !== '0'
        : fileConfig.qq?.dryRun !== false,
      endpoint: process.env.NAVAL_ONEBOT_ENDPOINT || fileConfig.qq?.endpoint || '',
      accessToken: process.env.NAVAL_ONEBOT_TOKEN || fileConfig.qq?.accessToken || '',
      groupId: process.env.NAVAL_QQ_GROUP_ID || fileConfig.qq?.groupId || '',
      defaultRoomId: process.env.NAVAL_QQ_DEFAULT_ROOM_ID || fileConfig.qq?.defaultRoomId || 'default',
      inboundEnabled: process.env.NAVAL_QQ_INBOUND_ENABLED
        ? process.env.NAVAL_QQ_INBOUND_ENABLED !== '0'
        : fileConfig.qq?.inboundEnabled !== false,
      commandPrefix: process.env.NAVAL_QQ_COMMAND_PREFIX || fileConfig.qq?.commandPrefix || '',
      playerMap: { ...(fileConfig.qq?.playerMap || {}), ...envPlayerMap },
      maxMessageChars: Number(process.env.NAVAL_QQ_MAX_MESSAGE_CHARS || fileConfig.qq?.maxMessageChars || 1800),
    },
  };
}

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const item = args[i];
    if (item.startsWith('--')) {
      const key = item.slice(2);
      parsed[key] = args[i + 1];
      i += 1;
    }
  }
  return parsed;
}

function publicConfig() {
  return {
    host: config.host,
    port: config.port,
    dataDir,
    recordingEnabled: config.recordingEnabled,
    maxSnapshotBytes: config.maxSnapshotBytes,
    qq: {
      enabled: config.qq.enabled,
      dryRun: config.qq.dryRun,
      endpointConfigured: Boolean(config.qq.endpoint),
      groupConfigured: Boolean(config.qq.groupId),
      defaultRoomId: config.qq.defaultRoomId,
      inboundEnabled: config.qq.inboundEnabled,
      commandPrefixConfigured: Boolean(config.qq.commandPrefix),
      mappedPlayers: Object.keys(config.qq.playerMap).length,
    },
  };
}
