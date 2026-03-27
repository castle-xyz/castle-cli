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
import { writeStateInternal, detectChanges, FileChanges, updateMetaHashes, stabilizeNewBlueprintIds, detectConflicts, initMetaFromDisk, readMeta, ConflictSummary } from './mobile-files.js';
import { initializeDeckDir, initializeCardDir } from './workspace.js';
import { FileWatcher } from './mobile-watcher.js';
import { Logger } from './logger.js';
import { writeDeckAgentFilesAsync } from './decks.js';

const WS_URL = 'wss://ws.castlexyz.com/ws';
const CASTLE_DIR = '.castle';
const SCREENSHOTS_DIR = 'screenshots';
const MAX_SCREENSHOTS = 100;
const RECONNECT_INTERVAL_MS = 3000;
const PING_INTERVAL_MS = 10000;
const PONG_TIMEOUT_MS = 3000;

export type SyncMode = 'both' | 'cli-to-mobile' | 'mobile-to-cli';

export interface CLIMobileConnectionOptions {
  deckDir: string;
  token: string;
  debug?: boolean;
  expectedDeckId?: string;
  cliPrimary?: boolean;   // Use local disk files as source of truth when conflict is detected (no prompt)
  mobilePrimary?: boolean; // Use mobile state as source of truth when conflict is detected (no prompt)
  syncMode?: SyncMode;
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
  private syncMode: SyncMode;
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

  private screenshotsDir: string;
  private screenshotCounter = 0;

  // Pending screenshot request
  private screenshotResolve: ((data: string | null) => void) | null = null;

  constructor({ deckDir, token, debug, expectedDeckId, cliPrimary, mobilePrimary, syncMode, onStateWritten }: CLIMobileConnectionOptions) {
    this.deckDir = deckDir;
    this.token = token;
    this.debug = !!debug;
    this.expectedDeckId = expectedDeckId ?? null;
    this.cliPrimary = !!cliPrimary;
    this.mobilePrimary = !!mobilePrimary;
    this.syncMode = syncMode ?? 'both';
    this.onStateWritten = onStateWritten;

    if (!fs.existsSync(deckDir)) fs.mkdirSync(deckDir, { recursive: true });
    const castleDir = path.join(deckDir, CASTLE_DIR);
    if (!fs.existsSync(castleDir)) fs.mkdirSync(castleDir, { recursive: true });
    this.screenshotsDir = path.join(castleDir, SCREENSHOTS_DIR);
    this.logger = new Logger(deckDir);
  }

  start() {
    this.logger.cli(`project directory: ${this.deckDir}`);
    if (this.debug) console.log(`[mobile] project directory: ${this.deckDir}`);
    this._connect();
  }

  setSyncMode(mode: SyncMode) {
    this.syncMode = mode;
    console.log(`[mobile] sync mode: ${mode}`);
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
      console.log('[mobile] connected to tunnel (waiting for mobile app...)');

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

    // cli-to-mobile: never write mobile state to disk — route straight to CLI-primary push.
    if (this.syncMode === 'cli-to-mobile') {
      if (!this.seenCards.has(cardId)) {
        this.seenCards.add(cardId);
        console.log(`[mobile] mobile app connected (card ${cardId}) — pushing local files to mobile`);
      }
      await this._handleStateInternalCLIPrimary(state, cardDir, cardId, deckDir);
      return;
    }

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
        console.log(`[mobile] mobile app connected (card ${cardId}) — pushing local files to mobile`);
      } else {
        console.log(`[mobile] mobile app connected (card ${cardId}, ${Object.keys(state.blueprints).length} blueprints, ${actorKeys.length} actors)`);
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

    // Check for draw hash mismatches: if mobile sent a blueprint with a different Drawing2.hash
    // than what's on disk, request the missing draw data.
    const mismatched = this._findDrawHashMismatches(state, cardDir);
    if (mismatched.length > 0) {
      this.logger.cli(`requesting draw data for ${mismatched.length} blueprint(s) with stale hashes`);
      this._sendToApp({ type: 'requestDrawData', entryIds: mismatched } as RequestDrawDataMessage);
    }

    await writeDeckAgentFilesAsync(deckDir);

    if (this.onStateWritten) {
      this.onStateWritten(cardId, deckDir);
    }

    if (!this.watchers.has(cardId)) {
      const watcher = new FileWatcher(cardDir, (_changes: FileChanges) => {
        if (this.syncMode !== 'mobile-to-cli') {
          this._sendFullState(cardDir);
        }
      });
      watcher.start();
      this.watchers.set(cardId, watcher);
    }

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
        if (this.syncMode !== 'mobile-to-cli') {
          this._sendFullState(cardDir);
        }
      });
      watcher.start();
      this.watchers.set(cardId, watcher);
    }

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

    // Collect entryIds of blueprints that are new on disk (just stabilized) so we can
    // include forkBlueprintId — mobile can't edit a blueprint it's never seen before.
    const newBlueprintEntryIds = new Set<string>();
    if (changes) {
      for (const bp of Object.values(changes.changedBlueprints)) {
        if (bp.isNew && bp.entryId) newBlueprintEntryIds.add(bp.entryId);
      }
    }

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
        if (newBlueprintEntryIds.has(entryId)) {
          bp.forkBlueprintId = bpData?.forkBlueprintId || 'default-blueprint-0';
        }
        // Send YAML drawing shorthand on every call until .draw.json exists (i.e. until the
        // drawing has been echoed back from mobile and written to disk by writeStateInternal).
        if (bpData?.drawing && !fs.existsSync(drawJsonPath)) {
          bp.drawing = bpData.drawing;
        }

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
      const changes = detectChanges(cardDir);
      if (changes?.hasChanges) {
        this._sendFullState(cardDir);
      }
    }
  }

  async cmdScreenshot(): Promise<any> {
    this._flushFileChanges();

    if (!this.connected) {
      this.logger.cli('screenshot: not connected');
      return { error: 'not connected', doneAt: new Date().toISOString() };
    }

    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (this.screenshotResolve) {
        this.screenshotResolve(null);
        this.screenshotResolve = null;
      }

      this.logger.cli(`screenshot: requesting... (attempt ${attempt}/${MAX_ATTEMPTS})`);
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

      if (data) {
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

      this.logger.cli(`screenshot: no data (attempt ${attempt}/${MAX_ATTEMPTS})`);
      if (!this.connected) break;
    }

    return { error: 'timed out', doneAt: new Date().toISOString() };
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

  async cmdStopAndPlay(): Promise<any> {
    this._flushFileChanges();

    if (!this.connected) {
      this.logger.cli('stopAndPlay: not connected');
      return { error: 'not connected', doneAt: new Date().toISOString() };
    }

    this.logger.cli('stopAndPlay: sending...');
    this._sendToApp({ type: 'stopAndPlay' });
    return { doneAt: new Date().toISOString() };
  }

  stop() {
    this.shouldReconnect = false;
    this._stateQueue = Promise.resolve();
    this._editIdCounter = 0;
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
