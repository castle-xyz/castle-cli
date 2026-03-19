import * as fs from 'fs';
import * as path from 'path';
import yaml from 'yaml';

import * as API from '../utils/api.js';
import * as Decks from '../utils/decks.js';
import { initMetadata } from '../utils/init.js';

const DEFAULT_FILES = [
  {
    path: '.castle/cli_api_version',
    content: `1`,
    required: true,
  },
  {
    path: '.gitignore',
    content: `.castle/.cache
.castle/logs.txt
.castle/commands.json
.castle/screenshots/
**/.castle/meta.json
**/.DS_Store
`,
  },
  {
    path: '.castle/logs.txt',
    content: '',
  },
  {
    path: '.castle/commands.json',
    content: '',
  },
];

export async function clone(deckArg: string, options: { directory?: string; replace?: boolean } = {}) {
  await initMetadata();

  let deckId = deckArg;

  if (
    deckId.startsWith('http') ||
    deckId.includes('castle.xyz') ||
    deckId.includes('castle.games') ||
    deckId.includes('/d/')
  ) {
    let url = deckId;

    try {
      let resolvedLink = await API.resolveDeepLink(url);
      if (resolvedLink && resolvedLink.deck) {
        deckId = resolvedLink.deck.deckId;
        console.log(`Found deck ID ${deckId} at url ${url}`);
      } else {
        console.error(`Failed to resolve deep link: ${url}`);
        process.exit(1);
      }
    } catch (e) {
      console.error(`Failed to find deck at link: ${url}`);
      process.exit(1);
    }
  }

  const directory = options.directory;

  let deck;

  try {
    deck = await API.deck(deckId);
  } catch (e) {}

  if (!deck) {
    console.error(`Deck with ID ${deckId} not found.`);
    process.exit(1);
  }

  let deckDirectory = `deck-${deckId}`;
  if (directory && directory !== '.') {
    deckDirectory = directory;
  }

  if (fs.existsSync(deckDirectory)) {
    if (options.replace) {
      fs.rmSync(deckDirectory, { recursive: true });
    } else {
      console.error(`Directory ${deckDirectory} already exists.`);
      process.exit(1);
    }
  }

  fs.mkdirSync(deckDirectory);

  for (let file of DEFAULT_FILES) {
    let filePath = path.join(deckDirectory, file.path);
    let fileDir = path.dirname(filePath);

    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }

    fs.writeFileSync(filePath, file.content);
  }

  let castleDirectory = path.join(deckDirectory, '.castle');
  if (!fs.existsSync(castleDirectory)) {
    fs.mkdirSync(castleDirectory);
  }

  let castleCacheDirectory = path.join(castleDirectory, '.cache');
  fs.mkdirSync(castleCacheDirectory);

  fs.mkdirSync(path.join(castleDirectory, 'screenshots'));

  let deckFileName = path.join(deckDirectory, 'deck.yaml');
  fs.writeFileSync(
    deckFileName,
    yaml.stringify({
      deckId: deck.deckId,
    })
  );

  for (let card of deck.cards) {
    console.log(`Cloning card ${card.cardId}...`);

    let cardDirectory = path.join(deckDirectory, `card-${card.cardId}`);
    fs.mkdirSync(cardDirectory);

    let cardFileName = path.join(cardDirectory, 'card.yaml');

    fs.writeFileSync(
      cardFileName,
      yaml.stringify({
        cardId: card.cardId,
      })
    );

    await Decks.cloneCardAsync({
      cardId: card.cardId,
      sceneDataUrl: card.sceneDataUrl,
      cardDir: cardDirectory,
      deckDir: deckDirectory,
    });
  }

  console.log(`Deck ${deckId} cloned successfully to ${deckDirectory}`);

  return {
    deckId,
    directory: deckDirectory,
  };
}
