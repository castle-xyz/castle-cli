import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { URL, fileURLToPath } from 'url';
import chokidar from 'chokidar';
import openBrowser from 'open';
import * as API from '../api.js';
import { getConfigDir } from '../config.js';
import { applyLocalEdit } from '../utils/edit.js';
import { isProjectCardDir, materializeProjectCard } from '../utils/project.js';
import { endpointLabel, LOOPBACK_HOST, REGISTRY_SCHEMA_VERSION, type Endpoint } from '../utils/socket.js';

const CASTLE_WWW = 'https://castle.xyz';
const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCAL_PLAYER_DIR = path.join(CLI_ROOT, 'bundles', 'player');
const SCREENSHOT_SERVER_TIMEOUT_MS = 60_000;
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
  card?: string;
  open?: boolean;
  debug?: boolean;
  detach?: boolean;
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
  variables: any[];
  cards: Map<string, CardFile>;
}

interface PendingScreenshot {
  filename?: string;
  targetClientId?: string;
  respond: (result: any) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingScreenshotPoll {
  clientId: string;
  res: http.ServerResponse;
  timeout: ReturnType<typeof setTimeout>;
}

interface PreviewClientState {
  seenAt: number;
  readyVersion?: number;
  readyAt?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCacheDir(): string {
  return path.join(getConfigDir(), 'cache');
}

function getServeRegistryPath(): string {
  return path.join(getConfigDir(), 'cli4-serve.json');
}

function getDeckServeInfoPath(deckDir: string): string {
  return path.join(deckDir, '.castle', 'serve.json');
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
    const response = await fetch(`${CASTLE_WWW}/api/coreviews`, {
      signal: AbortSignal.timeout(3000),
    });
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
        '\nCopy the complete castle-www/player output into bundles/player. Serve currently uses main/nothread; node is kept for upcoming WASM workflows.',
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
  fs.mkdirSync(screenshotsDir, { recursive: true });
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
  let variables: any[] = [];

  const deckJsonPath = path.join(resolvedDir, 'deck.json');
  if (fs.existsSync(deckJsonPath)) {
    const deck = JSON.parse(fs.readFileSync(deckJsonPath, 'utf8')) as any;
    deckId = deck.deckId;
    title = deck.title;
    initialCardId = deck.initialCard?.cardId;
    variables = Array.isArray(deck.variables) ? deck.variables : [];

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

  return { dir: resolvedDir, deckId, title, initialCardId, variables, cards };
}

function selectInitialCard(deck: LocalDeck, requestedCardId?: string): CardFile | undefined {
  const cardId = requestedCardId || deck.initialCardId || deck.cards.keys().next().value;
  return cardId ? deck.cards.get(cardId) : undefined;
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

async function getCardVariables(card: CardFile): Promise<any[]> {
  if (card.projectCardDir) {
    const sceneData = await materializeProjectCard(card.projectCardDir);
    return Array.isArray(sceneData?.snapshot?.variables) ? sceneData.snapshot.variables : [];
  }
  if (card.sceneDataPath) {
    const sceneData = JSON.parse(fs.readFileSync(card.sceneDataPath, 'utf8'));
    return Array.isArray(sceneData?.snapshot?.variables) ? sceneData.snapshot.variables : [];
  }
  return [];
}

function mergeVariables(...groups: any[][]): any[] {
  const result = new Map<string, any>();
  for (const group of groups) {
    for (const variable of group) {
      const key = variable?.variableId || variable?.name;
      if (!key) continue;
      result.set(key, variable);
    }
  }
  return Array.from(result.values());
}

function getHTML(
  deck: LocalDeck,
  initialCard: CardFile | undefined,
  meInfo: any,
  previewRunId: string,
  servedVersion: number,
  debug: boolean,
): string {
  const deckId = JSON.stringify(deck.deckId || '');
  const cardId = JSON.stringify(initialCard?.cardId || '');
  const cardTitle = JSON.stringify(initialCard?.title || '');
  const creatorUsername = JSON.stringify(meInfo?.username || '');
  const featureFlags = JSON.stringify(JSON.stringify({ scriptDraw: true }));
  const previewRunIdJson = JSON.stringify(previewRunId);
  const servedVersionJson = JSON.stringify(servedVersion);
  const debugLogsJson = JSON.stringify(debug);
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
          }).catch(function() {});
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
      var currentVersion = ${servedVersionJson};
      var servedVersion = ${servedVersionJson};
      var previewRunId = ${previewRunIdJson};
      var debugLogs = ${debugLogsJson};
      var previewClientId = String(Date.now()) + '-' + Math.random().toString(36).slice(2);

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

      function postPreviewReady() {
        try {
          fetch('/preview-ready', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              previewRunId: previewRunId,
              previewClientId: previewClientId,
              version: servedVersion,
            }),
          }).catch(function() {});
        } catch (e) {}
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
            }).catch(function() {});
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
                if (debugLogs) console.log('[cli screenshot] received data', event.params.requestId);
                postScreenshotData(event.params.requestId, event.params.data);
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
        script.addEventListener('load', function() {
          setTimeout(postPreviewReady, 500);
        });
        document.head.appendChild(script);
        canvas.focus();
        pollScreenshotRequests('');
      }

      function postScreenshotData(requestId, data) {
        fetch('/screenshot-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            previewRunId: previewRunId,
            previewClientId: previewClientId,
            requestId: requestId,
            data: data,
          }),
        }).then(function(response) {
          if (response.ok || response.status === 404) {
            completeLocalScreenshotRequest(requestId);
          }
        }).catch(function() {});
      }

      function completeLocalScreenshotRequest(requestId) {
        if (!window.Castle.localScreenshotRequests[requestId]) return;
        window.Castle.localScreenshotRequests[requestId].done = true;
        delete window.Castle.localScreenshotRequests[requestId];
      }

      function requestCastleScreenshot(requestId) {
        if (window.Castle.localScreenshotRequests[requestId]) return;

        var state = { done: false, attempts: 0 };
        window.Castle.localScreenshotRequests[requestId] = state;

        setTimeout(function() {
          if (state.done) return;
          try {
            var canvas = document.getElementById('canvas');
            var dataUrl = canvas.toDataURL('image/png');
            var prefix = 'data:image/png;base64,';
            if (dataUrl.indexOf(prefix) === 0) {
              if (debugLogs) console.log('[cli screenshot] using canvas fallback', requestId);
              postScreenshotData(requestId, dataUrl.slice(prefix.length));
            }
          } catch (e) {
            if (debugLogs) console.warn('[cli screenshot] canvas fallback failed', e);
          }
        }, 2000);

        function send() {
          if (state.done) return;
          state.attempts++;
          try {
            if (window.Module && window.Module.ccall) {
              if (debugLogs) console.log('[cli screenshot] requesting', requestId, 'attempt', state.attempts);
              window.Module.ccall('jsNativeEventSend', 'void', ['string'], [
                JSON.stringify({ name: 'REQUEST_SCREENSHOT', params: { requestId: requestId } })
              ]);
            }
          } catch (e) {
            console.error('request screenshot failed', e);
          }
          if (!state.done && state.attempts < 60) {
            setTimeout(send, 750);
          } else if (!state.done) {
            delete window.Castle.localScreenshotRequests[requestId];
          }
        }

        send();
      }

      async function pollScreenshotRequests(lastRequestId) {
        try {
          var response = await fetch(
            '/screenshot-request?previewRunId=' + encodeURIComponent(previewRunId) +
              '&previewClientId=' + encodeURIComponent(previewClientId) +
              '&last=' + encodeURIComponent(lastRequestId || '')
          );
          if (response.status === 409) {
            location.reload();
            return;
          }
          if (!response.ok) {
            throw new Error('screenshot poll failed: ' + response.status);
          }
          var body = await response.json();
          if (body.requestId) {
            requestCastleScreenshot(body.requestId);
            lastRequestId = body.requestId;
          }
        } catch (e) {
          if (debugLogs) console.warn('[cli screenshot] poll failed', e);
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

async function listen(server: http.Server): Promise<number> {
  const start = 4321;
  const maxAttempts = 100;

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
      if (error?.code === 'EADDRINUSE') continue;
      throw error;
    }
  }

  throw new Error(`No available port found starting at ${start}.`);
}

