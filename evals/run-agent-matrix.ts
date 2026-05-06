import * as fs from 'fs';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';

type Agent = 'claude' | 'codex';

interface Spec {
  agent: Agent;
  model: string;
  effort: string;
}

interface Options {
  prompt: string;
  docPack: string;
  variant: string;
  specs: Spec[];
  concurrency: number;
  timeoutMin: string;
  commandTimeoutMs: string;
  browserTimeoutMs: string;
  consoleOutputLimitKb: string;
  maxBudgetUsd: string;
  outputDir: string;
  browser: boolean;
  headed: boolean;
  runGroup: string;
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
  if (agent !== 'claude' && agent !== 'codex') {
    throw new Error(`Invalid spec agent: ${value}`);
  }
  if (!model || !effort) {
    throw new Error(`Spec must be agent:model:effort, got: ${value}`);
  }
  return { agent, model, effort };
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    prompt: 'dialogue-rpg',
    docPack: 'none',
    variant: 'default',
    specs: [],
    concurrency: 3,
    timeoutMin: '12',
    commandTimeoutMs: '15000',
    browserTimeoutMs: '45000',
    consoleOutputLimitKb: '24',
    maxBudgetUsd: '5',
    outputDir: 'eval-runs',
    browser: true,
    headed: false,
    runGroup: `matrix-${timestamp()}`,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--prompt') options.prompt = argv[++i];
    else if (arg === '--doc-pack') options.docPack = argv[++i];
    else if (arg === '--variant') options.variant = argv[++i];
    else if (arg === '--spec') options.specs.push(parseSpec(argv[++i]));
    else if (arg === '--concurrency') options.concurrency = Number(argv[++i]);
    else if (arg === '--timeout-min') options.timeoutMin = argv[++i];
    else if (arg === '--command-timeout-ms') options.commandTimeoutMs = argv[++i];
    else if (arg === '--browser-timeout-ms') options.browserTimeoutMs = argv[++i];
    else if (arg === '--console-output-limit-kb') options.consoleOutputLimitKb = argv[++i];
    else if (arg === '--max-budget-usd') options.maxBudgetUsd = argv[++i];
    else if (arg === '--output-dir') options.outputDir = argv[++i];
    else if (arg === '--run-group') options.runGroup = slugify(argv[++i]);
    else if (arg === '--no-browser') options.browser = false;
    else if (arg === '--headless') options.headed = false;
    else if (arg === '--headed') options.headed = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: npx tsx evals/run-agent-matrix.ts [options]

Runs multiple eval specs in parallel. Default specs are:
  codex:gpt-5.5:high
  claude:opus:high
  claude:sonnet:high

Options:
  --prompt <name|path>          Prompt under evals/prompts, or a markdown file path (default: dialogue-rpg)
  --doc-pack <name>             Append docs to eval prompt: none, minimal, focused, current (default: none)
  --variant <name>              Architecture variant: default, single-script, separate-actors (default: default)
  --spec <agent:model:effort>   Eval spec; repeat to override defaults
  --concurrency <n>             Parallel evals (default: 3)
  --timeout-min <n>             Agent timeout in minutes (default: 12)
  --command-timeout-ms <n>      CLI command timeout (default: 15000)
  --browser-timeout-ms <n>      Browser command timeout (default: 45000)
  --console-output-limit-kb <n> Live output cap per child command stream (default: 24)
  --max-budget-usd <n>          Claude max budget per run (default: 5)
  --output-dir <dir>            Eval output root (default: eval-runs)
  --run-group <name>            Matrix group id (default: timestamped)
  --no-browser                  Skip browser verification
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
  return options;
}

interface RunResult {
  spec: Spec;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
}

function prefixStream(prefix: string, child: ChildProcess): void {
  let stdoutBuffer = '';
  let stderrBuffer = '';
  const flush = (name: 'stdout' | 'stderr', text: string, final = false) => {
    const lines = text.split(/\r?\n/);
    const completeCount = final ? lines.length : lines.length - 1;
    for (let i = 0; i < completeCount; i++) {
      if (lines[i].length > 0) process[name].write(`[${prefix}] ${lines[i]}\n`);
    }
    return final ? '' : lines[lines.length - 1];
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer = flush('stdout', stdoutBuffer + chunk.toString());
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer = flush('stderr', stderrBuffer + chunk.toString());
  });
  child.on('close', () => {
    stdoutBuffer = flush('stdout', stdoutBuffer, true);
    stderrBuffer = flush('stderr', stderrBuffer, true);
  });
}

