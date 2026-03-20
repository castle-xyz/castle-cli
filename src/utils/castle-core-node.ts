import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { fetchPlayerId, getCacheDir, readCacheBinary, writeCacheBinary } from './cache.js';

const require = createRequire(import.meta.url);
const CASTLE_CDN = 'https://cdn.castle.xyz';

let M: any = null;
let modulePromise: Promise<any> | null = null;
let metadataCache: { behaviors: any; rules: any } | null = null;

async function ensureCachedNodeFiles(playerId: string): Promise<void> {
  const cdnBase = `${CASTLE_CDN}/player/${playerId}/node`;
  for (const filename of ['castle-core-node.js', 'castle-core-node.wasm']) {
    const relPath = `node/${playerId}/${filename}`;
    if (readCacheBinary(relPath) === null) {
      const res = await fetch(`${cdnBase}/${filename}`);
      if (!res.ok) throw new Error(`Failed to fetch ${filename}: ${res.status}`);
      writeCacheBinary(relPath, Buffer.from(await res.arrayBuffer()));
    }
  }
}

async function getModule(): Promise<any> {
  if (M) return M;
  if (!modulePromise) {
    modulePromise = (async () => {
      let nodeDir: string;
      const localNode = process.env.CASTLE_LOCAL_NODE;
      if (localNode) {
        nodeDir = localNode === '1' ? path.resolve(process.cwd(), 'node-dev') : localNode;
        console.log(`[castle-core] using local node WASM from ${nodeDir}`);
      } else {
        const playerId = await fetchPlayerId(false);
        if (!playerId) throw new Error('Cannot load castle-core: no player ID (no network and no cache)');
        await ensureCachedNodeFiles(playerId);
        nodeDir = path.join(getCacheDir(), 'node', playerId);
      }
      const CastleNode = require(path.join(nodeDir, 'castle-core-node.js'));
      const wasmBinary = fs.readFileSync(path.join(nodeDir, 'castle-core-node.wasm'));
      M = await CastleNode({ wasmBinary });
      M.ccall('castle_node_init', 'number', [], []);
      return M;
    })().catch(e => {
      modulePromise = null; // allow retry on next call
      throw e;
    });
  }
  return modulePromise;
}

export async function getCastleMetadata(): Promise<{ behaviors: any; rules: any }> {
  if (metadataCache) return metadataCache;
  const m = await getModule();
  const getBehaviorsJson = m.cwrap('castle_node_get_behaviors_json', 'string', []);
  const getRulesJson = m.cwrap('castle_node_get_rules_json', 'string', []);
  const behaviors = JSON.parse(getBehaviorsJson()).behaviors;
  const rules = JSON.parse(getRulesJson());
  metadataCache = { behaviors, rules };
  return metadataCache;
}

// Processes a full snapshot (library + actors) through handleSetProperty,
// converting external-format values to internal format.
// Input snapshot: library entries with actorBlueprint.components and actors with bp.components,
// all in external format (e.g. Body.widthScale=5.0). Internal names (Body, Drawing2) expected.
// Output: same structure with values converted (e.g. Body.widthScale=0.5).
export async function applySnapshot(snapshot: any): Promise<any> {
  const m = await getModule();
  const fn = m.cwrap('castle_node_apply_snapshot', 'string', ['string']);
  return JSON.parse(fn(JSON.stringify(snapshot)));
}

// Processes a full snapshot (library + actors) through handleGetProperty,
// converting internal-format values to external format.
// Input snapshot: library entries with actorBlueprint.components and actors with bp.components,
// all in internal format (e.g. Body.widthScale=0.5). Internal names (Body, Drawing2) expected.
// Output: same structure with values converted (e.g. Body.widthScale=5.0).
export async function getSnapshotExternalValues(snapshot: any): Promise<any> {
  const m = await getModule();
  const fn = m.cwrap('castle_node_get_snapshot_external_values', 'string', ['string']);
  return JSON.parse(fn(JSON.stringify(snapshot)));
}
