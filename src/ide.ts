import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { Duplex } from 'stream';
import { fileURLToPath } from 'url';
import { spawn as spawnPty, IPty } from '@lydell/node-pty';
import headlessPkg from '@xterm/headless';
import type { Terminal as HeadlessTerminalType } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebSocketServer, WebSocket, RawData } from 'ws';

const HeadlessTerminal = headlessPkg.Terminal;

// This file lives at src/ide.ts → compiled to dist/ide.js, so the cli root is one level up.
const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
const IDE_DIST = path.join(CLI_ROOT, 'ide', 'dist');
const PTY_TERM = process.env.CASTLE_IDE_TERM ?? 'xterm-256color';
const INITIAL_COLS = 80;
const INITIAL_ROWS = 24;
const SCROLLBACK = 4000;
const MAX_TRANSCRIPT = 200_000;
const REPLAY_TIMEOUT_MS = 1000;

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

interface IdeSession {
  id: string;
  cwd: string;
  command: string;
  args: string[];
  pid: number;
  startedAt: string;
  pty: IPty;
  screen: HeadlessTerminalType;
  serializeAddon: SerializeAddon;
  renderQueue: Promise<void>;
  transcript: string;
  sockets: Set<WebSocket>;
  exited: { exitCode: number; signal?: number } | null;
}

export interface IdeServeContext {
  deckDir: string;
  serveUrl: () => string;
  port: number;
  debug?: boolean;
}

export interface Ide {
  handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    reqPath: string,
  ): boolean;
  handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): boolean;
  shutdown(): void;
  isIdeRequest(reqPath: string): boolean;
  isIdeUpgrade(reqPath: string): boolean;
}

