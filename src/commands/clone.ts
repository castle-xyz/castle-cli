import * as fs from 'fs';
import * as path from 'path';

import * as API from '../utils/api.js';
import * as Decks from '../utils/decks.js';
import { initMetadata } from '../utils/init.js';
import { initializeDeckDir, initializeCardDir } from '../utils/workspace.js';

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

  initializeDeckDir(deckDirectory, deck.deckId);

  for (let card of deck.cards) {
    console.log(`Cloning card ${card.cardId}...`);

    let cardDirectory = path.join(deckDirectory, `card-${card.cardId}`);
    initializeCardDir(cardDirectory, card.cardId);

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