function runSpec(spec: Spec, options: Options): Promise<RunResult> {
  const label = `${spec.agent}-${slugify(spec.model)}-${slugify(spec.effort)}`;
  const args = [
    'tsx',
    'evals/run-agent-eval.ts',
    '--agent', spec.agent,
    '--model', spec.model,
    '--effort', spec.effort,
    '--prompt', options.prompt,
    '--doc-pack', options.docPack,
    '--variant', options.variant,
    '--timeout-min', options.timeoutMin,
    '--command-timeout-ms', options.commandTimeoutMs,
    '--browser-timeout-ms', options.browserTimeoutMs,
    '--console-output-limit-kb', options.consoleOutputLimitKb,
    '--max-budget-usd', options.maxBudgetUsd,
    '--output-dir', options.outputDir,
    '--run-group', options.runGroup,
    ...(options.browser ? [] : ['--no-browser']),
    ...(options.headed ? ['--headed'] : ['--headless']),
  ];

  return new Promise((resolve) => {
    const started = Date.now();
    console.error(`[matrix] start ${label}: npx ${args.join(' ')}`);
    const child = spawn('npx', args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    prefixStream(label, child);
    child.on('close', (exitCode, signal) => {
      const durationMs = Date.now() - started;
      console.error(`[matrix] finish ${label}: exit=${exitCode ?? 'null'} signal=${signal ?? 'none'} durationMs=${durationMs}`);
      resolve({ spec, exitCode, signal, durationMs });
    });
    child.on('error', (error) => {
      const durationMs = Date.now() - started;
      console.error(`[matrix] error ${label}: ${String(error)}`);
      resolve({ spec, exitCode: null, signal: null, durationMs });
    });
  });
}

function walkResults(evalRoot: string): string[] {
  if (!fs.existsSync(evalRoot)) return [];
  const files: string[] = [];
  for (const name of fs.readdirSync(evalRoot)) {
    const resultPath = path.join(evalRoot, name, 'result.json');
    if (fs.existsSync(resultPath)) files.push(resultPath);
  }
  return files;
}

function seconds(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  return (ms / 1000).toFixed(1);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function resultTable(options: Options): string {
  const evalRoot = path.resolve(ROOT, options.outputDir);
  const rows = walkResults(evalRoot)
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8')))
    .filter((result) => result.runGroup === options.runGroup)
    .sort((a, b) => String(a.runId).localeCompare(String(b.runId)));

  const lines = [
    `# Eval Matrix ${options.runGroup}`,
    '',
    `Prompt: \`${options.prompt}\``,
    `Doc pack: \`${options.docPack}\``,
    `Variant: \`${options.variant}\``,
    '',
    '| commit | run | agent | model | effort | total(s) | agent(s) | warnings | screenshot |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |',
  ];
  for (const row of rows) {
    const warnings = row.verification?.qualityWarnings ?? [];
    const screenshot = row.verification?.screenshots?.browser?.path
      ? path.relative(ROOT, row.verification.screenshots.browser.path)
      : '';
    lines.push([
      `| ${String(row.git?.commit ?? '').slice(0, 7)}`,
      row.runId,
      row.agent,
      row.model,
      row.effort,
      seconds(row.durationMs),
      seconds(row.agentRun?.durationMs),
      String(warnings.length),
      truncate(screenshot, 56),
    ].join(' | ') + ' |');
    for (const warning of warnings) {
      lines.push(`|  |  |  |  |  |  |  | warning | ${truncate(String(warning), 80)} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const pending = [...options.specs];
  const running = new Set<Promise<RunResult>>();
  const results: RunResult[] = [];

  while (pending.length > 0 || running.size > 0) {
    while (pending.length > 0 && running.size < options.concurrency) {
      const spec = pending.shift()!;
      const promise = runSpec(spec, options).then((result) => {
        running.delete(promise);
        results.push(result);
        return result;
      });
      running.add(promise);
    }
    if (running.size > 0) await Promise.race(running);
  }

  const table = resultTable(options);
  const resultsDir = path.resolve(ROOT, options.outputDir, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const tablePath = path.join(resultsDir, `${options.runGroup}.md`);
  fs.writeFileSync(tablePath, table, 'utf8');
  console.log(table);
  console.error(`[matrix] wrote ${path.relative(ROOT, tablePath)}`);

  if (results.some((result) => result.exitCode !== 0)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
