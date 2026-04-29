import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';

type Agent = 'claude' | 'codex';
type Stack = 'react' | 'canvas' | 'pixi';

interface Spec {
  agent: Agent;
  model: string;
  effort: string;
}

interface Options {
  stack: Stack;
  specs: Spec[];
  concurrency: number;
  timeoutMin: number;
  commandTimeoutMs: number;
  browserTimeoutMs: number;
  consoleOutputLimitKb: number;
  maxBudgetUsd: string;
  outputDir: string;
  runGroup: string;
  headed: boolean;
}

interface CommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}

interface RunResult {
  runId: string;
  stack: Stack;
  spec: Spec;
  runDir: string;
  appDir: string;
  url: string | null;
  timings: {
    totalMs: number;
    agentMs: number;
    installMs: number | null;
    buildMs: number | null;
    serverReadyMs: number | null;
    browserMs: number | null;
  };
  commands: Record<string, CommandResult | null>;
  warnings: string[];
  screenshot: string | null;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'eval';
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').replace('Z', '');
}

function parseSpec(value: string): Spec {
  const [agent, model, effort] = value.split(':');
  if (agent !== 'claude' && agent !== 'codex') throw new Error(`Invalid agent in spec: ${value}`);
  if (!model || !effort) throw new Error(`Spec must be agent:model:effort, got: ${value}`);
  return { agent, model, effort };
}

