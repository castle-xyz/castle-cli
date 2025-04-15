import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../baseCommand.js';
import * as fs from 'fs';
import * as path from 'path';

import * as API from '../utils/api.js';
import * as Decks from '../utils/decks.js';

const DEFAULT_FILES = [
  {
    path: '.castle/cli_api_version',
    content: `1`,
    required: true,
  },
  {
    path: '.gitignore',
    content: `.castle/.cache
**/.DS_Store
`,
  },
  /*{
    path: '.cursor/mcp.json',
    content: `{
  "mcpServers": {
    "castle": {
      "command": "npx",
      "args": ["-y", "castle-cli", "mcp"]
    }
  }
}`,
  },*/
  {
    path: '.vscode/settings.json',
    content: `{
  "files.exclude": {
    ".castle/.cache": true
  }
}`,
  },
];

export default class Clone extends BaseCommand<typeof Clone> {
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
    ['skip-optional']: Flags.boolean({
      description: 'Skip creating optional files .gitignore, .vscode, and .cursor',
      default: false,
    }),
  };

  public async run(): Promise<{deckId: string; directory: string}> {
    const { args } = await this.parse(Clone);
    const { flags } = await this.parse(Clone);

    const deckId = args.deck;
    const directory = args.directory;

    let deck;

    try {
      deck = await API.deck(deckId);
    } catch (e) {}

    if (!deck) {
      this.error(`Deck with ID ${deckId} not found.`);
    }

    let deckDirectory = `deck-${deckId}`;
    if (directory && directory !== '.') {
      deckDirectory = directory;
    }

    if (fs.existsSync(deckDirectory)) {
      if (flags.replace) {
        fs.rmSync(deckDirectory, { recursive: true });
      } else {
        this.error(`Directory ${deckDirectory} already exists.`);
      }
    }

    fs.mkdirSync(deckDirectory);

    for (let file of DEFAULT_FILES) {
      if (flags['skip-optional'] && !file.required) {
        continue;
      }

      let filePath = path.join(deckDirectory, file.path);
      let fileDir = path.dirname(filePath);

      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }

      fs.writeFileSync(filePath, file.content);
    }

    let castleDirectory = path.join(deckDirectory, '.castle');
    if (!fs.existsSync(castleDirectory)) {
      fs.mkdirSync(castleDirectory);
    }

    let castleCacheDirectory = path.join(castleDirectory, '.cache');
    fs.mkdirSync(castleCacheDirectory);

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
        cardDir: cardDirectory,
        deckDir: deckDirectory,
      });
    }

    this.log(`Deck ${deckId} cloned successfully to ${deckDirectory}`);

    return {
      deckId,
      directory: deckDirectory,
    };
  }
}
