import { Command } from 'commander';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import updateNotifier from 'update-notifier';

import { clone } from './commands/clone.js';
import { pull } from './commands/pull.js';
import { push } from './commands/push.js';
import { serve } from './commands/serve.js';
import { login } from './commands/login.js';
import { logout } from './commands/logout.js';
import { whoami } from './commands/whoami.js';
import { drawPreview } from './commands/draw-preview.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let packageVersion = '1.0.0';
try {
  const pkg = require(path.join(__dirname, '../package.json'));
  packageVersion = pkg.version;
} catch (e) {}

updateNotifier({ pkg: { name: 'castle-cli', version: packageVersion } }).notify();

const program = new Command();

program
  .name('castle')
  .description('Castle CLI — combined web + mobile')
  .version(packageVersion);

program
  .command('clone <deckId>')
  .description('Clone a deck from the server')
  .option('-d, --directory <directory>', 'Directory to clone into')
  .option('--replace', 'Replace the directory if it already exists')
  .option('--draw-previews', 'Enable draw preview PNG generation (stored in deck.yaml)')
  .action(async (deckId, options) => {
    await clone(deckId, options);
  });

program
  .command('pull')
  .description('Pull latest changes from server')
  .option('-d, --directory <directory>', 'Directory to pull', '.')
  .action(async (options) => {
    await pull(options);
  });

program
  .command('push')
  .description('Push local changes to server')
  .option('-d, --directory <directory>', 'Directory to push', '.')
  .action(async (options) => {
    await push(options);
  });

program
  .command('serve [directory]')
  .description('Serve deck locally (web + mobile)')
  .option('-p, --port <port>', 'Web player port')
  .option('-c, --card <cardId>', 'Initial card to serve')
  .option('--open', 'Automatically open browser')
  .option('--debug', 'Show verbose connection and file-change logs')
  .option('--draw-previews', 'Enable draw preview PNG generation (stored in deck.yaml)')
  .option('--cli-primary', 'Use local files as source of truth when mobile state conflicts (no prompt)')
  .option('--mobile-primary', 'Use mobile state as source of truth when local files conflict (no prompt)')
  .action(async (directory, options) => {
    await serve(directory || '.', options);
  });

program
  .command('login')
  .description('Log in to your Castle account')
  .action(async () => {
    await login();
  });

program
  .command('logout')
  .description('Log out from your Castle account')
  .action(async () => {
    await logout();
  });

program
  .command('whoami')
  .description('Display the current logged in user')
  .action(async () => {
    await whoami();
  });

program
  .command('version')
  .description('Show the current CLI version')
  .action(() => {
    console.log(packageVersion);
  });

program
  .command('draw-preview <draw-json>')
  .description('Render a blueprint drawing to a PNG preview')
  .option('-o, --output <path>', 'Output PNG path (default: replaces .draw.json with .preview.png)')
  .option('-f, --frame <n>', 'Zero-based frame index (default: 0)')
  .option('-s, --size <n>', 'Output image size in pixels (default: 256)')
  .action(async (drawJson, options) => {
    await drawPreview(drawJson, options);
  });

program.parse();
