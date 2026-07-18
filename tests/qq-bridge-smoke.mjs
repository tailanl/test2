import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const multiplayerPort = 19100 + Math.floor(Math.random() * 800);
const onebotPort = 20100 + Math.floor(Math.random() * 800);
const multiplayerDataDir = await mkdtemp(join(tmpdir(), 'naval-qq-bridge-mp-'));
const onebotDataDir = await mkdtemp(join(tmpdir(), 'naval-qq-bridge-onebot-'));

const mock = spawn(process.execPath, ['scripts/onebot-mock-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NAVAL_ONEBOT_MOCK_PORT: String(onebotPort),
    NAVAL_ONEBOT_MOCK_DATA_DIR: onebotDataDir,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const server = spawn(process.execPath, ['scripts/multiplayer-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NAVAL_MULTIPLAYER_PORT: String(multiplayerPort),
    NAVAL_MULTIPLAYER_DATA_DIR: multiplayerDataDir,
    NAVAL_QQ_ENABLED: '1',
    NAVAL_QQ_DRY_RUN: '0',
    NAVAL_ONEBOT_ENDPOINT: `http://127.0.0.1:${onebotPort}`,
    NAVAL_QQ_GROUP_ID: '123456',
    NAVAL_QQ_DEFAULT_ROOM_ID: 'smoke',
    NAVAL_QQ_INBOUND_ENABLED: '1',
    NAVAL_QQ_COMMAND_PREFIX: '!',
    NAVAL_QQ_PLAYER_MAP: JSON.stringify({ blue_command: '10001', red_command: '10002' }),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

function waitForReady(child, phrase, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not start`)), 5000);
    const onData = (chunk) => {
      if (String(chunk).includes(phrase)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      if (/EADDRINUSE|SyntaxError|Error/i.test(text)) {
        clearTimeout(timer);
        reject(new Error(`${label} stderr: ${text}`));
      }
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.seenMessages = [];
    ws.on('message', (buffer) => {
      try {
        ws.seenMessages.push(JSON.parse(String(buffer)));
      } catch {
        // The waiter below will fail if JSON is required.
      }
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitForMessage(ws, predicate, label) {
  return new Promise((resolve, reject) => {
    const existing = ws.seenMessages.find(predicate);
    if (existing) {
      resolve(existing);
      return;
    }
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}; seen=${JSON.stringify(ws.seenMessages)}`)), 5000);
    const onMessage = (buffer) => {
      const message = JSON.parse(String(buffer));
      if (predicate(message)) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(message);
      }
    };
    ws.on('message', onMessage);
  });
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${url} failed: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

try {
  await Promise.all([
    waitForReady(mock, 'Mock OneBot listening', 'mock OneBot'),
    waitForReady(server, 'Naval multiplayer sync server listening', 'multiplayer server'),
  ]);

  const multiplayerUrl = `http://127.0.0.1:${multiplayerPort}`;
  const onebotUrl = `http://127.0.0.1:${onebotPort}`;
  const qqHealth = await fetch(`${multiplayerUrl}/qq/health`).then((res) => res.json());
  if (!qqHealth.ok || String(qqHealth.loginInfo?.user_id) !== '90000001') {
    throw new Error(`expected OneBot health ok, got ${JSON.stringify(qqHealth)}`);
  }

  const ws = await openClient(`ws://127.0.0.1:${multiplayerPort}`);
  const joined = waitForMessage(ws, (message) => message.type === 'joined' && message.roomId === 'smoke', 'join');
  ws.send(JSON.stringify({ type: 'join', roomId: 'smoke', clientId: 'tester' }));
  await joined;

  const ack = waitForMessage(ws, (message) => message.type === 'snapshot_ack', 'snapshot ack');
  ws.send(JSON.stringify({
    type: 'snapshot',
    snapshot: {
      currentTurn: 3,
      fleets: [{ id: 'tf16' }],
      localMultiplayer: {
        players: [
          { id: 'blue_command', name: 'Blue Command', faction: 'player', role: 'theater_commander', qqUserId: '10001' },
          { id: 'red_command', name: 'Red Command', faction: 'enemy', role: 'theater_commander', qqUserId: '10002' },
        ],
      },
    },
  }));
  await ack;

  const groupPlan = await postJson(`${multiplayerUrl}/qq/dispatch`, {
    roomId: 'smoke',
    visibility: 'all',
    text: 'shared battlefield report',
  });
  if (groupPlan.dryRun !== false || !groupPlan.results[0]?.ok) throw new Error(`expected live group send, got ${JSON.stringify(groupPlan)}`);

  const privatePlan = await postJson(`${multiplayerUrl}/qq/dispatch`, {
    roomId: 'smoke',
    visibility: 'private',
    faction: 'enemy',
    text: 'red side only',
  });
  if (!privatePlan.routes.some((route) => route.channel === 'private' && route.userId === '10002')) {
    throw new Error(`expected private red route, got ${JSON.stringify(privatePlan)}`);
  }

  const messages = await fetch(`${onebotUrl}/messages`).then((res) => res.json());
  if (!messages.messages.some((message) => message.api === 'send_group_msg' && message.groupId === '123456')) {
    throw new Error(`expected recorded group message, got ${JSON.stringify(messages)}`);
  }
  if (!messages.messages.some((message) => message.api === 'send_private_msg' && message.userId === '10002')) {
    throw new Error(`expected recorded private message, got ${JSON.stringify(messages)}`);
  }

  const inbound = waitForMessage(ws, (message) => message.type === 'qq_inbound' && message.event?.commandText === 'TF16 search north', 'qq inbound');
  const inboundResult = await postJson(`${multiplayerUrl}/onebot/event?roomId=smoke`, {
    post_type: 'message',
    message_type: 'private',
    user_id: 10001,
    message_id: 'inbound_1',
    raw_message: '!TF16 search north',
    message: '!TF16 search north',
  });
  if (!inboundResult.ok) throw new Error(`expected inbound ok, got ${JSON.stringify(inboundResult)}`);
  await inbound;

  await wait(50);
  const eventLines = await readFile(join(multiplayerDataDir, 'events.jsonl'), 'utf8');
  if (!eventLines.includes('qq_dispatch_http') || !eventLines.includes('qq_inbound')) {
    throw new Error(`expected qq events in jsonl, got ${eventLines}`);
  }

  ws.close();
  await wait(50);
  console.log('QQ BRIDGE SMOKE PASS');
} finally {
  mock.kill();
  server.kill();
}
