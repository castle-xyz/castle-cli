import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import WebSocket from 'ws';
import yaml from 'yaml';
import { v4 as uuidv4 } from 'uuid';
import {
  StateInternalMessage,
  VariableData,
  LogsMessage,
  ScreenshotMessage,
  CLIScreenshotMessage,
  AppToCliMessage,
  RequestStateMessage,
  RequestDrawDataMessage,
} from './mobile-protocol.js';
import { writeStateInternal, detectChanges, FileChanges, mobileInternalStateToSceneData, updateMetaHashes, stabilizeNewBlueprintIds, detectConflicts, initMetaFromDisk, readMeta, ConflictSummary } from './mobile-files.js';
import { initializeDeckDir, initializeCardDir } from './workspace.js';
import { FileWatcher } from './mobile-watcher.js';
import { Logger } from './logger.js';
import { generateSceneContext, writeDeckAgentFilesAsync } from './decks.js';

const WS_URL = 'wss://ws.castlexyz.com/ws';
const CASTLE_DIR = '.castle';
const COMMANDS_FILE = 'commands.json';
const SCREENSHOTS_DIR = 'screenshots';
const MAX_SCREENSHOTS = 100;
const COMMANDS_POLL_MS = 500;
const MAX_COMMAND_LINES = 200;
const RECONNECT_INTERVAL_MS = 3000;
const PING_INTERVAL_MS = 10000;
const PONG_TIMEOUT_MS = 3000;

export interface CLIMobileConnectionOptions {
  deckDir: string;
  token: string;
  debug?: boolean;
  expectedDeckId?: string;
  cliPrimary?: boolean;   // Use local disk files as source of truth when conflict is detected (no prompt)
  mobilePrimary?: boolean; // Use mobile state as source of truth when conflict is detected (no prompt)
  onStateWritten?: (cardId: string, deckDir: string) => void;
}

export class CLIMobileConnection {
  private ws: WebSocket | null = null;
  private watchers: Map<string, FileWatcher> = new Map();
  private cardDirs: Map<string, string> = new Map();
  private deckDir: string;
  private token: string;
  private debug: boolean;
  private expectedDeckId: string | null;
  private lockedDeckId: string | null = null;
  private activeDeckDir: string | null = null;
  private onStateWritten?: (cardId: string, deckDir: string) => void;
  private lastCliSessionIds: Map<string, string> = new Map();
  private logger: Logger;
  private cliPrimary: boolean;
  private mobilePrimary: boolean;
  private connected = false;
  private shouldReconnect = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;

  // Stable session ID used in state_internal messages sent from CLI → Mobile.
  private _cliSessionId: string = uuidv4();

  // Blueprint/draw hash tracking for CLI → Mobile: only send when content changed.
  private _lastSentDrawHashes: Map<string, string> = new Map(); // entryId → last sent Drawing2.hash
  private _lastSentBlueprintHashes: Map<string, string> = new Map(); // entryId → hash of components+script

  // Tracks cardIds we've received state_internal for (for first-sync log).
  private seenCards: Set<string> = new Set();

  // Serialization queue: ensures only one state handler runs at a time to prevent races.
  private _stateQueue: Promise<void> = Promise.resolve();
  private _editIdCounter: number = 0;

  // Commands
  private commandsPollTimer: ReturnType<typeof setInterval> | null = null;
  private commandsPath: string;
  private screenshotsDir: string;
  private screenshotCounter = 0;
  private processingCommands = false;

  // Pending screenshot request
  private screenshotResolve: ((data: string | null) => void) | null = null;

