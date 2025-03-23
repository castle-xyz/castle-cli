import { Args, Command, Flags } from '@oclif/core';
import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';

import * as Decks from '../utils/decks.js';

export default class Pull extends Command {
  static description = 'Pull updates from a deck';

  static args = {
    directory: Args.string({
      required: false,
      description: 'Directory to pull',
      default: '.',
    }),
  };

  public async run(): Promise<void> {
    const { args } = await this.parse(Pull);

    const directory = args.directory;

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
        this.log(`Pulling updates for card ${card.cardId}...`);

        await Decks.pullCardAsync({
          cardId: card.cardId,
          sceneDataUrl: card.sceneDataUrl,
          cardDir: path.join(directory, cardIdToDirectory[cardId]),
          deckDir: directory,
        });
      } else {
        this.log(`No directory found for card ${card.cardId}. Cloning...`);

        let cardDirectory = path.join(directory, `card-${card.cardId}`);
        fs.mkdirSync(cardDirectory);

        let cardFileName = path.join(cardDirectory, 'card.json');

        fs.writeFileSync(
          cardFileName,
          JSON.stringify(
            {
              cardId: card.cardId,
            },
            null,
            2
          )
        );

        await Decks.cloneCardAsync({
          cardId: card.cardId,
          sceneDataUrl: card.sceneDataUrl,
          cardDir: cardDirectory,
          deckDir: directory,
        });
      }
    }

    this.log('Pull complete');
  }
}
