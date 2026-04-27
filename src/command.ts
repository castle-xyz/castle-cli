import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';

const SOCK_PATH = path.join('workspace', '.castle', 'cli.sock');
const SERVE_REGISTRY_PATH = path.join(process.env.HOME || '.', '.castle', 'cli4-serve.json');

function getSocketPath(): string {
  try {
    const registry = JSON.parse(fs.readFileSync(SERVE_REGISTRY_PATH, 'utf8'));
    if (registry.sockPath && fs.existsSync(registry.sockPath)) return registry.sockPath;
  } catch {}
  if (fs.existsSync(SOCK_PATH)) return SOCK_PATH;
  return SOCK_PATH;
}

function sendToServer(request: any, timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('timed out'));
    }, timeoutMs);

    const client = net.createConnection(getSocketPath(), () => {
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
      const logsPath = path.join('workspace', '.castle', 'logs.txt');
      try { content = fs.readFileSync(logsPath, 'utf-8'); } catch {}
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
      console.log(`cards: ${result.cards}`);
      console.log(`workspace: ${result.workspace}`);
    } else {
      console.log(`connected: ${result.connected}`);
      console.log(`blueprints: ${result.blueprints}`);
      console.log(`scripts: ${result.scripts}`);
      console.log(`workspace: ${result.workspace}`);
      if (result.slugMap && Object.keys(result.slugMap).length > 0) {
        console.log('blueprint mapping:');
        for (const [slug, id] of Object.entries(result.slugMap)) {
          const hasScript = fs.existsSync(path.join('workspace', 'scripts', `${slug}.lua`));
          console.log(`  ${slug}${hasScript ? ' (script)' : ''} → ${id}`);
        }
      }
    }
  }
}
