import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NODE_BUNDLE_DIR = path.join(CLI_ROOT, 'bundles', 'player', 'node');

let modulePromise: Promise<any> | null = null;
let moduleInstance: any = null;

function ensureBrowserGlobals(): void {
  const g = globalThis as any;
  g.window ??= g;
  g.screen ??= { width: 256, height: 256, availWidth: 256, availHeight: 256 };
  g.navigator ??= { userAgent: 'node', platform: 'node' };
  g.location ??= { href: 'about:blank', origin: 'about:blank' };
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};

  if (!g.document) {
    const stubEl = () => ({
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      setAttribute: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 256, height: 256 }),
    });
    g.document = {
      createElement: stubEl,
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById: stubEl,
      querySelector: stubEl,
      body: stubEl(),
    };
  }
}

function verifyNodeBundle(): void {
  const missing = ['castle-core-node.js', 'castle-core-node.wasm'].filter((file) => {
    return !fs.existsSync(path.join(NODE_BUNDLE_DIR, file));
  });
  if (missing.length > 0) {
    throw new Error(
      `Missing node WASM bundle files in ${NODE_BUNDLE_DIR}:\n` +
        missing.map((file) => `  - ${file}`).join('\n')
    );
  }
}

async function loadModule(): Promise<any> {
  verifyNodeBundle();
  ensureBrowserGlobals();

  const CastleNode = require(path.join(NODE_BUNDLE_DIR, 'castle-core-node.js'));
  const wasmBinary = fs.readFileSync(path.join(NODE_BUNDLE_DIR, 'castle-core-node.wasm'));
  const module = await CastleNode({ wasmBinary });
  module.ccall('castle_node_init', 'number', [], []);
  return module;
}

async function getModule(): Promise<any> {
  if (moduleInstance) return moduleInstance;
  if (!modulePromise) {
    modulePromise = loadModule()
      .then((module) => {
        moduleInstance = module;
        return module;
      })
      .catch((error) => {
        modulePromise = null;
        throw error;
      });
  }
  return modulePromise;
}

export async function getCastleMetadata(): Promise<{ behaviors: Record<string, any>; rules: any }> {
  const module = await getModule();
  const getBehaviorsJson = module.cwrap('castle_node_get_behaviors_json', 'string', []);
  const getRulesJson = module.cwrap('castle_node_get_rules_json', 'string', []);
  return {
    behaviors: JSON.parse(getBehaviorsJson()).behaviors,
    rules: JSON.parse(getRulesJson()),
  };
}

export async function applySnapshot(snapshot: any): Promise<any> {
  const module = await getModule();
  const apply = module.cwrap('castle_node_apply_snapshot', 'string', ['string']);
  return JSON.parse(apply(JSON.stringify(snapshot)));
}

export async function getSnapshotExternalValues(snapshot: any): Promise<any> {
  const module = await getModule();
  const getExternal = module.cwrap('castle_node_get_snapshot_external_values', 'string', ['string']);
  return JSON.parse(getExternal(JSON.stringify(snapshot)));
}

