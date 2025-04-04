import { BaseCommand } from '../baseCommand.js';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import * as API from '../utils/api.js';

const server = new McpServer({
  name: 'Castle',
  version: '1.0.0',
});

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

export default class MCP extends BaseCommand<typeof MCP> {
  static description = 'Starts an MCP server';

  public async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}
