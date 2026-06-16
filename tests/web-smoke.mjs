import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const root = process.cwd();
const appUrl = process.env.WEB_SMOKE_URL || 'http://127.0.0.1:5173';
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const llmMode = (process.env.WEB_SMOKE_LLM || 'mock').toLowerCase();
const ollamaModel = process.env.WEB_SMOKE_MODEL || (llmMode === 'mock' ? 'mock-ollama' : 'qwen3.5:0.8b');
const turnCount = Math.max(1, Math.min(10, Number(process.env.WEB_SMOKE_TURNS || '1') || 1));
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const reportDir = join(root, 'artifacts', 'web-smoke', timestamp);
const failures = [];
const consoleMessages = [];
const phases = [];
const networkLLMOutputs = [];
let devServer;
let chrome;
let profileDir;

async function main() {
  await mkdir(reportDir, { recursive: true });

  try {
    await phase('ensure app server', ensureAppServer);
    const browser = await phase('launch chrome', launchChrome);
    const cdp = await phase('open page', () => openPage(browser.port));

    cdp.on('Runtime.consoleAPICalled', (event) => {
      consoleMessages.push({
        type: event.type,
        text: (event.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' '),
      });
    });
    cdp.on('Runtime.exceptionThrown', (event) => {
      consoleMessages.push({ type: 'exception', text: event.exceptionDetails?.text || 'Runtime exception' });
    });
    cdp.on('Log.entryAdded', (event) => {
      consoleMessages.push({ type: event.entry?.level || 'log', text: event.entry?.text || '' });
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    cdp.on('Network.responseReceived', (event) => {
      const url = event.response?.url || '';
      if (url.includes('/api/chat') || url.includes('api.deepseek.com')) {
        networkLLMOutputs.push({
          url,
          status: event.response?.status,
          mimeType: event.response?.mimeType,
        });
      }
    });

    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: testBootstrapSource() });
    await phase('navigate', async () => {
      await cdp.send('Page.navigate', { url: appUrl });
      await cdp.waitFor('Page.loadEventFired', 15000);
      await waitForAppShell(cdp, 10000);
    });

    await phase('deploy scenario', async () => {
      await deployScenario(cdp);
      await waitForText(cdp, 'Task Force 16', 15000);
    });

    await phase(`set ${turnCount} turn(s)`, () => setTurnCount(cdp, turnCount));
    await phase(`run ${turnCount} campaign turn(s)`, async () => {
      await clickStartCampaign(cdp);
      await waitUntil(async () => {
        const snapshot = await readWindowSnapshot(cdp);
        return snapshot?.llmTraces?.length >= turnCount || snapshot?.storedTraces?.length >= turnCount;
      }, llmMode === 'ollama' ? Math.max(90000, turnCount * 90000) : Math.max(30000, turnCount * 30000), 'Campaign turns did not produce expected LLM traces');
    });

    const snapshot = await readWindowSnapshot(cdp);
    const text = await getBodyText(cdp);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(reportDir, 'screenshot.png'), Buffer.from(screenshot.data, 'base64'));
    await writeFile(join(reportDir, 'body.txt'), text);
    await writeFile(join(reportDir, 'window-snapshot.json'), JSON.stringify(snapshot, null, 2));

    const llmTraces = snapshot?.llmTraces?.length ? snapshot.llmTraces : (snapshot?.storedTraces || []);
    await writeFile(join(reportDir, 'llm-traces.json'), JSON.stringify(llmTraces, null, 2));
    await writeFile(join(reportDir, 'llm-network.json'), JSON.stringify(networkLLMOutputs, null, 2));

    validateSmoke({ text, snapshot, llmTraces });

    const relevantConsoleErrors = consoleMessages.filter((m) =>
      ['error', 'exception'].includes(String(m.type).toLowerCase()) &&
      !/Failed to load resource|Statsig|ERR_BLOCKED_BY_CLIENT/i.test(m.text)
    );
    if (relevantConsoleErrors.length > 0) {
      failures.push(`Console errors: ${relevantConsoleErrors.map((m) => m.text).join(' | ')}`);
    }

    const report = {
      ok: failures.length === 0,
      mode: llmMode,
      model: ollamaModel,
      turnCount,
      url: appUrl,
      reportDir,
      phases,
      failures,
      consoleMessages,
      llmNetwork: networkLLMOutputs,
      llmTraceSummary: llmTraces.map((trace) => ({
        provider: trace.provider,
        model: trace.model,
        requestError: trace.requestError,
        parseError: trace.parseError,
        rawOutput: trace.rawOutput,
        decisions: trace.parsedDecision?.decisions,
      })),
      bodyTextTail: text.slice(-5000),
    };
    await writeFile(join(reportDir, 'report.json'), JSON.stringify(report, null, 2));

    console.log(`Web smoke report: ${reportDir}`);
    console.log(report.ok ? 'WEB SMOKE PASS' : 'WEB SMOKE FAIL');
    if (!report.ok) {
      for (const failure of failures) console.error(`- ${failure}`);
      process.exit(1);
    }
  } finally {
    if (chrome && !chrome.killed) chrome.kill('SIGKILL');
    if (devServer && !devServer.killed) devServer.kill('SIGTERM');
    if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function phase(name, fn) {
  const startedAt = new Date().toISOString();
  try {
    const result = await fn();
    phases.push({ name, ok: true, startedAt, endedAt: new Date().toISOString() });
    await writeFile(join(reportDir, 'phases.json'), JSON.stringify(phases, null, 2));
    return result;
  } catch (error) {
    phases.push({
      name,
      ok: false,
      startedAt,
      endedAt: new Date().toISOString(),
      error: error instanceof Error ? error.stack || error.message : String(error),
    });
    await writeFile(join(reportDir, 'phases.json'), JSON.stringify(phases, null, 2));
    throw error;
  }
}

async function ensureAppServer() {
  if (await canFetch(appUrl)) return;
  devServer = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], { cwd: root, shell: true });
  await waitUntil(async () => canFetch(appUrl), 30000, 'Vite dev server did not become ready');
}

