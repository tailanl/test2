import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const port = 18900 + Math.floor(Math.random() * 1000);
const dataDir = await mkdtemp(join(tmpdir(), 'naval-multiplayer-'));
const server = spawn(process.execPath, ['scripts/multiplayer-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NAVAL_MULTIPLAYER_PORT: String(port),
    NAVAL_MULTIPLAYER_DATA_DIR: dataDir,
    NAVAL_QQ_GROUP_ID: '123456',
    NAVAL_QQ_PLAYER_MAP: JSON.stringify({ blue_command: '10001', red_command: '10002' }),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForServerReady() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('multiplayer server did not start')), 5000);
    const onData = (chunk) => {
      if (String(chunk).includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', (chunk) => {
      const text = String(chunk);
      if (/EADDRINUSE|Error/i.test(text)) {
        clearTimeout(timer);
        reject(new Error(text));
      }
    });
  });
}

function openClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.seenMessages = [];
    ws.on('message', (buffer) => {
      try {
        ws.seenMessages.push(JSON.parse(String(buffer)));
      } catch {
        // Individual waiters will surface parse issues if they matter.
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

try {
  await waitForServerReady();
  const url = `ws://127.0.0.1:${port}`;
  const health = await fetch(`http://127.0.0.1:${port}/health`).then((res) => res.json());
  if (!health.ok || !health.config.recordingEnabled) throw new Error('expected healthy recording server');

  const a = await openClient(url);
  const b = await openClient(url);

  const aJoined = waitForMessage(a, (message) => message.type === 'joined' && message.roomId === 'smoke', 'client a join');
  const bJoined = waitForMessage(b, (message) => message.type === 'joined' && message.roomId === 'smoke', 'client b join');
  a.send(JSON.stringify({ type: 'join', roomId: 'smoke', clientId: 'a' }));
  b.send(JSON.stringify({ type: 'join', roomId: 'smoke', clientId: 'b' }));
  await aJoined;
  await bJoined;
  await wait(50);

  const snapshotPromise = waitForMessage(
    b,
    (message) => message.type === 'snapshot' && message.senderId === 'a' && message.snapshot?.currentTurn === 7,
    'broadcast snapshot',
  );
  const snapshotAck = waitForMessage(
    a,
    (message) => message.type === 'snapshot_ack' || message.type === 'error',
    'snapshot ack',
  );
  a.send(JSON.stringify({
    type: 'snapshot',
    snapshot: {
      currentTurn: 7,
      fleets: [{ id: 'tf_sync' }],
      localMultiplayer: {
        players: [
          { id: 'blue_command', name: 'Blue Command', faction: 'player', role: 'theater_commander', qqUserId: '10001' },
          { id: 'red_command', name: 'Red Command', faction: 'enemy', role: 'theater_commander', qqUserId: '10002' },
        ],
      },
    },
  }));
  const ack = await snapshotAck;
  if (ack.type === 'error') throw new Error(`snapshot failed: ${ack.message}`);
  await snapshotPromise;

  const recordAck = waitForMessage(a, (message) => message.type === 'record_ack', 'record ack');
  a.send(JSON.stringify({ type: 'record_event', kind: 'test_event', payload: { ok: true } }));
  await recordAck;

  const datasetAck = waitForMessage(a, (message) => message.type === 'dataset_ack', 'dataset create');
  a.send(JSON.stringify({
    type: 'dataset_create',
    sample: {
      scenario: 'smoke',
      instruction: 'move fleet west',
      fleetIds: ['tf_sync'],
      beforeSnapshot: { currentTurn: 7 },
      afterSnapshot: { currentTurn: 8 },
      action: { type: 'move_fleet' },
      label: 'accepted',
      tags: ['smoke'],
      notes: 'initial',
    },
  }));
  const created = await datasetAck;
  if (!created.sample?.id) throw new Error('expected dataset sample id');

  const listAck = waitForMessage(a, (message) => message.type === 'dataset_list' && message.samples.length === 1, 'dataset list');
  a.send(JSON.stringify({ type: 'dataset_list' }));
  await listAck;

  const updateAck = waitForMessage(a, (message) => message.type === 'dataset_update_ack' && message.sample.notes === 'updated', 'dataset update');
  a.send(JSON.stringify({ type: 'dataset_update', id: created.sample.id, patch: { notes: 'updated' } }));
  await updateAck;

  const qqPlan = waitForMessage(a, (message) => message.type === 'qq_route_plan' && message.routes.length === 1, 'qq route plan');
  a.send(JSON.stringify({ type: 'qq_dispatch', visibility: 'all', text: 'shared battlefield report' }));
  const qq = await qqPlan;
  if (qq.routes[0].channel !== 'group') throw new Error(`expected group route, got ${qq.routes[0].channel}`);

  const privatePlan = waitForMessage(a, (message) => message.type === 'qq_route_plan' && message.routes.some((route) => route.channel === 'private'), 'qq private route');
  a.send(JSON.stringify({ type: 'qq_dispatch', visibility: 'private', faction: 'enemy', text: 'red side only' }));
  await privatePlan;

  const deleteAck = waitForMessage(a, (message) => message.type === 'dataset_delete_ack' && message.ok, 'dataset delete');
  a.send(JSON.stringify({ type: 'dataset_delete', id: created.sample.id }));
  await deleteAck;

  a.close();
  b.close();
  await wait(50);
  console.log('MULTIPLAYER SERVER SMOKE PASS');
} finally {
  server.kill();
}
