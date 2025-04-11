import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../baseCommand.js';
import express from 'express';
import open from 'open';
import portfinder from 'portfinder';
import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import watch from 'node-watch';

import * as Decks from '../utils/decks.js';

const HTML = `
<html>
  <head></head>

  <body style="background-color: #000;">

    <div style="display: flex; flex-direction: row; justify-content: center;">

      <div id="player" style="margin-top: 20px"></div>
      <div id="message" style="position: absolute; color: white; bottom: 20px; left: 20px;"></div>

      <script src="https://castle.xyz/embed.js" charset="utf-8"></script>
      <script charset="utf-8">
        var currentVersion = 0;
        var currentCardId = null;

        function showMessage(message) {
          document.getElementById('message').innerText = message;
          setTimeout(() => {
            document.getElementById('message').innerText = '';
          }, 2000);
        }

        async function getVersion() {
          var response = await fetch('/version?version=' + currentVersion);
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
            if (version > currentVersion) {
              currentVersion = version;
              await update();
              showMessage('Reloaded from file change');
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
        setTimeout(checkForUpdate, 1000);
      </script>
    </div>
  </body>
</html>`;

export default class Serve extends BaseCommand<typeof Serve> {
  static description = 'Test your deck in the browser';

  static args = {
    directory: Args.string({
      required: false,
      description: 'Directory to serve',
      default: '.',
    }),
  };

  static flags = {
    port: Flags.string({
      char: 'p',
      description: 'Port to serve on',
    }),
    card: Flags.string({
      char: 'c',
      description: 'Card ID to serve',
    }),
  };

  public async run(): Promise<void> {
    const { args } = await this.parse(Serve);
    const { flags } = await this.parse(Serve);

    const directory = args.directory;

    await Decks.syncCardVersionsAsync({ deckDir: directory });

    let deck = await Decks.readDeckFromDirectoryAsync({ dir: directory, log: this.log.bind(this) });
    if (!deck) {
      return;
    }

    let initialCardId = deck.initialCard.cardId;
    if (flags.card) {
      initialCardId = flags.card;
      if (!deck.cards.find((card) => card.cardId == initialCardId)) {
        this.error(`Card with ID ${initialCardId} not found in deck.`);
      }
    }

    let cardDirectories: any = {};

    const cardFiles = await glob('**/card.json', { cwd: directory, ignore: ['node_modules/**'] });
    for (let cardFile of cardFiles) {
      try {
        let cardData = JSON.parse(fs.readFileSync(path.join(directory, cardFile), 'utf8'));
        cardDirectories[cardData.cardId] = path.dirname(cardFile);
      } catch (e) {}
    }

    if (!cardDirectories[initialCardId]) {
      this.error(`Card with ID ${initialCardId} not found in directory.`);
    }

    let port: any = null;

    if (flags.port) {
      try {
        port = parseInt(flags.port);
      } catch (e) {
        this.log(`Invalid port: ${flags.port}`);
        return;
      }
    }

    if (!port) {
      portfinder.basePort = 1337;
      port = await portfinder.getPortPromise();
    }

    let version = 0;

    watch.default(directory, { recursive: true }, async (evt, name) => {
      this.log(`File ${path.relative(directory, name)} changed. Reloading...`);
      version++;
    });

    try {
      const app = express();

      app.get('/', (req, res) => {
        res.send(HTML);
      });

      app.get('/version', (req, res) => {
        const clientVersion = parseInt(req.query.version as string) || 0;

        // If client's version is outdated, respond immediately
        if (clientVersion < version) {
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
        let queryCardId = req.query.cardId;
        let cardId = queryCardId ? queryCardId : initialCardId;

        if (!cardDirectories[cardId]) {
          this.error(`Card with ID ${cardId} not found in directory.`);
        }

        let response = await Decks.newSceneDataForCardAsync({
          cardId,
          deckDir: directory,
          cardDir: path.join(directory, cardDirectories[cardId]),
        });

        res.json(response.sceneData);
      });

      app.post('/log', express.json(), (req, res) => {
        try {
          let log = req.body;
          this.log(`${log.blueprintTitle}: ${log.log}`);
        } catch (e) {}

        res.sendStatus(200);
      });

      let url = `http://localhost:${port}`;

      app.listen(port, () => {
        this.log(`Server is running on ${url}`);
        this.log('Listening for changes...\n');

        setTimeout(async () => {
          await open(url);
        }, 100);
      });
    } catch (e) {
      this.log(`Error starting server: ${e}`);
    }
  }
}
