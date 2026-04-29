import * as fs from 'fs';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';

interface Options {
  prompt: string;
  model: string;
  timeoutMs: number;
  commandTimeoutMs: number;
  browserTimeoutMs: number;
  maxBudgetUsd: string;
  outputDir: string;
  browser: boolean;
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv: string[]): Options {
  const options: Options = {
    prompt: 'breakout',
    model: 'sonnet',
    timeoutMs: 20 * 60 * 1000,
    commandTimeoutMs: 30 * 1000,
    browserTimeoutMs: 90 * 1000,
    maxBudgetUsd: '5',
    outputDir: 'eval-runs',
    browser: true,
    headed: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--prompt') options.prompt = argv[++i];
    else if (arg === '--model') options.model = argv[++i];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++i]);
    else if (arg === '--timeout-min') options.timeoutMs = Number(argv[++i]) * 60 * 1000;
    else if (arg === '--command-timeout-ms') options.commandTimeoutMs = Number(argv[++i]);
    else if (arg === '--browser-timeout-ms') options.browserTimeoutMs = Number(argv[++i]);
    else if (arg === '--max-budget-usd') options.maxBudgetUsd = argv[++i];
    else if (arg === '--output-dir') options.outputDir = argv[++i];
    else if (arg === '--no-browser') options.browser = false;
    else if (arg === '--headless') options.headed = false;
    else if (arg === '--headed') options.headed = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: npx tsx evals/run-agent-eval.ts [options]

Options:
  --prompt <name|path>          Prompt under evals/prompts, or a markdown file path (default: breakout)
  --model <name>                Claude model alias/name (default: sonnet)
  --timeout-min <n>             Agent timeout in minutes (default: 20)
  --timeout-ms <n>              Agent timeout in milliseconds
  --command-timeout-ms <n>      CLI command timeout (default: 30000)
  --browser-timeout-ms <n>      Browser verification timeout per command (default: 90000)
  --max-budget-usd <n>          Claude max budget (default: 5)
  --output-dir <dir>            Eval output root (default: eval-runs)
  --no-browser                  Skip agent-browser verification
  --headless                    Run agent-browser headless
  --headed                      Run agent-browser headed (default)`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('timeout must be positive');
  }
  return options;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'eval';
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').replace('Z', '');
}

function promptPath(prompt: string): string {
  if (prompt.endsWith('.md') || prompt.includes(path.sep)) return path.resolve(ROOT, prompt);
  return path.join(ROOT, 'evals', 'prompts', `${prompt}.md`);
}

function readJsonIfExists(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
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

function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; stdoutPath?: string; stderrPath?: string }
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let timedOut = false;
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutStream = options.stdoutPath ? fs.createWriteStream(options.stdoutPath) : null;
    const stderrStream = options.stderrPath ? fs.createWriteStream(options.stderrPath) : null;
    const timeout = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      stdoutStream?.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      stderrStream?.write(chunk);
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout);
      stdoutStream?.end();
      stderrStream?.end();
      resolve({
        command,
        args,
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - started,
        stdout,
        stderr,
      });
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      stdoutStream?.end();
      stderrStream?.end();
      resolve({
        command,
        args,
        exitCode: null,
        signal: null,
        timedOut,
        durationMs: Date.now() - started,
        stdout,
        stderr: stderr + String(error),
      });
    });
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const promptFile = promptPath(options.prompt);
  const promptName = slugify(path.basename(promptFile, '.md'));
  const runId = `${timestamp()}-${promptName}-${slugify(options.model)}`;
  const runDir = path.resolve(ROOT, options.outputDir, runId);
  const deckDir = path.join(runDir, 'deck');
  fs.mkdirSync(runDir, { recursive: true });

  const taskPrompt = fs.readFileSync(promptFile, 'utf8');
  const fullPrompt = `You are running an automated Castle CLI 4 eval.

Eval run directory: ${path.relative(ROOT, runDir)}
Eval deck directory: ${path.relative(ROOT, deckDir)}

Follow the task below exactly. Keep all generated deck/game files inside the eval deck directory. Do not edit repo source files unless you hit a real CLI bug that blocks the task. If you start local serve, leave it running so verification can inspect it.

Task:
${taskPrompt}

