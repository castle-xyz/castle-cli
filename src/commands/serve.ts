import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { URL, fileURLToPath } from 'url';
import chokidar from 'chokidar';
import openBrowser from 'open';
import * as API from '../api.js';
import { isProjectCardDir, materializeProjectCard } from '../utils/project.js';

const CASTLE_WWW = 'https://castle.xyz';
const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCAL_PLAYER_DIR = path.join(CLI_ROOT, 'bundles', 'player');
const REQUIRED_PLAYER_FILES = [
  path.join('main', 'castle-core.js'),
  path.join('main', 'castle-core.wasm'),
  path.join('main', 'castle-core.worker.js'),
  path.join('nothread', 'castle-core.js'),
  path.join('nothread', 'castle-core.wasm'),
  path.join('node', 'castle-core-node.js'),
  path.join('node', 'castle-core-node.wasm'),
];

interface ServeOptions {
  port?: string;
  card?: string;
  open?: boolean;
  debug?: boolean;
}

interface CardFile {
  cardId: string;
  title?: string;
  sceneDataPath?: string;
  projectCardDir?: string;
}

interface LocalDeck {
  dir: string;
  deckId?: string;
  title?: string;
  initialCardId?: string;
  cards: Map<string, CardFile>;
}

interface PendingScreenshot {
  filename?: string;
  respond: (result: any) => void;
  timeout: ReturnType<typeof setTimeout>;
}

function getCacheDir(): string {
  return path.join(os.homedir(), '.castle', 'cache');
}

function getServeRegistryPath(): string {
  return path.join(os.homedir(), '.castle', 'cli4-serve.json');
}

function readCache(relativePath: string): string | null {
  try {
    return fs.readFileSync(path.join(getCacheDir(), relativePath), 'utf8');
  } catch {
    return null;
  }
}

function writeCache(relativePath: string, data: string): void {
  const fullPath = path.join(getCacheDir(), relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, data, 'utf8');
}

async function fetchCoreViews(debug: boolean): Promise<string> {
  try {
    const response = await fetch(`${CASTLE_WWW}/api/coreviews`, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      const text = await response.text();
      writeCache('coreviews.json', text);
      if (debug) console.log('[serve] loaded coreviews from castle.xyz');
      return text;
    }
  } catch {
    // fall through to cache
  }

  const cached = readCache('coreviews.json');
  if (cached) {
    if (debug) console.log('[serve] loaded coreviews from cache');
    return cached;
  }

  return '{}';
}

function verifyLocalPlayerBundle(): void {
  const missing = REQUIRED_PLAYER_FILES.filter((file) => !fs.existsSync(path.join(LOCAL_PLAYER_DIR, file)));
  if (missing.length > 0) {
    throw new Error(
      `Missing local player bundle files in ${LOCAL_PLAYER_DIR}:\n` +
        missing.map((file) => `  - ${file}`).join('\n') +
        '\nCopy the complete castle-www/player output into bundles/player. Serve currently uses main/nothread; node is kept for upcoming WASM workflows.'
    );
  }
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.wasm')) return 'application/wasm';
  if (filePath.endsWith('.data')) return 'application/octet-stream';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res: http.ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function appendServeLog(deckDir: string, entry: any): void {
  const level = entry.level || 'log';
  const prefix = level.includes('error') ? 'ERROR' : level.includes('warn') ? 'WARN' : 'LOG';
  const blueprint = entry.blueprintTitle ? ` [${entry.blueprintTitle}]` : '';
  const ts = new Date().toISOString().substring(11, 23);
  const line = `[${ts}] [${prefix}]${blueprint} ${entry.log ?? ''}\n`;
  const logsPath = path.join(deckDir, '.castle', 'logs.txt');
  fs.mkdirSync(path.dirname(logsPath), { recursive: true });
  fs.appendFileSync(logsPath, line, 'utf8');
}

function saveScreenshot(deckDir: string, request: PendingScreenshot, base64Data: string, counter: number): string {
  const screenshotsDir = path.join(deckDir, '.castle', 'screenshots');
  const defaultFilename = `${String(counter).padStart(3, '0')}.png`;
  const outPath = request.filename || path.join(screenshotsDir, defaultFilename);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(base64Data, 'base64'));
  const latestPath = path.join(screenshotsDir, 'latest.png');
  fs.copyFileSync(outPath, latestPath);
  return outPath;
}

