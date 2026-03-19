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
import * as os from 'os';

const CASTLE_CDN = 'https://cdn.castle.xyz';
const CASTLE_WWW = 'https://castle.xyz';

// Cache directory for player builds and coreViews.
function getCacheDir() {
  return path.join(os.homedir(), '.castle', 'cache');
}

// Read a cached file, returning null if not found.
function readCache(relPath: string): string | null {
  try {
    return fs.readFileSync(path.join(getCacheDir(), relPath), 'utf-8');
  } catch {
    return null;
  }
}

// Write a value to the cache.
function writeCache(relPath: string, data: string) {
  const full = path.join(getCacheDir(), relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data, 'utf-8');
}

// Fetch the current player ID from castle.xyz, with local cache fallback.
// Returns null if unavailable (CDN redirect won't work but local build still will).
async function fetchPlayerId(debug: boolean): Promise<string | null> {
  try {
    const res = await fetch(`${CASTLE_WWW}/api/player-id`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const json = await res.json() as any;
      if (json.playerId) {
        writeCache('player-id', json.playerId);
        if (debug) console.log(`[serve] Player ID: ${json.playerId}`);
        return json.playerId;
      }
    }
  } catch {
    // fall through to cache
  }
  const cached = readCache('player-id');
  if (cached) {
    if (debug) console.log(`[serve] Player ID: ${cached.trim()} (from cache)`);
    return cached.trim();
  }
  if (debug) console.log('[serve] Player ID unavailable — CDN fallback will not work (local build still works)');
  return null;
}

// Serve player files from local castle-www build (same origin, avoids CORS/CORP issues).
// Falls back to CDN redirect if local build not found.
function getCastleWwwVariantDir(playerId: string | null, variant: 'main' | 'nothread'): string | null {
  if (!playerId) return null;
  const localPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '../../../castle-www/public/player',
    playerId,
    variant
  );
  return fs.existsSync(localPath) ? localPath : null;
}

// Full player approach: load castle-core.js directly so we can inject real variables.
// On file change, reload the page (simpler than re-calling createDeckFromJSON).
const HTML = `
<html>
  <head></head>

  <body style="background-color: #000; display: flex; flex-direction: row; justify-content: center;">

    <canvas id="canvas" tabindex="0" width="400" height="560" style="margin-top: 20px; outline: none;"></canvas>
    <div id="message" style="position: absolute; color: white; bottom: 20px; left: 20px;"></div>

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

        // Provide a pre-initialized WebGL context so Emscripten uses the HTML5
        // WebGL API instead of trying to create an EGL/OpenGL context (which fails).
        window.Module = {
          canvas: canvas,
          preinitializedWebGLContext: canvas.getContext('webgl'),
          locateFile: function(filePath, scriptDirectory) {
            // Keep all files on same origin so workers can load them.
            return '/player/' + variant + '/' + filePath;
          },
          mainScriptUrlOrBlob: '/player/' + variant + '/castle-core.js',
        };

        var script = document.createElement('script');
        script.src = '/player/' + variant + '/castle-core.js';
        document.head.appendChild(script);
        canvas.focus();
      }

      loadDeck();
      setTimeout(checkForUpdate, 100);
    </script>
  </body>
</html>`;

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
  options: { port?: string; card?: string; open?: boolean; debug?: boolean } = {}
) {
  const debug = !!options.debug;

  await initMetadata();

  // Fetch player ID and coreViews at startup in parallel (graceful offline fallback).
  const [playerId, coreViewsJson] = await Promise.all([fetchPlayerId(debug), fetchCoreViews(debug)]);

  // Auto-detect deck subdirectory if no deck.yaml in the current directory
  if (!fs.existsSync(path.join(directory, 'deck.yaml'))) {
    try {
      const entries = fs.readdirSync(directory);
      const deckSubdirs = entries.filter(
        (d) =>
          d.startsWith('deck-') &&
          fs.statSync(path.join(directory, d)).isDirectory() &&
          fs.existsSync(path.join(directory, d, 'deck.yaml'))
      );
      if (deckSubdirs.length === 1) {
        directory = path.join(directory, deckSubdirs[0]);
        console.log(`Using deck directory: ${directory}`);
      }
    } catch (e) {}
  }

  // Sync card versions from server — skip gracefully when offline.
  try {
    await Decks.syncCardVersionsAsync({ deckDir: directory });
  } catch (e: any) {
    if (debug) console.log(`[serve] Offline — skipping card sync: ${e.message}`);
  }

  // Try to read deck.yaml — but it might not exist yet (mobile-first mode)
  let initialCardId: string | null = null;
  let cardDirectories: any = {};

  try {
    let deck = await Decks.readDeckFromDirectoryAsync({ dir: directory, log: debug ? console.log : () => {} });

    if (deck) {
      initialCardId = deck.initialCard.cardId;

      if (options.card) {
        initialCardId = options.card;
        if (!deck.cards.find((card) => card.cardId == initialCardId)) {
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

  let port: any = null;

  if (options.port) {
    try {
      port = parseInt(options.port);
    } catch (e) {
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
      onStateWritten: (cardId) => {
        version++;

        // Update card directories if this is a new card
        const cardDir = path.join(directory, `card-${cardId}`);
        const relativeDir = path.relative(directory, cardDir);
        if (!cardDirectories[cardId]) {
          cardDirectories[cardId] = relativeDir;
        }

        // Set initial card ID if not set yet
        if (!initialCardId) {
          initialCardId = cardId;
        }
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

    // Serve castle-core.js/wasm/worker from local castle-www build (same origin).
    // Falls back to redirecting to CDN if local build not found.
    for (const variant of ['main', 'nothread'] as const) {
      const variantDir = getCastleWwwVariantDir(playerId, variant);
      if (variantDir) {
        app.use(`/player/${variant}`, express.static(variantDir, { setHeaders: (res) => {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
        }}));
      } else if (playerId) {
        const cdnBase = `${CASTLE_CDN}/player/${playerId}/${variant}`;
        app.get(`/player/${variant}/:file`, (req, res) => {
          res.redirect(`${cdnBase}/${req.params.file}`);
        });
      } else {
        app.get(`/player/${variant}/:file`, (req, res) => {
          res.status(503).send('Player build unavailable: castle.xyz could not be reached and no cache found.');
        });
      }
    }

    app.get('/', (req, res) => {
      res.send(HTML);
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
      let cardId = queryCardId ? queryCardId : initialCardId;

      if (!cardId) {
        res.status(503).json({ error: 'No card available yet. Connect mobile app or clone a deck.' });
        return;
      }

      // Refresh card directories in case new cards arrived via mobile
      if (!cardDirectories[cardId]) {
        const cardFiles = await glob('**/card.yaml', { cwd: directory, ignore: ['node_modules/**'] });
        for (let cardFile of cardFiles) {
          try {
            let cardData = yaml.parse(fs.readFileSync(path.join(directory, cardFile), 'utf8'));
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
          deckDir: directory,
          cardDir: path.join(directory, cardDirectories[cardId]),
        });

        res.json(response.sceneData);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    app.get('/variables', async (req, res) => {
      const queryCardId = req.query.cardId as string | undefined;
      const cardId = queryCardId || initialCardId;
      if (!cardId || !cardDirectories[cardId]) {
        return res.json({ variables: [], passes: [], cards: [] });
      }
      const cardDir = path.join(directory, cardDirectories[cardId]);
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
