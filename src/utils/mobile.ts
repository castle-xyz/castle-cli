import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import yaml from 'yaml';
import {
  StateInternalMessage,
  StateInternalDiffMessage,
  EditMessage,
  LogsMessage,
  ScreenshotMessage,
  CLIScreenshotMessage,
  AppToCliMessage,
} from './mobile-protocol.js';
import { writeStateInternal, applyStateDiff, detectChanges, FileChanges, mobileInternalStateToSceneData, updateMetaHashes } from './mobile-files.js';
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
  private connected = false;
  private shouldReconnect = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;

  // The last actors dict received from mobile, per cardDir. Used to compute
  // which keys were *newly added* by the user's edit vs already present in mobile.
  private lastMobileActors: Map<string, Record<string, any>> = new Map();

  // The last full StateInternalMessage received per cardId. Used to apply incremental diffs.
  private lastInternalStates: Map<string, StateInternalMessage> = new Map();

  // Tracks actor edits we sent that mobile may not have processed yet.
  // addedKeys: keys the user newly added — these need re-apply if mobile races us with stale state.
  // addedActors: disk-format data for each added key, to restore if mobile's state lacks them.
  // Deletions are fire-and-forget; only additions are enforced to avoid fighting game-managed actors.
  private pendingActors: Map<string, { addedActors: Record<string, any>; addedKeys: string[] }> = new Map();

  // Tracks cardIds we've received state_internal for (for first-sync log).
  private seenCards: Set<string> = new Set();

  // Serialization queue: ensures only one state handler runs at a time to prevent races.
  private _stateQueue: Promise<void> = Promise.resolve();
  private _msgSeq: number = 0;
  private _latestFullStateSeq: number = 0;
  private _editIdCounter: number = 0;

  // Commands
  private commandsPollTimer: ReturnType<typeof setInterval> | null = null;
  private commandsPath: string;
  private screenshotsDir: string;
  private screenshotCounter = 0;
  private processingCommands = false;

  // Pending screenshot request
  private screenshotResolve: ((data: string | null) => void) | null = null;

  constructor({ deckDir, token, debug, expectedDeckId, onStateWritten }: CLIMobileConnectionOptions) {
    this.deckDir = deckDir;
    this.token = token;
    this.debug = !!debug;
    this.expectedDeckId = expectedDeckId ?? null;
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

      // Request state from app (in case app is already open)
      this._send({ type: 'cli_tunnel_send_message', innerType: 'requestState' });

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
      const seq = ++this._msgSeq;
      this._latestFullStateSeq = seq;
      this._stateQueue = this._stateQueue.then(() =>
        this._handleStateInternal(msg as StateInternalMessage).catch((e) =>
          this.logger.cli(`[mobile] error handling state_internal: ${e}`)
        )
      );
    } else if (msg.type === 'state_internal_diff') {
      const seq = ++this._msgSeq;
      const capturedFullStateSeq = this._latestFullStateSeq;
      this._stateQueue = this._stateQueue.then(() => {
        // Skip this diff if a newer full state_internal was enqueued after it.
        // The mobile builds full state from EDITOR_LIBRARY/EDITOR_ACTORS at send time,
        // so a newer full state already incorporates all changes from this diff.
        if (this._latestFullStateSeq > capturedFullStateSeq) {
          if (this.debug) console.log(`[mobile] skipping stale state_internal_diff (seq=${seq}, latestFull=${this._latestFullStateSeq})`);
          return;
        }
        return this._handleStateInternalDiff(msg as StateInternalDiffMessage).catch((e) =>
          this.logger.cli(`[mobile] error handling state_internal_diff: ${e}`)
        );
      });
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
    if (!this.seenCards.has(cardId)) {
      this.seenCards.add(cardId);
      console.log(`[mobile] card ${cardId}: synced (${Object.keys(state.blueprints).length} blueprints, ${actorKeys.length} actors)`);
    }

    initializeCardDir(cardDir, cardId);

    const lastSessionId = this.lastCliSessionIds.get(cardId);
    const sessionChanged = !!lastSessionId && lastSessionId !== state.cliSessionId;
    if (!lastSessionId || sessionChanged) {
      if (fs.existsSync(cardDir)) {
        for (const entry of fs.readdirSync(cardDir)) {
          if (entry === 'card.yaml') continue;
          fs.rmSync(path.join(cardDir, entry), { recursive: true, force: true });
        }
        this.logger.cli(sessionChanged ? `session changed — wiped card workspace for ${cardId}` : `wiped card workspace for fresh sync (${cardId})`);
      }
    }
    this.lastCliSessionIds.set(cardId, state.cliSessionId);

    const prePendingChanges = detectChanges(cardDir);

    try {
      const meta = await writeStateInternal(cardDir, state);
      this.lastInternalStates.set(cardId, state);
      this.lastMobileActors.set(cardDir, { ...(meta.lastActors ?? {}) });
      this.logger.cli(`wrote ${Object.keys(state.blueprints).length} blueprints, ${Object.keys(state.actors).length} actors for card ${cardId}`);

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
    } finally {
      if (prePendingChanges?.hasChanges) {
        this._reapplyPreWriteChanges(prePendingChanges, cardDir);
      }
      this._reapplyPendingActors(cardDir);
    }

    if (!this.watchers.has(cardId)) {
      const watcher = new FileWatcher(cardDir, (changes) => {
        this._sendChanges(changes, cardDir);
      });
      watcher.start();
      this.watchers.set(cardId, watcher);
    }

    this._startCommandsPoll();
  }

  private async _handleStateInternalDiff(diff: StateInternalDiffMessage) {
    const cardId = diff.cardId;

    let deckDir: string;
    if (this.expectedDeckId !== null) {
      if (diff.deckId !== this.expectedDeckId) {
        this.logger.cli(`⚠  Mobile has deck ${diff.deckId} open, but this directory serves deck ${this.expectedDeckId}.\n   Switch to the correct deck on mobile to enable sync.`);
        return;
      }
      deckDir = this.deckDir;
    } else {
      if (this.lockedDeckId === null || diff.deckId !== this.lockedDeckId) {
        this._sendToApp({ type: 'requestState' });
        return;
      }
      deckDir = this.activeDeckDir!;
    }

    const cardDir = path.join(deckDir, `card-${cardId}`);

    // Validate session
    const lastSessionId = this.lastCliSessionIds.get(cardId);
    if (!lastSessionId || diff.cliSessionId !== lastSessionId) {
      this._sendToApp({ type: 'requestState' });
      return;
    }

    // Look up base state for this card
    const last = this.lastInternalStates.get(cardId);
    if (!last) {
      this._sendToApp({ type: 'requestState' });
      return;
    }

    // Merge diff into full state
    const merged = applyStateDiff(last, diff);

    const bpChanges = Object.keys(diff.blueprintChanges ?? {}).length;
    const actorChanges = Object.keys(diff.actorChanges ?? {}).length;
    this.logger.cli(`received state_internal_diff for card ${cardId}: ${bpChanges} bp changes, ${actorChanges} actor changes`);

    const prePendingChanges = detectChanges(cardDir);

    try {
      const meta = await writeStateInternal(cardDir, merged);
      this.lastInternalStates.set(cardId, merged);
      this.lastMobileActors.set(cardDir, { ...(meta.lastActors ?? {}) });
      this.logger.cli(`wrote state_internal_diff for card ${cardId}`);

      const sceneData = mobileInternalStateToSceneData(merged);
      const sceneContext = await generateSceneContext(sceneData);
      if (sceneContext) {
        fs.writeFileSync(path.join(cardDir, 'SCENE.md'), sceneContext);
      }
      await writeDeckAgentFilesAsync(deckDir);

      if (this.onStateWritten) {
        this.onStateWritten(cardId, deckDir);
      }
    } finally {
      if (prePendingChanges?.hasChanges) {
        this._reapplyPreWriteChanges(prePendingChanges, cardDir);
      }
      this._reapplyPendingActors(cardDir);
    }
  }

  private _sendChanges(changes: FileChanges, cardDir: string) {
    if (!this.connected) {
      this.logger.cli('not connected, skipping change send');
      return;
    }

    const changedBlueprintCount = Object.keys(changes.changedBlueprints).length;
    const parts: string[] = [];
    if (changedBlueprintCount > 0) parts.push(`${changedBlueprintCount} blueprint(s)`);
    if (changes.changedActors) parts.push('actors');
    if (changes.changedVariables) parts.push('variables');
    if (changes.changedSceneProperties !== undefined) parts.push('scene properties');

    const description = `cli: updated ${parts.join(', ')}`;
    this.logger.cli(`sending edit: ${description}`);
    console.log(`[mobile] sending edit: updated ${parts.join(', ')}`);

    const edit: EditMessage = {
      type: 'edit',
      description,
      editId: ++this._editIdCounter,
    };

    if (changedBlueprintCount > 0) {
      edit.blueprints = changes.changedBlueprints;
    }
    if (changes.changedActors) {
      edit.actors = changes.changedActors;
    }
    if (changes.changedVariables) {
      edit.variables = changes.changedVariables;
    }
    if (changes.changedSceneProperties !== undefined) {
      edit.sceneProperties = changes.changedSceneProperties;
    }

    this._sendToApp(edit);
    updateMetaHashes(cardDir);

    // Optimistically remove deleted keys from lastMobileActors so that a subsequent re-add of
    // the same key (before the echo returns) is correctly tracked in pendingActors below.
    if (changes.changedActors) {
      const lm = this.lastMobileActors.get(cardDir) ?? {};
      let changed = false;
      for (const [k, v] of Object.entries(changes.changedActors)) {
        if ((v as any).removeActor && k in lm) { delete lm[k]; changed = true; }
      }
      if (changed) this.lastMobileActors.set(cardDir, lm);
    }

    // Track newly added actors so we can re-apply them if mobile races us with stale state.
    // Only additions are re-applied — deletions are fire-and-forget.
    if (changes.changedActors !== null) {
      const actorDiff = changes.changedActors;
      const lastMobile = this.lastMobileActors.get(cardDir) ?? {};
      const addedActors: Record<string, any> = {};
      const addedKeys: string[] = [];
      for (const [k, v] of Object.entries(actorDiff)) {
        if (!(v as any).removeActor && !(k in lastMobile)) {
          addedActors[k] = v;
          addedKeys.push(k);
        }
      }
      if (addedKeys.length > 0) {
        this.pendingActors.set(cardDir, { addedActors, addedKeys });
      } else {
        this.pendingActors.delete(cardDir);
      }
    }
  }

  // Re-apply user changes (deletions, modifications) that writeState may have overwritten.
  // Called before _reapplyPendingActors so explicit deletions can clear pendingActors.
  private _reapplyPreWriteChanges(prePendingChanges: FileChanges, cardDir: string) {
    const changedActors = prePendingChanges.changedActors;
    if (!changedActors) return;

    const actorsPath = path.join(cardDir, 'actors.yaml');
    let currentActors: Record<string, any> = {};
    try {
      currentActors = (yaml.parse(fs.readFileSync(actorsPath, 'utf-8')) as Record<string, any>) ?? {};
    } catch {}

    const merged = { ...currentActors };
    let needsWrite = false;

    for (const [key, data] of Object.entries(changedActors)) {
      if ((data as any).removeActor) {
        // User deleted this actor before writeState ran; if writeState put it back, remove it again.
        if (key in merged) {
          delete merged[key];
          needsWrite = true;
          // Also clear from pendingActors so _reapplyPendingActors doesn't re-add it.
          const pending = this.pendingActors.get(cardDir);
          if (pending) {
            const newAddedKeys = pending.addedKeys.filter(k => k !== key);
            if (newAddedKeys.length === 0) {
              this.pendingActors.delete(cardDir);
            } else if (newAddedKeys.length < pending.addedKeys.length) {
              const newAddedActors = { ...pending.addedActors };
              delete newAddedActors[key];
              this.pendingActors.set(cardDir, { addedActors: newAddedActors, addedKeys: newAddedKeys });
            }
          }
        }
      } else if (!(key in merged)) {
        // User added this actor before writeState ran; writeState removed it, so re-add it.
        // The FileWatcher debounce hadn't fired yet, so pendingActors was never set — fix that here.
        merged[key] = data;
        needsWrite = true;
      }
    }

    if (needsWrite) {
      fs.writeFileSync(actorsPath, yaml.stringify(merged, { lineWidth: 120 }));
      const changes = detectChanges(cardDir);
      if (changes?.hasChanges) {
        this._sendChanges(changes, cardDir);
      }
    }
  }

  // Called after writeState() completes (writingState is back to false).
  // If mobile's state was missing any actor we newly added, re-add them to actors.yaml and re-send.
  // Satisfaction is checked by key OR by blueprint title (mobile assigns a new entity ID on creation).
  // Deletions are fire-and-forget — we only enforce additions to avoid fighting game-managed actors.
  private _reapplyPendingActors(cardDir: string) {
    const pending = this.pendingActors.get(cardDir);
    if (pending === undefined) {
      return;
    }

    const lastMobile = this.lastMobileActors.get(cardDir) ?? {};

    // An added actor is "satisfied" if mobile has it by key, OR if mobile has any actor with
    // the same title (mobile assigns a new entity ID on creation, so the key will differ).
    const missingKeys = pending.addedKeys.filter(key => {
      if (key in lastMobile) return false;
      const actorData = pending.addedActors[key];
      if (!actorData) return false;
      const title = (actorData as any).title;
      if (title && Object.values(lastMobile).some((a: any) => a.title === title)) return false;
      return true;
    });

    if (missingKeys.length === 0) {
      this.pendingActors.delete(cardDir);
      return;
    }

    // Mobile is missing some additions. Read the current actors.yaml (written by writeState
    // with mobile's stale state), add the missing actors back, and re-send.
    const actorsPath = path.join(cardDir, 'actors.yaml');
    let currentActors: Record<string, any> = {};
    try {
      const content = fs.readFileSync(actorsPath, 'utf-8');
      currentActors = (yaml.parse(content) as Record<string, any>) ?? {};
    } catch {}

    const mergedActors: Record<string, any> = { ...currentActors };
    for (const key of missingKeys) {
      mergedActors[key] = pending.addedActors[key];
    }

    this.logger.cli(`re-applying pending actor edit (mobile missing: [${missingKeys}])`);

    fs.writeFileSync(actorsPath, yaml.stringify(mergedActors, { lineWidth: 120 }));

    const changes = detectChanges(cardDir);
    if (changes && changes.hasChanges) {
      this._sendChanges(changes, cardDir);
    }
  }

  // Flush any pending file changes to the app (for the currently active card)
  private _flushFileChanges() {
    // Find the most recently updated card
    for (const [cardId, _watcher] of this.watchers) {
      const cardDir = this.cardDirs.get(cardId) ?? path.join(this.deckDir, `card-${cardId}`);
      const changes = detectChanges(cardDir);
      if (changes && changes.hasChanges) {
        this._sendChanges(changes, cardDir);
      }
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
    this._msgSeq = 0;
    this._latestFullStateSeq = 0;
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