// Drop a one-shot `castle` shim into a tmp bin dir so the embedded shell can run
// `castle ...` without the user having a global install. Bound to the same node
// + cli entry that's running this serve.
function ensureCastleShimDir(): string {
  const dir = path.join(os.tmpdir(), `castle-ide-bin-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true });
  const shimPath = path.join(dir, 'castle');
  if (process.platform === 'win32') {
    const cmdPath = `${shimPath}.cmd`;
    fs.writeFileSync(cmdPath, `@echo off\r\n"${process.execPath}" "${CLI_ENTRY}" %*\r\n`);
  } else {
    const script = `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI_ENTRY)} "$@"\n`;
    fs.writeFileSync(shimPath, script);
    fs.chmodSync(shimPath, 0o755);
  }
  return dir;
}

function ptyEnv(extraPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: PTY_TERM,
    COLORTERM: 'truecolor',
    CLICOLOR: '1',
    CLICOLOR_FORCE: '1',
    FORCE_COLOR: process.env.FORCE_COLOR === '0' ? '3' : process.env.FORCE_COLOR ?? '3',
    TERM_PROGRAM: 'castle-ide',
  };
  const existingPath = env.PATH ?? '';
  env.PATH = existingPath ? `${extraPath}${path.delimiter}${existingPath}` : extraPath;
  delete env.NO_COLOR;
  delete env.NODE_DISABLE_COLORS;
  return env;
}

function defaultShell(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: process.env.COMSPEC ?? 'cmd.exe', args: [] };
  }
  return { command: process.env.SHELL ?? '/bin/zsh', args: ['-l'] };
}

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return Buffer.from(new Uint8Array(data as ArrayBuffer)).toString('utf8');
}

function send(socket: WebSocket, body: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(body));
  }
}

function sessionSummary(session: IdeSession) {
  return {
    id: session.id,
    cwd: session.cwd,
    command: session.command,
    args: session.args,
    pid: session.pid,
    startedAt: session.startedAt,
    exited: session.exited,
    scrollbackLimit: SCROLLBACK,
  };
}

function appendTranscript(session: IdeSession, data: string): void {
  session.transcript += data;
  if (session.transcript.length > MAX_TRANSCRIPT) {
    session.transcript = session.transcript.slice(-MAX_TRANSCRIPT);
  }
}

function queueScreenWrite(session: IdeSession, data: string): void {
  session.renderQueue = session.renderQueue
    .catch(() => undefined)
    .then(
      () =>
        new Promise<void>((resolve) => {
          session.screen.write(data, resolve);
        }),
    )
    .catch((err) => {
      console.error('[ide] screen write failed', err);
    });
}

function queueScreenResize(session: IdeSession, cols: number, rows: number): void {
  session.renderQueue = session.renderQueue
    .catch(() => undefined)
    .then(() => {
      session.screen.resize(cols, rows);
    })
    .catch((err) => {
      console.error('[ide] screen resize failed', err);
    });
}

async function waitForStableScreen(session: IdeSession): Promise<void> {
  while (true) {
    const queue = session.renderQueue;
    await queue.catch(() => undefined);
    if (session.renderQueue === queue) return;
  }
}

function broadcast(session: IdeSession, body: unknown): void {
  for (const socket of session.sockets) send(socket, body);
}

function spawnSession(ctx: IdeServeContext, shimDir: string): IdeSession {
  const { command, args } = defaultShell();
  const screen = new HeadlessTerminal({
    allowProposedApi: true,
    cols: INITIAL_COLS,
    rows: INITIAL_ROWS,
    convertEol: false,
    scrollback: SCROLLBACK,
  });
  const serializeAddon = new SerializeAddon();
  screen.loadAddon(serializeAddon);

  const pty = spawnPty(command, args, {
    name: PTY_TERM,
    cols: INITIAL_COLS,
    rows: INITIAL_ROWS,
    cwd: ctx.deckDir,
    env: ptyEnv(shimDir),
  });
  const session: IdeSession = {
    id: `ide-${Date.now().toString(36)}`,
    cwd: ctx.deckDir,
    command,
    args,
    pid: pty.pid,
    startedAt: new Date().toISOString(),
    pty,
    screen,
    serializeAddon,
    renderQueue: Promise.resolve(),
    transcript: '',
    sockets: new Set(),
    exited: null,
  };
  pty.onData((data) => {
    appendTranscript(session, data);
    queueScreenWrite(session, data);
    broadcast(session, { type: 'output', session: sessionSummary(session), data });
  });
  pty.onExit(({ exitCode, signal }) => {
    session.exited = { exitCode, signal };
    broadcast(session, {
      type: 'exit',
      session: sessionSummary(session),
      exitCode,
      signal,
    });
  });
  if (ctx.debug) {
    console.log(`[ide] pty spawned pid=${pty.pid} cwd=${ctx.deckDir}`);
  }
  return session;
}

function safeResolveDist(reqPath: string): string | null {
  // reqPath is the path under /ide/, e.g. "/", "/assets/index-xxx.js"
  const cleaned = reqPath === '/' ? '/index.html' : reqPath;
  const requested = path.resolve(IDE_DIST, '.' + cleaned);
  if (!requested.startsWith(IDE_DIST)) return null;
  return requested;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text).toString(),
  });
  res.end(text);
}

export function createIde(ctx: IdeServeContext): Ide {
  let session: IdeSession | null = null;
  const wss = new WebSocketServer({ noServer: true });
  const shimDir = ensureCastleShimDir();
  if (ctx.debug) console.log(`[ide] castle shim dir: ${shimDir}`);

  function ensureSession(): IdeSession {
    if (!session || session.exited) {
      session = spawnSession(ctx, shimDir);
    }
    return session;
  }

  function handleSocket(socket: WebSocket): void {
    let s: IdeSession;
    try {
      s = ensureSession();
    } catch (err) {
      send(socket, {
        type: 'error',
        error: err instanceof Error ? err.message : 'could not spawn pty session',
      });
      try {
        socket.close(1011, 'pty spawn failed');
      } catch {}
      console.error('[ide] pty spawn failed', err);
      return;
    }
    let replaySent = false;
    let replayTimer: NodeJS.Timeout | null = null;

    async function sendInitialReplay(): Promise<void> {
      if (replaySent) return;
      replaySent = true;
      if (replayTimer) {
        clearTimeout(replayTimer);
        replayTimer = null;
      }
      try {
        await waitForStableScreen(s);
        if (socket.readyState !== socket.OPEN) return;
        s.sockets.add(socket);
        send(socket, {
          type: 'replay',
          session: sessionSummary(s),
          data: s.serializeAddon.serialize({ scrollback: SCROLLBACK }),
        });
        if (s.exited) {
          send(socket, {
            type: 'exit',
            session: sessionSummary(s),
            exitCode: s.exited.exitCode,
            signal: s.exited.signal,
          });
        }
      } catch (err) {
        send(socket, {
          type: 'error',
          error: err instanceof Error ? err.message : 'could not restore terminal screen',
        });
      }
    }

    send(socket, { type: 'hello', session: sessionSummary(s) });
    replayTimer = setTimeout(() => void sendInitialReplay(), REPLAY_TIMEOUT_MS);

    socket.on('message', (data) => {
      let parsed: any;
      try {
        parsed = JSON.parse(rawDataToString(data));
      } catch {
        send(socket, { type: 'error', error: 'invalid client message' });
        return;
      }
      try {
        if (parsed?.type === 'input') {
          if (s.exited) return;
          if (typeof parsed.data === 'string') s.pty.write(parsed.data);
          return;
        }
        if (parsed?.type === 'resize') {
          const cols = Math.max(2, Number(parsed.cols) || INITIAL_COLS);
          const rows = Math.max(2, Number(parsed.rows) || INITIAL_ROWS);
          s.pty.resize(cols, rows);
          queueScreenResize(s, cols, rows);
          if (!replaySent) void sendInitialReplay();
          return;
        }
      } catch (err) {
        send(socket, {
          type: 'error',
          error: err instanceof Error ? err.message : 'pty operation failed',
        });
      }
    });

    socket.on('close', () => {
      if (replayTimer) clearTimeout(replayTimer);
      s.sockets.delete(socket);
    });
  }

  function isIdeRequest(reqPath: string): boolean {
    return reqPath === '/ide' || reqPath.startsWith('/ide/');
  }

  function isIdeUpgrade(reqPath: string): boolean {
    return reqPath === '/ide/pty';
  }

  function handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    reqPath: string,
  ): boolean {
    if (!isIdeRequest(reqPath)) return false;

    if (reqPath === '/ide') {
      res.writeHead(302, { location: '/ide/' });
      res.end();
      return true;
    }

    if (req.method === 'GET' && reqPath === '/ide/api/serve-info') {
      sendJson(res, 200, {
        url: ctx.serveUrl(),
        port: ctx.port,
        deckDir: ctx.deckDir,
      });
      return true;
    }

    if (req.method === 'GET' && reqPath === '/ide/api/health') {
      sendJson(res, 200, {
        ok: true,
        deckDir: ctx.deckDir,
        port: ctx.port,
        sessionPid: session?.pid ?? null,
        sessionExited: session?.exited ?? null,
      });
      return true;
    }

    if (reqPath.startsWith('/ide/api/')) {
      sendJson(res, 404, { error: 'not found', path: reqPath });
      return true;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return true;
    }

    if (!fs.existsSync(IDE_DIST)) {
      sendJson(res, 503, {
        error: 'ide assets are missing; run `npm run build:ide` in the cli source repo',
      });
      return true;
    }

    const stripped = reqPath.replace(/^\/ide/, '') || '/';
    const resolved = safeResolveDist(stripped);
    if (!resolved) {
      sendJson(res, 400, { error: 'bad path' });
      return true;
    }
    let filePath = resolved;
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(IDE_DIST, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': contentTypes[ext] ?? 'application/octet-stream',
    });
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  function handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const reqUrl = new URL(req.url ?? '/', 'http://localhost');
    if (!isIdeUpgrade(reqUrl.pathname)) return false;
    wss.handleUpgrade(req, socket, head, (ws) => handleSocket(ws));
    return true;
  }

  function shutdown(): void {
    if (session) {
      try {
        session.pty.kill();
      } catch {}
      for (const sock of session.sockets) {
        try {
          sock.close(1001, 'serve shutting down');
        } catch {}
      }
    }
    wss.close();
    try {
      fs.rmSync(shimDir, { recursive: true, force: true });
    } catch {}
  }

  return {
    handleHttpRequest,
    handleUpgrade,
    isIdeRequest,
    isIdeUpgrade,
    shutdown,
  };
}
