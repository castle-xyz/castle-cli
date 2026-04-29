import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';

type Agent = 'claude' | 'codex';

interface Options {
  agent: Agent;
  prompt: string;
  model: string;
  effort: string;
  timeoutMs: number;
  commandTimeoutMs: number;
  browserTimeoutMs: number;
  maxBudgetUsd: string;
  outputDir: string;
  browser: boolean;
  headed: boolean;
  consoleOutputLimitBytes: number;
  runGroup?: string;
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
const CANVAS_BOX_SCRIPT = `(() => {
  const canvas = document.querySelector("canvas");
  if (!canvas) return { hasCanvas: false };
  const rect = canvas.getBoundingClientRect();
  return {
    hasCanvas: true,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    centerX: rect.x + rect.width / 2,
    centerY: rect.y + rect.height / 2,
  };
})()`;
const CANVAS_PROBE_SCRIPT = `(async () => {
  const canvas = document.querySelector("canvas");
  if (!canvas) return { hasCanvas: false };
  const rect = canvas.getBoundingClientRect();
  const result = {
    hasCanvas: true,
    width: canvas.width,
    height: canvas.height,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    url: location.href,
    title: document.title,
    dataUrlLength: 0,
    sample: null,
    error: null,
  };
  try {
    const dataUrl = canvas.toDataURL("image/png");
    result.dataUrlLength = dataUrl.length;
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = dataUrl;
    });
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = 64;
    sampleCanvas.height = 64;
    const ctx = sampleCanvas.getContext("2d");
    ctx.drawImage(img, 0, 0, 64, 64);
    const pixels = ctx.getImageData(0, 0, 64, 64).data;
    let nonTransparent = 0;
    let nonBlack = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      if (a > 5) nonTransparent++;
      if (a > 5 && r + g + b > 30) nonBlack++;
    }
    result.sample = {
      pixels: 64 * 64,
      nonTransparent,
      nonBlack,
      nonTransparentRatio: nonTransparent / (64 * 64),
      nonBlackRatio: nonBlack / (64 * 64),
    };
  } catch (error) {
    result.error = String(error && error.message ? error.message : error);
  }
  return result;
})()`;

function parseArgs(argv: string[]): Options {
  const options: Omit<Options, 'model'> & { model?: string } = {
    agent: 'claude',
    prompt: 'breakout',
    effort: 'medium',
    timeoutMs: 20 * 60 * 1000,
    commandTimeoutMs: 30 * 1000,
    browserTimeoutMs: 90 * 1000,
    maxBudgetUsd: '5',
    outputDir: 'eval-runs',
    browser: true,
    headed: false,
    consoleOutputLimitBytes: 96 * 1024,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--agent') options.agent = parseAgent(argv[++i]);
    else if (arg === '--prompt') options.prompt = argv[++i];
    else if (arg === '--model') options.model = argv[++i];
    else if (arg === '--effort') options.effort = argv[++i];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++i]);
    else if (arg === '--timeout-min') options.timeoutMs = Number(argv[++i]) * 60 * 1000;
    else if (arg === '--command-timeout-ms') options.commandTimeoutMs = Number(argv[++i]);
    else if (arg === '--browser-timeout-ms') options.browserTimeoutMs = Number(argv[++i]);
    else if (arg === '--max-budget-usd') options.maxBudgetUsd = argv[++i];
    else if (arg === '--output-dir') options.outputDir = argv[++i];
    else if (arg === '--console-output-limit-kb') options.consoleOutputLimitBytes = Number(argv[++i]) * 1024;
    else if (arg === '--run-group') options.runGroup = slugify(argv[++i]);
    else if (arg === '--no-browser') options.browser = false;
    else if (arg === '--headless') options.headed = false;
    else if (arg === '--headed') options.headed = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: npx tsx evals/run-agent-eval.ts [options]

Options:
  --agent <claude|codex>        Agent CLI to run (default: claude)
  --prompt <name|path>          Prompt under evals/prompts, or a markdown file path (default: breakout)
  --model <name>                Model alias/name (default: sonnet for Claude, gpt-5.4 for Codex)
  --effort <level>              Reasoning effort (default: medium)
  --timeout-min <n>             Agent timeout in minutes (default: 20)
  --timeout-ms <n>              Agent timeout in milliseconds
  --command-timeout-ms <n>      CLI command timeout (default: 30000)
  --browser-timeout-ms <n>      Browser verification timeout per command (default: 90000)
  --max-budget-usd <n>          Claude max budget (default: 5)
  --output-dir <dir>            Eval output root (default: eval-runs)
  --console-output-limit-kb <n> Live console output limit per command stream (default: 96)
  --run-group <name>            Add a group slug to the run id for matrix batches
  --no-browser                  Skip agent-browser verification
  --headless                    Run agent-browser headless (default)
  --headed                      Run agent-browser headed`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('timeout must be positive');
  }
  if (!Number.isFinite(options.consoleOutputLimitBytes) || options.consoleOutputLimitBytes < 0) {
    throw new Error('console output limit must be zero or positive');
  }
  return {
    ...options,
    model: options.model || (options.agent === 'codex' ? 'gpt-5.4' : 'sonnet'),
  };
}

function parseAgent(value: string): Agent {
  if (value === 'claude' || value === 'codex') return value;
  throw new Error(`Unknown agent: ${value}`);
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

function gitOutput(args: string[]): string {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) return '';
  return result.stdout.trim();
}

function readJsonIfExists(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

interface PngPixelStats {
  pixels: number;
  sampledPixels: number;
  nonTransparent: number;
  nonBlack: number;
  nonTransparentRatio: number;
  nonBlackRatio: number;
  uniqueColors: number;
  mostCommonColor: string;
  mostCommonRatio: number;
  meanLuma: number;
  lumaStdDev: number;
}

interface PngInfo {
  path: string;
  exists: boolean;
  bytes: number;
  width?: number;
  height?: number;
  isPng?: boolean;
  pixelStats?: PngPixelStats;
  pixelStatsError?: string;
  region?: PngRegion;
}

interface PngRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasBox {
  hasCanvas?: boolean;
  width?: number;
  height?: number;
  centerX?: number;
  centerY?: number;
}

interface ScriptWarning {
  file: string;
  line: number;
  pattern: string;
  message: string;
  text: string;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function readPngPixelStats(buffer: Buffer, width: number, height: number, region?: PngRegion): PngPixelStats {
  let offset = 8;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idatChunks: Buffer[] = [];

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) break;
    if (type === 'IHDR') {
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
      interlace = buffer[dataStart + 12];
    } else if (type === 'PLTE') {
      palette = buffer.subarray(dataStart, dataEnd);
    } else if (type === 'tRNS') {
      transparency = buffer.subarray(dataStart, dataEnd);
    } else if (type === 'IDAT') {
      idatChunks.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (interlace !== 0) throw new Error('unsupported interlaced PNG');
  if (idatChunks.length === 0) throw new Error('PNG has no IDAT chunks');

  const bitsPerPixel =
    colorType === 0 ? bitDepth :
    colorType === 2 ? bitDepth * 3 :
    colorType === 3 ? bitDepth :
    colorType === 4 ? bitDepth * 2 :
    colorType === 6 ? bitDepth * 4 :
    0;
  if (!bitsPerPixel) throw new Error(`unsupported PNG color type ${colorType}`);
  if (colorType === 3 && !palette) throw new Error('indexed PNG missing PLTE chunk');
  if ((colorType === 2 || colorType === 4 || colorType === 6) && bitDepth !== 8) {
    throw new Error(`unsupported PNG bit depth ${bitDepth} for color type ${colorType}`);
  }
  if ((colorType === 0 || colorType === 3) && ![1, 2, 4, 8].includes(bitDepth)) {
    throw new Error(`unsupported PNG bit depth ${bitDepth} for color type ${colorType}`);
  }

  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const filterBytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const rows = Buffer.alloc(rowBytes * height);
  let source = 0;

  for (let y = 0; y < height; y++) {
    const filter = inflated[source++];
    const rowStart = y * rowBytes;
    const prevRowStart = rowStart - rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const raw = inflated[source++];
      const left = x >= filterBytesPerPixel ? rows[rowStart + x - filterBytesPerPixel] : 0;
      const up = y > 0 ? rows[prevRowStart + x] : 0;
      const upLeft = y > 0 && x >= filterBytesPerPixel ? rows[prevRowStart + x - filterBytesPerPixel] : 0;
      let value: number;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paeth(left, up, upLeft);
      else throw new Error(`unsupported PNG filter ${filter}`);
      rows[rowStart + x] = value & 0xff;
    }
  }

  function packedSample(rowStart: number, x: number): number {
    if (bitDepth === 8) return rows[rowStart + x];
    const bitOffset = x * bitDepth;
    const byte = rows[rowStart + Math.floor(bitOffset / 8)];
    const shift = 8 - bitDepth - (bitOffset % 8);
    return (byte >> shift) & ((1 << bitDepth) - 1);
  }

  function scaledPackedSample(rowStart: number, x: number): number {
    const sample = packedSample(rowStart, x);
    return Math.round((sample / ((1 << bitDepth) - 1)) * 255);
  }

  function rgbaAt(x: number, y: number): [number, number, number, number] {
    const rowStart = y * rowBytes;
    if (colorType === 0) {
      const gray = scaledPackedSample(rowStart, x);
      return [gray, gray, gray, 255];
    }
    if (colorType === 2) {
      const index = rowStart + x * 3;
      return [rows[index], rows[index + 1], rows[index + 2], 255];
    }
    if (colorType === 3) {
      const paletteIndex = packedSample(rowStart, x);
      const paletteOffset = paletteIndex * 3;
      if (!palette || paletteOffset + 2 >= palette.length) return [0, 0, 0, 255];
      return [
        palette[paletteOffset],
        palette[paletteOffset + 1],
        palette[paletteOffset + 2],
        transparency?.[paletteIndex] ?? 255,
      ];
    }
    if (colorType === 4) {
      const index = rowStart + x * 2;
      return [rows[index], rows[index], rows[index], rows[index + 1]];
    }

    const index = rowStart + x * 4;
    return [rows[index], rows[index + 1], rows[index + 2], rows[index + 3]];
  }

  let sampledPixels = 0;
  let nonTransparent = 0;
  let nonBlack = 0;
  let lumaSum = 0;
  let lumaSquareSum = 0;
  const colorCounts = new Map<string, number>();
  const xStart = Math.max(0, Math.floor(region?.x ?? 0));
  const yStart = Math.max(0, Math.floor(region?.y ?? 0));
  const xEnd = Math.min(width, Math.ceil((region?.x ?? 0) + (region?.width ?? width)));
  const yEnd = Math.min(height, Math.ceil((region?.y ?? 0) + (region?.height ?? height)));
  const regionPixels = Math.max(1, (xEnd - xStart) * (yEnd - yStart));
  const step = Math.max(1, Math.floor(Math.sqrt(regionPixels / 200_000)));

  for (let y = yStart; y < yEnd; y += step) {
    for (let x = xStart; x < xEnd; x += step) {
      const [r, g, b, a] = rgbaAt(x, y);
      sampledPixels++;
      if (a > 5) nonTransparent++;
      if (a > 5 && r + g + b > 30) nonBlack++;
      const colorKey = `${r},${g},${b},${a}`;
      colorCounts.set(colorKey, (colorCounts.get(colorKey) ?? 0) + 1);
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumaSum += luma;
      lumaSquareSum += luma * luma;
    }
  }

  let mostCommonColor = '';
  let mostCommonCount = 0;
  for (const [color, count] of colorCounts) {
    if (count > mostCommonCount) {
      mostCommonColor = color;
      mostCommonCount = count;
    }
  }

  const meanLuma = sampledPixels === 0 ? 0 : lumaSum / sampledPixels;
  const variance = sampledPixels === 0 ? 0 : Math.max(0, (lumaSquareSum / sampledPixels) - (meanLuma * meanLuma));

  return {
    pixels: width * height,
    sampledPixels,
    nonTransparent,
    nonBlack,
    nonTransparentRatio: sampledPixels === 0 ? 0 : nonTransparent / sampledPixels,
    nonBlackRatio: sampledPixels === 0 ? 0 : nonBlack / sampledPixels,
    uniqueColors: colorCounts.size,
    mostCommonColor,
    mostCommonRatio: sampledPixels === 0 ? 0 : mostCommonCount / sampledPixels,
    meanLuma,
    lumaStdDev: Math.sqrt(variance),
  };
}

function readPngInfo(filePath: string, region?: PngRegion): PngInfo {
  if (!fs.existsSync(filePath)) return { path: filePath, exists: false, bytes: 0, ...(region ? { region } : {}) };
  const buffer = fs.readFileSync(filePath);
  const isPng = buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  const info: PngInfo = {
    path: filePath,
    exists: true,
    bytes: buffer.length,
    isPng,
    ...(region ? { region } : {}),
  };
  if (isPng) {
    info.width = buffer.readUInt32BE(16);
    info.height = buffer.readUInt32BE(20);
    try {
      info.pixelStats = readPngPixelStats(buffer, info.width, info.height, region);
    } catch (error: any) {
      info.pixelStatsError = error?.message || String(error);
    }
  }
  return info;
}

function parseReadyPreviews(stdout: string): { ready: number; total: number } | null {
  const match = stdout.match(/ready previews:\s*(\d+)\/(\d+)/i);
  if (!match) return null;
  return { ready: Number(match[1]), total: Number(match[2]) };
}

function extractLogWarnings(stdout: string, stderr: string): string[] {
  return `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .filter((line) => /\b(error|warn|fatal|runtime|attempt to call|nil value|script)\b/i.test(line))
    .slice(-20);
}

