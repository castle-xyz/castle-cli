import { BaseCommand } from '../baseCommand.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

import * as API from '../utils/api.js';
import * as Blueprints from '../utils/blueprints.js';
import { BlueprintEntryType } from '../utils/blueprints.js';
import { getCurrentDeck, getCurrentDeckCards } from '../utils/decks.js';

const DOCS_PATH = '.castle/.docs/global-docs.mdx';
const DOCS_DOWNLOAD_URL = 'https://385v7jnpen.ufs.sh/f/TmnXoqifwiv9PW0ig7Tl9oq8VFQwyO3RJB06snXiEImrNaef'; // 'https://docs.castle.game/complete';

/**
   ____    _    ____ _____ _     _____ 
  / ___|  / \  / ___|_   _| |   | ____|
 | |     / _ \ \___ \ | | | |   |  _|  
 | |___ / ___ \ ___) || | | |___| |___ 
  \____/_/   \_\____/ |_| |_____|_____|

 */
const server = new McpServer({
  name: 'Castle',
  version: '1.0.0',
});

/**
 * NOTE: Check support matrix for Resource support:
 * https://modelcontextprotocol.io/clients#feature-support-matrix
 */
server.resource(
  'current_user',
  'users://me',
  {
    description: 'Returns the current logged-in user on Castle',
  },
  async (uri) => {
    let me = await API.me();
    let text;
    if (me) {
      text = `Logged in to Castle as user ${me.username}`;
    } else {
      text = `Not logged in to Castle`;
    }

    return {
      contents: [
        {
          uri: uri.href,
          text,
        },
      ],
    };
  }
);

server.tool('getCurrentDeck', 'Get the ID of the currently loaded deck', {}, async ({}) => 
  {
    const deckId = getCurrentDeck();
    if (!deckId) {
      throw new Error('No deck is currently loaded');
    }
    return {
      content: [
        { type: 'text', text: deckId },
      ],
    };
});

server.tool('getAvailableCards', 'Get a list of cards that are available in the current deck', {}, async ({}) => {
  const cards = getCurrentDeckCards();
  return {
    content: cards.map((card) => ({ type: 'text', text: card })),
  };
});

server.tool('addBlueprint', 'Add a blueprint to the current deck', {
  name: z.string().describe('The name of the blueprint to add'),
  // deck: z.string().describe('The ID of the deck to add the blueprint to. In most cases, this will be the currently loaded deck.'),
  card: z.string().describe('The ID of the card to add the blueprint to.'),
}, async ({ name, card }) => {
  const blueprint = Blueprints.DEFAULT_BLUEPRINTS.find((blueprint) => blueprint.title === name);
  if (!blueprint || blueprint.entryType !== BlueprintEntryType.actorBlueprint) {
    return { content: [{ type: 'text', text: 'Blueprint not found' }] };
  }

  const deckPath = path.resolve('.');
  const cardPath = path.join(deckPath, 'card-' + card);

  if (!fs.existsSync(deckPath)) {
    throw new Error('Deck directory not found in ' + deckPath);
  }
  if (!fs.existsSync(cardPath)) {
    throw new Error('Card directory not found in ' + cardPath);
  }

  Blueprints.addBlueprintToDeck(blueprint, deckPath, cardPath);

  return {
    content: [
      { type: 'text', text: 'Blueprint added' },
    ],
  };
});

server.tool('getPossibleBlueprints', 'Get a list of possible blueprints that can be added to the current deck', {}, async ({}) => {
  const defaultBlueprints = Blueprints.DEFAULT_BLUEPRINTS;
  const names = defaultBlueprints.map((blueprint) => blueprint.title);
  return { 
    content: names.map((name) => ({ type: 'text', text: name })),
  };
});

server.tool('searchDocumentation', 'Search the Castle game platform documentation', {
  query: z.string().describe("The query to answer using the documentation")
}, async ({ query }) => {
  let documentation: string;
  
  try {
    // Check if docs file exists locally
    if (fs.existsSync(DOCS_PATH)) {
      documentation = await fs.readFileSync(DOCS_PATH, 'utf-8');
    } else {
      // Download docs from URL and save locally
      const response = await fetch(DOCS_DOWNLOAD_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch documentation: ${response.statusText}`);
      }
      documentation = await response.text();
      
      // Ensure the assets directory exists
      const assetsDir = path.dirname(DOCS_PATH);
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
      }
      
      // Write the documentation to local file
      await fs.writeFileSync(DOCS_PATH, documentation, 'utf-8');
    }
  } catch (error) {
    return {
      content: [
        { type: 'text', text: `Error loading documentation: ${error instanceof Error ? error.message : 'Unknown error'}` }
      ]
    };
  }
    
  return {
      content: [
          {
              type: "text",
              text: `Please answer this query using the following documentation:\n\n${documentation}\n\Query: ${query}`
          }
      ]
  };
});

export default class MCP extends BaseCommand<typeof MCP> {
  static description = 'Starts an MCP server';
  static hidden = true;

  public async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}
