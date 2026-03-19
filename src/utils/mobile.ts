import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import jsyaml from 'js-yaml';
import {
  StateMessage,
  EditMessage,
  LogsMessage,
  ScreenshotMessage,
  CLIScreenshotMessage,
  AppToCliMessage,
} from './mobile-protocol.js';
import { writeState, canWriteToDir, detectChanges, FileChanges, mobileStateToSceneData } from './mobile-files.js';
import { FileWatcher } from './mobile-watcher.js';
import { Logger } from './logger.js';
import { getCacheDir } from './decks.js';

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
  onStateWritten?: (cardId: string) => void;
}

export class CLIMobileConnection {
  private ws: WebSocket | null = null;
  private watchers: Map<string, FileWatcher> = new Map();
  private deckDir: string;
  private token: string;
  private debug: boolean;
  private onStateWritten?: (cardId: string) => void;
  private lastCliSessionIds: Map<string, string> = new Map();
  private logger: Logger;
  private connected = false;
  private shouldReconnect = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;

  // Track whether we're writing state from app (to ignore our own file changes)
  private writingState = false;

  // Commands
  private commandsPollTimer: ReturnType<typeof setInterval> | null = null;
  private commandsPath: string;
  private screenshotsDir: string;
  private screenshotCounter = 0;
  private processingCommands = false;

  // Pending screenshot request
  private screenshotResolve: ((data: string | null) => void) | null = null;

  constructor({ deckDir, token, debug, onStateWritten }: CLIMobileConnectionOptions) {
    this.deckDir = deckDir;
    this.token = token;
    this.debug = !!debug;
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
      if (this.debug) console.log('[mobile] connected to tunnel');

      // Enable the cli tunnel feature
      this._send({ type: 'cli_tunnel_start_listening' });

      // Request state from app (in case app is already open)
      this._send({ type: 'cli_tunnel_send_message', innerType: 'requestState' });

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
      if (this.debug) console.log('[mobile] disconnected from tunnel');
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
    if (msg.type === 'state') {
      this._handleState(msg as StateMessage);
    } else if (msg.type === 'logs') {
      this._handleLogs(msg as LogsMessage);
    } else if (msg.type === 'screenshot') {
      this._handleScreenshot(msg as ScreenshotMessage);
    } else if (msg.type === 'cliScreenshot') {
      this._handleCLIScreenshot(msg as CLIScreenshotMessage);
    } else if (msg.type === 'editResult') {
      if (!(msg as any).success) {
        this.logger.cli(`edit failed: ${(msg as any).error}`);
      }
    } else if (msg.type === 'pong') {
      // keepalive response
    }
  }

  private _handleLogs(msg: LogsMessage) {
    for (const entry of msg.logs) {
      const count = entry.count && entry.count > 1 ? ` (${entry.count}x)` : '';
      this.logger.deck(`${entry.log}${count}`, entry.level, entry.blueprintTitle);
    }
  }

  private _handleState(state: StateMessage) {
    const cardId = state.cardId;
    const cardDir = path.join(this.deckDir, `card-${cardId}`);

    this.logger.cli(`received state for card ${cardId}: ${Object.keys(state.blueprints).length} blueprints, ${Object.keys(state.actors).length} actors`);

    // Create deck.yaml stub if not exists
    const deckYamlPath = path.join(this.deckDir, 'deck.yaml');
    if (!fs.existsSync(deckYamlPath)) {
      fs.writeFileSync(deckYamlPath, jsyaml.dump({ deckId: state.deckId }));
    }

    // Create card directory and card.yaml stub if not exists
    if (!fs.existsSync(cardDir)) {
      fs.mkdirSync(cardDir, { recursive: true });
    }
    const cardYamlPath = path.join(cardDir, 'card.yaml');
    if (!fs.existsSync(cardYamlPath)) {
      fs.writeFileSync(cardYamlPath, jsyaml.dump({ cardId }));
    }

    // Handle session changes (wipe workspace on new session or device)
    const lastSessionId = this.lastCliSessionIds.get(cardId);
    const sessionChanged = !!lastSessionId && lastSessionId !== state.cliSessionId;
    if (!lastSessionId || sessionChanged) {
      if (fs.existsSync(cardDir)) {
        for (const entry of fs.readdirSync(cardDir)) {
          // Preserve card.yaml
          if (entry === 'card.yaml') continue;
          fs.rmSync(path.join(cardDir, entry), { recursive: true, force: true });
        }
        this.logger.cli(sessionChanged ? `session changed — wiped card workspace for ${cardId}` : `wiped card workspace for fresh sync (${cardId})`);
      }
    }
    this.lastCliSessionIds.set(cardId, state.cliSessionId);

    // Write files
    this.writingState = true;
    try {
      writeState(cardDir, state);
      this.logger.cli(`wrote ${Object.keys(state.blueprints).length} blueprints, ${Object.keys(state.actors).length} actors for card ${cardId}`);

      // Write scene data cache for web player
      const sceneData = mobileStateToSceneData(state);
      const cacheDir = getCacheDir(this.deckDir);
      fs.writeFileSync(path.join(cacheDir, `${cardId}.json`), JSON.stringify(sceneData, null, 2));

      // Update cardversions.json (mark card as present from mobile)
      const castleDir = path.join(this.deckDir, CASTLE_DIR);
      if (!fs.existsSync(castleDir)) fs.mkdirSync(castleDir, { recursive: true });
      const cardVersionsPath = path.join(castleDir, 'cardversions.json');
      let cardVersions: any = {};
      try {
        cardVersions = JSON.parse(fs.readFileSync(cardVersionsPath, 'utf-8'));
      } catch (e) {}
      cardVersions[cardId] = 'mobile';
      fs.writeFileSync(cardVersionsPath, JSON.stringify(cardVersions, null, 2));

      // Notify web player that content changed
      if (this.onStateWritten) {
        this.onStateWritten(cardId);
      }
    } finally {
      setTimeout(() => {
        this.writingState = false;
      }, 600);
    }

    // Start watcher for this card if not already running
    if (!this.watchers.has(cardId)) {
      const watcher = new FileWatcher(cardDir, (changes) => {
        if (!this.writingState) {
          this._sendChanges(changes);
        }
      });
      watcher.start();
      this.watchers.set(cardId, watcher);
    }

    // Start commands poll
    this._startCommandsPoll();
  }

  private _sendChanges(changes: FileChanges) {
    if (!this.connected) {
      this.logger.cli('not connected, skipping change send');
      return;
    }

    const changedBlueprintCount = Object.keys(changes.changedBlueprints).length;
    const parts: string[] = [];
    if (changedBlueprintCount > 0) parts.push(`${changedBlueprintCount} blueprint(s)`);
    if (changes.changedActors) parts.push('actors');
    if (changes.changedVariables) parts.push('variables');

    const description = `cli: updated ${parts.join(', ')}`;
    this.logger.cli(`sending edit: ${description}`);

    const edit: EditMessage = {
      type: 'edit',
      description,
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

    this._sendToApp(edit);
  }

  // Flush any pending file changes to the app (for the currently active card)
  private _flushFileChanges() {
    // Find the most recently updated card
    for (const [cardId, _watcher] of this.watchers) {
      const cardDir = path.join(this.deckDir, `card-${cardId}`);
      const changes = detectChanges(cardDir);
      if (changes && changes.hasChanges) {
        this._sendChanges(changes);
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
