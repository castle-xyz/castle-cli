import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as os from 'os';
import WebSocket from 'ws';
import chokidar from 'chokidar';
import { projectSocketPath } from './utils/socket.js';

const WS_URL = 'wss://ws.castlexyz.com/ws';
const RECONNECT_MS = 3000;
const PING_INTERVAL_MS = 30_000;
const SCRIPT_DEBOUNCE_MS = 500;
const CONNECT_REGISTRY_PATH = path.join(os.homedir(), '.castle', 'cli4-connect.json');

interface StateMessage {
  innerType: 'cli4_state';
  cardId: string;
  deckId: string;
  blueprints: string | Record<string, string>;
  actors: string;
  variables: string;
  behaviors: string;
  rules: string;
  scripts: Record<string, string>;
  slugToEntryId: Record<string, string>;
  scriptingReference: string;
  scriptPropertyNamePrompt: string;
}

function log(category: string, ...args: any[]) {
  const ts = new Date().toISOString().substring(11, 23);
  console.log(`[${ts}] [${category}]`, ...args);
}

export class CLIServer {
  private ws: WebSocket | null = null;
  private connectRoot: string;
  private dir: string;
  private token: string;
  private connected = false;
  private shouldReconnect = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private scriptDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingScriptChanges = new Map<string, string>();

  private slugToEntryId: Record<string, string> = {};
  private entryIdToSlug: Record<string, string> = {};
  private writingFiles = false;
  private needsFullSync = true;
  private lastSyncedScripts: Record<string, string> = {};

  private screenshotsDir: string;
  private screenshotCounter = 0;
  private ipcServer: net.Server | null = null;
  private sockPath: string;
  private pendingScreenshot: { respond: (result: any) => void; filename?: string } | null = null;
  private pendingEdit: { respond: (result: any) => void } | null = null;
  private activeDeckDir: string | null = null;
  private activeDeckId: string | null = null;
  private activeCardId: string | null = null;

  constructor(dir: string, token: string) {
    this.connectRoot = dir;
    this.dir = dir;
    this.token = token;
    this.screenshotsDir = path.join(dir, '.castle', 'screenshots');
    this.sockPath = projectSocketPath('connect', dir);

    for (const d of [dir, path.join(dir, '.castle'), this.screenshotsDir]) {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }
  }

  start() {
    log('server', `connect root: ${this.connectRoot}`);
    this._connect();
    this._startIPC();
  }

