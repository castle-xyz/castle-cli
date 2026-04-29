import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface Profile {
  run: string;
  suite: string;
  agent: string;
  model: string;
  totalSec: string;
  agentSec: string;
  toolCalls: number;
  commands: number;
  writes: number;
  reads: number;
  searches: number;
  docsReads: number;
  installs: number;
  builds: number;
  outputTokens: number | '';
  reasoningTokens: number | '';
  cacheReadTokens: number | '';
  costUsd: string;
}

function seconds(ms: number | undefined | null): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  return (ms / 1000).toFixed(1);
}

function resultPath(arg: string): string | null {
  const resolved = path.resolve(ROOT, arg);
  if (!fs.existsSync(resolved)) return null;
  if (fs.statSync(resolved).isDirectory()) {
    const filePath = path.join(resolved, 'result.json');
    return fs.existsSync(filePath) ? filePath : null;
  }
  return resolved.endsWith('.json') ? resolved : null;
}

function findResultFiles(args: string[]): string[] {
  if (args.length > 0) return args.map(resultPath).filter((item): item is string => Boolean(item));

  const roots = [path.join(ROOT, 'eval-runs'), path.join(ROOT, 'eval-runs', 'react-smoke')];
  const files: string[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      const filePath = path.join(root, name, 'result.json');
      if (fs.existsSync(filePath)) files.push(filePath);
    }
  }
  return files;
}

function readJsonLines(filePath: string): any[] {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function isDocsPath(value: unknown): boolean {
  return typeof value === 'string' && /(^|\/)(CLAUDE\.md|AGENTS\.md|docs\/)/.test(value);
}

function commandText(item: any): string {
  return String(item?.command ?? item?.input?.command ?? '');
}

function profileResult(filePath: string): Profile {
  const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const runDir = result.runDir ?? path.dirname(filePath);
  const transcript = readJsonLines(path.join(runDir, 'transcript.jsonl'));
  const run = result.runId ?? path.basename(runDir);
  const suite = result.prompt ?? (result.stack ? `web-${result.stack}` : run.includes('react-smoke') ? 'react-smoke' : '');
  const agent = result.agent ?? result.spec?.agent ?? '';
  const model = result.model ?? result.spec?.model ?? '';
  const totalMs = result.durationMs ?? result.timings?.totalMs;
  const agentMs = result.agentRun?.durationMs ?? result.timings?.agentMs ?? result.commands?.agent?.durationMs;

  let toolCalls = 0;
  let commands = 0;
  let writes = 0;
  let reads = 0;
  let searches = 0;
  let docsReads = 0;
  let installs = 0;
  let builds = 0;
  let outputTokens: number | '' = '';
  let reasoningTokens: number | '' = '';
  let cacheReadTokens: number | '' = '';
  let costUsd = '';

  for (const event of transcript) {
    if (event.type === 'assistant') {
      for (const content of event.message?.content ?? []) {
        if (content.type !== 'tool_use') continue;
        toolCalls++;
        const name = String(content.name ?? '');
        if (name === 'Bash') commands++;
        if (name === 'Write' || name === 'Edit') writes++;
        if (name === 'Read') reads++;
        if (name === 'Glob' || name === 'Grep') searches++;
        if (isDocsPath(content.input?.file_path) || isDocsPath(content.input?.path)) docsReads++;
        const command = commandText(content);
        if (/\b(CLAUDE\.md|AGENTS\.md|docs\/)/.test(command)) docsReads++;
        if (/\bnpm\s+(install|i)\b/.test(command)) installs++;
        if (/\bnpm\s+run\s+build\b/.test(command)) builds++;
      }
    }

    if (event.type === 'item.started' || event.type === 'item.completed') {
      const item = event.item ?? {};
      if (item.type === 'command_execution') {
        if (event.type === 'item.started') {
          commands++;
          const command = commandText(item);
          if (/\bnpm\s+(install|i)\b/.test(command)) installs++;
          if (/\bnpm\s+run\s+build\b/.test(command)) builds++;
          if (/\b(rg|grep|find)\b.*\b(CLAUDE\.md|AGENTS\.md|docs\/)/.test(command)) docsReads++;
        }
      }
      if (item.type === 'file_change' && event.type === 'item.completed') {
        writes += Array.isArray(item.changes) ? item.changes.length : 1;
      }
    }

    if (event.type === 'turn.completed') {
      outputTokens = event.usage?.output_tokens ?? outputTokens;
      reasoningTokens = event.usage?.reasoning_output_tokens ?? reasoningTokens;
      cacheReadTokens = event.usage?.cached_input_tokens ?? cacheReadTokens;
    }

    if (event.type === 'result') {
      outputTokens = event.usage?.output_tokens ?? outputTokens;
      cacheReadTokens = event.usage?.cache_read_input_tokens ?? cacheReadTokens;
      costUsd = event.total_cost_usd !== undefined ? String(event.total_cost_usd) : costUsd;
    }
  }

  return {
    run,
    suite,
    agent,
    model,
    totalSec: seconds(totalMs),
    agentSec: seconds(agentMs),
    toolCalls,
    commands,
    writes,
    reads,
    searches,
    docsReads,
    installs,
    builds,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    costUsd,
  };
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

const profiles = findResultFiles(process.argv.slice(2))
  .map(profileResult)
  .sort((a, b) => a.run.localeCompare(b.run));

if (profiles.length === 0) {
  console.log('No result.json files found.');
  process.exit(0);
}

console.log('| run | suite | agent | model | total(s) | agent(s) | tools | cmds | writes | reads | searches | docs | npm i | build | output | reasoning | cache read | cost |');
console.log('| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const profile of profiles) {
  console.log([
    `| ${truncate(profile.run, 48)}`,
    profile.suite,
    profile.agent,
    profile.model,
    profile.totalSec,
    profile.agentSec,
    String(profile.toolCalls),
    String(profile.commands),
    String(profile.writes),
    String(profile.reads),
    String(profile.searches),
    String(profile.docsReads),
    String(profile.installs),
    String(profile.builds),
    String(profile.outputTokens),
    String(profile.reasoningTokens),
    String(profile.cacheReadTokens),
    profile.costUsd,
  ].join(' | ') + ' |');
}
