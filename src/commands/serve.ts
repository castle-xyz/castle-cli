import express from 'express';
import openBrowser from 'open';
import portfinder from 'portfinder';
import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import watch from 'node-watch';
import yaml from 'yaml';

import * as Decks from '../utils/decks.js';
import { initMetadata } from '../utils/init.js';
import { CLIMobileConnection } from '../utils/mobile.js';
import * as config from '../utils/config.js';

// get the current version when page loads, so that if you reload the page it doesn't immediately
// show the reload alert
const HTML = `
<html>
  <head></head>

  <body style="background-color: #000;">

    <div style="display: flex; flex-direction: row; justify-content: center;">

      <div id="player" style="margin-top: 20px"></div>
      <div id="message" style="position: absolute; color: white; bottom: 20px; left: 20px;"></div>

      <script src="https://castle.xyz/embed.js" charset="utf-8"></script>
      <script charset="utf-8">
        var hasSetCurrentVersion = false;
        var currentVersion = 0;
        var currentCardId = null;

        function showMessage(message) {
          document.getElementById('message').innerText = message;
          setTimeout(() => {
            document.getElementById('message').innerText = '';
          }, 2000);
        }

        async function getVersion() {
          var response = await fetch('/version?version=' + currentVersion + '&returnImmediate=' + (hasSetCurrentVersion ? 'false' : 'true'));
          var versionJson = await response.json();
          return versionJson.version;
        }

        async function update() {
          var response;
          if (currentCardId) {
            response = await fetch('/scene-data?cardId=' + currentCardId);
          } else {
            response = await fetch('/scene-data');
          }
          var deckJson = await response.json();
          window.castlexyz.createDeckFromJSON(document.getElementById('player'), JSON.stringify(deckJson), {
            maxWidth: 400,
          });
        }

        async function checkForUpdate() {
          try {
            var version = await getVersion();

            if (hasSetCurrentVersion) {
              if (version > currentVersion) {
                currentVersion = version;
                await update();
                showMessage('Reloaded from file change');
              }
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

        function logger(log) {
          fetch('/log', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(log),
          });
        }

        async function cardLoader(cardId) {
          var response = await fetch('/scene-data?cardId=' + cardId);
          var deckJson = await response.json();
          currentCardId = cardId;
          return JSON.stringify(deckJson);
        }

        function registerCallbacks() {
          window.castlexyz.registerLogListener(logger);
          window.castlexyz.registerCardLoader(cardLoader);
        }

        setTimeout(registerCallbacks, 100);
        setTimeout(update, 100);
        setTimeout(checkForUpdate, 100);
      </script>
    </div>
  </body>
</html>`;

export async function serve(
  directory: string = '.',
  options: { port?: string; card?: string; open?: boolean } = {}
) {
  await initMetadata();

  await Decks.syncCardVersionsAsync({ deckDir: directory });

  // Try to read deck.yaml — but it might not exist yet (mobile-first mode)
  let initialCardId: string | null = null;
  let cardDirectories: any = {};

  try {
    let deck = await Decks.readDeckFromDirectoryAsync({ dir: directory, log: console.log });

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
    console.log('No deck.yaml found — running in mobile-first mode');
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
    portfinder.basePort = 1337;
    port = await portfinder.getPortPromise();
  }

  let version = 0;

  // Watch all files for web player version increment
  // node-watch exports differently in ESM vs CJS contexts
  const watchFn: any = typeof watch === 'function' ? watch : (watch as any).default;
  watchFn(directory, { recursive: true }, async (_evt: any, name: any) => {
    if (name) {
      console.log(`File ${path.relative(directory, name)} changed. Reloading...`);
    }
    version++;
  });

  // Start mobile WebSocket connection
  const token = config.getToken();
  if (token) {
    const mobileConnection = new CLIMobileConnection({
      deckDir: directory,
      token,
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
  } else {
    console.log('[serve] No token found — mobile connection disabled. Run `castle login` to enable.');
  }

  try {
    const app = express();

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
        console.log(`Server is running on ${url}`);
        console.log('Listening for changes...\n');

        if (options.open) {
          setTimeout(async () => {
            await openBrowser(url);
          }, 100);
        }

        resolve({ app, port: actualPort, url });
      });
      httpServer.on('error', reject);
    });

    return server;
  } catch (e) {
    console.error(`Error starting server: ${e}`);
  }
}