  stop() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.scriptDebounceTimer) clearTimeout(this.scriptDebounceTimer);
    this._stopPing();
    this.watcher?.close();
    this.ipcServer?.close();
    try { fs.unlinkSync(this.sockPath); } catch {}
    try {
      const registry = JSON.parse(fs.readFileSync(CONNECT_REGISTRY_PATH, 'utf8'));
      if (registry.sockPath === this.sockPath) fs.unlinkSync(CONNECT_REGISTRY_PATH);
    } catch {}
    if (this.ws) {
      this._sendToApp({ innerType: 'cli4_disconnect' });
      this.ws.close();
    }
  }

  private _connect() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    const url = `${WS_URL}?token=${this.token}`;
    log('tunnel', 'connecting...');

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.connected = true;
      this.needsFullSync = true;
      log('tunnel', 'connected');

      this.ws!.send(JSON.stringify({
        type: 'cli_tunnel_start_listening',
      }));

      this._sendToApp({ innerType: 'cli4_hello' });
      log('tunnel', 'sent hello');

      this._startPing();
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'cli_tunnel_send_message') {
          this._handleMessage(msg);
        }
      } catch (e) {
        log('tunnel', 'parse error:', e);
      }
    });

    this.ws.on('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      this._stopPing();
      if (wasConnected) {
        log('tunnel', 'disconnected — reconnecting...');
      } else {
        log('tunnel', 'connection failed — retrying...');
      }
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      log('tunnel', 'error:', err.message);
    });
  }

  private _startPing() {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, PING_INTERVAL_MS);
  }

  private _stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private _scheduleReconnect() {
    if (!this.shouldReconnect) return;
    if (this.reconnectTimer) return;
    log('tunnel', `reconnecting in ${RECONNECT_MS}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, RECONNECT_MS);
  }

  private _sendToApp(data: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'cli_tunnel_send_message',
      ...data,
    }));
  }

  private _handleMessage(msg: any) {
    const { innerType } = msg;

    switch (innerType) {
      case 'cli4_state':
        log('recv', 'state update');
        this._onState(msg as StateMessage);
        break;
      case 'cli4_screenshot_data':
        this._onScreenshotData(msg.data);
        break;
      case 'cli4_logs':
        this._onLogs(msg.logs);
        break;
      case 'cli4_edit_result':
        this._onEditResult(msg);
        break;
      case 'cli4_bridge_hello':
        log('recv', 'bridge hello — deck:', msg.deckId || 'unknown', 'card:', msg.cardId || 'unknown');
        this._activateProject(msg.deckId, msg.cardId);
        this.needsFullSync = true;
        this._sendToApp({ innerType: 'cli4_hello' });
        log('tunnel', 'sent hello in response to bridge');
        break;
      default:
        log('recv', 'unknown:', innerType);
    }
  }

  private _readJson(filePath: string): any | null {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  private _findProjectDeckDir(deckId: string): string | null {
    const rootDeckJson = this._readJson(path.join(this.connectRoot, 'deck.json'));
    if (rootDeckJson?.deckId === deckId) return this.connectRoot;

    const direct = path.join(this.connectRoot, deckId);
    const directDeckJson = this._readJson(path.join(direct, 'deck.json'));
    if (directDeckJson?.deckId === deckId) return direct;

    if (!fs.existsSync(this.connectRoot)) return null;
    for (const entry of fs.readdirSync(this.connectRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(this.connectRoot, entry.name);
      const deckJson = this._readJson(path.join(candidate, 'deck.json'));
      if (deckJson?.deckId === deckId) return candidate;
    }

    return null;
  }

  private _activateProject(deckId?: string, cardId?: string): boolean {
    if (!deckId || !cardId) {
      log('project', 'waiting for deckId/cardId from app bridge');
      return false;
    }
    if (this.activeDeckId === deckId && this.activeCardId === cardId) return true;

    const deckDir = this._findProjectDeckDir(deckId);
    if (!deckDir) {
      log('project', `no local project found for deck ${deckId}; run "npx tsx src/index.ts pull ${deckId}" first`);
      return false;
    }

    const cardDir = path.join(deckDir, 'cards', cardId);
    if (!fs.existsSync(cardDir)) {
      log('project', `deck ${deckId} found at ${deckDir}, but card ${cardId} is missing locally`);
      return false;
    }

    this.activeDeckDir = deckDir;
    this.activeDeckId = deckId;
    this.activeCardId = cardId;
    this.dir = cardDir;
    this.screenshotsDir = path.join(deckDir, '.castle', 'screenshots');
    this.needsFullSync = true;
    this.pendingScriptChanges.clear();

    for (const d of [
      path.join(cardDir, 'scripts'),
      path.join(cardDir, 'scene', 'blueprints'),
      path.join(cardDir, '.castle'),
      path.join(deckDir, '.castle'),
      this.screenshotsDir,
    ]) {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }

    this._writeConnectRegistry();
    this._startWatcher();
    log('project', `active deck ${deckId} card ${cardId}: ${cardDir}`);
    return true;
  }

  private _clearProjection() {
    const scriptsDir = path.join(this.dir, 'scripts');
    if (fs.existsSync(scriptsDir)) {
      for (const f of fs.readdirSync(scriptsDir)) {
        if (f.endsWith('.lua')) fs.unlinkSync(path.join(scriptsDir, f));
      }
    } else {
      fs.mkdirSync(scriptsDir, { recursive: true });
    }

    const sceneDir = path.join(this.dir, 'scene');
    fs.mkdirSync(path.join(sceneDir, 'blueprints'), { recursive: true });
    for (const f of ['actors.yaml', 'variables.yaml', 'behaviors.yaml', 'rules.yaml', 'scripting-reference.md', 'script-property-names.md']) {
      try { fs.unlinkSync(path.join(sceneDir, f)); } catch {}
    }
    const blueprintsDir = path.join(sceneDir, 'blueprints');
    for (const f of fs.readdirSync(blueprintsDir)) {
      if (f.endsWith('.yaml')) fs.unlinkSync(path.join(blueprintsDir, f));
    }
    log('project', `cleared app projection in ${this.dir}`);
  }

  private _onState(state: StateMessage) {
    if (!this._activateProject(state.deckId, state.cardId)) {
      log('state', 'skipping state update until matching local project is available');
      return;
    }

    const isFullSync = this.needsFullSync;
    this.needsFullSync = false;

    this.slugToEntryId = state.slugToEntryId;
    this.entryIdToSlug = {};
    for (const [slug, entryId] of Object.entries(state.slugToEntryId)) {
      this.entryIdToSlug[entryId] = slug;
    }

    this.writingFiles = true;

    if (isFullSync) {
      this._clearProjection();
      log('state', 'full sync');
    }

    if (typeof state.blueprints === 'string') {
      this._writeFile('scene/blueprints.yaml', state.blueprints);
    } else {
      const blueprintsDir = path.join(this.dir, 'scene', 'blueprints');
      if (!fs.existsSync(blueprintsDir)) fs.mkdirSync(blueprintsDir, { recursive: true });

      if (isFullSync) {
        for (const f of fs.readdirSync(blueprintsDir)) {
          if (f.endsWith('.yaml')) fs.unlinkSync(path.join(blueprintsDir, f));
        }
      } else {
        const currentSlugs = new Set(Object.keys(state.blueprints));
        for (const f of fs.readdirSync(blueprintsDir)) {
          if (f.endsWith('.yaml') && !currentSlugs.has(f.replace('.yaml', ''))) {
            fs.unlinkSync(path.join(blueprintsDir, f));
            log('blueprints', `removed stale: ${f}`);
          }
        }
      }

      for (const [slug, yaml] of Object.entries(state.blueprints)) {
        if (yaml && yaml.trim()) {
          this._writeFile(path.join('scene', 'blueprints', `${slug}.yaml`), yaml);
        }
      }
    }

    this._writeFile('scene/actors.yaml', state.actors);
    this._writeFile('scene/variables.yaml', state.variables);
    this._writeFile('scene/behaviors.yaml', state.behaviors);
    this._writeFile('scene/rules.yaml', state.rules);
    this._writeFile('scene/scripting-reference.md', state.scriptingReference);
    this._writeFile('scene/script-property-names.md', state.scriptPropertyNamePrompt);

    const scriptDir = path.join(this.dir, 'scripts');
    const existingScripts = new Set<string>();
    if (fs.existsSync(scriptDir)) {
      for (const f of fs.readdirSync(scriptDir)) {
        if (f.endsWith('.lua')) existingScripts.add(f.replace('.lua', ''));
      }
    }

    if (isFullSync) {
      this.lastSyncedScripts = {};
      for (const [slug, code] of Object.entries(state.scripts)) {
        this._writeFile(path.join('scripts', `${slug}.lua`), code);
        this.lastSyncedScripts[slug] = code;
        log('scripts', `synced: ${slug}.lua`);
      }
    } else {
      // Incremental: remove stale, keep local, write new
      const currentSlugs = new Set(Object.keys(state.scripts));
      for (const slug of existingScripts) {
        if (!currentSlugs.has(slug)) {
          fs.unlinkSync(path.join(scriptDir, `${slug}.lua`));
          log('scripts', `removed stale: ${slug}.lua`);
        }
      }
      for (const [slug, code] of Object.entries(state.scripts)) {
        if (!existingScripts.has(slug)) {
          this._writeFile(path.join('scripts', `${slug}.lua`), code);
          log('scripts', `wrote new: ${slug}.lua`);
        } else {
          log('scripts', `keeping local: ${slug}.lua`);
        }
      }
    }

    this._writeFile('.castle/slug-map.json', JSON.stringify(state.slugToEntryId, null, 2));
    log('state', `${Object.keys(state.scripts).length} scripts, ${Object.keys(state.slugToEntryId).length} blueprints`);

    setTimeout(() => {
      this.writingFiles = false;
    }, 300);
  }

  private _writeFile(relativePath: string, content: string) {
    const fullPath = path.join(this.dir, relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  private _writeConnectRegistry() {
    const registry = {
      sockPath: this.sockPath,
      connectRoot: this.connectRoot,
      deckDir: this.activeDeckDir,
      cardDir: this.dir,
      deckId: this.activeDeckId,
      cardId: this.activeCardId,
      mode: 'connect',
    };
    fs.mkdirSync(path.dirname(CONNECT_REGISTRY_PATH), { recursive: true });
    fs.writeFileSync(CONNECT_REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf8');
  }

  private _startWatcher() {
    const scriptsDir = path.join(this.dir, 'scripts');
    this.watcher?.close();
    this.watcher = null;
    log('watcher', `watching ${scriptsDir}`);

    this.watcher = chokidar.watch(scriptsDir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200 },
    });

    this.watcher.on('all', (event: string, filePath: string) => {
      if (event !== 'change' && event !== 'add') return;
      if (this.writingFiles) return;
      if (!filePath.endsWith('.lua')) return;

      const slug = path.basename(filePath, '.lua');
      const entryId = this.slugToEntryId[slug];
      if (!entryId) {
        log('watcher', `unknown script: ${slug}.lua (no matching blueprint)`);
        return;
      }

      const code = fs.readFileSync(filePath, 'utf-8');
      if (this.lastSyncedScripts[slug] === code) {
        return;
      }
      this.pendingScriptChanges.set(entryId, code);
      log('watcher', `script changed: ${slug}.lua`);

      if (this.scriptDebounceTimer) clearTimeout(this.scriptDebounceTimer);
      this.scriptDebounceTimer = setTimeout(() => {
        this._flushScriptChanges();
      }, SCRIPT_DEBOUNCE_MS);
    });
  }

  private _flushScriptChanges() {
    if (this.pendingScriptChanges.size === 0) return;

    const edits: Record<string, string> = {};
    for (const [entryId, code] of this.pendingScriptChanges) {
      edits[entryId] = code;
      const slug = this.entryIdToSlug[entryId] || entryId;
      this.lastSyncedScripts[slug] = code;
      log('send', `script edit: ${slug}`);
    }
    this.pendingScriptChanges.clear();

    this._sendToApp({
      innerType: 'cli4_script_edit',
      edits,
    });
    log('send', `sent ${Object.keys(edits).length} script edit(s)`);
  }

  private _onLogs(logs: any[]) {
    if (!logs || !Array.isArray(logs)) return;

    const logsPath = path.join(this.activeDeckDir || this.connectRoot, '.castle', 'logs.txt');
    const lines = logs.map((entry: any) => {
      const level = entry.level || 'log';
      const prefix = level === 'error' ? 'ERROR' : level === 'warn' ? 'WARN' : 'LOG';
      const blueprint = entry.blueprintTitle ? ` [${entry.blueprintTitle}]` : '';
      const count = entry.count > 1 ? ` (x${entry.count})` : '';
      const ts = new Date().toISOString().substring(11, 23);
      return `[${ts}] [${prefix}]${blueprint} ${entry.log}${count}`;
    });

    for (const entry of logs) {
      if (entry.level === 'error') {
        const bp = entry.blueprintTitle ? ` [${entry.blueprintTitle}]` : '';
        log('error', `${bp} ${entry.log}`);
      }
    }

    try {
      let existing = '';
      if (fs.existsSync(logsPath)) {
        existing = fs.readFileSync(logsPath, 'utf-8');
      }
      const combined = existing + lines.join('\n') + '\n';
      const maxSize = 100 * 1024;
      if (combined.length > maxSize) {
        const truncated = combined.slice(combined.length - maxSize);
        const firstNewline = truncated.indexOf('\n');
        fs.writeFileSync(logsPath, truncated.slice(firstNewline + 1));
      } else {
        fs.writeFileSync(logsPath, combined);
      }
    } catch {}
  }

  private _onScreenshotData(base64Data: string) {
    this.screenshotCounter++;
    const defaultFilename = `${String(this.screenshotCounter).padStart(3, '0')}.png`;
    const outPath = this.pendingScreenshot?.filename || path.join(this.screenshotsDir, defaultFilename);
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(base64Data, 'base64'));

    const latestPath = path.join(this.screenshotsDir, 'latest.png');
    fs.copyFileSync(outPath, latestPath);

    log('screenshot', `saved: ${outPath}`);

    if (this.pendingScreenshot) {
      this.pendingScreenshot.respond({ path: outPath });
      this.pendingScreenshot = null;
    }
  }

  private _onEditResult(msg: any) {
    log('edit', msg.success ? 'success' : 'failed', msg.error || '');
    if (this.pendingEdit) {
      this.pendingEdit.respond(msg);
      this.pendingEdit = null;
    }
  }

  private _startIPC() {
    try { fs.unlinkSync(this.sockPath); } catch {}

    this.ipcServer = net.createServer((conn) => {
      let data = '';
      conn.on('data', (chunk) => {
        data += chunk.toString();
        if (data.includes('\n')) {
          try {
            const request = JSON.parse(data.trim());
            this._handleIPC(request, (result) => {
              conn.write(JSON.stringify(result) + '\n');
              conn.end();
            });
          } catch {
            conn.write(JSON.stringify({ error: 'invalid request' }) + '\n');
            conn.end();
          }
        }
      });
    });

    this.ipcServer.listen(this.sockPath, () => {
      this._writeConnectRegistry();
      log('ipc', `listening on ${this.sockPath}`);
    });

    this.ipcServer.on('error', (err) => {
      log('ipc', 'error:', err.message);
    });
  }

  private _handleIPC(request: any, respond: (result: any) => void) {
    const { command } = request;
    log('ipc', 'command:', command);

    if (command === 'restart') {
      const logsPath = path.join(this.activeDeckDir || this.connectRoot, '.castle', 'logs.txt');
      const ts = new Date().toISOString().substring(11, 23);
      try { fs.appendFileSync(logsPath, `\n--- restart ${ts} ---\n`); } catch {}
      this._sendToApp({ innerType: 'cli4_restart' });
      respond({ ok: true });
    } else if (command === 'screenshot') {
      this.pendingScreenshot = { respond, filename: request.filename };
      this._sendToApp({ innerType: 'cli4_screenshot' });
    } else if (command === 'edit') {
      const requestId = `edit-${Date.now()}`;
      this.pendingEdit = { respond };
      this._sendToApp({ innerType: 'cli4_edit', args: request.args, requestId });
    } else if (command === 'status') {
      respond({
        connected: this.connected,
        blueprints: Object.keys(this.slugToEntryId).length,
        scripts: Object.keys(this.slugToEntryId).filter(slug =>
          fs.existsSync(path.join(this.dir, 'scripts', `${slug}.lua`))
        ).length,
        slugMap: this.slugToEntryId,
        cardDir: this.dir,
        deckDir: this.activeDeckDir,
        deckId: this.activeDeckId,
        cardId: this.activeCardId,
      });
    } else {
      respond({ error: `unknown command: ${command}` });
    }
  }
}
