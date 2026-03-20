import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CASTLE_WWW = 'https://castle.xyz';

export function getCacheDir(): string {
  return path.join(os.homedir(), '.castle', 'cache');
}

export function readCache(relPath: string): string | null {
  try {
    return fs.readFileSync(path.join(getCacheDir(), relPath), 'utf-8');
  } catch {
    return null;
  }
}

export function writeCache(relPath: string, data: string): void {
  const full = path.join(getCacheDir(), relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data, 'utf-8');
}

export function readCacheBinary(relPath: string): Buffer | null {
  try {
    return fs.readFileSync(path.join(getCacheDir(), relPath));
  } catch {
    return null;
  }
}

export function writeCacheBinary(relPath: string, data: Buffer): void {
  const full = path.join(getCacheDir(), relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
}

// Fetch the current player ID from castle.xyz, with local cache fallback.
// Returns null if unavailable (CDN redirect won't work but local build still will).
export async function fetchPlayerId(debug: boolean): Promise<string | null> {
  try {
    const res = await fetch(`${CASTLE_WWW}/api/player-id`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const json = await res.json() as any;
      if (json.playerId) {
        writeCache('player-id', json.playerId);
        if (debug) console.log(`[serve] Player ID: ${json.playerId}`);
        return json.playerId;
      }
    }
  } catch {
    // fall through to cache
  }
  const cached = readCache('player-id');
  if (cached) {
    if (debug) console.log(`[serve] Player ID: ${cached.trim()} (from cache)`);
    return cached.trim();
  }
  if (debug) console.log('[serve] Player ID unavailable — CDN fallback will not work (local build still works)');
  return null;
}