async function listenIpc(server: net.Server): Promise<Endpoint> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('failed to bind TCP command endpoint'));
        return;
      }
      resolve({ host: LOOPBACK_HOST, port: address.port });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, LOOPBACK_HOST);
  });
}

function readJsonIfExists(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function serveChildArgs(deckDir: string, options: ServeOptions): string[] {
  const entry = process.argv[1];
  if (!entry) throw new Error('cannot find CLI entrypoint for detached serve');

  const args = [...process.execArgv, entry, 'serve', deckDir];
  if (options.card) args.push('--card', options.card);
  if (options.open) args.push('--open');
  if (options.debug) args.push('--debug');
  return args;
}

async function serveDetached(directory: string, options: ServeOptions): Promise<void> {
  const deck = readLocalDeck(directory);
  const castleDir = path.join(deck.dir, '.castle');
  const logPath = path.join(castleDir, 'serve.log');
  const serveInfoPath = getDeckServeInfoPath(deck.dir);
  fs.mkdirSync(castleDir, { recursive: true });
  try {
    fs.unlinkSync(serveInfoPath);
  } catch {}

  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, serveChildArgs(deck.dir, options), {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const serveInfo = readJsonIfExists(serveInfoPath);
    if (serveInfo?.url) {
      console.log(`Started serve in background: ${serveInfo.url}`);
      console.log(`PID: ${serveInfo.pid || child.pid}`);
      console.log(`Logs: ${logPath}`);
      if (serveInfo.host && serveInfo.port) {
        console.log(`Command endpoint: ${serveInfo.host}:${serveInfo.port}`);
      }
      return;
    }
    await sleep(250);
  }

  console.log(`Started serve in background: PID ${child.pid}`);
  console.log(`Logs: ${logPath}`);
  const logTail = (() => {
    try {
      return fs.readFileSync(logPath, 'utf8').trim().split('\n').slice(-20).join('\n');
    } catch {
      return '';
    }
  })();
  if (logTail) console.error(logTail);
  throw new Error(`Detached serve did not write ${serveInfoPath} within 15s; check logs for startup errors.`);
}

export async function serve(directory = '.', options: ServeOptions = {}): Promise<void> {
  if (options.detach) {
    await serveDetached(directory, options);
    return;
  }

  const debug = !!options.debug;
  verifyLocalPlayerBundle();
  if (debug) console.log(`[serve] player bundle: ${LOCAL_PLAYER_DIR}`);
  let deck = readLocalDeck(directory);

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
        'or a direct <dir>/scene-data.json file.',
    );
    return;
  }

  const selectedInitialCard = selectInitialCard(deck, options.card);
  if (!selectedInitialCard) {
    console.error(`Card ${options.card || deck.initialCardId || '(first card)'} not found in ${deck.dir}.`);
    return;
  }
  let initialCard: CardFile = selectedInitialCard;

  const [coreViewsJson, meInfo] = await Promise.all([fetchCoreViews(debug), API.me()]);

  const previewRunId = crypto.randomUUID();
  const previewClients = new Map<string, PreviewClientState>();
  let version = 0;
  let dirty = false;
  const changedFiles = new Set<string>();
  let screenshotCounter = 0;
  const pendingScreenshots = new Map<string, PendingScreenshot>();
  const pendingScreenshotPolls = new Set<PendingScreenshotPoll>();
  let ipcEndpoint: Endpoint | null = null;
  let actualPort: number | null = null;
  let url = '';

  const prunePreviewClients = () => {
    const cutoff = Date.now() - 60_000;
    for (const [clientId, state] of previewClients) {
      if (state.seenAt < cutoff) previewClients.delete(clientId);
    }
  };

  const registerPreviewClient = (clientId: string) => {
    if (!clientId) return;
    const state = previewClients.get(clientId) || { seenAt: 0 };
    state.seenAt = Date.now();
    previewClients.set(clientId, state);
    prunePreviewClients();
  };

  const markPreviewClientReady = (clientId: string, readyVersion: number) => {
    if (!clientId) return;
    const now = Date.now();
    const state = previewClients.get(clientId) || { seenAt: now };
    state.seenAt = now;
    state.readyVersion = readyVersion;
    state.readyAt = now;
    previewClients.set(clientId, state);
    prunePreviewClients();
  };

  const choosePreviewClient = (requireReady = false) => {
    prunePreviewClients();
    let bestClientId: string | undefined;
    let bestSeen = 0;
    for (const [clientId, state] of previewClients) {
      if (requireReady && (state.readyVersion ?? -1) < version) continue;
      const lastSeen = requireReady ? state.readyAt || state.seenAt : state.seenAt;
      if (lastSeen > bestSeen) {
        bestClientId = clientId;
        bestSeen = lastSeen;
      }
    }
    return bestClientId;
  };

  const readyPreviewClientCount = () => {
    prunePreviewClients();
    let count = 0;
    for (const state of previewClients.values()) {
      if ((state.readyVersion ?? -1) >= version) count++;
    }
    return count;
  };

  const waitForReadyPreviewClient = async (timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const clientId = choosePreviewClient(true);
      if (clientId) {
        const state = previewClients.get(clientId);
        const settleMs = Math.max(0, 500 - (Date.now() - (state?.readyAt || 0)));
        if (settleMs > 0) await sleep(settleMs);
        return clientId;
      }
      await sleep(100);
    }
    return undefined;
  };

  const pendingScreenshotForClient = (clientId: string, lastRequestId = ''): [string, PendingScreenshot] | null => {
    for (const [requestId, pending] of pendingScreenshots) {
      if (requestId === lastRequestId) continue;
      if (!pending.targetClientId || pending.targetClientId === clientId) return [requestId, pending];
    }
    return null;
  };

  const flushScreenshotPolls = () => {
    for (const poll of Array.from(pendingScreenshotPolls)) {
      const request = pendingScreenshotForClient(poll.clientId);
      if (!request) continue;
      const [requestId, pending] = request;
      pending.targetClientId ??= poll.clientId;
      pendingScreenshotPolls.delete(poll);
      clearTimeout(poll.timeout);
      sendJson(poll.res, 200, { requestId });
    }
  };

  const watcher = chokidar.watch(deck.dir, {
    ignored: (name) => name.split(path.sep).includes('.castle'),
    ignoreInitial: true,
  });

  const pendingVersionResponses = new Set<http.ServerResponse>();
  const reloadLocalProject = () => {
    const nextDeck = readLocalDeck(deck.dir);
    const nextInitialCard = selectInitialCard(nextDeck, options.card);
    if (!nextInitialCard) {
      throw new Error(`No local card data found after reload in ${nextDeck.dir}.`);
    }
    deck = nextDeck;
    initialCard = nextInitialCard;
  };
  const markDirty = (filePath?: string) => {
    dirty = true;
    if (filePath) changedFiles.add(path.relative(deck.dir, filePath));
    if (debug && filePath) console.log(`[serve] changed, restart required: ${path.relative(deck.dir, filePath)}`);
  };
  const restartPreview = (reason = 'restart') => {
    reloadLocalProject();
    version++;
    dirty = false;
    changedFiles.clear();
    for (const pending of pendingVersionResponses) {
      sendJson(pending, 200, { version });
    }
    pendingVersionResponses.clear();
    const ts = new Date().toISOString().substring(11, 23);
    const logsPath = path.join(deck.dir, '.castle', 'logs.txt');
    fs.mkdirSync(path.dirname(logsPath), { recursive: true });
    fs.appendFileSync(logsPath, `\n--- restart ${ts} (${reason}) ---\n`, 'utf8');
  };
  watcher.on('all', (_event, filePath) => markDirty(filePath));

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

      if (request.command === 'restart') {
        try {
          restartPreview('local serve');
          respond({ ok: true, version, dirty: false });
        } catch (error: any) {
          respond({ error: error?.message || String(error) });
        }
      } else if (request.command === 'screenshot') {
        void (async () => {
          const targetClientId = await waitForReadyPreviewClient();
          if (!targetClientId) {
            respond({
              error: 'no ready browser preview; open the serve URL and wait for it to load',
            });
            return;
          }

          const requestId = `cli4-local-screenshot-${Date.now()}`;
          const timeout = setTimeout(() => {
            if (!pendingScreenshots.delete(requestId)) return;
            respond({
              error: 'screenshot timed out; is the served deck open in a browser?',
            });
          }, SCREENSHOT_SERVER_TIMEOUT_MS);
          pendingScreenshots.set(requestId, {
            targetClientId,
            filename: request.filename,
            respond,
            timeout,
          });
          if (debug) console.log(`[screenshot] queued ${requestId} target ${targetClientId}`);
          flushScreenshotPolls();
        })().catch((error: any) => {
          respond({ error: error?.message || String(error) });
        });
      } else if (request.command === 'logs') {
        const logsPath = path.join(deck.dir, '.castle', 'logs.txt');
        let content = '';
        try {
          content = fs.readFileSync(logsPath, 'utf8');
        } catch {}
        respond({ logs: content });
      } else if (request.command === 'edit') {
        const cardId = request.card || initialCard.cardId;
        const card = deck.cards.get(cardId);
        if (!card?.projectCardDir) {
          respond({ error: `Card ${cardId} is not a project-format card.` });
          return;
        }
        applyLocalEdit({
          cardDir: card.projectCardDir,
          args: request.args,
          deckId: deck.deckId,
          cardId,
        })
          .then((result) => {
            markDirty();
            respond({
              success: true,
              summary: result.summary,
              restartRequired: true,
            });
          })
          .catch((error: any) => {
            respond({ error: error?.message || String(error) });
          });
      } else if (request.command === 'status') {
        respond({
          connected: true,
          mode: 'serve',
          deckId: deck.deckId,
          initialCardId: initialCard.cardId,
          cards: deck.cards.size,
          directory: deck.dir,
          port: actualPort,
          url,
          version,
          dirty,
          changedFiles: Array.from(changedFiles).slice(-20),
          previewClients: previewClients.size,
          readyPreviewClients: readyPreviewClientCount(),
        });
      } else {
        respond({
          error: `serve does not support command: ${request.command}`,
        });
      }
    });
  });
  ipcEndpoint = await listenIpc(ipcServer);

  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');

      const requestUrl = new URL(req.url || '/', 'http://localhost');
      const reqPath = decodeURIComponent(requestUrl.pathname);

      if (req.method === 'GET' && reqPath === '/') {
        sendText(
          res,
          200,
          getHTML(deck, initialCard, meInfo, previewRunId, version, debug),
          'text/html; charset=utf-8',
        );
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
        const cardVariables = await getCardVariables(initialCard);
        sendJson(res, 200, {
          variables: mergeVariables(deck.variables, cardVariables),
          passes: [],
          cards: Array.from(deck.cards.values()).map((card) => ({
            cardId: card.cardId,
            title: card.title,
          })),
        });
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
        const requestPreviewRunId = requestUrl.searchParams.get('previewRunId');
        if (!requestPreviewRunId) {
          const timeout = setTimeout(() => sendJson(res, 200, { requestId: null }), 30_000);
          res.on('close', () => clearTimeout(timeout));
          return;
        }
        if (requestPreviewRunId !== previewRunId) {
          sendJson(res, 409, { error: 'stale preview run' });
          return;
        }

        const previewClientId = requestUrl.searchParams.get('previewClientId') || '';
        if (!previewClientId) {
          sendJson(res, 400, { error: 'missing preview client id' });
          return;
        }

        registerPreviewClient(previewClientId);
        const lastRequestId = requestUrl.searchParams.get('last') || '';
        const screenshotRequest = pendingScreenshotForClient(previewClientId, lastRequestId);
        if (screenshotRequest) {
          const [requestId, pending] = screenshotRequest;
          pending.targetClientId ??= previewClientId;
          if (debug) console.log(`[screenshot] delivering ${requestId} to ${previewClientId}`);
          sendJson(res, 200, { requestId });
          return;
        }

        const poll: PendingScreenshotPoll = {
          clientId: previewClientId,
          res,
          timeout: setTimeout(() => {
            if (pendingScreenshotPolls.delete(poll)) sendJson(res, 200, { requestId: null });
          }, 30_000),
        };
        pendingScreenshotPolls.add(poll);
        res.on('close', () => {
          clearTimeout(poll.timeout);
          pendingScreenshotPolls.delete(poll);
        });
        return;
      }

      if (req.method === 'POST' && reqPath === '/preview-ready') {
        const raw = await readRequestBody(req);
        const body = JSON.parse(raw);
        if (body.previewRunId !== previewRunId) {
          sendJson(res, 409, { error: 'stale preview run' });
          return;
        }
        if (!body.previewClientId) {
          sendJson(res, 400, { error: 'missing preview client id' });
          return;
        }

        const readyVersion = Number(body.version);
        markPreviewClientReady(body.previewClientId, Number.isFinite(readyVersion) ? readyVersion : version);
        if (debug)
          console.log(
            `[preview] ready ${body.previewClientId} version ${Number.isFinite(readyVersion) ? readyVersion : version}`,
          );
        sendJson(res, 200, { ok: true, version });
        return;
      }

      if (req.method === 'POST' && reqPath === '/screenshot-data') {
        const raw = await readRequestBody(req);
        const body = JSON.parse(raw);
        if (body.previewRunId !== previewRunId) {
          sendJson(res, 409, { error: 'stale preview run' });
          return;
        }

        const pending = pendingScreenshots.get(body.requestId);
        if (!pending) {
          sendJson(res, 404, {
            error: `Screenshot request not found: ${body.requestId}`,
          });
          return;
        }
        if (pending.targetClientId && pending.targetClientId !== body.previewClientId) {
          sendJson(res, 409, {
            error: 'screenshot request targeted another preview client',
          });
          return;
        }

        if (body.previewClientId) registerPreviewClient(body.previewClientId);
        pending.targetClientId ??= body.previewClientId;
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

  actualPort = await listen(server);
  url = `http://localhost:${actualPort}`;
  console.log(`Serving ${deck.deckId || path.basename(deck.dir)} on ${url}`);
  console.log(`Initial card: ${initialCard.cardId}`);
  console.log(`Command endpoint: ${endpointLabel(ipcEndpoint)}`);
  const serveInfo = {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    host: ipcEndpoint.host,
    port: ipcEndpoint.port,
    deckDir: deck.dir,
    url,
    httpPort: actualPort,
    pid: process.pid,
    mode: 'serve',
  };
  fs.mkdirSync(path.dirname(getServeRegistryPath()), { recursive: true });
  fs.mkdirSync(path.dirname(getDeckServeInfoPath(deck.dir)), {
    recursive: true,
  });
  fs.writeFileSync(getServeRegistryPath(), JSON.stringify(serveInfo, null, 2), 'utf8');
  fs.writeFileSync(getDeckServeInfoPath(deck.dir), JSON.stringify(serveInfo, null, 2), 'utf8');

  if (options.open) {
    await openBrowser(url);
  }

  const shutdown = async () => {
    await watcher.close();
    server.close();
    ipcServer.close();
    try {
      fs.unlinkSync(getDeckServeInfoPath(deck.dir));
    } catch {}
    try {
      const registry = JSON.parse(fs.readFileSync(getServeRegistryPath(), 'utf8'));
      if (
        registry.schemaVersion === REGISTRY_SCHEMA_VERSION &&
        registry.pid === process.pid &&
        registry.host === ipcEndpoint.host &&
        registry.port === ipcEndpoint.port
      ) {
        fs.unlinkSync(getServeRegistryPath());
      }
    } catch {}
  };

  process.on('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });
}