function readCardJson(cardDir: string): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(cardDir, 'card.json'), 'utf8'));
  } catch {
    return {};
  }
}

function readLocalDeck(dir: string): LocalDeck {
  const resolvedDir = path.resolve(dir);
  const cards = new Map<string, CardFile>();
  let deckId: string | undefined;
  let title: string | undefined;
  let initialCardId: string | undefined;

  const deckJsonPath = path.join(resolvedDir, 'deck.json');
  if (fs.existsSync(deckJsonPath)) {
    const deck = JSON.parse(fs.readFileSync(deckJsonPath, 'utf8')) as any;
    deckId = deck.deckId;
    title = deck.title;
    initialCardId = deck.initialCard?.cardId;

    for (const card of deck.cards || []) {
      if (!card?.cardId) continue;
      const cardDir = path.join(resolvedDir, 'cards', card.cardId);
      const sceneDataPath = path.join(resolvedDir, 'cards', card.cardId, 'scene-data.json');
      if (isProjectCardDir(cardDir)) {
        cards.set(card.cardId, {
          cardId: card.cardId,
          title: card.title,
          projectCardDir: cardDir,
          sceneDataPath: fs.existsSync(sceneDataPath) ? sceneDataPath : undefined,
        });
      } else if (fs.existsSync(sceneDataPath)) {
        cards.set(card.cardId, {
          cardId: card.cardId,
          title: card.title,
          sceneDataPath,
        });
      }
    }
  }

  const cardsDir = path.join(resolvedDir, 'cards');
  if (fs.existsSync(cardsDir)) {
    for (const entry of fs.readdirSync(cardsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const cardDir = path.join(cardsDir, entry.name);
      const sceneDataPath = path.join(cardDir, 'scene-data.json');
      const cardJson = readCardJson(cardDir);
      if (isProjectCardDir(cardDir) && !cards.has(entry.name)) {
        cards.set(entry.name, {
          cardId: entry.name,
          title: cardJson.title,
          projectCardDir: cardDir,
          sceneDataPath: fs.existsSync(sceneDataPath) ? sceneDataPath : undefined,
        });
      } else if (fs.existsSync(sceneDataPath) && !cards.has(entry.name)) {
        cards.set(entry.name, {
          cardId: entry.name,
          title: cardJson.title,
          sceneDataPath,
        });
      }
    }
  }

  const directSceneDataPath = path.join(resolvedDir, 'scene-data.json');
  if (fs.existsSync(directSceneDataPath)) {
    const cardId = path.basename(resolvedDir);
    cards.set(cardId, {
      cardId,
      sceneDataPath: directSceneDataPath,
    });
    initialCardId ??= cardId;
  }

  initialCardId ??= cards.keys().next().value;

  return { dir: resolvedDir, deckId, title, initialCardId, cards };
}

async function getCardSceneDataText(card: CardFile): Promise<string> {
  if (card.projectCardDir) {
    return JSON.stringify(await materializeProjectCard(card.projectCardDir));
  }
  if (!card.sceneDataPath) {
    throw new Error(`Card ${card.cardId} has no scene-data.json or project files.`);
  }
  return fs.readFileSync(card.sceneDataPath, 'utf8');
}

function getHTML(deck: LocalDeck, initialCard: CardFile | undefined, meInfo: any): string {
  const deckId = JSON.stringify(deck.deckId || '');
  const cardId = JSON.stringify(initialCard?.cardId || '');
  const cardTitle = JSON.stringify(initialCard?.title || '');
  const creatorUsername = JSON.stringify(meInfo?.username || '');
  const featureFlags = JSON.stringify(JSON.stringify({ scriptDraw: true }));
  const showUserInfo = meInfo?.username && !meInfo?.isAnonymous;
  const avatarUrl = meInfo?.photo?.url || meInfo?.photo?.avatarUrl || '';
  const frameUrl = meInfo?.photoFrame?.frameUrl || '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Castle CLI Serve</title>
    <style>
      html, body { margin: 0; padding: 0; min-height: 100%; background: #000; }
      body { display: flex; align-items: center; justify-content: center; min-height: 100vh; overflow: hidden; }
      #player-container { display: flex; flex-direction: column; visibility: hidden; }
      #player-frame { position: relative; border-radius: 4% / calc(4% * (5 / 7)); overflow: hidden; background: #000; }
      #canvas { width: 100%; height: 100%; display: block; border-radius: inherit; outline: none; }
      #message { position: absolute; color: white; bottom: 20px; left: 20px; }
      #user-info { height: 44px; display: flex; flex-direction: row; align-items: center; color: #fff; padding: 8px; font-size: 13px; font-family: sans-serif; }
      #avatar-wrap { position: relative; width: 26px; height: 26px; flex: 0 0 auto; }
      #avatar { width: 26px; height: 26px; border-radius: 100%; display: block; }
      #avatar-frame { position: absolute; top: -6.5px; left: -6.5px; width: 39px; height: 39px; }
      #user-info a { color: #fff; font-weight: bold; text-decoration: none; }
    </style>
  </head>
  <body>
    <div id="player-container">
      <div id="player-frame">
        <canvas id="canvas" tabindex="0" width="450" height="630"></canvas>
        <div id="message"></div>
      </div>
      ${
        showUserInfo
          ? `<div id="user-info">
              <div id="avatar-wrap">
                ${avatarUrl ? `<img id="avatar" src="${avatarUrl}" />` : ''}
                ${frameUrl ? `<img id="avatar-frame" src="${frameUrl}" />` : ''}
              </div>
              <div style="margin-left: 8px;">
                <div style="font-size: 10px; text-transform: uppercase;">Local preview</div>
                <div><a href="https://castle.xyz/${meInfo.username}">@${meInfo.username}</a></div>
              </div>
            </div>`
          : ''
      }
    </div>
    <script>
      function postLocalLog(level, args) {
        try {
          fetch('/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              level: level,
              log: Array.prototype.slice.call(args).map(function(arg) {
                if (arg instanceof Error) return arg.stack || arg.message;
                if (typeof arg === 'string') return arg;
                try { return JSON.stringify(arg); } catch (e) { return String(arg); }
              }).join(' ')
            }),
          });
        } catch (e) {}
      }
      ['log', 'warn', 'error'].forEach(function(level) {
        var original = console[level].bind(console);
        console[level] = function() {
          original.apply(console, arguments);
          postLocalLog('browser-' + level, arguments);
        };
      });
      window.addEventListener('error', function(event) {
        postLocalLog('browser-error', [event.error || event.message]);
      });
      window.addEventListener('unhandledrejection', function(event) {
        postLocalLog('browser-error', [event.reason]);
      });

      var hasSetCurrentVersion = false;
      var currentVersion = 0;

      async function getVersion() {
        var response = await fetch('/version?version=' + currentVersion + '&returnImmediate=' + (hasSetCurrentVersion ? 'false' : 'true'));
        var versionJson = await response.json();
        return versionJson.version;
      }

      async function checkForUpdate() {
        try {
          var version = await getVersion();
          if (hasSetCurrentVersion && version > currentVersion) {
            location.reload();
            return;
          }
          currentVersion = version;
          hasSetCurrentVersion = true;
        } catch (e) {
          setTimeout(checkForUpdate, 2000);
          return;
        }
        setTimeout(checkForUpdate, 100);
      }

      async function loadDeck() {
        var sceneRes = await fetch('/scene-data');
        var varsRes = await fetch('/variables');
        var coreViewsRes = await fetch('/coreviews');

        if (!sceneRes.ok) {
          var msg = document.getElementById('message');
          msg.style.cssText = 'position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: white; font-family: sans-serif; text-align: center; padding: 20px;';
          msg.textContent = 'No local scene data found.';
          return;
        }

        var sceneText = await sceneRes.text();
        var varsJson = await varsRes.json();
        var coreViewsText = await coreViewsRes.text();
        var canvas = document.getElementById('canvas');

        window.Castle = {
          hasInitialDeck: true,
          isPlayableMultiplayer: false,
          creatorUsername: ${creatorUsername},
          deckId: ${deckId},
          cardId: ${cardId},
          cardTitle: ${cardTitle},
          featureFlags: ${featureFlags},
          nextCardSceneData: sceneText,
          variables: JSON.stringify(varsJson),
          cardCache: {},
          isFocused: true,
          coreViews: coreViewsText,
          authToken: '',
          localScreenshotRequests: {},
          scriptLog: function(log, level, blueprintTitle) {
            fetch('/log', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ log: log, level: level, blueprintTitle: blueprintTitle }),
            });
          },
          navigateToCardId: async function(nextCardId) {
            var res = await fetch('/scene-data?cardId=' + encodeURIComponent(nextCardId));
            window.Castle.nextCardSceneData = await res.text();
          },
          navigateToDeckId: function() {},
          openDownloadAppLink: function() {},
          bridgeEvent: function(eventString) {
            try {
              var event = JSON.parse(eventString);
              if (event.name === 'SCREENSHOT_DATA' && event.params && event.params.requestId) {
                fetch('/screenshot-data', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    requestId: event.params.requestId,
                    data: event.params.data,
                  }),
                });
              }
            } catch (e) {
              console.error('bridgeEvent error', e);
            }
          },
          dataRequest: async function(requestId, url) {
            var arrayBuffer = new ArrayBuffer(0);
            var success = 1;
            try {
              var resp = await fetch(url);
              arrayBuffer = await resp.arrayBuffer();
            } catch (e) {
              success = 0;
            }
            window.Module.ccall('jsDataRequestCompleted', 'void',
              ['number', 'number', 'array', 'number'],
              [requestId, success, new Uint8Array(arrayBuffer), arrayBuffer.byteLength]);
          },
          graphqlPostRequest: async function(requestId, body) {
            window.Module.ccall('jsGraphQLPostRequestComplete', 'void', ['number', 'number', 'string'], [requestId, 0, '']);
          },
        };

        var useThread = typeof Atomics !== 'undefined' && typeof SharedArrayBuffer !== 'undefined';
        var variant = useThread ? 'main' : 'nothread';

        window.Module = {
          canvas: canvas,
          locateFile: function(filePath) {
            return '/player/' + variant + '/' + filePath;
          },
          mainScriptUrlOrBlob: '/player/' + variant + '/castle-core.js',
        };
        window.Module.preinitializedWebGLContext = canvas.getContext('webgl');

        var script = document.createElement('script');
        script.src = '/player/' + variant + '/castle-core.js';
        document.head.appendChild(script);
        canvas.focus();
        pollScreenshotRequests('');
      }

      async function requestCastleScreenshot(requestId) {
        try {
          if (!window.Module || !window.Module.ccall) {
            setTimeout(function() { requestCastleScreenshot(requestId); }, 250);
            return;
          }
          window.Module.ccall('jsNativeEventSend', 'void', ['string'], [
            JSON.stringify({ name: 'REQUEST_SCREENSHOT', params: { requestId: requestId } })
          ]);
        } catch (e) {
          console.error('request screenshot failed', e);
        }
      }

      async function pollScreenshotRequests(lastRequestId) {
        try {
          var response = await fetch('/screenshot-request?last=' + encodeURIComponent(lastRequestId || ''));
          var body = await response.json();
          if (body.requestId) {
            requestCastleScreenshot(body.requestId);
            lastRequestId = body.requestId;
          }
        } catch (e) {
          console.error('screenshot poll failed', e);
          await new Promise(function(resolve) { setTimeout(resolve, 1000); });
        }
        pollScreenshotRequests(lastRequestId);
      }

      function resizeCard() {
        var userInfo = document.getElementById('user-info');
        var userInfoHeight = userInfo ? userInfo.offsetHeight : 0;
        var padding = 20;
        var availableWidth = window.innerWidth - padding * 2;
        var availableHeight = window.innerHeight - userInfoHeight - padding * 2;
        var cardWidth;
        var cardHeight;
        if (availableWidth >= 450 && availableHeight >= 630) {
          cardWidth = 450;
          cardHeight = 630;
        } else if (availableWidth / availableHeight < 5 / 7) {
          cardWidth = availableWidth;
          cardHeight = cardWidth * (7 / 5);
        } else {
          cardHeight = availableHeight;
          cardWidth = cardHeight * (5 / 7);
        }
        var frame = document.getElementById('player-frame');
        frame.style.width = cardWidth + 'px';
        frame.style.height = cardHeight + 'px';
        document.getElementById('player-container').style.visibility = 'visible';
      }

      resizeCard();
      window.addEventListener('resize', resizeCard);
      loadDeck();
      setTimeout(checkForUpdate, 100);
    </script>
  </body>