function buildQualityWarnings(args: {
  browserCanvas: PngInfo;
  cli: PngInfo;
  statusReady: { ready: number; total: number } | null;
  statusAfterReady: { ready: number; total: number } | null;
  logWarnings: string[];
  scriptWarnings: ScriptWarning[];
}): string[] {
  const warnings: string[] = [];
  const canvasStats = args.browserCanvas.pixelStats;
  if (!args.browserCanvas.exists) {
    warnings.push('browser screenshot was not captured');
  } else if (!canvasStats) {
    warnings.push(`browser canvas pixel stats unavailable${args.browserCanvas.pixelStatsError ? `: ${args.browserCanvas.pixelStatsError}` : ''}`);
  } else {
    if (canvasStats.uniqueColors <= 4) {
      warnings.push(`browser canvas looks visually flat: only ${canvasStats.uniqueColors} sampled colors`);
    }
    if (canvasStats.mostCommonRatio >= 0.985) {
      warnings.push(`browser canvas is dominated by one color (${Math.round(canvasStats.mostCommonRatio * 1000) / 10}%)`);
    }
    if (canvasStats.lumaStdDev < 1.5) {
      warnings.push(`browser canvas has very low luminance variation (${Math.round(canvasStats.lumaStdDev * 100) / 100})`);
    }
  }

  if (args.cli.exists && args.cli.bytes > 0 && args.cli.bytes < 1000) {
    warnings.push(`CLI screenshot is very small (${args.cli.bytes} bytes), which often means a flat/blank image`);
  }
  if (args.statusAfterReady && args.statusAfterReady.total > 0 && args.statusAfterReady.ready < args.statusAfterReady.total) {
    warnings.push(`not all previews were ready after browser verification (${args.statusAfterReady.ready}/${args.statusAfterReady.total})`);
  } else if (args.statusReady && args.statusReady.total > 0 && args.statusReady.ready === 0) {
    warnings.push(`no previews were ready before browser verification (${args.statusReady.ready}/${args.statusReady.total})`);
  }
  if (args.logWarnings.length > 0) {
    warnings.push(`${args.logWarnings.length} warning/error-like log line(s) found`);
  }
  if (args.scriptWarnings.length > 0) {
    warnings.push(`${args.scriptWarnings.length} known script/API footgun(s) found`);
  }
  return warnings;
}

function walkFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  for (const name of fs.readdirSync(root)) {
    const filePath = path.join(root, name);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) result.push(...walkFiles(filePath));
    else result.push(filePath);
  }
  return result;
}

function scanScriptWarnings(deckDir: string): ScriptWarning[] {
  const checks: Array<{ pattern: string; regex: RegExp; message: string }> = [
    {
      pattern: 'castle.draw.print',
      regex: /\bcastle\.draw\.print\s*\(/,
      message: 'Use castle.draw.text(...); castle.draw.print is not a Castle draw API.',
    },
    {
      pattern: 'castle.dt',
      regex: /\bcastle\.dt\s*\(/,
      message: 'onUpdate receives dt as a parameter; there is no castle.dt() function.',
    },
    {
      pattern: 'my.body',
      regex: /\bmy\.body\b/,
      message: 'Use my.layout.x/my.layout.y for position; there is no script my.body accessor.',
    },
    {
      pattern: 'my:destroy',
      regex: /\bmy:destroy\s*\(/,
      message: 'Use castle.destroyActor(my); there is no my:destroy() method.',
    },
    {
      pattern: 'onDraw(dt)',
      regex: /\bfunction\s+onDraw\s*\(\s*dt\s*\)/,
      message: 'onDraw does not receive dt; use castle.getTime() for draw-time animation.',
    },
    {
      pattern: 'onCollide',
      regex: /\bfunction\s+onCollide\s*\(/,
      message: 'There is no onCollide callback; poll collisions from onUpdate if needed.',
    },
  ];

  const warnings = walkFiles(deckDir)
    .filter((filePath) => filePath.endsWith('.lua'))
    .flatMap((filePath) => {
      const rel = path.relative(deckDir, filePath);
      const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
      const warnings: ScriptWarning[] = [];
      lines.forEach((line, index) => {
        for (const check of checks) {
          if (check.regex.test(line)) {
            warnings.push({
              file: rel,
              line: index + 1,
              pattern: check.pattern,
              message: check.message,
              text: line.trim(),
            });
          }
        }
      });
      return warnings;
    });

  for (const filePath of walkFiles(deckDir).filter((file) =>
    file.endsWith('.yaml') && file.includes(`${path.sep}scene${path.sep}blueprints${path.sep}`)
  )) {
    const yamlText = fs.readFileSync(filePath, 'utf8');
    if (!/^\s*visible:\s*false\s*$/m.test(yamlText)) continue;

    const slug = path.basename(filePath, '.yaml');
    const cardDir = path.dirname(path.dirname(path.dirname(filePath)));
    const scriptPath = path.join(cardDir, 'scripts', `${slug}.lua`);
    if (!fs.existsSync(scriptPath)) continue;

    const scriptText = fs.readFileSync(scriptPath, 'utf8');
    if (!/\bfunction\s+onDraw\s*\(|\bcastle\.draw\./.test(scriptText)) continue;

    const rel = path.relative(deckDir, filePath);
    const lines = yamlText.split(/\r?\n/);
    const lineIndex = lines.findIndex((line) => /^\s*visible:\s*false\s*$/.test(line));
    warnings.push({
      file: rel,
      line: lineIndex >= 0 ? lineIndex + 1 : 1,
      pattern: 'visible: false',
      message: 'This blueprint has onDraw/custom drawing but Layout.visible is false, so its scene/HUD/dialogue drawing will not render. Use visible: true or omit visible.',
      text: lineIndex >= 0 ? lines[lineIndex].trim() : 'visible: false',
    });
  }

  return warnings;
}

function progress(message: string): void {
  const time = new Date().toISOString().substring(11, 19);
  process.stderr.write(`[eval ${time}] ${message}\n`);
}

function compactArg(arg: string): string {
  if (arg.includes('\n')) return `<${arg.length} chars>`;
  if (arg.length > 160) return `${arg.slice(0, 80)}...<${arg.length} chars>`;
  return arg;
}

function quoteArg(arg: string): string {
  const compact = compactArg(arg);
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(compact)) return compact;
  return JSON.stringify(compact);
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(quoteArg).join(' ');
}

interface StreamState {
  bytes: number;
  truncated: boolean;
}

function streamText(prefix: string, text: string, target: NodeJS.WriteStream): void {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0 && i === lines.length - 1) continue;
    target.write(`${prefix}${line}\n`);
  }
}

function streamChunk(
  label: string,
  streamName: 'stdout' | 'stderr',
  chunk: Buffer,
  target: NodeJS.WriteStream,
  state: StreamState,
  limitBytes: number,
  artifactPath?: string,
): void {
  if (limitBytes === 0) {
    if (!state.truncated) {
      state.truncated = true;
      target.write(`[${label} ${streamName}] live output hidden; full output saved to ${artifactPath || 'the eval artifacts'}\n`);
    }
    return;
  }

  if (state.bytes >= limitBytes) {
    if (!state.truncated) {
      state.truncated = true;
      target.write(`[${label} ${streamName}] live output truncated after ${limitBytes} bytes; full output saved to ${artifactPath || 'the eval artifacts'}\n`);
    }
    return;
  }

  const remaining = limitBytes - state.bytes;
  const printable = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
  state.bytes += printable.length;
  streamText(`[${label} ${streamName}] `, printable.toString(), target);

  if (chunk.length > remaining && !state.truncated) {
    state.truncated = true;
    target.write(`[${label} ${streamName}] live output truncated after ${limitBytes} bytes; full output saved to ${artifactPath || 'the eval artifacts'}\n`);
  }
}

function buildAgentCommand(options: Options, fullPrompt: string, runDir: string): { command: string; args: string[]; stderrPath: string } {
  if (options.agent === 'claude') {
    return {
      command: 'claude',
      args: [
        '-p',
        '--model',
        options.model,
        '--effort',
        options.effort,
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'bypassPermissions',
        '--max-budget-usd',
        options.maxBudgetUsd,
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
      '--model',
      options.model,
      '-c',
      `model_reasoning_effort="${options.effort}"`,
      '--dangerously-bypass-approvals-and-sandbox',
      '--cd',
      ROOT,
      '--output-last-message',
      path.join(runDir, 'codex-last-message.txt'),
      fullPrompt,
    ],
    stderrPath: path.join(runDir, 'codex.stderr.log'),
  };
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
  options: { cwd: string; timeoutMs: number; stdoutPath?: string; stderrPath?: string; label?: string; consoleOutputLimitBytes?: number; env?: NodeJS.ProcessEnv }
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const label = options.label || command;
    progress(`start ${label}: ${formatCommand(command, args)}`);
    const started = Date.now();
    let timedOut = false;
    let stdout = '';
    let stderr = '';
    const stdoutState: StreamState = { bytes: 0, truncated: false };
    const stderrState: StreamState = { bytes: 0, truncated: false };
    const consoleOutputLimitBytes = options.consoleOutputLimitBytes ?? 96 * 1024;
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
      progress(`timeout ${label} after ${options.timeoutMs}ms`);
      killProcessTree(child);
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      stdoutStream?.write(chunk);
      streamChunk(label, 'stdout', chunk, process.stdout, stdoutState, consoleOutputLimitBytes, options.stdoutPath);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      stderrStream?.write(chunk);
      streamChunk(label, 'stderr', chunk, process.stderr, stderrState, consoleOutputLimitBytes, options.stderrPath);
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout);
      stdoutStream?.end();
      stderrStream?.end();
      progress(`finish ${label}: exit=${exitCode ?? 'null'} signal=${signal ?? 'none'} timedOut=${timedOut} durationMs=${Date.now() - started}`);
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
      progress(`error ${label}: ${String(error)}`);
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
  const groupSlug = options.runGroup ? `${options.runGroup}-` : '';
  const runId = `${timestamp()}-${groupSlug}${promptName}-${options.agent}-${slugify(options.model)}-${slugify(options.effort)}`;
  const runDir = path.resolve(ROOT, options.outputDir, runId);
  const deckDir = path.join(runDir, 'deck');
  const screenshotDir = path.join(runDir, 'screenshots');
  const evalConfigDir = path.join(runDir, '.castle-home');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.mkdirSync(evalConfigDir, { recursive: true });
  const evalEnv = { ...process.env, CASTLE_CLI_HOME: evalConfigDir };

  const taskPrompt = fs.readFileSync(promptFile, 'utf8');
  const fullPrompt = `You are running an automated Castle CLI 4 eval.

Eval run directory: ${path.relative(ROOT, runDir)}
Eval deck directory: ${path.relative(ROOT, deckDir)}

Follow the task below exactly. Keep all generated deck/game files inside the eval deck directory. Do not edit repo source files unless you hit a real CLI bug that blocks the task.

Create the project first with: npx tsx src/index.ts init ${path.relative(ROOT, deckDir)} --title "Eval Deck"
Then use this command for local serve: npx tsx src/index.ts serve ${path.relative(ROOT, deckDir)} --detach

Do not run foreground serve in this eval, because the agent process must continue after the server starts. Do not run OS browser commands such as open, and do not run agent-browser; the harness owns headless browser verification after you finish. Leave detached serve running so verification can inspect it.

Read only the docs you need before editing. Start with docs/cli/1-getting-started.md, docs/cli/2-editing-decks.md, and the relevant script reference section such as docs/scripts/castle-library-reference.md for input APIs like castle.getTouches(). Do not search library/ or existing decks unless the task specifically requires examples from them.

For custom drawing and HUD/dialogue text, read docs/scripts/drawing-reference.md before writing draw code. Use castle.draw.text(...); castle.draw.print(...) is not a Castle API.

For any actor or blueprint that draws the scene, HUD, or dialogue with onDraw(), keep Layout.visible true or omit visible. Do not set visible: false on draw/controller actors.

Task:
${taskPrompt}

Finish by printing a short summary with the local serve URL, what you changed, and any remaining problems.`;

  fs.writeFileSync(path.join(runDir, 'prompt.md'), fullPrompt, 'utf8');

  const startedAt = new Date().toISOString();
  const agentCommand = buildAgentCommand(options, fullPrompt, runDir);
  const agent = await runCommand(agentCommand.command, agentCommand.args, {
    cwd: ROOT,
    timeoutMs: options.timeoutMs,
    stdoutPath: path.join(runDir, 'transcript.jsonl'),
    stderrPath: agentCommand.stderrPath,
    consoleOutputLimitBytes: options.consoleOutputLimitBytes,
    label: options.agent,
    env: evalEnv,
  });

  const status = await runCommand('npx', ['tsx', 'src/index.ts', 'status'], {
    cwd: ROOT,
    timeoutMs: options.commandTimeoutMs,
    stdoutPath: path.join(runDir, 'status.log'),
    stderrPath: path.join(runDir, 'status.stderr.log'),
    consoleOutputLimitBytes: options.consoleOutputLimitBytes,
    label: 'status',
    env: evalEnv,
  });
  const logs = await runCommand('npx', ['tsx', 'src/index.ts', 'logs'], {
    cwd: ROOT,
    timeoutMs: options.commandTimeoutMs,
    stdoutPath: path.join(runDir, 'logs.txt'),
    stderrPath: path.join(runDir, 'logs.stderr.log'),
    consoleOutputLimitBytes: options.consoleOutputLimitBytes,
    label: 'logs',
    env: evalEnv,
  });

  const serveInfo = readJsonIfExists(path.join(deckDir, '.castle', 'serve.json'));
  const browserResults: CommandResult[] = [];
  let cliScreenshot: CommandResult | null = null;
  let statusAfterBrowser: CommandResult | null = null;
  if (options.browser && serveInfo?.url) {
    const session = `c4-${crypto.createHash('sha1').update(runId).digest('hex').slice(0, 12)}`;
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
      consoleOutputLimitBytes: options.consoleOutputLimitBytes,
      label: 'browser-open',
    }));
    browserResults.push(await runCommand('npx', [...browserBaseArgs, 'wait', '3000'], {
      cwd: ROOT,
      timeoutMs: options.browserTimeoutMs,
      stdoutPath: path.join(runDir, 'browser-wait.log'),
      stderrPath: path.join(runDir, 'browser-wait.stderr.log'),
      consoleOutputLimitBytes: options.consoleOutputLimitBytes,
      label: 'browser-wait',
    }));

    browserResults.push(await runCommand('npx', [...browserBaseArgs, 'eval', CANVAS_BOX_SCRIPT], {
      cwd: ROOT,
      timeoutMs: options.browserTimeoutMs,
      stdoutPath: path.join(runDir, 'browser-canvas-box.json'),
      stderrPath: path.join(runDir, 'browser-canvas-box.stderr.log'),
      consoleOutputLimitBytes: options.consoleOutputLimitBytes,
      label: 'browser-canvas-box',
    }));

    const canvasBox = readJsonIfExists(path.join(runDir, 'browser-canvas-box.json')) as CanvasBox | null;
    if (canvasBox?.hasCanvas && Number.isFinite(canvasBox.centerX) && Number.isFinite(canvasBox.centerY)) {
      const x = String(Math.round(canvasBox.centerX!));
      const y = String(Math.round(canvasBox.centerY!));
      browserResults.push(await runCommand('npx', [...browserBaseArgs, 'batch', '--bail', `mouse move ${x} ${y}`, 'mouse down', 'wait 80', 'mouse up'], {
        cwd: ROOT,
        timeoutMs: options.browserTimeoutMs,
        stdoutPath: path.join(runDir, 'browser-tap.log'),
        stderrPath: path.join(runDir, 'browser-tap.stderr.log'),
        consoleOutputLimitBytes: options.consoleOutputLimitBytes,
        label: 'browser-tap',
      }));
    } else {
      browserResults.push(await runCommand('npx', [...browserBaseArgs, 'click', 'canvas'], {
        cwd: ROOT,
        timeoutMs: options.browserTimeoutMs,
        stdoutPath: path.join(runDir, 'browser-click.log'),
        stderrPath: path.join(runDir, 'browser-click.stderr.log'),
        consoleOutputLimitBytes: options.consoleOutputLimitBytes,
        label: 'browser-click',
      }));
    }

    browserResults.push(await runCommand('npx', [...browserBaseArgs, 'wait', '500'], {
      cwd: ROOT,
      timeoutMs: options.browserTimeoutMs,
      stdoutPath: path.join(runDir, 'browser-post-click-wait.log'),
      stderrPath: path.join(runDir, 'browser-post-click-wait.stderr.log'),
      consoleOutputLimitBytes: options.consoleOutputLimitBytes,
      label: 'browser-post-click-wait',
    }));
    browserResults.push(await runCommand('npx', [...browserBaseArgs, 'screenshot', path.join(screenshotDir, 'browser.png')], {
      cwd: ROOT,
      timeoutMs: options.browserTimeoutMs,
      stdoutPath: path.join(runDir, 'browser-screenshot.log'),
      stderrPath: path.join(runDir, 'browser-screenshot.stderr.log'),
      consoleOutputLimitBytes: options.consoleOutputLimitBytes,
      label: 'browser-screenshot',
    }));
    browserResults.push(await runCommand('npx', [...browserBaseArgs, 'eval', CANVAS_PROBE_SCRIPT], {
      cwd: ROOT,
      timeoutMs: options.browserTimeoutMs,
      stdoutPath: path.join(runDir, 'browser-canvas.json'),
      stderrPath: path.join(runDir, 'browser-canvas.stderr.log'),
      consoleOutputLimitBytes: options.consoleOutputLimitBytes,
      label: 'browser-canvas',
    }));
    browserResults.push(await runCommand('npx', [...browserBaseArgs, 'console'], {
      cwd: ROOT,
      timeoutMs: options.browserTimeoutMs,
      stdoutPath: path.join(runDir, 'browser-console.log'),
      stderrPath: path.join(runDir, 'browser-console.stderr.log'),
      consoleOutputLimitBytes: options.consoleOutputLimitBytes,
      label: 'browser-console',
    }));
    browserResults.push(await runCommand('npx', [...browserBaseArgs, 'errors'], {
      cwd: ROOT,
      timeoutMs: options.browserTimeoutMs,
      stdoutPath: path.join(runDir, 'browser-errors.log'),
      stderrPath: path.join(runDir, 'browser-errors.stderr.log'),
      consoleOutputLimitBytes: options.consoleOutputLimitBytes,
      label: 'browser-errors',
    }));
    cliScreenshot = await runCommand('npx', ['tsx', 'src/index.ts', 'screenshot', path.join(screenshotDir, 'cli.png')], {
      cwd: ROOT,
      timeoutMs: options.browserTimeoutMs,
      stdoutPath: path.join(runDir, 'cli-screenshot.log'),
      stderrPath: path.join(runDir, 'cli-screenshot.stderr.log'),
      consoleOutputLimitBytes: options.consoleOutputLimitBytes,
      label: 'cli-screenshot',
      env: evalEnv,
    });
    statusAfterBrowser = await runCommand('npx', ['tsx', 'src/index.ts', 'status'], {
      cwd: ROOT,
      timeoutMs: options.commandTimeoutMs,
      stdoutPath: path.join(runDir, 'status-after-browser.log'),
      stderrPath: path.join(runDir, 'status-after-browser.stderr.log'),
      consoleOutputLimitBytes: options.consoleOutputLimitBytes,
      label: 'status-after-browser',
      env: evalEnv,
    });
    browserResults.push(await runCommand('npx', [...browserBaseArgs, 'close'], {
      cwd: ROOT,
      timeoutMs: options.browserTimeoutMs,
      stdoutPath: path.join(runDir, 'browser-close.log'),
      stderrPath: path.join(runDir, 'browser-close.stderr.log'),
      consoleOutputLimitBytes: options.consoleOutputLimitBytes,
      label: 'browser-close',
    }));
  }

  const endedAt = new Date().toISOString();
  const canvasBox = readJsonIfExists(path.join(runDir, 'browser-canvas-box.json')) as CanvasBox | null;
  const browserCanvasRegion = canvasBox?.hasCanvas &&
    Number.isFinite(canvasBox.centerX) &&
    Number.isFinite(canvasBox.centerY) &&
    Number.isFinite(canvasBox.width) &&
    Number.isFinite(canvasBox.height)
    ? {
        x: Math.max(0, Math.floor(canvasBox.centerX! - (canvasBox.width! / 2))),
        y: Math.max(0, Math.floor(canvasBox.centerY! - (canvasBox.height! / 2))),
        width: Math.ceil(canvasBox.width!),
        height: Math.ceil(canvasBox.height!),
      }
    : undefined;
  const screenshots = {
    browser: readPngInfo(path.join(screenshotDir, 'browser.png')),
    browserCanvas: readPngInfo(path.join(screenshotDir, 'browser.png'), browserCanvasRegion),
    cli: readPngInfo(path.join(screenshotDir, 'cli.png')),
  };
  const statusReady = parseReadyPreviews(status.stdout);
  const statusAfterReady = statusAfterBrowser ? parseReadyPreviews(statusAfterBrowser.stdout) : null;
  const logWarnings = extractLogWarnings(logs.stdout, logs.stderr);
  const scriptWarnings = scanScriptWarnings(deckDir);
  const qualityWarnings = buildQualityWarnings({
    browserCanvas: screenshots.browserCanvas,
    cli: screenshots.cli,
    statusReady,
    statusAfterReady,
    logWarnings,
    scriptWarnings,
  });
  const result = {
    runId,
    agent: options.agent,
    prompt: options.prompt,
    promptFile,
    model: options.model,
    effort: options.effort,
    runGroup: options.runGroup,
    git: {
      commit: gitOutput(['rev-parse', 'HEAD']),
      branch: gitOutput(['branch', '--show-current']),
      trackedDirty: gitOutput(['status', '--short', '--untracked-files=no']).length > 0,
    },
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
    screenshotDir,
    serveInfo,
    agentRun: {
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
        readyPreviews: statusReady,
      },
      logs: {
        exitCode: logs.exitCode,
        timedOut: logs.timedOut,
        durationMs: logs.durationMs,
        warningLines: logWarnings,
      },
      scriptWarnings,
      statusAfterBrowser: statusAfterBrowser ? {
        exitCode: statusAfterBrowser.exitCode,
        timedOut: statusAfterBrowser.timedOut,
        durationMs: statusAfterBrowser.durationMs,
        readyPreviews: statusAfterReady,
      } : null,
      cliScreenshot: cliScreenshot ? {
        exitCode: cliScreenshot.exitCode,
        signal: cliScreenshot.signal,
        timedOut: cliScreenshot.timedOut,
        durationMs: cliScreenshot.durationMs,
      } : null,
      browser: browserResults.map((item) => ({
        command: [item.command, ...item.args].join(' '),
        exitCode: item.exitCode,
        signal: item.signal,
        timedOut: item.timedOut,
        durationMs: item.durationMs,
      })),
      screenshots,
      canvasBox,
      canvasProbe: readJsonIfExists(path.join(runDir, 'browser-canvas.json')),
      qualityWarnings,
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