  constructor({ deckDir, token, debug, expectedDeckId, cliPrimary, mobilePrimary, onStateWritten }: CLIMobileConnectionOptions) {
    this.deckDir = deckDir;
    this.token = token;
    this.debug = !!debug;
    this.expectedDeckId = expectedDeckId ?? null;
    this.cliPrimary = !!cliPrimary;
    this.mobilePrimary = !!mobilePrimary;
    this.onStateWritten = onStateWritten;

    if (!fs.existsSync(deckDir)) fs.mkdirSync(deckDir, { recursive: true });
    const castleDir = path.join(deckDir, CASTLE_DIR);
    if (!fs.existsSync(castleDir)) fs.mkdirSync(castleDir, { recursive: true });
    this.commandsPath = path.join(castleDir, COMMANDS_FILE);
    this.screenshotsDir = path.join(castleDir, SCREENSHOTS_DIR);
    this.logger = new Logger(deckDir);
  }

  start() {
    this.logger.cli(`project directory: ${this.deckDir}`);
    if (this.debug) console.log(`[mobile] project directory: ${this.deckDir}`);
    this._connect();
  }

  private _connect() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    const url = `${WS_URL}?token=${this.token}`;
    this.logger.cli('connecting to tunnel...');
    if (this.debug) console.log('[mobile] connecting to tunnel...');

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.connected = true;
      this.logger.cli('connected to tunnel');
      console.log('[mobile] connected');

      // Enable the cli tunnel feature
      this._send({ type: 'cli_tunnel_start_listening' });

      // Reset hash tracking on reconnect so first edits include fresh data
      this._lastSentDrawHashes.clear();
      this._lastSentBlueprintHashes.clear();

      // Request state from app, providing known draw hashes so mobile can skip redundant sends
      const knownDrawHashes = this._buildKnownDrawHashes();
      this._sendToApp({ type: 'requestState', knownDrawHashes });

      // Start keepalive pings
      this._startPing();

