import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const root = process.cwd();
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = join(root, 'artifacts', 'test-runs', timestamp);
const llmOutputDir = join(runDir, 'llm-outputs');
const distDir = join(root, 'dist');
const stages = [];

const defaultPorts = ['5173', '5174', '3000', '4173'];
const args = new Set(process.argv.slice(2));
const skipBuild = args.has('--no-build');

await mkdir(runDir, { recursive: true });
await mkdir(llmOutputDir, { recursive: true });
await mkdir(distDir, { recursive: true });

function commandText(command, args) {
  return [command, ...args].join(' ');
}

function runStage(name, command, args, options = {}) {
  return new Promise((resolve) => {
    const startedAt = new Date();
    const start = performance.now();
    const child = spawn(command, args, {
      cwd: root,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0', ...(options.env || {}) },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (!options.quiet) process.stdout.write(text);
    });

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (!options.quiet) process.stderr.write(text);
    });

    child.on('close', async (code, signal) => {
      const durationMs = Math.round(performance.now() - start);
      const endedAt = new Date();
      const stage = {
        name,
        command: commandText(command, args),
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs,
        exitCode: code,
        signal,
        ok: code === 0 || options.allowFailure === true,
        required: options.allowFailure !== true,
        stdout,
        stderr,
      };
      stages.push(stage);
      await writeFile(join(runDir, `${String(stages.length).padStart(2, '0')}-${name}.log`), [
        `$ ${stage.command}`,
        '',
        '# stdout',
        stdout || '(empty)',
        '',
        '# stderr',
        stderr || '(empty)',
        '',
      ].join('\n'));
      resolve(stage);
    });
  });
}

async function writeReports() {
  const failedRequired = stages.filter((stage) => stage.required && stage.exitCode !== 0);
  const summary = {
    runId: timestamp,
    root,
    llmOutputDir,
    startedAt: stages[0]?.startedAt,
    endedAt: stages[stages.length - 1]?.endedAt,
    ok: failedRequired.length === 0,
    failedRequiredStages: failedRequired.map((stage) => stage.name),
    stages: stages.map(({ stdout, stderr, ...stage }) => ({
      ...stage,
      stdoutBytes: Buffer.byteLength(stdout || ''),
      stderrBytes: Buffer.byteLength(stderr || ''),
    })),
  };

  const markdown = [
    `# Build Diagnostics ${timestamp}`,
    '',
    `- Root: \`${root}\``,
    `- LLM outputs: \`${llmOutputDir}\``,
    `- Result: ${summary.ok ? 'PASS' : 'FAIL'}`,
    `- Failed required stages: ${summary.failedRequiredStages.length ? summary.failedRequiredStages.join(', ') : 'none'}`,
    '',
    '## Stages',
    '',
    ...stages.map((stage, index) => [
      `### ${index + 1}. ${stage.name}`,
      '',
      `- Command: \`${stage.command}\``,
      `- Required: ${stage.required ? 'yes' : 'no'}`,
      `- Exit code: ${stage.exitCode}`,
      `- Duration: ${stage.durationMs}ms`,
      `- Log: \`${String(index + 1).padStart(2, '0')}-${stage.name}.log\``,
      '',
      'Last output:',
      '```text',
      tail(stage.stdout || stage.stderr || '(empty)', 40),
      '```',
      '',
    ].join('\n')),
  ].join('\n');

  await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(join(runDir, 'summary.md'), markdown);
  return summary;
}

function tail(text, maxLines) {
  const lines = text.replace(/\r\n/g, '\n').trimEnd().split('\n');
  return lines.slice(-maxLines).join('\n');
}

console.log(`Diagnostics run: ${runDir}\n`);

await runStage('git-status', 'git', ['status', '--short'], { allowFailure: true });
await runStage('port-status', 'powershell', [
  '-NoProfile',
  '-Command',
  `netstat -ano | findstr LISTENING | findstr "${defaultPorts.join(' ')}"`,
], { allowFailure: true });
await runStage('typecheck', 'npm', ['run', 'typecheck']);
await runStage('naval-regression', 'node', ['tests/run-regression.mjs']);
await runStage('ai-regression-bundle', 'npx', [
  'esbuild',
  'tests/ai-regression.ts',
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--outfile=dist/ai-regression.mjs',
]);
await runStage('ai-regression', 'node', ['dist/ai-regression.mjs']);
await runStage('llm-output-capture-bundle', 'npx', [
  'esbuild',
  'tests/llm-output-capture.ts',
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--outfile=dist/llm-output-capture.mjs',
]);
await runStage('llm-output-capture', 'node', ['dist/llm-output-capture.mjs'], {
  env: { LLM_OUTPUT_DIR: llmOutputDir },
});

if (!skipBuild) {
  await runStage('production-build', 'npm', ['run', 'build']);
}

const summary = await writeReports();
console.log(`\nDiagnostics saved to: ${runDir}`);
console.log(`Result: ${summary.ok ? 'PASS' : 'FAIL'}`);

process.exit(summary.ok ? 0 : 1);
