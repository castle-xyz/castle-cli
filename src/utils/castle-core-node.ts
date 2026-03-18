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

// Applies changesComponents to baseComponents through the C++ engine's handleSetProperty,
// triggering all side effects (e.g. relativeToCamera → layerName in Body).
// Returns the full component state for all behaviors after changes are applied.
export async function applyComponentChanges(
  baseComponents: Record<string, any>,
  changesComponents: Record<string, any>
): Promise<Record<string, any>> {
  const m = await getModule();
  const applyFn = m.cwrap('castle_node_apply_component_changes', 'string', ['string', 'string']);
  const result = applyFn(JSON.stringify(baseComponents), JSON.stringify(changesComponents));
  return JSON.parse(result);
}
