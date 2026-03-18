import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'yaml';

import * as Decks from '../utils/decks.js';
import { initMetadata } from '../utils/init.js';

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
    } catch (e) {}
  }

  for (let card of deck.cards) {
    let cardId = card.cardId;

    if (cardIdToDirectory[cardId]) {
      console.log(`Pulling updates for card ${card.cardId}...`);

      await Decks.pullCardAsync({
        cardId: card.cardId,
        sceneDataUrl: card.sceneDataUrl,
        cardDir: path.join(directory, cardIdToDirectory[cardId]),
        deckDir: directory,
      });
    } else {
      console.log(`No directory found for card ${card.cardId}. Cloning...`);

      let cardDirectory = path.join(directory, `card-${card.cardId}`);
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
        deckDir: directory,
      });
    }
  }

  console.log('Pull complete');
}
