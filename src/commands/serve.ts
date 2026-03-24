import express from 'express';
import openBrowser from 'open';
import portfinder from 'portfinder';
import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import readline from 'readline';
import watch from 'node-watch';
import yaml from 'yaml';

import * as Decks from '../utils/decks.js';
import { initMetadata } from '../utils/init.js';
import { CLIMobileConnection } from '../utils/mobile.js';
import * as config from '../utils/config.js';
import { getCacheDir, readCache, writeCache, fetchPlayerId } from '../utils/cache.js';
import * as api from '../utils/api.js';

const CASTLE_CDN = 'https://cdn.castle.xyz';
const CASTLE_WWW = 'https://castle.xyz';

// Full player approach: load castle-core.js directly so we can inject real variables.
// On file change, reload the page (simpler than re-calling createDeckFromJSON).
function getHTML(meInfo: any) {
  return `
<html>
  <head>
    <link rel="icon" href="/favicon.ico">
    <style>html, body { margin: 0; padding: 0; }</style>
  </head>

  <body style="background-color: #000; display: flex; justify-content: center; align-items: center; min-height: 100vh;">

    <div id="player-container" style="display: flex; flex-direction: column; visibility: hidden;">
      <div id="player-frame" style="position: relative; border-radius: 4% / calc(4% * (5 / 7)); overflow: hidden;">
        <canvas id="canvas" tabindex="0" width="450" height="630" style="width: 100%; height: 100%; display: block; border-radius: inherit; overflow: hidden; outline: none;"></canvas>
        <div id="message" style="position: absolute; color: white; bottom: 20px; left: 20px;"></div>
      </div>
      ${meInfo && !meInfo.isAnonymous ? `
      <div id="user-info" style="height: 44px; display: flex; flex-direction: row; align-items: center; color: #fff; padding: 8px; font-size: 13px; font-family: sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;">
        <div style="position: relative;">
          <img src="${meInfo.photo?.url ?? ''}" style="width: 26px; height: 26px; border-radius: 100%;" />
          ${meInfo.photoFrame ? `<img src="${meInfo.photoFrame.frameUrl}" style="position: absolute; top: -6.5px; left: -6.5px; width: 39px; height: 39px;" />` : ''}
        </div>
        <div style="flex-grow: 1; margin-left: 8px;">
          <div style="font-size: 10px; text-transform: uppercase; letter-spacing: -0.2px;">You are previewing</div>
          <div><a href="https://castle.xyz/${meInfo.username}" style="font-weight: bold; color: #fff; text-decoration: none;">@${meInfo.username}</a>'s deck on Castle</div>
        </div>
      </div>
      ` : ''}
    </div>

    <script charset="utf-8">
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
          } else {
            currentVersion = version;
            hasSetCurrentVersion = true;
          }
        } catch (e) {
          setTimeout(checkForUpdate, 2000);
          return;
        }
        setTimeout(checkForUpdate, 100);
      }

      async function loadDeck() {
        var [sceneRes, varsRes, coreViewsRes] = await Promise.all([fetch('/scene-data'), fetch('/variables'), fetch('/coreviews')]);

        if (!sceneRes.ok) {
          var msg = document.getElementById('message');
          msg.style.cssText = 'position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; color: white; font-family: sans-serif; text-align: center; padding: 20px;';
          msg.innerHTML = '<div style="font-size: 20px; margin-bottom: 12px;">Castle Server Running</div><div style="font-size: 14px; color: #aaa;">Open Castle on your phone and select a deck to connect.</div>';
          return;
        }

        var sceneText = await sceneRes.text();
        var varsJson = await varsRes.json();
        var coreViewsText = await coreViewsRes.text();

        var canvas = document.getElementById('canvas');

        window.Castle = {
          hasInitialDeck: true,
          isPlayableMultiplayer: false,
          creatorUsername: '',
          deckId: '',
          cardId: '',
          cardTitle: '',
          nextCardSceneData: sceneText,
          variables: JSON.stringify(varsJson),
          cardCache: {},
          isFocused: true,
          coreViews: coreViewsText,
          authToken: '',
          scriptLog: function(log, level, blueprintTitle) {
            fetch('/log', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ log: log, level: level, blueprintTitle: blueprintTitle }),
            });
          },
          navigateToCardId: async function(cardId) {
            var res = await fetch('/scene-data?cardId=' + cardId);
            window.Castle.nextCardSceneData = await res.text();
          },
          navigateToDeckId: function() {},
          openDownloadAppLink: function() {},
          bridgeEvent: function() {},
          dataRequest: async function(requestId, url) {
            var arrayBuffer = new ArrayBuffer(0);
            var success = 1;
            try {
              var resp = await fetch(url);
              arrayBuffer = await resp.arrayBuffer();
            } catch(e) {
              success = 0;
            }
            window.Module.ccall('jsDataRequestCompleted', 'void',
              ['number', 'number', 'array', 'number'],
              [requestId, success, new Uint8Array(arrayBuffer), arrayBuffer.byteLength]);
          },
          graphqlPostRequest: async function(requestId, body) {
            window.Module.ccall('jsGraphQLPostRequestComplete', 'void',
              ['number', 'number', 'string'],
              [requestId, 0, '']);
          },
        };

        // Use threaded variant when SharedArrayBuffer is available (requires COOP/COEP headers).
        // Fall back to nothread variant otherwise.
        var useThread = typeof Atomics !== 'undefined' && typeof SharedArrayBuffer !== 'undefined';
        var variant = useThread ? 'main' : 'nothread';

        window.Module = {
          canvas: canvas,
          locateFile: function(filePath, scriptDirectory) {
            // Keep all files on same origin so workers can load them.
            return '/player/' + variant + '/' + filePath;
          },
          mainScriptUrlOrBlob: '/player/' + variant + '/castle-core.js',
        };

        // Use WebGL1 instead of WebGL2 to prevent Safari rendering issues.
        // https://github.com/emscripten-core/emscripten/issues/16104
        window.Module.preinitializedWebGLContext = canvas.getContext('webgl');

        var script = document.createElement('script');
        script.src = '/player/' + variant + '/castle-core.js';
        document.head.appendChild(script);
        canvas.focus();
      }

      var MAX_CARD_WIDTH = 450;
      var MAX_CARD_HEIGHT = 630;
      var PADDING = 20;

      function resizeCard() {
        var userInfo = document.getElementById('user-info');
        var userInfoHeight = userInfo ? userInfo.offsetHeight : 0;
        var availableWidth = window.innerWidth - PADDING * 2;
        var availableHeight = window.innerHeight - userInfoHeight - PADDING * 2;
        var cardWidth, cardHeight;
        if (availableWidth >= MAX_CARD_WIDTH && availableHeight >= MAX_CARD_HEIGHT) {
          cardWidth = MAX_CARD_WIDTH;
          cardHeight = MAX_CARD_HEIGHT;
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

// Fetch coreViews JSON from production castle.xyz.
// coreViews is required by the C++ engine for UI overlays (feed, passes, inventory, etc.).
// Caches to ~/.castle/cache/coreviews.json for offline use.
async function fetchCoreViews(debug: boolean): Promise<string> {
  try {
    const res = await fetch(`${CASTLE_WWW}/api/coreviews`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const text = await res.text();
      writeCache('coreviews.json', text);
      if (debug) console.log('[serve] Loaded coreViews from castle.xyz');
      return text;
    }
  } catch {
    // fall through to cache
  }
  const cached = readCache('coreviews.json');
  if (cached) {
    if (debug) console.log('[serve] Loaded coreViews from cache');
    return cached;
  }
  if (debug) console.log('[serve] coreViews unavailable — UI overlays (passes, inventory, feed) will not render');
  return '{}';
}

export async function serve(
  directory: string = '.',
  options: { port?: string; card?: string; open?: boolean; debug?: boolean; drawPreviews?: boolean } = {}
) {
  const debug = !!options.debug;

  await initMetadata();

  // Fetch player ID, coreViews, and me info at startup in parallel (graceful offline fallback).
  const [playerId, coreViewsJson, meInfo] = await Promise.all([fetchPlayerId(debug), fetchCoreViews(debug), api.me()]);

  // Sync card versions from server — skip gracefully when offline.
  try {
    await Decks.syncCardVersionsAsync({ deckDir: directory });
  } catch (e: any) {
    if (debug) console.log(`[serve] Offline — skipping card sync: ${e.message}`);
  }

  // Try to read deck.yaml — but it might not exist yet (mobile-first mode)
  let initialCardId: string | null = null;
  let activeCardId: string | null = null;
  let cardDirectories: any = {};
  let deckDirForRoutes = directory;

  // Read deckId from deck.yaml if present (deck-locked mode)
  let deckId: string | undefined;
  const deckYamlPath = path.join(directory, 'deck.yaml');
  if (fs.existsSync(deckYamlPath)) {
    try {
      const deckConfig = yaml.parse(fs.readFileSync(deckYamlPath, 'utf8'));
      deckId = deckConfig.deckId || undefined;
      if (options.drawPreviews === false) {
        if (deckConfig.drawPreviews !== false) {
          deckConfig.drawPreviews = false;
          fs.writeFileSync(deckYamlPath, yaml.stringify(deckConfig));
        }
      } else if (deckConfig.drawPreviews === undefined) {
        deckConfig.drawPreviews = true;
        fs.writeFileSync(deckYamlPath, yaml.stringify(deckConfig));
      }
    } catch (e) {}
  }

  try {
    let deck = await Decks.readDeckFromDirectoryAsync({ dir: directory, log: debug ? console.log : () => {} });

    if (deck) {
      initialCardId = deck.initialCard.cardId;

      if (options.card) {
        initialCardId = options.card;
        if (!deck.cards.find((card: any) => card.cardId == initialCardId)) {
          console.error(`Card with ID ${initialCardId} not found in deck.`);
          process.exit(1);
        }
      }

      const cardFiles = await glob('**/card.yaml', { cwd: directory, ignore: ['node_modules/**'] });
      for (let cardFile of cardFiles) {
        try {
          let cardData = yaml.parse(fs.readFileSync(path.join(directory, cardFile), 'utf8'));
          cardDirectories[cardData.cardId] = path.dirname(cardFile);
        } catch (e) {}
      }
    }
  } catch (e) {
    if (debug) console.log('[serve] No deck.yaml found — running in mobile-first mode');
  }

  let port: number | null = null;

  if (options.port) {
    port = parseInt(options.port, 10);
    if (isNaN(port) || port < 0 || port > 65535) {
      console.error(`Invalid port: ${options.port}`);
      return;
    }
  }

  if (!port) {
    portfinder.basePort = 4321;
    port = await portfinder.getPortPromise();
  }

  let version = 0;

  // Watch game files for web player version increment.
  // Exclude .castle/ (internal CLI files like logs.txt) to avoid spurious reloads.
  // node-watch exports differently in ESM vs CJS contexts
  const watchFn: any = typeof watch === 'function' ? watch : (watch as any).default;
  watchFn(directory, { recursive: true, filter: (name: string) => !name.includes(`${path.sep}.castle${path.sep}`) && !name.endsWith(`${path.sep}.castle`) }, (_evt: any, name: any) => {
    if (name && debug) {
      console.log(`[serve] File changed: ${path.relative(directory, name)}`);
    }
    version++;
  });

  // Start mobile WebSocket connection (if logged in).
  const token = config.getToken();
  if (token) {
    const mobileConnection = new CLIMobileConnection({
      deckDir: directory,
      token,
      debug,
      expectedDeckId: deckId,
      onStateWritten: (cardId, actualDeckDir) => {
        deckDirForRoutes = actualDeckDir;
        version++;

        // Update card directories if this is a new card
        if (!cardDirectories[cardId]) {
          cardDirectories[cardId] = `card-${cardId}`;
        }

        // Set initial card ID if not set yet; always track the active card
        if (!initialCardId) {
          initialCardId = cardId;
        }
        activeCardId = cardId;
      },
    });
    mobileConnection.start();
  } else if (debug) {
    console.log('[serve] No token found — mobile disabled. Run `castle login` to enable.');
  }

  try {
    const app = express();

    // COOP/COEP headers required for SharedArrayBuffer (threaded WASM variant).
    app.use((req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
      next();
    });

    // Serve castle-core.js/wasm/worker proxied from CDN (same origin).
    // Proxy instead of redirect — browsers block cross-origin Worker construction
    // when following redirects (new Worker(url) fails if url redirects cross-origin).
    for (const variant of ['main', 'nothread'] as const) {
      if (playerId) {
        const cdnBase = `${CASTLE_CDN}/player/${playerId}/${variant}`;
        app.get(`/player/${variant}/:file`, async (req, res) => {
          try {
            const upstream = await fetch(`${cdnBase}/${req.params.file}`);
            if (!upstream.ok) {
              res.status(upstream.status).send(await upstream.text());
              return;
            }
            const ct = upstream.headers.get('content-type');
            if (ct) res.setHeader('Content-Type', ct);
            const buf = await upstream.arrayBuffer();
            res.send(Buffer.from(buf));
          } catch (e: any) {
            res.status(502).send(`Failed to fetch from CDN: ${e.message}`);
          }
        });
      } else {
        app.get(`/player/${variant}/:file`, (req, res) => {
          res.status(503).send('Player build unavailable: castle.xyz could not be reached and no cache found.');
        });
      }
    }

    app.get('/', (req, res) => {
      res.send(getHTML(meInfo));
    });

    app.get('/favicon.ico', (req, res) => {
      const faviconPath = path.join(path.dirname(new URL(import.meta.url).pathname), '../assets/favicon.ico');
      res.sendFile(faviconPath);
    });

    app.get('/version', (req, res) => {
      const returnImmediate = req.query.returnImmediate === 'true';
      const clientVersion = parseInt(req.query.version as string) || 0;

      // If client's version is outdated, respond immediately
      if (clientVersion < version || returnImmediate) {
        return res.json({ version });
      }

      // Otherwise, wait for a change (long polling)
      const timeout = setTimeout(() => {
        res.json({ version }); // Return current version after timeout
      }, 30000); // 30 second timeout

      // Store the request to respond when version changes
      const checkInterval = setInterval(() => {
        if (clientVersion < version) {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          res.json({ version });
        }
      }, 100);

      // Clean up on connection close
      res.on('close', () => {
        clearTimeout(timeout);
        clearInterval(checkInterval);
      });
    });

    app.get('/scene-data', async (req, res) => {
      let queryCardId = req.query.cardId as string | undefined;
      let cardId = queryCardId ? queryCardId : (activeCardId || initialCardId);

      if (!cardId) {
        res.status(503).json({ error: 'No card available yet. Connect mobile app or clone a deck.' });
        return;
      }

      // Refresh card directories in case new cards arrived via mobile
      if (!cardDirectories[cardId]) {
        const cardFiles = await glob('**/card.yaml', { cwd: deckDirForRoutes, ignore: ['node_modules/**'] });
        for (let cardFile of cardFiles) {
          try {
            let cardData = yaml.parse(fs.readFileSync(path.join(deckDirForRoutes, cardFile), 'utf8'));
            cardDirectories[cardData.cardId] = path.dirname(cardFile);
          } catch (e) {}
        }
      }

      if (!cardDirectories[cardId]) {
        res.status(404).json({ error: `Card with ID ${cardId} not found in directory.` });
        return;
      }

      try {
        let response = await Decks.newSceneDataForCardAsync({
          cardId,
          deckDir: deckDirForRoutes,
          cardDir: path.join(deckDirForRoutes, cardDirectories[cardId]),
        });

        res.json(response.sceneData);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    app.get('/variables', async (req, res) => {
      const queryCardId = req.query.cardId as string | undefined;
      const cardId = queryCardId || activeCardId || initialCardId;
      if (!cardId || !cardDirectories[cardId]) {
        return res.json({ variables: [], passes: [], cards: [] });
      }
      const cardDir = path.join(deckDirForRoutes, cardDirectories[cardId]);
      const variablesPath = path.join(cardDir, 'variables.yaml');
      let variables: any[] = [];
      if (fs.existsSync(variablesPath)) {
        try {
          const rawVars = yaml.parse(fs.readFileSync(variablesPath, 'utf8'));
          if (Array.isArray(rawVars)) {
            variables = rawVars.map((v: any) => ({
              id: v.variableId ?? v.id,
              name: v.name,
              initialValue: v.initialValue ?? 0,
              lifetime: v.lifetime ?? 'deck',
            }));
          }
        } catch (e) {}
      }
      res.json({ variables, passes: [], cards: [] });
    });

    app.get('/coreviews', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(coreViewsJson);
    });

    app.post('/log', express.json(), (req, res) => {
      try {
        let log = req.body;
        console.log(`${log.blueprintTitle}: ${log.log}`);
      } catch (e) {}

      res.sendStatus(200);
    });

    // Listen and resolve with actual bound port (port 0 = OS-assigned)
    const server = await new Promise<{ app: any; port: number; url: string }>((resolve, reject) => {
      const httpServer = app.listen(port, () => {
        const addr = httpServer.address() as any;
        const actualPort = addr?.port ?? port;
        const url = `http://localhost:${actualPort}`;
        console.log(`Serving on ${url}`);

        if (options.open) {
          setTimeout(async () => { await openBrowser(url); }, 100);
        }

        resolve({ app, port: actualPort, url });
      });
      httpServer.on('error', reject);
    });

    // Keyboard shortcuts — only in interactive terminals.
    if (process.stdin.isTTY) {
      console.log('  o  open in browser  ·  r  reload  ·  q  quit');
      console.log();
      readline.emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('keypress', (_str: string, key: any) => {
        if (!key) return;
        if ((key.ctrl && key.name === 'c') || key.name === 'q') {
          process.exit(0);
        }
        if (key.name === 'o') {
          openBrowser(server.url);
        }
        if (key.name === 'r') {
          version++;
          console.log('Reloading...');
        }
      });
    }

    return server;
  } catch (e) {
    console.error(`Error starting server: ${e}`);
  }
}