Finish by printing a short summary with the local serve URL, what you changed, and any remaining problems.`;

  fs.writeFileSync(path.join(runDir, 'prompt.md'), fullPrompt, 'utf8');

  const startedAt = new Date().toISOString();
  const agent = await runCommand(
    'claude',
    [
      '-p',
      '--model',
      options.model,
      '--output-format',
      'stream-json',
      '--permission-mode',
      'acceptEdits',
      '--max-budget-usd',
      options.maxBudgetUsd,
      fullPrompt,
    ],
    {
      cwd: ROOT,
      timeoutMs: options.timeoutMs,
      stdoutPath: path.join(runDir, 'transcript.jsonl'),
      stderrPath: path.join(runDir, 'claude.stderr.log'),
    }
  );

  const status = await runCommand('npx', ['tsx', 'src/index.ts', 'status'], {
    cwd: ROOT,
    timeoutMs: options.commandTimeoutMs,
    stdoutPath: path.join(runDir, 'status.log'),
    stderrPath: path.join(runDir, 'status.stderr.log'),
  });
  const logs = await runCommand('npx', ['tsx', 'src/index.ts', 'logs'], {
    cwd: ROOT,
    timeoutMs: options.commandTimeoutMs,
    stdoutPath: path.join(runDir, 'logs.txt'),
    stderrPath: path.join(runDir, 'logs.stderr.log'),
  });

  const serveInfo = readJsonIfExists(path.join(deckDir, '.castle', 'serve.json'));
  const browserResults: CommandResult[] = [];
  if (options.browser && serveInfo?.url) {
    const session = `cli4-eval-${runId}`;
    const browserBaseArgs = [
      'agent-browser',
      '--session',
      session,
      ...(options.headed ? ['--headed', '--args', '--disable-infobars'] : []),
    ];
    browserResults.push(await runCommand('npx', [...browserBaseArgs, 'open', serveInfo.url], {
      cwd: ROOT,
      timeoutMs: options.browserTimeoutMs,
      stdoutPath: path.join(runDir, 'browser-open.log'),
      stderrPath: path.join(runDir, 'browser-open.stderr.log'),
    }));
    browserResults.push(await runCommand('npx', [...browserBaseArgs, 'wait', '3000'], {
      cwd: ROOT,
      timeoutMs: options.browserTimeoutMs,
      stdoutPath: path.join(runDir, 'browser-wait.log'),
      stderrPath: path.join(runDir, 'browser-wait.stderr.log'),
    }));
    browserResults.push(await runCommand('npx', [...browserBaseArgs, 'eval', '(() => { const canvas = document.querySelector("canvas"); if (!canvas) return { hasCanvas: false }; const rect = canvas.getBoundingClientRect(); return { hasCanvas: true, width: canvas.width, height: canvas.height, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, url: location.href, title: document.title }; })()'], {
      cwd: ROOT,
      timeoutMs: options.browserTimeoutMs,
      stdoutPath: path.join(runDir, 'browser-canvas.json'),
      stderrPath: path.join(runDir, 'browser-canvas.stderr.log'),
    }));
    browserResults.push(await runCommand('npx', [...browserBaseArgs, 'console'], {
      cwd: ROOT,
      timeoutMs: options.browserTimeoutMs,
      stdoutPath: path.join(runDir, 'browser-console.log'),
      stderrPath: path.join(runDir, 'browser-console.stderr.log'),
    }));
    browserResults.push(await runCommand('npx', [...browserBaseArgs, 'errors'], {
      cwd: ROOT,
      timeoutMs: options.browserTimeoutMs,
      stdoutPath: path.join(runDir, 'browser-errors.log'),
      stderrPath: path.join(runDir, 'browser-errors.stderr.log'),
    }));
    browserResults.push(await runCommand('npx', [...browserBaseArgs, 'screenshot', path.join(runDir, 'screenshot.png')], {
      cwd: ROOT,
      timeoutMs: options.browserTimeoutMs,
      stdoutPath: path.join(runDir, 'browser-screenshot.log'),
      stderrPath: path.join(runDir, 'browser-screenshot.stderr.log'),
    }));
  }

  const endedAt = new Date().toISOString();
  const result = {
    runId,
    prompt: options.prompt,
    promptFile,
    model: options.model,
    startedAt,
    endedAt,
    durationMs: Date.parse(endedAt) - Date.parse(startedAt),
    timeouts: {
      agentMs: options.timeoutMs,
      commandMs: options.commandTimeoutMs,
      browserMs: options.browserTimeoutMs,
    },
    runDir,
    deckDir,
    serveInfo,
    agent: {
      exitCode: agent.exitCode,
      signal: agent.signal,
      timedOut: agent.timedOut,
      durationMs: agent.durationMs,
    },
    verification: {
      status: {
        exitCode: status.exitCode,
        timedOut: status.timedOut,
        durationMs: status.durationMs,
      },
      logs: {
        exitCode: logs.exitCode,
        timedOut: logs.timedOut,
        durationMs: logs.durationMs,
      },
      browser: browserResults.map((item) => ({
        command: [item.command, ...item.args].join(' '),
        exitCode: item.exitCode,
        signal: item.signal,
        timedOut: item.timedOut,
        durationMs: item.durationMs,
      })),
    },
  };

  fs.writeFileSync(path.join(runDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));

  if (agent.timedOut || agent.exitCode !== 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
