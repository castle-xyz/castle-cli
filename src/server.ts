import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import chokidar from 'chokidar';

const WS_URL = 'wss://ws.castlexyz.com/ws';
const RECONNECT_MS = 3000;
const SCRIPT_DEBOUNCE_MS = 500;

interface StateMessage {
  innerType: 'cli4_state';
  cardId: string;
  deckId: string;
  blueprints: string;
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
  private dir: string;
  private token: string;
  private connected = false;
  private shouldReconnect = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private scriptDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingScriptChanges = new Map<string, string>();

  private slugToEntryId: Record<string, string> = {};
  private entryIdToSlug: Record<string, string> = {};
  private writingFiles = false;

  private screenshotsDir: string;
  private screenshotCounter = 0;

  constructor(dir: string, token: string) {
    this.dir = dir;
    this.token = token;
    this.screenshotsDir = path.join(dir, '.castle', 'screenshots');

    for (const d of [dir, path.join(dir, 'scripts'), path.join(dir, 'context'), path.join(dir, '.castle'), this.screenshotsDir]) {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }

    this._writeGitignore();
  }

  start() {
    log('server', `workspace: ${this.dir}`);
    this._connect();
    this._startWatcher();
  }

  stop() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.scriptDebounceTimer) clearTimeout(this.scriptDebounceTimer);
    this.watcher?.close();
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
      log('tunnel', 'connected');

      // Enable tunnel listening
      this.ws!.send(JSON.stringify({
        type: 'cli_tunnel_start_listening',
      }));

      // Say hello to the app
      this._sendToApp({ innerType: 'cli4_hello' });
      log('tunnel', 'sent hello');
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
      log('tunnel', wasConnected ? 'disconnected' : 'connection failed');
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      log('tunnel', 'error:', err.message);
    });
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
      default:
        log('recv', 'unknown:', innerType);
    }
  }

  private _onState(state: StateMessage) {
    this.slugToEntryId = state.slugToEntryId;
    this.entryIdToSlug = {};
    for (const [slug, entryId] of Object.entries(state.slugToEntryId)) {
      this.entryIdToSlug[entryId] = slug;
    }

    this.writingFiles = true;

    // Write context files
    this._writeFile('context/blueprints.yaml', state.blueprints);
    this._writeFile('context/actors.yaml', state.actors);
    this._writeFile('context/variables.yaml', state.variables);
    this._writeFile('context/behaviors.yaml', state.behaviors);
    this._writeFile('context/rules.yaml', state.rules);
    this._writeFile('context/scripting-reference.md', state.scriptingReference);
    this._writeFile('context/script-property-names.md', state.scriptPropertyNamePrompt);

    // Write script files (only if they don't already exist locally or this is first sync)
    const scriptDir = path.join(this.dir, 'scripts');
    const existingScripts = new Set<string>();
    if (fs.existsSync(scriptDir)) {
      for (const f of fs.readdirSync(scriptDir)) {
        if (f.endsWith('.lua')) existingScripts.add(f.replace('.lua', ''));
      }
    }

    for (const [slug, code] of Object.entries(state.scripts)) {
      const filePath = path.join('scripts', `${slug}.lua`);
      if (!existingScripts.has(slug)) {
        // New script — write it
        this._writeFile(filePath, code);
        log('scripts', `wrote new: ${slug}.lua`);
      } else {
        // Existing script — don't overwrite (CLI owns scripts)
        log('scripts', `keeping local: ${slug}.lua`);
      }
    }

    // Write slug mapping
    this._writeFile('.castle/slug-map.json', JSON.stringify(state.slugToEntryId, null, 2));

    // Copy castle docs if available
    this._copyDocs();

    // Write CLAUDE.md for AI context
    this._writeCLAUDEmd();

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

  private _writeCLAUDEmd() {
    const slugList = Object.entries(this.slugToEntryId)
      .map(([slug, id]) => `  - scripts/${slug}.lua → blueprint "${slug}" (${id})`)
      .join('\n');

    const content = `# Castle CLI Workspace

This workspace is connected to a Castle deck via castle-cli-4.

## IMPORTANT — Read Before Writing Any Script

- IMPORTANT: You MUST verify every Castle API function you use exists in the docs before using it. Check \`context/scripting-reference.md\` and \`context/docs/\` for the full API reference.
- IMPORTANT: Do NOT assume or guess function names. If a function is not documented, it does not exist.
- IMPORTANT: \`onUpdate(dt)\` receives delta time as a parameter. There is no \`castle.dt()\` function.
- IMPORTANT: \`onDraw()\` does NOT receive dt. Use \`castle.getTime()\` for elapsed time in draw handlers.
- IMPORTANT: \`castle.draw.*\` functions ONLY work inside \`onDraw()\`. They do nothing elsewhere.
- IMPORTANT: Check \`context/script-property-names.md\` for name differences between scripts and YAML.
- IMPORTANT: Check \`.castle/logs.txt\` after running to see script errors and print output.

## Structure

- \`scripts/*.lua\` — Editable Lua scripts, one per blueprint. Edit these to change game logic.
- \`context/\` — Read-only context files describing the current scene state.
  - \`blueprints.yaml\` — All blueprints with their behaviors, components, and properties
  - \`actors.yaml\` — Actor instances in the scene with positions
  - \`variables.yaml\` — Deck variables
  - \`behaviors.yaml\` — Available behavior types and their properties
  - \`rules.yaml\` — Available rule triggers, responses, and conditions
  - \`scripting-reference.md\` — Full Lua scripting API reference
  - \`script-property-names.md\` — Property name mappings between scripts and YAML
  - \`docs/\` — Castle documentation (tutorials, actor reference, library reference)
- \`.castle/logs.txt\` — Script logs and errors from the running scene

## Script Mapping

${slugList}

## Commands

Run these from the castle-cli-4 directory (sibling terminal):
- \`npx tsx src/index.ts restart\` — stop and restart the scene
- \`npx tsx src/index.ts screenshot [filename]\` — take a screenshot (default: workspace/.castle/screenshots/<timestamp>.png, also saves latest.png)

## Workflow

1. Edit scripts in \`scripts/\` — changes are sent to the app automatically
2. Run \`npx tsx src/index.ts restart\` to restart and see your changes running
3. Run \`npx tsx src/index.ts screenshot\` to capture what's on screen
4. Check \`.castle/logs.txt\` for script errors
5. If you need new blueprints, actors, behavior changes, or property edits — tell the user, as those must be done in the Castle app

## Key Facts

- Scripts use Luau (Lua 5.1 with types).
- Positive Y is downward. Angles are in degrees.
- Only edit files in \`scripts/\`. Context files are overwritten by the app.
`;
    this._writeFile('CLAUDE.md', content);
  }

  private _copyDocs() {
    const docsSource = path.resolve(this.dir, '../../castle-docs/docs/scripts');
    const docsDest = path.join(this.dir, 'context', 'docs');

    if (!fs.existsSync(docsSource)) {
      log('docs', `castle-docs not found at ${docsSource}, skipping`);
      return;
    }

    if (fs.existsSync(docsDest)) return; // only copy once

    const copyRecursive = (src: string, dest: string) => {
      if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          copyRecursive(srcPath, destPath);
        } else if (entry.name.endsWith('.md')) {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    };

    copyRecursive(docsSource, docsDest);
    log('docs', 'copied castle docs to context/docs/');
  }

  private _writeGitignore() {
    const gitignorePath = path.join(this.dir, '.gitignore');
    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8');
    }
    for (const entry of ['.castle/', 'context/', 'CLAUDE.md']) {
      if (!content.includes(entry)) {
        content += (content.length > 0 && !content.endsWith('\n') ? '\n' : '') + entry + '\n';
      }
    }
    fs.writeFileSync(gitignorePath, content);
  }

  // File watching for script changes
  private _startWatcher() {
    const scriptsDir = path.join(this.dir, 'scripts');
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

    const logsPath = path.join(this.dir, '.castle', 'logs.txt');
    const lines = logs.map((entry: any) => {
      const level = entry.level || 'log';
      const prefix = level === 'error' ? 'ERROR' : level === 'warn' ? 'WARN' : 'LOG';
      const blueprint = entry.blueprintTitle ? ` [${entry.blueprintTitle}]` : '';
      const count = entry.count > 1 ? ` (x${entry.count})` : '';
      return `[${prefix}]${blueprint} ${entry.log}${count}`;
    });

    // Print errors/warnings to console too
    for (const entry of logs) {
      if (entry.level === 'error') {
        const bp = entry.blueprintTitle ? ` [${entry.blueprintTitle}]` : '';
        log('error', `${bp} ${entry.log}`);
      }
    }

    // Append to logs file, truncate if too large
    try {
      let existing = '';
      if (fs.existsSync(logsPath)) {
        existing = fs.readFileSync(logsPath, 'utf-8');
      }
      const combined = existing + lines.join('\n') + '\n';
      const maxSize = 100 * 1024; // 100KB
      if (combined.length > maxSize) {
        const truncated = combined.slice(combined.length - maxSize);
        const firstNewline = truncated.indexOf('\n');
        fs.writeFileSync(logsPath, truncated.slice(firstNewline + 1));
      } else {
        fs.writeFileSync(logsPath, combined);
      }
    } catch {
      // ignore write errors
    }
  }

  private _onScreenshotData(base64Data: string) {
    this.screenshotCounter++;
    const filename = `${String(this.screenshotCounter).padStart(3, '0')}.png`;
    const filePath = path.join(this.screenshotsDir, filename);
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

    // Also write latest.png
    const latestPath = path.join(this.screenshotsDir, 'latest.png');
    fs.copyFileSync(filePath, latestPath);

    log('screenshot', `saved: ${filename}`);
  }
}
