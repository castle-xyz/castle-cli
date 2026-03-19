import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let M: any = null;
let metadataCache: { behaviors: any; rules: any } | null = null;

async function getModule(): Promise<any> {
  if (M) return M;
  const CastleNode = require(path.join(__dirname, '../assets/core/castle-core-node.cjs'));
  const wasmBinary = readFileSync(
    path.join(__dirname, '../assets/core/castle-core-node.wasm')
  );
  M = await CastleNode({ wasmBinary });
  M.ccall('castle_node_init', 'number', [], []);
  return M;
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
