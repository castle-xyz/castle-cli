import * as path from 'path';
import open from 'open';
import { CLIServer } from './server.js';
import { getToken, setToken } from './config.js';
import * as API from './api.js';
import { sendCommand } from './command.js';

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
  connect [dir]          Connect to Castle app and sync scripts (default)
  restart                Stop and restart the scene
  screenshot [filename]  Take a screenshot
  edit                   Apply scene edits (reads JSON from stdin)

Options:
  --help, -h             Show this help
`);
    process.exit(0);
  }

  if (command === 'restart' || command === 'screenshot' || command === 'edit') {
    const arg = command === 'screenshot' ? args[1] : undefined;
    await sendCommand(command, arg);
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