async function canFetch(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function launchChrome() {
  if (!existsSync(chromePath)) throw new Error(`Chrome not found: ${chromePath}`);
  profileDir = await mkdtemp(join(tmpdir(), 'naval-web-smoke-'));
  chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const activePortFile = join(profileDir, 'DevToolsActivePort');
  await waitUntil(async () => existsSync(activePortFile), 20000, 'Chrome DevToolsActivePort was not created');
  const [portLine] = (await readFile(activePortFile, 'utf8')).trim().split(/\r?\n/);
  return { port: Number(portLine) };
}

async function openPage(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Failed to create Chrome target: ${response.status}`);
  const target = await response.json();
  return new CDPClient(target.webSocketDebuggerUrl);
}

class CDPClient {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
        else resolve(message.result || {});
        return;
      }
      const listeners = this.listeners.get(message.method) || [];
      for (const listener of listeners) listener(message.params || {});
    });
  }

  on(method, listener) {
    this.listeners.set(method, [...(this.listeners.get(method) || []), listener]);
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP command timed out: ${method}`));
        }
      }, 15000);
    });
  }

  waitFor(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      this.on(method, (params) => {
        clearTimeout(timeout);
        resolve(params);
      });
    });
  }
}

async function evalValue(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
  return result.result?.value;
}

async function getBodyText(cdp) {
  return await evalValue(cdp, 'document.body ? document.body.innerText : ""');
}

async function readWindowSnapshot(cdp) {
  return await evalValue(cdp, `
    (() => ({
      text: document.body ? document.body.innerText : '',
      log: window.__navalWebSmokeLog || [],
      report: window.__navalWebSmokeReport || '',
      llmTraces: window.__navalWebSmokeTraces || [],
      storedTraces: (() => {
        try { return JSON.parse(window.localStorage.getItem('naval_llm_traces') || '[]'); } catch { return []; }
      })(),
      buttons: [...document.querySelectorAll('button')].map((button, index) => ({
        index,
        text: button.textContent || '',
        disabled: button.disabled,
      })),
      inputs: [...document.querySelectorAll('input')].map((input, index) => ({
        index,
        type: input.type,
        value: input.value,
      })),
    }))()
  `);
}

