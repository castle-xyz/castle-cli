import * as fs from 'fs';
import * as path from 'path';
import yaml from 'yaml';

import * as API from '../utils/api.js';
import * as Decks from '../utils/decks.js';
import { initMetadata } from '../utils/init.js';
import { initializeDeckDir, initializeCardDir } from '../utils/workspace.js';

export async function clone(deckArg: string, options: { directory?: string; replace?: boolean; drawPreviews?: boolean } = {}) {
  await initMetadata();
  await API.fetchAndCacheAdminStatus();

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

  if (options.drawPreviews === true) {
    const deckYamlPath = path.join(deckDirectory, 'deck.yaml');
    const deckConfig = yaml.parse(fs.readFileSync(deckYamlPath, 'utf8'));
    deckConfig.drawPreviews = true;
    fs.writeFileSync(deckYamlPath, yaml.stringify(deckConfig));
  }

  for (let card of deck.cards) {
    console.log(`Cloning card ${card.cardId}...`);

    let cardDirectory = path.join(deckDirectory, `card-${card.cardId}`);
    initializeCardDir(cardDirectory, card.cardId);

    try {
      await Decks.cloneCardAsync({
        cardId: card.cardId,
        sceneDataUrl: card.sceneDataUrl,
        cardDir: cardDirectory,
        deckDir: deckDirectory,
      });
    } catch (e: any) {
      console.error(`Failed to clone card ${card.cardId}: ${e?.message ?? e}`);
      process.exit(1);
    }
  }

  console.log(`Deck ${deckId} cloned successfully to ${deckDirectory}`);

  return {
    deckId,
    directory: deckDirectory,
  };
}
