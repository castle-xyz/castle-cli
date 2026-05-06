#!/usr/bin/env node
import * as path from 'path';
import open from 'open';
import { CLIServer } from './server.js';
import { getToken, setToken } from './config.js';
import * as API from './api.js';
import { sendCommand } from './command.js';
import { serve } from './commands/serve.js';
import { pull } from './commands/pull.js';
import { push } from './commands/push.js';
import { init } from './commands/init.js';
import { listDecks } from './commands/list.js';
import { cardAdd, cardRemove } from './commands/card.js';
import { docs } from './commands/docs.js';

function parseOptions(args: string[]): { positional: string[]; options: Record<string, any> } {
  const positional: string[] = [];
  const options: Record<string, any> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--open') {
      options.open = true;
    } else if (arg === '--detach') {
      options.detach = true;
    } else if (arg === '--debug') {
      options.debug = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--title') {
      options.title = args[++i];
    } else if (arg === '--limit') {
      options.limit = Number(args[++i]);
    } else if (arg === '-c' || arg === '--card') {
      options.card = args[++i];
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  return { positional, options };
}

async function login(options: { quiet?: boolean } = {}): Promise<string> {
  const log = options.quiet ? console.error : console.log;
  const token = getToken();
  if (token) {
    const user = await API.me();
    if (user) {
      log(`logged in as ${user.username}`);
      return token;
    }
    log('saved token expired, logging in again...');
  }

  const { pollToken, url } = await API.startCLILogin();
  log(`open this URL to log in:\n${url}`);
  await open(url);

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const user = await API.pollForCLILogin(pollToken);
      setToken(user.token);
      log(`logged in as ${user.username}`);
      return user.token;
    } catch {
      // keep polling
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'connect';

  if (command === '--help' || command === '-h') {
    console.log(`
castle-cli - Castle local deck editor

Usage:
  castle [command] [options]

Commands:
  init [dir]             Create a new local project deck
  serve [dir]            Serve local project files with the bundled player
  pull <deck-id> [dir]   Pull a deck into local YAML/Lua plus slug.json project files
  list                   List your recently edited decks
  docs                   Install/update bundled local reference docs and print their path
  push [dir]             Push local project as unlisted deck; new decks capture a cover from serve
  add-card [dir]         Add a card to a local project deck
  remove-card <id> [dir] Remove a card from a local project deck
  connect [dir]          Connect to Castle app and sync an existing local project (default dir: decks)
  restart                Stop and restart the scene
  screenshot [filename]  Take a screenshot
  save-preview-image     Capture screenshot and set deck preview image
  edit                   Apply scene edits (reads JSON from stdin)
  logs                   Show script logs since last restart
  status                 Show connection and scene info

Serve options:
  --open                 Open browser for serve
  --card, -c             Card ID for serve
  --debug                Verbose serve logging

Init options:
  --title                Deck title
  --force                Replace target directory if it already contains files

Card options:
  --title                Card title for add-card
  --force                Required for remove-card

List options:
  --limit                Number of decks to show (default: 20)
  --json                 Print machine-readable JSON

Global options:
  --help, -h             Show this help
`);
    process.exit(0);
  }

  if (command === 'restart' || command === 'screenshot' || command === 'save-preview-image' || command === 'edit' || command === 'logs' || command === 'status') {
    if (command === 'save-preview-image') await login();
    const arg = command === 'screenshot' || command === 'save-preview-image' ? args[1] : undefined;
    await sendCommand(command, arg);
    return;
  }

  if (command === 'serve') {
    const { positional, options } = parseOptions(args.slice(1));
    await serve(positional[0] || '.', options);
    return;
  }

  if (command === 'init') {
    const { positional, options } = parseOptions(args.slice(1));
    await init({ directory: positional[0], title: options.title, force: options.force });
    return;
  }

  if (command === 'pull') {
    const { positional } = parseOptions(args.slice(1));
    await login();
    await pull(positional[0], { output: positional[1] });
    return;
  }

  if (command === 'list') {
    const { options } = parseOptions(args.slice(1));
    await login({ quiet: options.json === true });
    const user = await API.me();
    if (!user?.userId) throw new Error('Unable to load current user.');
    await listDecks(user.userId, { limit: options.limit, json: options.json === true });
    return;
  }

  if (command === 'docs') {
    await docs();
    return;
  }

  if (command === 'push') {
    const { positional } = parseOptions(args.slice(1));
    await login();
    await push({ directory: positional[0] || '.' });
    return;
  }

  if (command === 'add-card') {
    const { positional, options } = parseOptions(args.slice(1));
    await cardAdd({ directory: positional[0] || '.', title: options.title });
    return;
  }

  if (command === 'remove-card') {
    const { positional, options } = parseOptions(args.slice(1));
    await cardRemove({ cardId: positional[0], directory: positional[1] || '.', force: options.force === true });
    return;
  }

  if (command !== 'connect') {
    throw new Error(`Unknown command: ${command}`);
  }

  const dir = args[1] || 'decks';
  const token = await login();
  const resolvedDir = path.resolve(dir);
  const server = new CLIServer(resolvedDir, token);

  process.on('SIGINT', () => {
    console.log('\nshutting down...');
    server.stop();
    process.exit(0);
  });

  server.start();
}

main().catch((err) => {
  console.error('fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