async function waitForText(cdp, text, timeoutMs) {
  await waitUntil(async () => (await getBodyText(cdp)).includes(text), timeoutMs, `Timed out waiting for text: ${text}`);
}

async function waitForAppShell(cdp, timeoutMs) {
  await waitUntil(async () => {
    const snapshot = await readWindowSnapshot(cdp);
    return snapshot.text.length > 20 && snapshot.buttons.length > 0;
  }, timeoutMs, 'App shell did not render meaningful content');
}

async function deployScenario(cdp) {
  const clicked = await evalValue(cdp, `
    (() => {
      if ((document.body?.innerText || '').includes('Task Force 16')) return true;
      const buttons = [...document.querySelectorAll('button')].filter((button) => !button.disabled);
      const preferred = buttons.find((button) => /deploy|scenario|舰队|部署/i.test(button.textContent || '')) || buttons[buttons.length - 1];
      if (!preferred) return false;
      preferred.click();
      return true;
    })()
  `);
  if (!clicked) throw new Error('Deploy scenario button not found');
}

async function clickStartCampaign(cdp) {
  const clicked = await evalValue(cdp, `
    (() => {
      const input = document.querySelector('input[type="number"]');
      const scoped = input?.parentElement ? [...input.parentElement.querySelectorAll('button')] : [];
      const buttons = (scoped.length ? scoped : [...document.querySelectorAll('button')]).filter((button) => !button.disabled);
      const preferred = buttons.find((button) => /start|campaign|开始|战役/i.test(button.textContent || '')) || buttons[0];
      if (!preferred) return false;
      preferred.click();
      return true;
    })()
  `);
  if (!clicked) throw new Error('Start campaign button not found');
}

async function setTurnCount(cdp, value) {
  const changed = await evalValue(cdp, `
    (() => {
      const input = document.querySelector('input[type="number"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, ${JSON.stringify(String(value))});
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(String(value))} }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.blur();
      return input.value === ${JSON.stringify(String(value))};
    })()
  `);
  if (!changed) throw new Error('Turn count input not found or did not update');
}

async function waitUntil(check, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(message);
}

function validateSmoke({ text, snapshot, llmTraces }) {
  const combinedLog = `${text}\n${(snapshot?.log || []).join('\n')}`;
  const badPatterns = [
    /Invalid string length/i,
    /no available aircraft/i,
    /not in own forces/i,
    /LLM.*error/i,
    /LLM.*错误/i,
    /launch_\w+:\s*Fleet .* not/i,
  ];
  for (const pattern of badPatterns) {
    if (pattern.test(combinedLog)) failures.push(`Page contains failure pattern: ${pattern}`);
  }
  if (!/Task Force 16/.test(text)) failures.push('Task Force 16 not visible after deployment');
  if (llmTraces.length === 0) failures.push('No LLM traces saved');
  const traceErrors = llmTraces.filter((trace) => trace.requestError || trace.parseError);
  if (traceErrors.length > 0) {
    failures.push(`LLM trace errors: ${traceErrors.map((trace) => trace.requestError || trace.parseError).join(' | ')}`);
  }
  if (llmMode === 'ollama' && !llmTraces.some((trace) => trace.provider === 'ollama' && trace.model === ollamaModel)) {
    failures.push(`Ollama trace for ${ollamaModel} not found`);
  }
  if (!llmTraces.some((trace) => trace.rawOutput)) failures.push('No raw LLM output captured');
  if (llmTraces.some((trace) => trace.provider === 'deepseek') || /api\.deepseek\.com/i.test(JSON.stringify(networkLLMOutputs))) {
    failures.push('DeepSeek was used during web smoke; local Ollama only is allowed');
  }
  const decisionTypes = llmTraces.flatMap((trace) => trace.parsedDecision?.decisions?.map((decision) => decision.type) || []);
  if (decisionTypes.length === 0) failures.push('No parsed LLM action found');
  if (!llmTraces.some((trace) => trace.parsedDecision?.situationAssessment && trace.parsedDecision?.missionAnalysis)) {
    failures.push('Parsed LLM decision missing OODA situationAssessment/missionAnalysis');
  }
  if (llmMode === 'mock') {
    if (!decisionTypes.includes('launch_search')) failures.push('Mock LLM did not request launch_search');
    if (!/(launch_search:\s*Search launched|Search launched)/.test(combinedLog)) failures.push('launch_search success evidence not found');
  }
}

