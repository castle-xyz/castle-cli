import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

export const SERVE_REGISTRY_PATH = path.join(os.homedir(), '.castle', 'cli4-serve.json');

function readJson(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function readServeRegistry(): any | null {
  return readJson(SERVE_REGISTRY_PATH);
}

export function getServeSocketPath(): string | null {
  const registry = readServeRegistry();
  if (registry?.sockPath && fs.existsSync(registry.sockPath)) return registry.sockPath;
  return null;
}

export function sendToServe(request: any, timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    const sockPath = getServeSocketPath();
    if (!sockPath) {
      reject(new Error('local serve is not running'));
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
      if (!data.includes('\n')) return;

      clearTimeout(timeout);
      client.end();
      try {
        resolve(JSON.parse(data.trim()));
      } catch {
        resolve({ error: 'invalid response' });
      }
    });

    client.on('error', (err: any) => {
      clearTimeout(timeout);
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        reject(new Error('local serve is not running'));
      } else {
        reject(err);
      }
    });
  });
}
