import { Args } from '@oclif/core';
import { glob } from 'glob';
import { BaseCommand } from '../baseCommand.js';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'yaml';

import * as Decks from '../utils/decks.js';
import { initMetadata } from '../utils/init.js';

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
    await initMetadata();
    await this.loginRequiredAsync();

    const { args } = await this.parse(Push);

    const directory = args.directory;

    // use force: true so that users can't edit the deck json files under .cache
    await Decks.syncCardVersionsAsync({ deckDir: directory, force: true });

    let deck = await Decks.readDeckFromDirectoryAsync({ dir: directory, log: this.log.bind(this) });
    if (!deck) {
      return;
    }

    const cardIdToDirectory = {};

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