function testBootstrapSource() {
  const decision = {
    situationAssessment: {
      enemy: 'No enemy contacts are known; enemy position remains unknown.',
      friendly: 'Friendly carrier task force and bases are available.',
      self: 'Carrier air group is ready for a small search.',
      battlefield: 'Clear weather supports air search.',
    },
    missionAnalysis: {
      primaryTask: 'locate enemy fleet',
      constraints: ['known information only', 'do not strike without tracked contact'],
      desiredEffect: 'create search coverage this turn',
      riskTolerance: 'medium',
    },
    availableDecisionReview: [{
      actionType: 'launch_search',
      feasible: true,
      method: 'carrier aircraft search arc',
      quantity: 4,
      constraints: ['requires ready aircraft'],
      estimatedSuccess: 'medium',
      reason: 'No contact exists yet.',
    }],
    courseOfActionAnalysis: [{
      option: 'search west',
      actionTypes: ['launch_search'],
      successEstimate: 'medium',
      risk: 'low',
      resourceUse: '4 search aircraft',
      reason: 'Best next-turn information gain.',
    }],
    selectedDecisionRationale: 'Search is the lowest-risk useful action with no contact.',
    assessment: 'No enemy contacts detected. Establish search coverage to locate potential threats.',
    intent: 'search',
    confidence: 'high',
    risk: 'medium',
    decisions: [{
      type: 'launch_search',
      fleetId: 'player_ctf_1',
      searchArcDeg: { centerDeg: 270, widthDeg: 90, range: 160 },
      priority: 1,
      reason: 'Web smoke test search order.',
    }],
    assumptions: [],
    informationGaps: ['No enemy contacts detected'],
    abortConditions: ['Carrier flight deck disabled'],
    nextReviewTurn: 2,
  };
  const content = JSON.stringify(decision);
  const mockFetch = llmMode === 'ollama' ? '' : `
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String(typeof input === 'string' ? input : input && input.url || '');
      if (url.includes('/api/chat')) {
        return new Response(JSON.stringify({ message: { role: 'assistant', content: ${JSON.stringify(content)} }, done: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('api.deepseek.com')) {
        return new Response(JSON.stringify({ error: 'DeepSeek must not be used in web smoke' }), {
          status: 599,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('api.z.ai')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ assessment: 'visual skipped', bearingSummary: '', threatRanking: [], recommendation: 'search' }) } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return originalFetch(input, init);
    };
  `;

  return `
    (() => {
      window.localStorage.setItem('llm_provider', 'ollama');
      window.localStorage.setItem('ollama_model', ${JSON.stringify(ollamaModel)});
      window.localStorage.setItem('deepseek_api_key', 'web-smoke-key');
      ${mockFetch}
      const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
      window.localStorage.setItem = (key, value) => {
        originalSetItem(key, value);
      if (key === 'naval_llm_traces') {
          try { window.__navalWebSmokeTraces = JSON.parse(value); } catch {}
        }
      };
      const originalLog = console.log.bind(console);
      console.log = (...args) => {
        window.__navalWebSmokeLog = window.__navalWebSmokeLog || [];
        window.__navalWebSmokeLog.push(args.map(String).join(' '));
        originalLog(...args);
      };
    })();
  `;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
