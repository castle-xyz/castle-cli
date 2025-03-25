import { Args } from '@oclif/core';
import { glob } from 'glob';
import { BaseCommand } from '../baseCommand.js';
import * as fs from 'fs';
import * as path from 'path';

import * as Decks from '../utils/decks.js';

export default class Push extends BaseCommand<typeof Push> {
  static description = 'Push updates to a deck';

  static args = {
    directory: Args.string({
      required: false,
      description: 'Directory to push',
      default: '.',
    }),
  };

  public async run(): Promise<void> {
    await this.loginRequiredAsync();

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

    let cardIds: string[] = [];
    for (let card of deck.cards) {
      let cardId = card.cardId;

      if (cardIdToDirectory[cardId]) {
        this.log(`Pushing updates for card ${card.cardId}...`);
        cardIds.push(cardId);
      }
    }

    await Decks.pushCardsAsync({
      deckDir: directory,
      cards: cardIds.map((cardId) => ({
        cardId,
        cardDir: path.join(directory, cardIdToDirectory[cardId]),
      })),
    });

    this.log('Push complete');
  }
}
