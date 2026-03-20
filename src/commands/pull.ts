import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'yaml';

import * as Decks from '../utils/decks.js';
import { initMetadata } from '../utils/init.js';
import { initializeCardDir } from '../utils/workspace.js';

export async function pull(options: { directory?: string } = {}) {
  await initMetadata();

  const directory = options.directory || '.';

  let deck = await Decks.readDeckFromDirectoryAsync({ dir: directory, log: console.log });
  if (!deck) {
    return;
  }

  const cardIdToDirectory: any = {};

  const cardFiles = await glob('**/card.yaml', { cwd: directory, ignore: ['node_modules/**'] });
  for (let cardFile of cardFiles) {
    try {
      let cardData = yaml.parse(fs.readFileSync(path.join(directory, cardFile), 'utf8'));
      if (cardData.cardId) {
        cardIdToDirectory[cardData.cardId] = path.dirname(cardFile);
      }
    } catch (e) {
      console.warn(`[pull] failed to parse ${cardFile}:`, e);
    }
  }

  for (let card of deck.cards) {
    let cardId = card.cardId;

    if (cardIdToDirectory[cardId]) {
      console.log(`Pulling updates for card ${card.cardId}...`);

      try {
        await Decks.pullCardAsync({
          cardId: card.cardId,
          sceneDataUrl: card.sceneDataUrl,
          cardDir: path.join(directory, cardIdToDirectory[cardId]),
          deckDir: directory,
        });
      } catch (e: any) {
        console.error(`Failed to pull card ${card.cardId}: ${e?.message ?? e}`);
        process.exit(1);
      }
    } else {
      console.log(`No directory found for card ${card.cardId}. Cloning...`);

      let cardDirectory = path.join(directory, `card-${card.cardId}`);
      initializeCardDir(cardDirectory, card.cardId);

      try {
        await Decks.cloneCardAsync({
          cardId: card.cardId,
          sceneDataUrl: card.sceneDataUrl,
          cardDir: cardDirectory,
          deckDir: directory,
        });
      } catch (e: any) {
        console.error(`Failed to clone card ${card.cardId}: ${e?.message ?? e}`);
        process.exit(1);
      }
    }
  }

  console.log('Pull complete');
}
