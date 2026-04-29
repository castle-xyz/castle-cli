import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { setCardPreviewImageFromPng } from './utils/preview.js';

const SERVE_REGISTRY_PATH = path.join(process.env.HOME || '.', '.castle', 'cli4-serve.json');
const CONNECT_REGISTRY_PATH = path.join(process.env.HOME || '.', '.castle', 'cli4-connect.json');

function readJson(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

type CommandTarget = 'auto' | 'serve' | 'connect';

function getSocketPath(target: CommandTarget = 'auto'): string | null {
  const registryPaths = target === 'serve'
    ? [SERVE_REGISTRY_PATH]
    : target === 'connect'
      ? [CONNECT_REGISTRY_PATH]
      : [CONNECT_REGISTRY_PATH, SERVE_REGISTRY_PATH];

  for (const registryPath of registryPaths) {
    const registry = readJson(registryPath);
    if (registry?.sockPath && fs.existsSync(registry.sockPath)) return registry.sockPath;
  }
  return null;
}

function sendToServer(request: any, timeoutMs = 30000, target: CommandTarget = 'auto'): Promise<any> {
  return new Promise((resolve, reject) => {
    const sockPath = getSocketPath(target);
    if (!sockPath) {
      reject(new Error('CLI server not running. Start serve or connect first.'));
      return;
    }

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('timed out'));
    }, timeoutMs);

    const client = net.createConnection(sockPath, () => {
      client.write(JSON.stringify(request) + '\n');
    });

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
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        reject(new Error('CLI server not running. Start serve or connect first.'));
      } else {
        reject(err);
      }
    });
  });
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
    const result = await sendToServer({ command: 'screenshot', filename: arg }, 35000);
    if (result.error) {
      console.error('screenshot failed:', result.error);
    } else {
      console.log(`screenshot saved: ${result.path}`);
    }
  } else if (command === 'save-preview-image') {
    const status = await sendToServer({ command: 'status' }, 5000, 'serve');
    if (status.error) {
      console.error('preview image failed:', status.error);
      return;
    }
    if (status.mode !== 'serve' || !status.initialCardId) {
      console.error('preview image failed: start local serve for a project deck first');
      return;
    }

    const result = await sendToServer({ command: 'screenshot', filename: arg }, 35000, 'serve');
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
