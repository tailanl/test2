const args = parseArgs(process.argv.slice(2));
const multiplayerUrl = (args.server || process.env.NAVAL_MULTIPLAYER_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const onebotUrl = (args.onebot || process.env.NAVAL_ONEBOT_ENDPOINT || 'http://127.0.0.1:3000').replace(/\/$/, '');
const token = args.token || process.env.NAVAL_ONEBOT_TOKEN || '';
const headers = {
  'content-type': 'application/json',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
};

const report = {
  checkedAt: new Date().toISOString(),
  multiplayerUrl,
  onebotUrl,
  multiplayer: await checkJson(`${multiplayerUrl}/health`),
  bridge: await checkJson(`${multiplayerUrl}/qq/health`),
  onebot: await checkJson(`${onebotUrl}/get_login_info`, { method: 'POST', headers }),
};

if (args.dispatch) {
  report.dispatch = await checkJson(`${multiplayerUrl}/qq/dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ visibility: 'all', text: args.dispatch }),
  });
}

console.log(JSON.stringify(report, null, 2));
if (!report.multiplayer.ok) process.exit(1);
if (args.requireOneBot && (!report.onebot.ok || !report.bridge.ok)) process.exit(2);

async function checkJson(url, options) {
  try {
    const response = await fetch(url, options);
    const body = await response.text();
    let parsed;
    try {
      parsed = body ? JSON.parse(body) : undefined;
    } catch {
      parsed = { raw: body.slice(0, 500) };
    }
    return { ok: response.ok, status: response.status, body: parsed };
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error) };
  }
}

function parseArgs(items) {
  const parsed = {};
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = items[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}
