import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const config = {
  host: process.env.NAVAL_ONEBOT_MOCK_HOST || '127.0.0.1',
  port: Number(process.env.NAVAL_ONEBOT_MOCK_PORT || process.env.PORT || 3000),
  dataDir: resolve(process.env.NAVAL_ONEBOT_MOCK_DATA_DIR || 'artifacts/qq-mock'),
  accessToken: process.env.NAVAL_ONEBOT_MOCK_TOKEN || '',
  eventUrl: process.env.NAVAL_ONEBOT_EVENT_URL || '',
  eventToken: process.env.NAVAL_ONEBOT_EVENT_TOKEN || process.env.NAVAL_ONEBOT_MOCK_TOKEN || '',
  selfId: process.env.NAVAL_ONEBOT_MOCK_SELF_ID || '90000001',
  nickname: process.env.NAVAL_ONEBOT_MOCK_NICKNAME || 'NavalMockBot',
};

await mkdir(config.dataDir, { recursive: true });
const messagesFile = join(config.dataDir, 'messages.jsonl');
const eventsFile = join(config.dataDir, 'events.jsonl');

const server = createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (error) {
    sendJson(res, 500, { status: 'failed', retcode: 500, message: String(error instanceof Error ? error.message : error) });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Mock OneBot listening on http://${config.host}:${config.port}`);
  console.log(`Mock OneBot data directory: ${config.dataDir}`);
});

async function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${config.host}:${config.port}`);
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (!tokenAccepted(req, url)) {
    sendJson(res, 401, { status: 'failed', retcode: 401, message: 'invalid access token' });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true, selfId: config.selfId, nickname: config.nickname, messages: await readJsonl(messagesFile) });
    return;
  }
  if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/get_login_info') {
    sendJson(res, 200, { status: 'ok', retcode: 0, data: { user_id: Number(config.selfId), nickname: config.nickname } });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/messages') {
    sendJson(res, 200, { messages: await readJsonl(messagesFile) });
    return;
  }
  if (req.method === 'POST' && ['/send_group_msg', '/send_private_msg', '/send_msg'].includes(url.pathname)) {
    const body = await readJson(req);
    const message = {
      id: randomUUID(),
      receivedAt: new Date().toISOString(),
      api: url.pathname.slice(1),
      groupId: body.group_id ? String(body.group_id) : undefined,
      userId: body.user_id ? String(body.user_id) : undefined,
      message: String(body.message ?? ''),
      raw: body,
    };
    await appendJsonl(messagesFile, message);
    sendJson(res, 200, { status: 'ok', retcode: 0, data: { message_id: message.id } });
    return;
  }
  if (req.method === 'POST' && (url.pathname === '/emit_private' || url.pathname === '/emit_group')) {
    const body = await readJson(req);
    const event = url.pathname === '/emit_group'
      ? buildGroupEvent(body)
      : buildPrivateEvent(body);
    await appendJsonl(eventsFile, { ...event, emittedAt: new Date().toISOString() });
    const eventUrl = body.eventUrl || config.eventUrl;
    const result = eventUrl ? await postEvent(eventUrl, event) : { ok: false, skipped: true, reason: 'No eventUrl configured' };
    sendJson(res, 200, { status: 'ok', retcode: 0, data: { event, result } });
    return;
  }
  sendJson(res, 404, { status: 'failed', retcode: 404, message: 'not found' });
}

function buildPrivateEvent(body) {
  return {
    time: Math.floor(Date.now() / 1000),
    self_id: Number(config.selfId),
    post_type: 'message',
    message_type: 'private',
    sub_type: 'friend',
    message_id: randomUUID(),
    user_id: Number(body.user_id || body.userId || 10001),
    message: String(body.message || body.raw_message || ''),
    raw_message: String(body.raw_message || body.message || ''),
  };
}

function buildGroupEvent(body) {
  return {
    time: Math.floor(Date.now() / 1000),
    self_id: Number(config.selfId),
    post_type: 'message',
    message_type: 'group',
    sub_type: 'normal',
    message_id: randomUUID(),
    group_id: Number(body.group_id || body.groupId || 123456),
    user_id: Number(body.user_id || body.userId || 10001),
    message: String(body.message || body.raw_message || ''),
    raw_message: String(body.raw_message || body.message || ''),
  };
}

async function postEvent(eventUrl, event) {
  try {
    const response = await fetch(eventUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.eventToken ? { authorization: `Bearer ${config.eventToken}` } : {}),
      },
      body: JSON.stringify(event),
    });
    return { ok: response.ok, status: response.status, body: await safeJson(response) };
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error) };
  }
}

function tokenAccepted(req, url) {
  if (!config.accessToken) return true;
  const header = String(req.headers.authorization || '');
  return header === `Bearer ${config.accessToken}` || url.searchParams.get('access_token') === config.accessToken;
}

function readJson(req) {
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

async function safeJson(response) {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

async function appendJsonl(file, entry) {
  await mkdir(config.dataDir, { recursive: true });
  await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
}

async function readJsonl(file) {
  if (!existsSync(file)) return [];
  const text = await readFile(file, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  });
  res.end(JSON.stringify(payload));
}