      // Start commands poll immediately on connect (don't wait for state_internal)
      this._startCommandsPoll();
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        // Unwrap tunnel envelope
        if (msg.type === 'cli_tunnel_send_message') {
          const inner = { ...msg };
          delete inner.type;
          delete inner.clientId;
          // Use innerType as the actual message type
          if (inner.innerType) {
            inner.type = inner.innerType;
            delete inner.innerType;
          }
          this._handleMessage(inner as AppToCliMessage);
        }
      } catch (e: any) {
        this.logger.cli(`failed to parse message: ${e.message}`);
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      this._stopPing();
      this.logger.cli('disconnected from tunnel');
      console.log('[mobile] disconnected');
      this._scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      this.logger.cli(`tunnel error: ${error.message}`);
    });
  }

  private _startPing() {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        // If no pong within timeout, connection is dead
        this.pongTimer = setTimeout(() => {
          this.logger.cli('pong timeout — reconnecting');
          if (this.debug) console.log('[mobile] pong timeout — reconnecting');
          if (this.ws) {
            this.ws.terminate();
          }
        }, PONG_TIMEOUT_MS);
      }
    }, PING_INTERVAL_MS);

    // Clear pong timer on pong received
    if (this.ws) {
      this.ws.on('pong', () => {
        if (this.pongTimer) {
          clearTimeout(this.pongTimer);
          this.pongTimer = null;
        }
      });
    }
  }

  private _stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private _scheduleReconnect() {
    if (!this.shouldReconnect) return;
    if (this.reconnectTimer) return;
    console.log('[mobile] reconnecting...');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, RECONNECT_INTERVAL_MS);
  }

  // Send a message through the tunnel
  private _send(msg: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // Send a message to the app through the tunnel
  private _sendToApp(msg: any) {
    const { type, ...rest } = msg;
    this._send({
      type: 'cli_tunnel_send_message',
      innerType: type,
      ...rest,
    });
  }

  private _handleMessage(msg: AppToCliMessage) {
    if (msg.type === 'state_internal') {
      this._stateQueue = this._stateQueue.then(() =>
        this._handleStateInternal(msg as StateInternalMessage).catch((e) =>
          this.logger.cli(`[mobile] error handling state_internal: ${e}`)
        )
      );
    } else if (msg.type === 'logs') {
      this._handleLogs(msg as LogsMessage);
    } else if (msg.type === 'screenshot') {
      this._handleScreenshot(msg as ScreenshotMessage);
    } else if (msg.type === 'cliScreenshot') {
      this._handleCLIScreenshot(msg as CLIScreenshotMessage);
    } else if (msg.type === 'editResult') {
      const result = msg as any;
      if (this.debug) console.log(`[mobile] editResult: success=${result.success} error=${result.error ?? 'none'}`);
      if (!result.success) {
        this.logger.cli(`edit failed: ${result.error}`);
      }
    } else if (msg.type === 'pong') {
      // keepalive response
    } else {
      if (this.debug) console.log(`[mobile] unknown message type: ${(msg as any).type}`, JSON.stringify(msg).slice(0, 200));
    }
  }

  private _handleLogs(msg: LogsMessage) {
    for (const entry of msg.logs) {
      const count = entry.count && entry.count > 1 ? ` (${entry.count}x)` : '';
      this.logger.deck(`${entry.log}${count}`, entry.level, entry.blueprintTitle);
    }
  }

  private async _handleStateInternal(state: StateInternalMessage) {
    const cardId = state.cardId;
    let deckDir: string;

    if (this.expectedDeckId !== null) {
      if (state.deckId !== this.expectedDeckId) {
        this.logger.cli(`⚠  Mobile has deck ${state.deckId} open, but this directory serves deck ${this.expectedDeckId}.\n   Switch to the correct deck on mobile to enable sync.`);
        return;
      }
      deckDir = this.deckDir;
    } else {
      if (this.lockedDeckId === null) {
        this.lockedDeckId = state.deckId;
        this.activeDeckDir = path.join(this.deckDir, `deck-${state.deckId}`);
      } else if (state.deckId !== this.lockedDeckId) {
        this.logger.cli(`⚠  Mobile switched to deck ${state.deckId}. Currently locked to deck ${this.lockedDeckId}.\n   Restart \`castle serve\` to work with a different deck.`);
        return;
      }
      deckDir = this.activeDeckDir!;
      initializeDeckDir(deckDir, state.deckId);
    }

    const cardDir = path.join(deckDir, `card-${cardId}`);
    this.cardDirs.set(cardId, cardDir);

    const actorKeys = Object.keys(state.actors);
    this.logger.cli(`received state_internal for card ${cardId}: ${Object.keys(state.blueprints).length} blueprints, ${actorKeys.length} actors`);

    initializeCardDir(cardDir, cardId);

    const lastSessionId = this.lastCliSessionIds.get(cardId);
    const sessionChanged = !!lastSessionId && lastSessionId !== state.cliSessionId;

    // Detect conflicts only on first connect or session change — not on every subsequent
    // mobile state (which would spam the user as the game runs and actors move).
    const isFirstConnect = !this.seenCards.has(cardId);
    const conflicts = (isFirstConnect || sessionChanged) ? detectConflicts(cardDir, state) : null;
    let useCLIPrimary = false;
    if (conflicts?.hasConflicts) {
      if (this.cliPrimary) {
        useCLIPrimary = true;
      } else if (!this.mobilePrimary) {
        useCLIPrimary = await this._promptConflictResolution(conflicts);
      }
    }

    this.lastCliSessionIds.set(cardId, state.cliSessionId);

    if (!this.seenCards.has(cardId)) {
      this.seenCards.add(cardId);
      if (useCLIPrimary) {
        console.log(`[mobile] card ${cardId}: CLI-primary sync — pushing local files to mobile`);
      } else {
        console.log(`[mobile] card ${cardId}: synced (${Object.keys(state.blueprints).length} blueprints, ${actorKeys.length} actors)`);
      }
    }

    if (useCLIPrimary) {
      await this._handleStateInternalCLIPrimary(state, cardDir, cardId, deckDir);
      return;
    }

    // Mobile-primary path: wipe workspace on session change, then write mobile state to disk.
    if (!lastSessionId || sessionChanged) {
      if (fs.existsSync(cardDir)) {
        for (const entry of fs.readdirSync(cardDir)) {
          if (entry === 'card.yaml') continue;
          fs.rmSync(path.join(cardDir, entry), { recursive: true, force: true });
        }
        this.logger.cli(sessionChanged ? `session changed — wiped card workspace for ${cardId}` : `wiped card workspace for fresh sync (${cardId})`);
      }
    }

    await writeStateInternal(cardDir, state);
    this.logger.cli(`wrote ${Object.keys(state.blueprints).length} blueprints, ${Object.keys(state.actors).length} actors for card ${cardId}`);

    // If any actor is missing persistentId, send full state so C++ stores them.
    // Older decks load from CDN without persistentId; newer decks already have them.
    const allHavePersistentId = Object.values(state.actors).every((a: any) => !!a.persistentId);
    if (!allHavePersistentId) {
      this._sendFullState(cardDir);
    }

    // Check for draw hash mismatches: if mobile sent a blueprint with a different Drawing2.hash
    // than what's on disk, request the missing draw data.
    const mismatched = this._findDrawHashMismatches(state, cardDir);
    if (mismatched.length > 0) {
      this.logger.cli(`requesting draw data for ${mismatched.length} blueprint(s) with stale hashes`);
      this._sendToApp({ type: 'requestDrawData', entryIds: mismatched } as RequestDrawDataMessage);
    }

    const sceneData = mobileInternalStateToSceneData(state);
    const sceneContext = await generateSceneContext(sceneData);
    if (sceneContext) {
      fs.writeFileSync(path.join(cardDir, 'SCENE.md'), sceneContext);
    }
    await writeDeckAgentFilesAsync(deckDir);

    const castleDir = path.join(deckDir, CASTLE_DIR);
    if (!fs.existsSync(castleDir)) fs.mkdirSync(castleDir, { recursive: true });
    const cardVersionsPath = path.join(castleDir, 'cardversions.json');
    let cardVersions: any = {};
    try {
      cardVersions = JSON.parse(fs.readFileSync(cardVersionsPath, 'utf-8'));
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        console.warn('[mobile] failed to parse cardversions.json:', e);
      }
    }
    cardVersions[cardId] = 'mobile';
    fs.writeFileSync(cardVersionsPath, JSON.stringify(cardVersions, null, 2));

    if (this.onStateWritten) {
      this.onStateWritten(cardId, deckDir);
    }

    if (!this.watchers.has(cardId)) {
      const watcher = new FileWatcher(cardDir, (_changes: FileChanges) => {
        this._sendFullState(cardDir);
      });
      watcher.start();
      this.watchers.set(cardId, watcher);
    }

    this._startCommandsPoll();
  }

  // CLI-primary: push disk state to mobile instead of writing mobile state to disk.
  private async _handleStateInternalCLIPrimary(
    state: StateInternalMessage,
    cardDir: string,
    cardId: string,
    deckDir: string,
  ) {
    // Initialize meta.json from disk files so the file watcher has a correct hash baseline
    initMetaFromDisk(cardDir, state.deckId, cardId);

    // Push full disk state to mobile (includes persistentId for all actors)
    this._sendFullState(cardDir);

    await writeDeckAgentFilesAsync(deckDir);

    if (this.onStateWritten) {
      this.onStateWritten(cardId, deckDir);
    }

    if (!this.watchers.has(cardId)) {
      const watcher = new FileWatcher(cardDir, (_changes: FileChanges) => {
        this._sendFullState(cardDir);
      });
      watcher.start();
      this.watchers.set(cardId, watcher);
    }

    this._startCommandsPoll();
    this.logger.cli(`CLI-primary: pushed disk state to mobile (card ${cardId})`);
  }

  // Prompt the user on stderr to choose CLI or mobile state when a conflict is detected.
  // Returns true to use CLI (disk) state, false to use mobile state.
  private async _promptConflictResolution(conflicts: ConflictSummary): Promise<boolean> {
    if (!process.stdin.isTTY) {
      process.stderr.write(
        '[mobile] Conflict detected between local files and mobile state, but stdin is not interactive.\n' +
        '         Defaulting to mobile state. Use --cli-primary or --mobile-primary to suppress this prompt.\n'
      );
      return false;
    }

    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

    const lines: string[] = ['', '[mobile] Conflict: mobile state differs from local files.'];
    if (conflicts.localOnlyBlueprintSlugs.length > 0) {
      lines.push(`  Local-only blueprints: ${conflicts.localOnlyBlueprintSlugs.join(', ')}`);
    }
    if (conflicts.mobileOnlyBlueprintEntryIds.length > 0) {
      lines.push(`  Mobile-only blueprints: ${conflicts.mobileOnlyBlueprintEntryIds.length}`);
    }
    if (conflicts.actorsDiffer) lines.push('  Actors differ');
    if (conflicts.variablesDiffer) lines.push('  Variables differ');
    process.stderr.write(lines.join('\n') + '\n');

    return new Promise<boolean>((resolve) => {
      rl.question('[mobile] Use [L]ocal files (push to mobile) or [M]obile state (overwrite local)? [L/m] ', (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() !== 'm');
      });
    });
  }

  private _sendFullState(cardDir: string) {
    if (!this.connected) {
      this.logger.cli('not connected, skipping full state send');
      return;
    }

    // Stabilize any new blueprint IDs (writes to meta.json if needed)
    const changes = detectChanges(cardDir);
    if (changes) stabilizeNewBlueprintIds(changes, cardDir);

    const meta = readMeta(cardDir);
    if (!meta) return;

    // Build full blueprints from disk
    const blueprints: Record<string, any> = {};
    const bpDir = path.join(cardDir, 'blueprints');
    if (fs.existsSync(bpDir)) {
      for (const file of fs.readdirSync(bpDir)) {
        if (!file.endsWith('.yaml')) continue;
        const slug = file.replace('.yaml', '');
        let bpData: any;
        try {
          bpData = yaml.parse(fs.readFileSync(path.join(bpDir, file), 'utf-8')) as any;
        } catch { continue; }

        const entryId: string | undefined = bpData?.entryId ?? meta.blueprintIdMap[slug];
        if (!entryId) continue;

        const components = { ...(bpData?.components ?? {}) };
        if (components.Script?.file) {
          const { file: _f, ...rest } = components.Script;
          components.Script = rest;
        }

        const luaPath = path.join(bpDir, `${slug}.lua`);
        const luaContent = fs.existsSync(luaPath) ? fs.readFileSync(luaPath, 'utf-8') : null;

        // Draw data: include only if hash changed vs what we last sent
        let drawing: any = undefined;
        const drawJsonPath = path.join(bpDir, `${slug}.draw.json`);
        if (fs.existsSync(drawJsonPath)) {
          try {
            const drawData = JSON.parse(fs.readFileSync(drawJsonPath, 'utf-8'));
            const hash = drawData?.Drawing2?.hash;
            if (hash && this._lastSentDrawHashes.get(entryId) !== hash) {
              drawing = drawData;
              this._lastSentDrawHashes.set(entryId, hash);
            }
          } catch {}
        }

        const bp: any = { entryId, title: bpData?.title ?? slug };

        // Only include components/script if content changed since last sent (avoids
        // repeated re-application of rules on mobile which corrupts rule state)
        const componentsYaml = Object.keys(components).length > 0 ? yaml.stringify(components, { lineWidth: 120 }) : '';
        const bpHash = crypto.createHash('sha256').update(componentsYaml + (luaContent ?? '')).digest('hex');
        if (this._lastSentBlueprintHashes.get(entryId) !== bpHash) {
          if (componentsYaml) bp.components = componentsYaml;
          if (luaContent) bp.script = [{ code: luaContent }];
          this._lastSentBlueprintHashes.set(entryId, bpHash);
        }

        if (drawing) bp.drawing = drawing;
        blueprints[entryId] = bp;
      }
    }

    // Build full actors with persistentId
    const actors: Record<string, any> = {};
    const actorsPath = path.join(cardDir, 'actors.yaml');
    if (fs.existsSync(actorsPath)) {
      try {
        const raw = yaml.parse(fs.readFileSync(actorsPath, 'utf-8'));
        if (raw && !Array.isArray(raw)) {
          for (const [key, actor] of Object.entries(raw as Record<string, any>)) {
            actors[key] = { ...(actor as any), persistentId: key };
          }
        }
      } catch {}
    }

    // Build variables
    let variables: VariableData[] = [];
    const variablesPath = path.join(cardDir, 'variables.yaml');
    if (fs.existsSync(variablesPath)) {
      try {
        const raw = yaml.parse(fs.readFileSync(variablesPath, 'utf-8'));
        if (Array.isArray(raw)) variables = raw as VariableData[];
      } catch {}
    }

    const msg: StateInternalMessage = {
      type: 'state_internal',
      deckId: meta.deckId,
      cardId: meta.cardId,
      cliSessionId: this._cliSessionId,
      editId: ++this._editIdCounter,
      blueprints,
      actors,
      variables,
    };

    this.logger.cli(`sending full state: ${Object.keys(blueprints).length} blueprints, ${Object.keys(actors).length} actors`);
    this._sendToApp(msg);
    updateMetaHashes(cardDir);
  }

  // Build a map of entryId → Drawing2.hash for all .draw.json files currently on disk.
  // Sent in requestState so mobile can skip draw data we already have.
  private _buildKnownDrawHashes(): Record<string, string> {
    const result: Record<string, string> = {};
    const baseDir = this.deckDir;

    const scanCardDir = (cardDir: string) => {
      const meta = readMeta(cardDir);
      if (!meta?.blueprintIdMap) return;
      const bpDir = path.join(cardDir, 'blueprints');
      if (!fs.existsSync(bpDir)) return;
      for (const file of fs.readdirSync(bpDir)) {
        if (!file.endsWith('.draw.json')) continue;
        const slug = file.slice(0, -'.draw.json'.length);
        const entryId = meta.blueprintIdMap[slug];
        if (!entryId) continue;
        try {
          const data = JSON.parse(fs.readFileSync(path.join(bpDir, file), 'utf-8'));
          const hash = data?.Drawing2?.hash;
          if (hash) result[entryId] = hash;
        } catch {}
      }
    };

    // Scan direct card-* dirs (for expectedDeckId case)
    try {
      for (const entry of fs.readdirSync(baseDir)) {
        if (entry.startsWith('card-')) scanCardDir(path.join(baseDir, entry));
      }
    } catch {}

    // Scan deck-*/card-* dirs (for no-expectedDeckId case)
    try {
      for (const entry of fs.readdirSync(baseDir)) {
        if (entry.startsWith('deck-')) {
          const deckSubDir = path.join(baseDir, entry);
          try {
            for (const cardEntry of fs.readdirSync(deckSubDir)) {
              if (cardEntry.startsWith('card-')) scanCardDir(path.join(deckSubDir, cardEntry));
            }
          } catch {}
        }
      }
    } catch {}

    return result;
  }

  // Find blueprints where the Drawing2.hash in the received state differs from what's on disk.
  // Returns entryIds that need their draw data re-sent.
  private _findDrawHashMismatches(state: StateInternalMessage, cardDir: string): string[] {
    const meta = readMeta(cardDir);
    if (!meta?.blueprintIdMap) return [];
    const slugByEntryId = Object.fromEntries(
      Object.entries(meta.blueprintIdMap).map(([slug, id]) => [id, slug])
    );
    const mismatched: string[] = [];
    for (const [entryId, blueprint] of Object.entries(state.blueprints)) {
      const d2 = (blueprint as any)?.actorBlueprint?.components?.Drawing2;
      if (!d2?.hash) continue;
      const slug = slugByEntryId[entryId];
      if (!slug) continue;
      const drawPath = path.join(cardDir, 'blueprints', `${slug}.draw.json`);
      try {
        const data = JSON.parse(fs.readFileSync(drawPath, 'utf-8'));
        const diskHash = data?.Drawing2?.hash;
        if (diskHash !== d2.hash) mismatched.push(entryId);
      } catch {
        // File doesn't exist — need the draw data
        mismatched.push(entryId);
      }
    }
    return mismatched;
  }

  // Flush any pending file changes to the app (for all active cards)
  private _flushFileChanges() {
    for (const [cardId] of this.watchers) {
      const cardDir = this.cardDirs.get(cardId) ?? path.join(this.deckDir, `card-${cardId}`);
      this._sendFullState(cardDir);
    }
  }

  // --- Commands ---

  private _startCommandsPoll() {
    if (this.commandsPollTimer) return;
    this.commandsPollTimer = setInterval(() => this._pollCommands(), COMMANDS_POLL_MS);
  }

  private _stopCommandsPoll() {
    if (this.commandsPollTimer) {
      clearInterval(this.commandsPollTimer);
      this.commandsPollTimer = null;
    }
  }

  private _pollCommands() {
    if (this.processingCommands) return;
    if (!fs.existsSync(this.commandsPath)) return;
    let content: string;
    try {
      content = fs.readFileSync(this.commandsPath, 'utf-8');
    } catch {
      return;
    }

    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length === 0) return;

    const parsed: any[] = [];
    let hasUnprocessed = false;
    for (const line of lines) {
      try {
        const cmd = JSON.parse(line);
        parsed.push(cmd);
        if (!cmd.response) hasUnprocessed = true;
      } catch {
        parsed.push({ _raw: line, response: { error: 'invalid json' } });
      }
    }
    if (!hasUnprocessed) return;

    this._processCommands(parsed, lines.length);
  }

  private async _processCommands(commands: any[], originalLineCount: number) {
    this.processingCommands = true;
    try {
      for (const cmd of commands) {
        if (cmd.response) continue;
        if (!cmd.type) {
          cmd.response = { error: 'missing type', doneAt: new Date().toISOString() };
          continue;
        }
        try {
          switch (cmd.type) {
            case 'screenshot':
              cmd.response = await this._cmdScreenshot();
              break;
            case 'stopAndPlay':
              cmd.response = await this._cmdStopAndPlay();
              break;
            default:
              cmd.response = { error: `unknown command: ${cmd.type}`, doneAt: new Date().toISOString() };
              this.logger.cli(`unknown command: ${cmd.type}`);
          }
        } catch (e: any) {
          cmd.response = { error: e.message, doneAt: new Date().toISOString() };
          this.logger.cli(`command ${cmd.type} failed: ${e.message}`);
        }
      }

      let newLines: string[] = [];
      try {
        const current = fs.readFileSync(this.commandsPath, 'utf-8');
        const currentLines = current.split('\n').filter(l => l.trim());
        if (currentLines.length > originalLineCount) {
          newLines = currentLines.slice(originalLineCount);
        }
      } catch {}

      this._writeCommands(commands, newLines);
    } finally {
      this.processingCommands = false;
    }
  }

  private _writeCommands(commands: any[], appendLines: string[] = []) {
    try {
      let lines = commands.map(cmd => {
        if (cmd._raw) return cmd._raw;
        return JSON.stringify(cmd);
      });
      lines.push(...appendLines);
      if (lines.length > MAX_COMMAND_LINES + 200) {
        lines = lines.slice(lines.length - MAX_COMMAND_LINES);
      }
      fs.writeFileSync(this.commandsPath, lines.join('\n') + '\n');
    } catch (e: any) {
      this.logger.cli(`failed to write commands.json: ${e.message}`);
    }
  }

  private async _cmdScreenshot(): Promise<any> {
    this._flushFileChanges();

    if (!this.connected) {
      this.logger.cli('screenshot: not connected');
      return { error: 'not connected', doneAt: new Date().toISOString() };
    }

    if (this.screenshotResolve) {
      this.screenshotResolve(null);
      this.screenshotResolve = null;
    }

    this.logger.cli('screenshot: requesting...');
    this._sendToApp({ type: 'requestScreenshot' });

    const data = await new Promise<string | null>((resolve) => {
      this.screenshotResolve = resolve;
      setTimeout(() => {
        if (this.screenshotResolve === resolve) {
          this.screenshotResolve = null;
          resolve(null);
        }
      }, 5000);
    });

    if (!data) {
      this.logger.cli('screenshot: timed out');
      return { error: 'timed out', doneAt: new Date().toISOString() };
    }

    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
    }

    const buf = Buffer.from(data, 'base64');

    const latestPath = path.join(this.screenshotsDir, 'latest.png');
    fs.writeFileSync(latestPath, buf);

    this.screenshotCounter++;
    const numberedName = `${String(this.screenshotCounter).padStart(3, '0')}.png`;
    fs.writeFileSync(path.join(this.screenshotsDir, numberedName), buf);

    const files = fs.readdirSync(this.screenshotsDir)
      .filter(f => f.match(/^\d{3}\.png$/))
      .sort();
    while (files.length > MAX_SCREENSHOTS) {
      const old = files.shift()!;
      fs.unlinkSync(path.join(this.screenshotsDir, old));
    }

    const screenshotPath = `.castle/screenshots/${numberedName}`;
    this.logger.cli(`screenshot: saved ${screenshotPath} (${Math.round(buf.length / 1024)}KB)`);
    console.log(`[mobile] screenshot saved: ${screenshotPath} (${Math.round(buf.length / 1024)}KB)`);
    return { doneAt: new Date().toISOString(), file: screenshotPath };
  }

  private _handleScreenshot(msg: ScreenshotMessage) {
    if (this.screenshotResolve) {
      this.screenshotResolve(msg.data);
      this.screenshotResolve = null;
    }
  }

  private _handleCLIScreenshot(msg: CLIScreenshotMessage) {
    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
    }

    const buf = Buffer.from(msg.data, 'base64');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const suffix = msg.suffix ? `_${msg.suffix}` : '';
    const filename = `${timestamp}${suffix}.png`;

    fs.writeFileSync(path.join(this.screenshotsDir, filename), buf);
    fs.writeFileSync(path.join(this.screenshotsDir, 'latest.png'), buf);

    const files = fs.readdirSync(this.screenshotsDir)
      .filter(f => f !== 'latest.png' && f.endsWith('.png'))
      .sort();
    while (files.length > 100) {
      const old = files.shift()!;
      fs.unlinkSync(path.join(this.screenshotsDir, old));
    }

    this.logger.cli(`cliScreenshot: saved ${filename} (${Math.round(buf.length / 1024)}KB)`);
  }

  private async _cmdStopAndPlay(): Promise<any> {
    this._flushFileChanges();

    if (!this.connected) {
      this.logger.cli('stopAndPlay: not connected');
      return { error: 'not connected', doneAt: new Date().toISOString() };
    }

    this.logger.cli('stopAndPlay: sending...');
    this._sendToApp({ type: 'stopAndPlay' });
    return { doneAt: new Date().toISOString() };
  }

  // --- End Commands ---

  stop() {
    this.shouldReconnect = false;
    this._stateQueue = Promise.resolve();
    this._editIdCounter = 0;
    this._stopCommandsPoll();
    this._stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const watcher of this.watchers.values()) {
      watcher.stop();
    }
    this.watchers.clear();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }
}