function parseStack(value: string): Stack {
  if (value === 'react' || value === 'canvas' || value === 'pixi') return value;
  throw new Error(`Invalid stack: ${value}`);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    stack: 'react',
    specs: [],
    concurrency: 3,
    timeoutMin: 8,
    commandTimeoutMs: 120_000,
    browserTimeoutMs: 45_000,
    consoleOutputLimitKb: 24,
    maxBudgetUsd: '5',
    outputDir: 'eval-runs/web-smoke',
    runGroup: `web-smoke-${timestamp()}`,
    headed: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stack') options.stack = parseStack(argv[++i]);
    else if (arg === '--spec') options.specs.push(parseSpec(argv[++i]));
    else if (arg === '--concurrency') options.concurrency = Number(argv[++i]);
    else if (arg === '--timeout-min') options.timeoutMin = Number(argv[++i]);
    else if (arg === '--command-timeout-ms') options.commandTimeoutMs = Number(argv[++i]);
    else if (arg === '--browser-timeout-ms') options.browserTimeoutMs = Number(argv[++i]);
    else if (arg === '--console-output-limit-kb') options.consoleOutputLimitKb = Number(argv[++i]);
    else if (arg === '--max-budget-usd') options.maxBudgetUsd = argv[++i];
    else if (arg === '--output-dir') options.outputDir = argv[++i];
    else if (arg === '--run-group') options.runGroup = slugify(argv[++i]);
    else if (arg === '--headed') options.headed = true;
    else if (arg === '--headless') options.headed = false;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: npx tsx evals/run-react-smoke-matrix.ts [options]

Runs a quick web app smoke eval with the same default model matrix as CLI 4:
  codex:gpt-5.5:high
  claude:opus:high
  claude:sonnet:high

Options:
  --stack <react|canvas|pixi>   Rendering stack to ask for (default: react)
  --spec <agent:model:effort>   Eval spec; repeat to override defaults
  --concurrency <n>             Parallel evals (default: 3)
  --timeout-min <n>             Agent timeout in minutes (default: 8)
  --command-timeout-ms <n>      npm command timeout (default: 120000)
  --browser-timeout-ms <n>      agent-browser command timeout (default: 45000)
  --console-output-limit-kb <n> Live output cap per stream (default: 24)
  --max-budget-usd <n>          Claude max budget per run (default: 5)
  --output-dir <dir>            Eval output root (default: eval-runs/web-smoke)
  --run-group <name>            Matrix group id (default: timestamped)
  --headless                    Run agent-browser headless (default)
  --headed                      Run agent-browser headed`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.specs.length === 0) {
    options.specs = [
      { agent: 'codex', model: 'gpt-5.5', effort: 'high' },
      { agent: 'claude', model: 'opus', effort: 'high' },
      { agent: 'claude', model: 'sonnet', effort: 'high' },
    ];
  }
  if (!Number.isFinite(options.concurrency) || options.concurrency <= 0) {
    throw new Error('concurrency must be positive');
  }
  if (!Number.isFinite(options.timeoutMin) || options.timeoutMin <= 0) {
    throw new Error('timeout-min must be positive');
  }
  return options;
}

function streamChunk(
  label: string,
  streamName: 'stdout' | 'stderr',
  chunk: Buffer,
  output: NodeJS.WriteStream,
  state: { bytes: number; truncated: boolean },
  limitBytes: number,
): void {
  if (state.bytes >= limitBytes) {
    if (!state.truncated) {
      state.truncated = true;
      output.write(`[${label} ${streamName}] live output truncated after ${limitBytes} bytes\n`);
    }
    return;
  }

  const remaining = limitBytes - state.bytes;
  const printable = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
  state.bytes += printable.length;
  for (const line of printable.toString().split(/\r?\n/)) {
    if (line.length > 0) output.write(`[${label} ${streamName}] ${line}\n`);
  }
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      try { child.kill('SIGKILL'); } catch {}
    }
  }, 5000).unref();
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(' ');
}

function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    label: string;
    stdoutPath?: string;
    stderrPath?: string;
    consoleOutputLimitBytes: number;
    env?: NodeJS.ProcessEnv;
  },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const stdoutState = { bytes: 0, truncated: false };
    const stderrState = { bytes: 0, truncated: false };
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    console.error(`[react-smoke] start ${options.label}: ${formatCommand(command, args)}`);
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutStream = options.stdoutPath ? fs.createWriteStream(options.stdoutPath) : null;
    const stderrStream = options.stderrPath ? fs.createWriteStream(options.stderrPath) : null;
    const timeout = setTimeout(() => {
      timedOut = true;
      console.error(`[react-smoke] timeout ${options.label} after ${options.timeoutMs}ms`);
      killProcessTree(child);
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      stdoutStream?.write(chunk);
      streamChunk(options.label, 'stdout', chunk, process.stdout, stdoutState, options.consoleOutputLimitBytes);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      stderrStream?.write(chunk);
      streamChunk(options.label, 'stderr', chunk, process.stderr, stderrState, options.consoleOutputLimitBytes);
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout);
      stdoutStream?.end();
      stderrStream?.end();
      const durationMs = Date.now() - started;
      console.error(`[react-smoke] finish ${options.label}: exit=${exitCode ?? 'null'} signal=${signal ?? 'none'} timedOut=${timedOut} durationMs=${durationMs}`);
      resolve({ command, args, exitCode, signal, timedOut, durationMs, stdout, stderr });
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      stdoutStream?.end();
      stderrStream?.end();
      const durationMs = Date.now() - started;
      stderr += String(error);
      console.error(`[react-smoke] error ${options.label}: ${String(error)}`);
      resolve({ command, args, exitCode: null, signal: null, timedOut, durationMs, stdout, stderr });
    });
  });
}

function buildAgentCommand(spec: Spec, fullPrompt: string, runDir: string, options: Options): { command: string; args: string[]; stderrPath: string } {
  if (spec.agent === 'claude') {
    return {
      command: 'claude',
      args: [
        '-p',
        '--model', spec.model,
        '--effort', spec.effort,
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', 'bypassPermissions',
        '--max-budget-usd', options.maxBudgetUsd,
        fullPrompt,
      ],
      stderrPath: path.join(runDir, 'claude.stderr.log'),
    };
  }

  return {
    command: 'codex',
    args: [
      'exec',
      '--json',
      '--model', spec.model,
      '-c', `model_reasoning_effort="${spec.effort}"`,
      '--dangerously-bypass-approvals-and-sandbox',
      '--cd', runDir,
      '--output-last-message', path.join(runDir, 'codex-last-message.txt'),
      fullPrompt,
    ],
    stderrPath: path.join(runDir, 'codex.stderr.log'),
  };
}

function stackInstructions(stack: Stack): string {
  if (stack === 'react') {
    return `Use Vite + React. Build the scene and dialogue UI as React components. TypeScript or JavaScript is fine.`;
  }
  if (stack === 'canvas') {
    return `Use Vite with plain HTML/CSS/JavaScript and the browser Canvas 2D API. Do not use React, Pixi, Phaser, or another rendering library. Draw the room/player/NPC scene on a <canvas>, and use ordinary DOM for the dialogue panel, advance control, and state readout.`;
  }
  return `Use Vite with PixiJS for the rendered room/player/NPC scene. Do not use React. Use ordinary DOM for the dialogue panel, advance control, and state readout, and PixiJS only for the game scene canvas.`;
}

function promptFor(appDir: string, stack: Stack): string {
  return `You are running an automated ${stack} first-shot smoke eval.

Working directory: ${path.dirname(appDir)}
App directory to create/edit: ${appDir}

Create a tiny web app from scratch in the app directory. Do not edit files outside that app directory.

Requirements:
- ${stackInstructions(stack)}
- Keep it fast: no heavyweight UI libraries, no backend, no external docs unless absolutely needed.
- The app should feel like a tiny dialogue RPG scene: a room, a visible player, an NPC, and an obvious dialogue panel.
- Include at least three dialogue beats and one simple choice or branch.
- Clicking/tapping should advance dialogue or choose a branch.
- Add a visible control with data-testid="advance" that advances or chooses dialogue.
- Add a visible state/readout element with data-testid="state" whose text changes after the advance control is clicked.
- Make the first screen screenshot-friendly: readable text, stable layout, and enough visual detail to judge quality.
- Provide npm scripts for "dev" and "build".
- Do not open a browser and do not run a long-lived foreground dev server. The harness will install if needed, start the server, and verify with agent-browser.

Finish by printing a short summary of what you built and any remaining problems.`;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('could not allocate a port')));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function waitForUrl(url: string, timeoutMs: number): Promise<{ ready: boolean; durationMs: number }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve({ ready: true, durationMs: Date.now() - started });
      });
      req.on('error', () => {
        if (Date.now() - started >= timeoutMs) {
          resolve({ ready: false, durationMs: Date.now() - started });
        } else {
          setTimeout(tryOnce, 300);
        }
      });
      req.setTimeout(1000, () => {
        req.destroy();
      });
    };
    tryOnce();
  });
}

function readPackageJson(appDir: string): any | null {
  const packagePath = path.join(appDir, 'package.json');
  if (!fs.existsSync(packagePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch {
    return null;
  }
}

function packageAppDir(runDir: string): string {
  const expected = path.join(runDir, 'app');
  if (fs.existsSync(path.join(expected, 'package.json'))) return expected;
  if (fs.existsSync(path.join(runDir, 'package.json'))) return runDir;
  return expected;
}

function writeText(filePath: string, text: string): void {
  fs.writeFileSync(filePath, text, 'utf8');
}

async function verifyBrowser(args: {
  runId: string;
  runDir: string;
  url: string;
  screenshotPath: string;
  options: Options;
}): Promise<{ commands: Record<string, CommandResult>; durationMs: number; warnings: string[] }> {
  const started = Date.now();
  const warnings: string[] = [];
  const commands: Record<string, CommandResult> = {};
  const session = `web-${crypto.createHash('sha1').update(args.runId).digest('hex').slice(0, 10)}`;
  const baseArgs = [
    'agent-browser',
    '--session', session,
    ...(args.options.headed ? ['--headed', '--args', '--disable-infobars'] : []),
  ];
  const runBrowser = async (name: string, browserArgs: string[]) => {
    const result = await runCommand('npx', [...baseArgs, ...browserArgs], {
      cwd: ROOT,
      timeoutMs: args.options.browserTimeoutMs,
      label: name,
      stdoutPath: path.join(args.runDir, `${name}.log`),
      stderrPath: path.join(args.runDir, `${name}.stderr.log`),
      consoleOutputLimitBytes: args.options.consoleOutputLimitKb * 1024,
    });
    commands[name] = result;
    if (result.exitCode !== 0 || result.timedOut) warnings.push(`${name} failed`);
    return result;
  };

  try {
    await runBrowser('browser-open', ['open', args.url]);
    await runBrowser('browser-wait', ['wait', '1000']);
    const before = await runBrowser('browser-text-before', ['get', 'text', 'body']);
    if (before.stdout.trim().length < 40) warnings.push('body text is very short before interaction');
    await runBrowser('browser-click-advance', ['click', '[data-testid="advance"]']);
    await runBrowser('browser-post-click-wait', ['wait', '300']);
    const state = await runBrowser('browser-state-after', ['get', 'text', '[data-testid="state"]']);
    if (state.stdout.trim().length < 3) warnings.push('state readout is missing or very short after click');
    await runBrowser('browser-screenshot', ['screenshot', args.screenshotPath]);
    await runBrowser('browser-console', ['console']);
    await runBrowser('browser-errors', ['errors']);
  } finally {
    await runBrowser('browser-close', ['close']);
  }

  return { commands, durationMs: Date.now() - started, warnings };
}

async function runSpec(spec: Spec, options: Options): Promise<RunResult> {
  const runId = `${timestamp()}-${options.runGroup}-${options.stack}-smoke-${spec.agent}-${slugify(spec.model)}-${slugify(spec.effort)}`;
  const runDir = path.resolve(ROOT, options.outputDir, runId);
  const expectedAppDir = path.join(runDir, 'app');
  const screenshotDir = path.join(runDir, 'screenshots');
  fs.mkdirSync(expectedAppDir, { recursive: true });
  fs.mkdirSync(screenshotDir, { recursive: true });

  const started = Date.now();
  const commands: Record<string, CommandResult | null> = {};
  const warnings: string[] = [];
  const prompt = promptFor(expectedAppDir, options.stack);
  writeText(path.join(runDir, 'prompt.md'), prompt);

  const agentCommand = buildAgentCommand(spec, prompt, runDir, options);
  const agent = await runCommand(agentCommand.command, agentCommand.args, {
    cwd: runDir,
    timeoutMs: options.timeoutMin * 60_000,
    label: `${spec.agent}-${slugify(spec.model)}-${slugify(spec.effort)}`,
    stdoutPath: path.join(runDir, 'transcript.jsonl'),
    stderrPath: agentCommand.stderrPath,
    consoleOutputLimitBytes: options.consoleOutputLimitKb * 1024,
  });
  commands.agent = agent;
  if (agent.exitCode !== 0 || agent.timedOut) warnings.push('agent failed or timed out');

  const appDir = packageAppDir(runDir);
  const packageJson = readPackageJson(appDir);
  if (!packageJson) warnings.push('package.json missing');
  if (appDir !== expectedAppDir) warnings.push('agent created app outside the requested app directory');

  let install: CommandResult | null = null;
  let build: CommandResult | null = null;
  let serverReadyMs: number | null = null;
  let browserMs: number | null = null;
  let url: string | null = null;
  let server: ChildProcess | null = null;
  const screenshotPath = path.join(screenshotDir, 'browser.png');

  try {
    if (packageJson && !fs.existsSync(path.join(appDir, 'node_modules'))) {
      install = await runCommand('npm', ['install'], {
        cwd: appDir,
        timeoutMs: options.commandTimeoutMs,
        label: `${spec.agent}-${slugify(spec.model)}-npm-install`,
        stdoutPath: path.join(runDir, 'npm-install.log'),
        stderrPath: path.join(runDir, 'npm-install.stderr.log'),
        consoleOutputLimitBytes: options.consoleOutputLimitKb * 1024,
      });
      commands.install = install;
      if (install.exitCode !== 0 || install.timedOut) warnings.push('npm install failed or timed out');
    }

    const freshPackageJson = readPackageJson(appDir);
    if (freshPackageJson?.scripts?.build) {
      build = await runCommand('npm', ['run', 'build'], {
        cwd: appDir,
        timeoutMs: options.commandTimeoutMs,
        label: `${spec.agent}-${slugify(spec.model)}-npm-build`,
        stdoutPath: path.join(runDir, 'npm-build.log'),
        stderrPath: path.join(runDir, 'npm-build.stderr.log'),
        consoleOutputLimitBytes: options.consoleOutputLimitKb * 1024,
      });
      commands.build = build;
      if (build.exitCode !== 0 || build.timedOut) warnings.push('npm build failed or timed out');
    } else {
      warnings.push('build script missing');
    }

    if (freshPackageJson?.scripts?.dev) {
      const port = await findFreePort();
      url = `http://127.0.0.1:${port}`;
      const serverOut = fs.openSync(path.join(runDir, 'dev-server.log'), 'a');
      const serverErr = fs.openSync(path.join(runDir, 'dev-server.stderr.log'), 'a');
      server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
        cwd: appDir,
        detached: true,
        stdio: ['ignore', serverOut, serverErr],
      });
      const ready = await waitForUrl(url, options.commandTimeoutMs);
      serverReadyMs = ready.durationMs;
      if (!ready.ready) {
        warnings.push('dev server did not become ready');
      } else {
        const browser = await verifyBrowser({
          runId,
          runDir,
          url,
          screenshotPath,
          options,
        });
        browserMs = browser.durationMs;
        for (const [name, result] of Object.entries(browser.commands)) commands[name] = result;
        warnings.push(...browser.warnings);
      }
    } else {
      warnings.push('dev script missing');
    }
  } finally {
    if (server) killProcessTree(server);
  }

  const result: RunResult = {
    runId,
    stack: options.stack,
    spec,
    runDir,
    appDir,
    url,
    timings: {
      totalMs: Date.now() - started,
      agentMs: agent.durationMs,
      installMs: install?.durationMs ?? null,
      buildMs: build?.durationMs ?? null,
      serverReadyMs,
      browserMs,
    },
    commands,
    warnings,
    screenshot: fs.existsSync(screenshotPath) ? screenshotPath : null,
  };
  writeText(path.join(runDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function seconds(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  return (ms / 1000).toFixed(1);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function writeSummary(options: Options, results: RunResult[]): string {
  const lines = [
    `# Web Smoke Matrix ${options.runGroup}`,
    '',
    `Stack: \`${options.stack}\``,
    '',
    '| run | stack | agent | model | effort | total(s) | agent(s) | install(s) | build(s) | browser(s) | warnings | screenshot |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const result of results.sort((a, b) => a.runId.localeCompare(b.runId))) {
    lines.push([
      `| ${result.runId}`,
      result.stack,
      result.spec.agent,
      result.spec.model,
      result.spec.effort,
      seconds(result.timings.totalMs),
      seconds(result.timings.agentMs),
      seconds(result.timings.installMs),
      seconds(result.timings.buildMs),
      seconds(result.timings.browserMs),
      String(result.warnings.length),
      result.screenshot ? truncate(path.relative(ROOT, result.screenshot), 60) : '',
    ].join(' | ') + ' |');
    for (const warning of result.warnings) {
      lines.push(`|  |  |  |  |  |  |  |  |  |  | warning | ${truncate(warning, 80)} |`);
    }
  }

  const summaryPath = path.join(ROOT, 'eval-runs', 'results', `${options.runGroup}.md`);
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  writeText(summaryPath, `${lines.join('\n')}\n`);
  return summaryPath;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const queue = [...options.specs];
  const results: RunResult[] = [];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const spec = queue.shift();
      if (!spec) return;
      try {
        results.push(await runSpec(spec, options));
      } catch (error: any) {
        console.error(`[web-smoke] failed ${options.stack}:${spec.agent}:${spec.model}:${spec.effort}: ${error?.stack || error}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(options.concurrency, options.specs.length) }, () => worker()));
  const summaryPath = writeSummary(options, results);
  console.log(fs.readFileSync(summaryPath, 'utf8'));
  console.error(`[react-smoke] wrote ${path.relative(ROOT, summaryPath)}`);
  if (results.some((result) => result.commands.agent?.timedOut || result.commands.agent?.exitCode !== 0)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
