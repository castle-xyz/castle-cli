import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'yaml';

import * as Decks from '../utils/decks.js';
import { initMetadata } from '../utils/init.js';

export async function push(options: { directory?: string } = {}) {
  await initMetadata();

  const directory = options.directory || '.';

  // Force sync to get latest server state before pushing
  await Decks.syncCardVersionsAsync({ deckDir: directory, force: true });

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

  let cardIds: string[] = [];
  for (let card of deck.cards) {
    let cardId = card.cardId;

    if (cardIdToDirectory[cardId]) {
      cardIds.push(cardId);
    }
  }

  try {
    await Decks.pushCardsAsync({
      deckDir: directory,
      cards: cardIds.map((cardId) => ({
        cardId,
        cardDir: path.join(directory, cardIdToDirectory[cardId]),
      })),
    });
  } catch (e: any) {
    const code: string = e?.extensions?.code ?? '';
    if (code === 'LOGIN_REQUIRED') {
      console.error('You need to be logged in to push. Run `castle login` first.');
    } else if (code === 'DECK_INVALID_PERMISSIONS') {
      console.error('You do not have permission to push to this deck.');
    } else {
      console.error(`Push failed: ${e?.message ?? e}`);
    }
    process.exit(1);
  }

  console.log('Push complete');
}
