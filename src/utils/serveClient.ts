import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { getConfigDir } from '../config.js';
import { socketEndpointFromRegistry, socketExists, type SocketEndpoint, withSocketCwd } from './socket.js';

export const SERVE_REGISTRY_PATH = path.join(getConfigDir(), 'cli4-serve.json');

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

export function getServeSocketEndpoint(): SocketEndpoint | null {
  const registry = readServeRegistry();
  const endpoint = socketEndpointFromRegistry(registry);
  if (endpoint && socketExists(endpoint)) return endpoint;
  return null;
}

export function sendToServe(request: any, timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = getServeSocketEndpoint();
    if (!socket) {
      reject(new Error('local serve is not running'));
      return;
    }

    let client: net.Socket;
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('timed out'));
    }, timeoutMs);

    client = withSocketCwd(socket, () => net.createConnection(socket.path, () => {
      client.write(JSON.stringify(request) + '\n');
    }));

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
