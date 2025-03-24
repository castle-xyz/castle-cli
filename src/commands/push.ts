import { Args, Command } from '@oclif/core';
import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';

import * as Decks from '../utils/decks.js';

export default class Push extends Command {
  static description = 'Push updates to a deck';

  static args = {
    directory: Args.string({
      required: false,
      description: 'Directory to push',
      default: '.',
    }),
  };

  public async run(): Promise<void> {
    const { args } = await this.parse(Push);

    const directory = args.directory;

    await Decks.syncCardVersionsAsync({ deckDir: directory });

    let deck = await Decks.readDeckFromDirectoryAsync({ dir: directory, log: this.log.bind(this) });
    if (!deck) {
      return;
    }

    const cardIdToDirectory = {};

    const cardFiles = await glob('**/card.json', { cwd: directory, ignore: ['node_modules/**'] });
    for (let cardFile of cardFiles) {
      try {
        let cardData = JSON.parse(fs.readFileSync(path.join(directory, cardFile), 'utf8'));
        if (cardData.cardId) {
          cardIdToDirectory[cardData.cardId] = path.dirname(cardFile);
        }
      } catch (e) {}
    }

    for (let card of deck.cards) {
      let cardId = card.cardId;

      if (cardIdToDirectory[cardId]) {
        this.log(`Pushing updates for card ${card.cardId}...`);

        await Decks.pushCardAsync({
          cardId: card.cardId,
          deckId: deck.deckId,
          cardDir: path.join(directory, cardIdToDirectory[cardId]),
          deckDir: directory,
        });
      }
    }

    this.log('Push complete');
  }
}
