import * as path from 'path';
import open from 'open';
import { CLIServer } from './server.js';
import { getToken, setToken } from './config.js';
import * as API from './api.js';
import { sendCommand } from './command.js';
import { serve } from './commands/serve.js';
import { pull } from './commands/pull.js';

function parseOptions(args: string[]): { positional: string[]; options: Record<string, any> } {
  const positional: string[] = [];
  const options: Record<string, any> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--open') {
      options.open = true;
    } else if (arg === '--debug') {
      options.debug = true;
    } else if (arg === '-p' || arg === '--port') {
      options.port = args[++i];
    } else if (arg === '-c' || arg === '--card') {
      options.card = args[++i];
    } else {
      positional.push(arg);
    }
  }

  return { positional, options };
}

async function login(): Promise<string> {
  const token = getToken();
  if (token) {
    const user = await API.me();
    if (user) {
      console.log(`logged in as ${user.username}`);
      return token;
    }
    console.log('saved token expired, logging in again...');
  }

  const { pollToken, url } = await API.startCLILogin();
  console.log(`open this URL to log in:\n${url}`);
  await open(url);

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const user = await API.pollForCLILogin(pollToken);
      setToken(user.token);
      console.log(`logged in as ${user.username}`);
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
castle-cli — Castle script editing bridge

Usage:
  castle [command] [options]

Commands:
  serve [dir]            Serve local saved scene-data JSON with the bundled player
  pull <deck-id> [dir]   Pull a deck into local YAML/Lua plus slug.json project files
  connect [dir]          Connect to Castle app and sync scripts (default)
  restart                Stop and restart the scene
  screenshot [filename]  Take a screenshot
  edit                   Apply scene edits (reads JSON from stdin)
  logs                   Show script logs since last restart
  status                 Show connection and scene info

Serve options:
  --open                 Open browser for serve
  --port, -p             Port for serve
  --card, -c             Card ID for serve
  --debug                Verbose serve logging

Global options:
  --help, -h             Show this help
`);
    process.exit(0);
  }

  if (command === 'restart' || command === 'screenshot' || command === 'edit' || command === 'logs' || command === 'status') {
    const arg = command === 'screenshot' ? args[1] : undefined;
    await sendCommand(command, arg);
    return;
  }

  if (command === 'serve') {
    const { positional, options } = parseOptions(args.slice(1));
    await serve(positional[0] || '.', options);
    return;
  }

  if (command === 'pull') {
    const { positional } = parseOptions(args.slice(1));
    await login();
    await pull(positional[0], { output: positional[1] });
    return;
  }

  // Default: connect
  const dir = command === 'connect' ? (args[1] || 'workspace') : (args[0] || 'workspace');
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
  console.error('fatal:', err);
  process.exit(1);
});
