import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { setCardPreviewImageFromPng } from './utils/preview.js';
import { sendToServe, SERVE_REGISTRY_PATH } from './utils/serveClient.js';

const CONNECT_REGISTRY_PATH = path.join(process.env.HOME || '.', '.castle', 'cli4-connect.json');
const SCREENSHOT_COMMAND_TIMEOUT_MS = 75_000;

function readJson(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

type CommandTarget = 'auto' | 'serve' | 'connect';

function getSocketPaths(target: CommandTarget = 'auto'): string[] {
  const registryPaths = target === 'serve'
    ? [SERVE_REGISTRY_PATH]
    : target === 'connect'
      ? [CONNECT_REGISTRY_PATH]
      : [CONNECT_REGISTRY_PATH, SERVE_REGISTRY_PATH];

  const socketPaths: string[] = [];
  for (const registryPath of registryPaths) {
    const registry = readJson(registryPath);
    if (
      registry?.sockPath &&
      fs.existsSync(registry.sockPath) &&
      !socketPaths.includes(registry.sockPath)
    ) {
      socketPaths.push(registry.sockPath);
    }
  }
  return socketPaths;
}

function isStaleSocketError(error: any): boolean {
  return error?.code === 'ENOENT' || error?.code === 'ECONNREFUSED';
}

function sendToSocket(sockPath: string, request: any, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(sockPath, () => {
      client.write(JSON.stringify(request) + '\n');
    });
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('timed out'));
    }, timeoutMs);

    let data = '';
    client.on('data', (chunk) => {
      data += chunk.toString();
      if (data.includes('\n')) {
        clearTimeout(timeout);
        client.end();
        try {
          resolve(JSON.parse(data.trim()));
        } catch {
          resolve({ error: 'invalid response' });
        }
      }
    });

    client.on('error', (err: any) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function sendToServer(request: any, timeoutMs = 30000, target: CommandTarget = 'auto'): Promise<any> {
  const socketPaths = getSocketPaths(target);
  if (socketPaths.length === 0) {
    throw new Error('CLI server not running. Start serve or connect first.');
  }

  const staleSockets: string[] = [];
  for (const sockPath of socketPaths) {
    try {
      return await sendToSocket(sockPath, request, timeoutMs);
    } catch (error: any) {
      if (!isStaleSocketError(error)) throw error;
      staleSockets.push(sockPath);
    }
  }

  throw new Error(
    'CLI server not running. Start serve or connect first.' +
      (staleSockets.length ? ` Stale socket(s): ${staleSockets.join(', ')}` : '')
  );
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

export async function sendCommand(command: string, arg?: string) {
  if (command === 'restart') {
    const result = await sendToServer({ command: 'restart' });
    if (result.error) {
      console.error('restart failed:', result.error);
    } else {
      console.log('restart sent');
    }
  } else if (command === 'screenshot') {
    const result = await sendToServer({ command: 'screenshot', filename: arg }, SCREENSHOT_COMMAND_TIMEOUT_MS);
    if (result.error) {
      console.error('screenshot failed:', result.error);
    } else {
      console.log(`screenshot saved: ${result.path}`);
    }
  } else if (command === 'save-preview-image') {
    const status = await sendToServe({ command: 'status' }, 5000);
    if (status.error) {
      console.error('preview image failed:', status.error);
      return;
    }
    if (status.mode !== 'serve' || !status.initialCardId) {
      console.error('preview image failed: start local serve for a project deck first');
      return;
    }

    const result = await sendToServe({ command: 'screenshot', filename: arg }, SCREENSHOT_COMMAND_TIMEOUT_MS);
    if (result.error) {
      console.error('preview image failed:', result.error);
      return;
    }

    const file = await setCardPreviewImageFromPng(status.initialCardId, result.path);
    console.log(`screenshot saved: ${result.path}`);
    console.log(`preview image set for card ${status.initialCardId}: ${file.fileId}`);
  } else if (command === 'edit') {
    const input = await readStdin();
    let args: any;
    try {
      args = JSON.parse(input);
    } catch {
      console.error('failed to parse JSON input');
      process.exit(1);
    }
    const result = await sendToServer({ command: 'edit', args });
    if (result.error) {
      console.error('edit failed:', result.error);
    } else {
      const msg = result.summary ? `edit applied: ${result.summary}` : 'edit applied successfully';
      console.log(msg);
      if (result.blueprintIdMapping && Object.keys(result.blueprintIdMapping).length > 0) {
        console.log('blueprint ID mapping:', JSON.stringify(result.blueprintIdMapping, null, 2));
      }
    }
  } else if (command === 'logs') {
    let content = '';
    try {
      const result = await sendToServer({ command: 'logs' }, 5000);
      content = result.logs || '';
    } catch {
      const serveRegistry = readJson(SERVE_REGISTRY_PATH);
      const connectRegistry = readJson(CONNECT_REGISTRY_PATH);
      const logsRoot = serveRegistry?.deckDir || connectRegistry?.deckDir || connectRegistry?.connectRoot;
      if (logsRoot) {
        try { content = fs.readFileSync(path.join(logsRoot, '.castle', 'logs.txt'), 'utf-8'); } catch {}
      }
    }
    const lines = content.split('\n');
    const lastRestart = lines.reduce((idx: number, line: string, i: number) =>
      line.includes('--- restart') || line.includes('--- play') ? i : idx, -1);
    const recent = lastRestart >= 0 ? lines.slice(lastRestart).join('\n').trim() : content.trim();
    if (recent) {
      console.log(recent);
    } else {
      console.log('(no logs)');
    }
  } else if (command === 'status') {
    const result = await sendToServer({ command: 'status' });
    if (result.error) {
      console.error('status failed:', result.error);
    } else if (result.mode === 'serve') {
      console.log(`connected: ${result.connected}`);
      console.log('mode: serve');
      console.log(`deck: ${result.deckId || '(local)'}`);
      if (result.initialCardId) console.log(`initial card: ${result.initialCardId}`);
      console.log(`cards: ${result.cards}`);
      console.log(`directory: ${result.directory || result.deckDir}`);
      if (result.url) console.log(`url: ${result.url}`);
      if (result.port) console.log(`port: ${result.port}`);
      if (typeof result.readyPreviewClients === 'number') console.log(`ready previews: ${result.readyPreviewClients}/${result.previewClients || 0}`);
    } else {
      console.log(`connected: ${result.connected}`);
      if (result.deckId) console.log(`deck: ${result.deckId}`);
      if (result.cardId) console.log(`card: ${result.cardId}`);
      console.log(`blueprints: ${result.blueprints}`);
      console.log(`scripts: ${result.scripts}`);
      console.log(`deck directory: ${result.deckDir || '(not selected)'}`);
      console.log(`card directory: ${result.cardDir || '(not selected)'}`);
      if (result.slugMap && Object.keys(result.slugMap).length > 0) {
        console.log('blueprint mapping:');
        for (const [slug, id] of Object.entries(result.slugMap)) {
          const hasScript = result.cardDir
            ? fs.existsSync(path.join(result.cardDir, 'scripts', `${slug}.lua`))
            : false;
          console.log(`  ${slug}${hasScript ? ' (script)' : ''} → ${id}`);
        }
      }
    }
  }
}
