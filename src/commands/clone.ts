import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../baseCommand.js';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'yaml';

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
  {
    path: '.vscode/settings.json',
    content: `{
  "files.exclude": {
    ".castle/.cache": true
  }
}`,
  },
  {
    path: '.cursor/mcp.json',
    content: `{
      "mcpServers": {
        "castle": {
          "command": "npx",
          "args": ["-y", "castle-cli", "mcp"]
        }
      }
    }`,
  },
  {
    path: '.cursor/rules/castle-rules.mdc',
    content: `---
description: Castle Development Rules
globs:
alwaysApply: true
---

Castle is a game development platform build on top of love2d & box2d.
You are a game development assistant tasked with helping users make games using Castle.
While doing this, you will help users understand how Castle works, and teach them how-to improve their existing games.

# Inputs
1. **MCP Documentation** You may use the bundled MCP server to search Castle's documentation.
Refer to the documentation whenever you have a doubt, or question, that you cannot answer.
2. **YAML Interface** A series of yaml files will help you find blueprints, cards, decks, and layout actors related to a user's game. Each entry has a set of properties, or components, that define its behavior. In order to understand what all of the possible properties for an entity are, search the castle documentation.
3. **Source JSON Cache** The entire of a Castle game is encoded within a .json file that you will have access to. You may read this file in order to analyze how a game works, and suggest changes.

If a game deck has multiple cards, and you are unsure about which one the user wants to modify, ask them to select a card explicitly.

You may modify any file within a game's directory, including the yaml and json files discussed above.
If you are unsure about a change, search for information in the documentation first.

If you are making a change to an existing game then, whenever possible, use included MCP tools in order to do so.
    `,
  }
];

export default class Clone extends BaseCommand<typeof Clone> {
  static description = 'Clone a deck';

  static args = {
    deck: Args.string({ required: true, description: 'Link or ID of the deck to clone' }),
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

  public async run(): Promise<{ deckId: string; directory: string }> {
    const { args } = await this.parse(Clone);
    const { flags } = await this.parse(Clone);

    let deckId = args.deck;

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

          this.log(`Found deck ID ${deckId} at url ${url}`);
        } else {
          this.error(`Failed to resolve deep link: ${url}`);
        }
      } catch (e) {
        this.error(`Failed to find deck at link: ${url}`);
      }
    }

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

    let deckFileName = path.join(deckDirectory, 'deck.yaml');
    fs.writeFileSync(
      deckFileName,
      yaml.stringify({
        deckId: deck.deckId,
      })
    );

    for (let card of deck.cards) {
      this.log(`Cloning card ${card.cardId}...`);

      let cardDirectory = path.join(deckDirectory, `card-${card.cardId}`);
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