</html>`;
}

function sendLocalPlayerFile(reqPath: string, res: http.ServerResponse): void {
  const match = reqPath.match(/^\/player\/(main|nothread|node)\/([A-Za-z0-9._-]+)$/);
  if (!match) {
    sendText(res, 404, 'Not found', 'text/plain; charset=utf-8');
    return;
  }

  const [, variant, file] = match;
  const filePath = path.join(LOCAL_PLAYER_DIR, variant, file);
  if (!fs.existsSync(filePath)) {
    sendText(res, 404, `Local player file not found: ${variant}/${file}`, 'text/plain; charset=utf-8');
    return;
  }

  const buffer = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentTypeFor(file),
    'Content-Length': buffer.length,
    'X-Castle-Player-Source': 'local',
  });
  res.end(buffer);
}

function parsePort(port: string | undefined): number | null {
  if (!port) return null;
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }
  return parsed;
}

async function listen(server: http.Server, requestedPort: number | null): Promise<number> {
  const start = requestedPort ?? 4321;
  const maxAttempts = requestedPort === null ? 100 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = start + attempt;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port);
      });
      const address = server.address();
      return typeof address === 'object' && address ? address.port : port;
    } catch (error: any) {
      if (error?.code === 'EADDRINUSE' && requestedPort === null) continue;
      throw error;
    }
  }

  throw new Error('No available port found.');
}

export async function serve(directory = '.', options: ServeOptions = {}): Promise<void> {
  const debug = !!options.debug;
  const requestedPort = parsePort(options.port);
  verifyLocalPlayerBundle();
  if (debug) console.log(`[serve] player bundle: ${LOCAL_PLAYER_DIR}`);
  const deck = readLocalDeck(directory);

  if (deck.cards.size === 0) {
    console.error(`No local card data found in ${deck.dir}.`);
    console.error(
      'Expected either project files shaped like:\n' +
        '  <dir>/deck.json\n' +
        '  <dir>/cards/<cardId>/scene/blueprints/<slug>.yaml\n' +
        '  <dir>/cards/<cardId>/scene/blueprints/<slug>.json\n' +
        'or a saved scene-data directory shaped like:\n' +
        '  <dir>/deck.json\n' +
        '  <dir>/cards/<cardId>/scene-data.json\n' +
        'or a direct <dir>/scene-data.json file.'
    );
    return;
  }

  const initialCardId = options.card || deck.initialCardId || deck.cards.keys().next().value;
  const initialCard = initialCardId ? deck.cards.get(initialCardId) : undefined;
  if (!initialCard) {
    console.error(`Card ${initialCardId} not found in ${deck.dir}.`);
    return;
  }

  const [coreViewsJson, meInfo] = await Promise.all([
    fetchCoreViews(debug),
    API.me(),
  ]);

  let version = 0;
  let screenshotCounter = 0;
  const pendingScreenshots = new Map<string, PendingScreenshot>();
  const pendingScreenshotPolls = new Set<http.ServerResponse>();
  const sockPath = path.join(deck.dir, '.castle', 'cli.sock');
  fs.mkdirSync(path.dirname(sockPath), { recursive: true });

  const currentScreenshotRequestId = () => Array.from(pendingScreenshots.keys()).at(-1) || '';
  const flushScreenshotPolls = () => {
    const requestId = currentScreenshotRequestId();
    if (!requestId) return;
    for (const pending of pendingScreenshotPolls) {
      sendJson(pending, 200, { requestId });
    }
    pendingScreenshotPolls.clear();
  };

  const watcher = chokidar.watch(deck.dir, {
    ignored: (name) => name.split(path.sep).includes('.castle'),
    ignoreInitial: true,
  });

  const pendingVersionResponses = new Set<http.ServerResponse>();
  const bumpVersion = (filePath?: string) => {
    if (debug && filePath) console.log(`[serve] changed: ${path.relative(deck.dir, filePath)}`);
    version++;
    for (const pending of pendingVersionResponses) {
      sendJson(pending, 200, { version });
    }
    pendingVersionResponses.clear();
  };
  watcher.on('all', (_event, filePath) => bumpVersion(filePath));

  try { fs.unlinkSync(sockPath); } catch {}
  const ipcServer = net.createServer((conn) => {
    let data = '';
    conn.on('data', (chunk) => {
      data += chunk.toString();
      if (!data.includes('\n')) return;

      let request: any;
      try {
        request = JSON.parse(data.trim());
      } catch {
        conn.write(`${JSON.stringify({ error: 'invalid request' })}\n`);
        conn.end();
        return;
      }

      const respond = (result: any) => {
        conn.write(`${JSON.stringify(result)}\n`);
        conn.end();
      };

      if (request.command === 'screenshot') {
        const requestId = `cli4-local-screenshot-${Date.now()}`;
        const timeout = setTimeout(() => {
          if (!pendingScreenshots.delete(requestId)) return;
          respond({ error: 'screenshot timed out; is the served deck open in a browser?' });
        }, 15_000);
        pendingScreenshots.set(requestId, {
          filename: request.filename,
          respond,
          timeout,
        });
        flushScreenshotPolls();
      } else if (request.command === 'logs') {
        const logsPath = path.join(deck.dir, '.castle', 'logs.txt');
        let content = '';
        try { content = fs.readFileSync(logsPath, 'utf8'); } catch {}
        respond({ logs: content });
      } else if (request.command === 'status') {
        respond({
          connected: true,
          mode: 'serve',
          deckId: deck.deckId,
          cards: deck.cards.size,
          workspace: deck.dir,
        });
      } else {
        respond({ error: `serve does not support command: ${request.command}` });
      }
    });
  });
  ipcServer.listen(sockPath);

  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');

      const requestUrl = new URL(req.url || '/', 'http://localhost');
      const reqPath = decodeURIComponent(requestUrl.pathname);

      if (req.method === 'GET' && reqPath === '/') {
        sendText(res, 200, getHTML(deck, initialCard, meInfo), 'text/html; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && reqPath === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'GET' && reqPath === '/scene-data') {
        const cardId = requestUrl.searchParams.get('cardId') || initialCard.cardId;
        const card = deck.cards.get(cardId);
        if (!card) {
          sendJson(res, 404, { error: `Card ${cardId} not found.` });
          return;
        }
        const body = await getCardSceneDataText(card);
        sendText(res, 200, body, 'application/json; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && reqPath === '/variables') {
        sendJson(res, 200, { variables: [], passes: [], cards: Array.from(deck.cards.values()).map((card) => ({ cardId: card.cardId, title: card.title })) });
        return;
      }

      if (req.method === 'GET' && reqPath === '/coreviews') {
        sendText(res, 200, coreViewsJson, 'application/json; charset=utf-8');
        return;
      }

      if (req.method === 'GET' && reqPath === '/version') {
        const returnImmediate = requestUrl.searchParams.get('returnImmediate') === 'true';
        const clientVersion = Number(requestUrl.searchParams.get('version') || 0);
        if (returnImmediate || clientVersion < version) {
          sendJson(res, 200, { version });
          return;
        }

        pendingVersionResponses.add(res);
        const timeout = setTimeout(() => {
          if (pendingVersionResponses.delete(res)) sendJson(res, 200, { version });
        }, 30_000);
        res.on('close', () => {
          clearTimeout(timeout);
          pendingVersionResponses.delete(res);
        });
        return;
      }

      if (req.method === 'GET' && reqPath === '/screenshot-request') {
        const lastRequestId = requestUrl.searchParams.get('last') || '';
        const requestId = currentScreenshotRequestId();
        if (requestId && requestId !== lastRequestId) {
          sendJson(res, 200, { requestId });
          return;
        }

        pendingScreenshotPolls.add(res);
        const timeout = setTimeout(() => {
          if (pendingScreenshotPolls.delete(res)) sendJson(res, 200, { requestId: null });
        }, 30_000);
        res.on('close', () => {
          clearTimeout(timeout);
          pendingScreenshotPolls.delete(res);
        });
        return;
      }

      if (req.method === 'POST' && reqPath === '/screenshot-data') {
        const raw = await readRequestBody(req);
        const body = JSON.parse(raw);
        const pending = pendingScreenshots.get(body.requestId);
        if (!pending) {
          sendJson(res, 404, { error: `Screenshot request not found: ${body.requestId}` });
          return;
        }
        pendingScreenshots.delete(body.requestId);
        clearTimeout(pending.timeout);
        screenshotCounter++;
        const outPath = saveScreenshot(deck.dir, pending, body.data, screenshotCounter);
        pending.respond({ path: outPath });
        console.log(`[screenshot] saved: ${outPath}`);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'GET' && reqPath.startsWith('/player/')) {
        sendLocalPlayerFile(reqPath, res);
        return;
      }

      if (req.method === 'POST' && reqPath === '/log') {
        const raw = await readRequestBody(req);
        try {
          const log = JSON.parse(raw);
          const prefix = log.blueprintTitle ? `${log.blueprintTitle}: ` : '';
          console.log(`${prefix}${log.log}`);
          appendServeLog(deck.dir, log);
        } catch {
          if (raw.trim()) console.log(raw.trim());
          appendServeLog(deck.dir, { log: raw.trim() });
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      sendText(res, 404, 'Not found', 'text/plain; charset=utf-8');
    } catch (error: any) {
      sendJson(res, 500, { error: error?.message || String(error) });
    }
  });

  const actualPort = await listen(server, requestedPort);
  const url = `http://localhost:${actualPort}`;
  console.log(`Serving ${deck.deckId || path.basename(deck.dir)} on ${url}`);
  console.log(`Initial card: ${initialCard.cardId}`);
  console.log(`Command socket: ${sockPath}`);
  fs.mkdirSync(path.dirname(getServeRegistryPath()), { recursive: true });
  fs.writeFileSync(getServeRegistryPath(), JSON.stringify({ sockPath, deckDir: deck.dir, url }, null, 2), 'utf8');

  if (options.open) {
    await openBrowser(url);
  }

  const shutdown = async () => {
    await watcher.close();
    server.close();
    ipcServer.close();
    try { fs.unlinkSync(sockPath); } catch {}
  };

  process.on('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });
}
