import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resultFiles(args: string[]): string[] {
  if (args.length > 0) {
    return args.flatMap((arg) => {
      const resolved = path.resolve(ROOT, arg);
      if (!fs.existsSync(resolved)) return [];
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        const resultPath = path.join(resolved, 'result.json');
        return fs.existsSync(resultPath) ? [resultPath] : [];
      }
      return [resolved];
    });
  }

  const evalRoot = path.join(ROOT, 'eval-runs');
  if (!fs.existsSync(evalRoot)) return [];
  return fs.readdirSync(evalRoot)
    .map((name) => path.join(evalRoot, name, 'result.json'))
    .filter((filePath) => fs.existsSync(filePath));
}

function seconds(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  return (ms / 1000).toFixed(1);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

const rows = resultFiles(process.argv.slice(2))
  .map((filePath) => {
    const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const warnings = result.verification?.qualityWarnings ?? [];
    return {
      runId: result.runId ?? path.basename(path.dirname(filePath)),
      prompt: result.prompt ?? '',
      agent: result.agent ?? '',
      model: result.model ?? '',
      effort: result.effort ?? '',
      totalSec: seconds(result.durationMs),
      agentSec: seconds(result.agentRun?.durationMs),
      agentExit: result.agentRun?.exitCode ?? '',
      statusExit: result.verification?.status?.exitCode ?? '',
      statusAfterExit: result.verification?.statusAfterBrowser?.exitCode ?? '',
      warnings,
      browser: result.verification?.screenshots?.browser?.path ?? '',
    };
  })
  .sort((a, b) => a.runId.localeCompare(b.runId));

if (rows.length === 0) {
  console.log('No eval results found.');
  process.exit(0);
}

console.log('| run | prompt | agent | model | effort | total(s) | agent(s) | exits | warnings | browser screenshot |');
console.log('| --- | --- | --- | --- | --- | ---: | ---: | --- | ---: | --- |');
for (const row of rows) {
  console.log([
    `| ${row.runId}`,
    row.prompt,
    row.agent,
    row.model,
    row.effort,
    row.totalSec,
    row.agentSec,
    `agent ${row.agentExit} / status ${row.statusExit} / after ${row.statusAfterExit}`,
    String(row.warnings.length),
    truncate(path.relative(ROOT, row.browser), 56),
  ].join(' | ') + ' |');
  for (const warning of row.warnings) {
    console.log(`|  |  |  |  |  |  |  | warning | ${truncate(String(warning), 80)} |  |`);
  }
}
