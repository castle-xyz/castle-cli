import { Args, Command, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';

import * as API from '../utils/api.js';
import * as Decks from '../utils/decks.js';

export default class Clone extends Command {
  static description = 'Clone a deck';

  static args = {
    deck: Args.string({ required: true, description: 'ID of the deck to clone' }),
    directory: Args.string({
      required: false,
      description: 'Directory to clone the deck into',
      default: '.',
    }),
  };

  static flags = {
    replace: Flags.boolean({
      description: 'Replace the directory if it already exists',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args } = await this.parse(Clone);
    const { flags } = await this.parse(Clone);

    const deckId = args.deck;
    const directory = args.directory;

    let deck;

    try {
      deck = await API.deck(deckId);
    } catch (e) {}

    if (!deck) {
      this.log(`Deck with ID ${deckId} not found.`);
      return;
    }

    let deckDirectory = `deck-${deckId}`;
    if (directory && directory !== '.') {
      deckDirectory = directory;
    }

    if (fs.existsSync(deckDirectory)) {
      if (flags.replace) {
        fs.rmSync(deckDirectory, { recursive: true });
      } else {
        this.log(`Directory ${deckDirectory} already exists.`);
        return;
      }
    }

    fs.mkdirSync(deckDirectory);

    let deckFileName = path.join(deckDirectory, 'deck.json');
    fs.writeFileSync(
      deckFileName,
      JSON.stringify(
        {
          deckId: deck.deckId,
        },
        null,
        2
      )
    );

    for (let card of deck.cards) {
      this.log(`Cloning card ${card.cardId}...`);

      let cardDirectory = path.join(deckDirectory, `card-${card.cardId}`);
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
        dir: cardDirectory,
      });
    }

    this.log(`Deck ${deckId} cloned successfully to ${deckDirectory}`);
  }
}
