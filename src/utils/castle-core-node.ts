import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { fetchPlayerId, getCacheDir, readCacheBinary, writeCacheBinary } from './cache.js';

const require = createRequire(import.meta.url);
const CASTLE_CDN = 'https://cdn.castle.xyz';

let M: any = null;
let modulePromise: Promise<any> | null = null;
let metadataCache: { behaviors: any; rules: any } | null = null;

// Separate module instance used only for renderDrawDataPng.
// Kept isolated from M so that GL canvas operations (which can corrupt WASM memory
// in the headless node environment) never affect applySnapshot or getCastleMetadata.
let R: any = null;
let renderModulePromise: Promise<any> | null = null;

// Resolved once and shared between both module loaders.
let nodeDirPromise: Promise<string> | null = null;

async function resolveNodeDir(): Promise<string> {
  if (!nodeDirPromise) {
    nodeDirPromise = (async () => {
      const localNode = process.env.CASTLE_LOCAL_NODE;
      if (localNode) {
        const dir = localNode === '1' ? path.resolve(process.cwd(), 'node-dev') : localNode;
        console.log(`[castle-core] using local node WASM from ${dir}`);
        return dir;
      }
      const playerId = await fetchPlayerId(false);
      if (!playerId) throw new Error('Cannot load castle-core: no player ID (no network and no cache)');
      await ensureCachedNodeFiles(playerId);
      return path.join(getCacheDir(), 'node', playerId);
    })().catch(e => {
      nodeDirPromise = null;
      throw e;
    });
  }
  return nodeDirPromise;
}

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

// Stub browser globals that SDL's Emscripten bindings reference.
// Called before loading any module instance because the rebuilt WASM now
// initialises love::window::sdl::Window during castle_node_init, which
// causes SDL to inspect `screen`, `document`, etc. even without GL.
function ensureBrowserGlobals(): void {
  const g = global as any;
  if (!g.screen) {
    g.screen = { width: 256, height: 256, availWidth: 256, availHeight: 256 };
  }
  if (!g.addEventListener) {
    g.addEventListener = () => {};
    g.removeEventListener = () => {};
  }
  if (!g.window) {
    g.window = g;
  }
  if (!g.navigator) {
    g.navigator = { userAgent: 'node', platform: 'node' };
  }
  if (!g.location) {
    g.location = { href: 'about:blank', origin: 'about:blank' };
  }
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

async function loadModule(nodeDir: string): Promise<any> {
  ensureBrowserGlobals();
  const CastleNode = require(path.join(nodeDir, 'castle-core-node.js'));
  const wasmBinary = fs.readFileSync(path.join(nodeDir, 'castle-core-node.wasm'));
  const m = await CastleNode({ wasmBinary });
  m.ccall('castle_node_init', 'number', [], []);
  return m;
}

async function loadRenderModule(nodeDir: string): Promise<any> {
  ensureBrowserGlobals();
  const CastleNode = require(path.join(nodeDir, 'castle-core-node.js'));
  const wasmBinary = fs.readFileSync(path.join(nodeDir, 'castle-core-node.wasm'));

  // Create a headless WebGL context via the `gl` npm package so that
  // Love2D's graphics module can render in the Node.js environment.
  let glCtx: any = null;
  let canvas: any = null;
  try {
    const createGl = require('gl');
    glCtx = createGl(256, 256, { preserveDrawingBuffer: true });
    if (glCtx) {
      // Expose the constructor as the global WebGLRenderingContext so that
      // Emscripten's instanceof check inside GL.createContext passes.
      (global as any).WebGLRenderingContext = glCtx.constructor;

      // Build a minimal canvas object. Setting getContextSafariWebGL2Fixed
      // bypasses the Emscripten Safari WebGL2 wrapper that would otherwise
      // replace getContext with a version that fails the instanceof check.
      const getCtx = (_type: string, _attrs?: any) => glCtx;
      canvas = {
        width: 256,
        height: 256,
        getContext: getCtx,
        getContextSafariWebGL2Fixed: getCtx,
        addEventListener: () => {},
        removeEventListener: () => {},
        style: {},
      };
    }
  } catch (_e) {
    // `gl` not available — rendering will return an error from C++
  }

  const m = await CastleNode({ wasmBinary, canvas });
  m.ccall('castle_node_init', 'number', [], []);

  if (canvas) {
    const ok = m.ccall('castle_node_init_rendering', 'number', [], []);
    if (!ok) {
      console.warn('[castle-core] castle_node_init_rendering returned 0 — GL may not be available');
    }
  }

  return m;
}

async function getModule(): Promise<any> {
  if (M) return M;
  if (!modulePromise) {
    modulePromise = (async () => {
      const nodeDir = await resolveNodeDir();
      M = await loadModule(nodeDir);
      return M;
    })().catch(e => {
      modulePromise = null;
      throw e;
    });
  }
  return modulePromise;
}

// Returns the isolated render module, creating it on first call.
// If the render module becomes corrupted (catch in renderDrawDataPng resets R),
// it will be recreated on the next call.
async function getRenderModule(): Promise<any> {
  if (R) return R;
  if (!renderModulePromise) {
    renderModulePromise = (async () => {
      const nodeDir = await resolveNodeDir();
      R = await loadRenderModule(nodeDir);
      return R;
    })().catch(e => {
      renderModulePromise = null;
      throw e;
    });
  }
  return renderModulePromise;
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

// Renders Drawing2 component data to a base64-encoded PNG.
// drawing2: the Drawing2 object from a .draw.json file (must contain drawData field).
// frameIdx: zero-based frame index (default 0). size: output pixel dimension (default 256).
// Returns the base64 PNG string, or throws on error.
//
// Uses an isolated WASM module instance (R) separate from the main module (M) so that
// GL canvas operations in renderPreviewPng cannot corrupt the memory used by applySnapshot.
export async function renderDrawDataPng(
  drawing2: any,
  frameIdx: number = 0,
  size: number = 256
): Promise<string> {
  const m = await getRenderModule();
  const fn = m.cwrap('castle_node_render_draw_data_png', 'string', ['string']);
  let resultStr: string;
  try {
    resultStr = fn(JSON.stringify({ drawing2, frameIdx, size }));
  } catch (e: any) {
    // WASM module may be corrupted — reset so next call gets a fresh instance
    R = null;
    renderModulePromise = null;
    throw new Error(`renderDrawDataPng: ${e?.message ?? e}`);
  }
  const result = JSON.parse(resultStr);
  if (result.error) throw new Error(`renderDrawDataPng: ${result.error}`);
  return result.base64Png as string;
}
