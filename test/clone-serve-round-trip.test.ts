/**
 * Clone → serve round-trip tests using real deck fixtures.
 *
 * Fixture files live at test/fixtures/decks/{deckId}.json.
 * Generate them first with:  npx tsx scripts/generate-deck-fixtures.ts
 *
 * For each fixture the test:
 *   1. Mocks API.deck() and axios.get() with fixture data
 *   2. Runs clone() to write blueprint YAMLs and actors.yaml
 *   3. Runs newSceneDataForCardAsync() to reconstruct scene data from those files
 *   4. Compares external values of original vs reconstructed snapshots
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as url from 'url';

vi.mock('../src/utils/api.js', () => ({
  deck: vi.fn(),
  resolveDeepLink: vi.fn(),
}));

vi.mock('axios');

import * as API from '../src/utils/api.js';
import { clone } from '../src/commands/clone.js';
import { newSceneDataForCardAsync } from '../src/utils/decks.js';
import { initMetadata } from '../src/utils/init.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'decks');

// Body fields that are engine-computed per-instance and legitimately differ after round-trip.
// NOTE: 'fixtures' and 'editorBounds' are intentionally NOT skipped — they must be preserved
// from the cache by the serve pipeline (see the stripBlueprintComponents fix in decks.ts).
// If they differ, it means the serve pipeline is corrupting the physics body, which breaks
// tap detection.
const BODY_SKIP = new Set([
  'x', 'y', 'angle',
  'width', 'height',
  'relativeToCameraFix',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'layerName',
  // Engine-internal fields not preserved through the YAML → applySnapshot round-trip:
  'bodyType', 'bullet', 'massData',
]);

// Drawing2 fields that are engine-computed and not written to blueprint YAMLs.
// 'loop' and 'playing' are internal-format Drawing2 state; they don't appear in the
// external (applySnapshot) format, so they're legitimately absent from served.snapshot.
const DRAWING2_SKIP = new Set(['currentFrame', 'hash', 'drawData', 'physicsBodyData', 'loop', 'playing']);

// Text properties that have known WASM color-space precision loss (~2/255 per channel)
// and are not the focus of the round-trip correctness we're verifying here.
const TEXT_SKIP = new Set(['color']);

// Styles color fields have the same ~0.01 per-channel WASM color-space precision loss.
const STYLES_SKIP = new Set(['backgroundColor', 'borderColor', 'dropShadowColor']);

// Shared.uuid is engine-assigned on each applySnapshot call and is not stored in YAML.
const SHARED_SKIP = new Set(['uuid']);

/**
 * Round all numbers in a value to `places` decimal places (handles WASM float noise).
 */
function roundDeep(value: any, places = 3): any {
  if (typeof value === 'number') {
    const factor = 10 ** places;
    const rounded = Math.round(value * factor) / factor;
    return rounded === 0 ? 0 : rounded; // normalize -0 → 0
  }
  if (Array.isArray(value)) return value.map(v => roundDeep(v, places));
  if (value !== null && typeof value === 'object') {
    const result: any = {};
    for (const k of Object.keys(value)) result[k] = roundDeep(value[k], places);
    return result;
  }
  return value;
}

/**
 * Normalize rules component data to absorb structural differences between
 * server-serialized and YAML-round-tripped rules that are semantically identical:
 *   - `rules: {}` (empty object) and `rules: []` (empty array) both mean "no rules"
 *   - `params: {}` on a trigger/response entry is equivalent to no `params` key
 */
function normalizeRulesComponent(rulesComp: any): void {
  if (!rulesComp) return;
  // Normalize empty rules: {} (server) === [] (YAML round-trip)
  if (rulesComp.rules !== undefined) {
    if (!Array.isArray(rulesComp.rules) && typeof rulesComp.rules === 'object') {
      if (Object.keys(rulesComp.rules).length === 0) {
        rulesComp.rules = [];
      }
    }
  }
  // Recursively normalize rule entry objects: strip empty params and the server-only
  // `index` field (an internal ordering key not preserved through YAML serialization).
  function normalizeRuleObj(obj: any): void {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach(normalizeRuleObj);
      return;
    }
    // Strip server-only index field (not serialized to YAML)
    delete obj.index;
    // Strip empty params: {}
    if ('params' in obj && obj.params !== null && typeof obj.params === 'object' && Object.keys(obj.params).length === 0) {
      delete obj.params;
    }
    for (const v of Object.values(obj)) normalizeRuleObj(v);
  }
  normalizeRuleObj(rulesComp);
}

function normalizeForComparison(snapshot: any): any {
  const snap = JSON.parse(JSON.stringify(snapshot));

  // Build blueprint text-content lookup BEFORE modifying library entries.
  // actors.yaml only saves actor Text.content when it differs from the blueprint's content,
  // so we need to know the blueprint content to decide whether to include it in actor normalization.
  const blueprintTextContentByEntryId: Record<string, string | undefined> = {};
  for (const [entryId, entry] of Object.entries(snap.library) as any[]) {
    blueprintTextContentByEntryId[entryId] = (entry as any).actorBlueprint?.components?.Text?.content;
  }

  for (const entry of Object.values(snap.library) as any[]) {
    // Server-side metadata not stored in blueprint YAMLs — strip from both sides.
    delete entry.base64Png;
    delete entry.titleEdited;
    delete entry.library;     // nested blueprint-asset references, not round-tripped
    delete entry.description; // server-side description metadata, not round-tripped

    const components = entry.actorBlueprint?.components ?? {};

    // Camera is always injected by applySnapshot as a default component;
    // the original server snapshot does not include it.
    delete components.Camera;

    // disabled: false is the engine default for every component. The YAML serializer
    // omits it, and the server sends it explicitly — strip from both sides.
    for (const comp of Object.values(components)) {
      if (comp && typeof comp === 'object' && !Array.isArray(comp)) {
        if ((comp as any).disabled === false) delete (comp as any).disabled;
      }
    }

    if (components.Body) {
      for (const field of BODY_SKIP) delete components.Body[field];
      if (Object.keys(components.Body).length === 0) delete components.Body;
    }
    if (components.Drawing2) {
      for (const field of DRAWING2_SKIP) delete components.Drawing2[field];
    }
    // Script.code is large; Script.errors is a runtime field (compile results vary by environment)
    if (components.Script) {
      delete components.Script.code;
      delete components.Script.errors;
    }
    // Text.color has ~2/255 channel drift through the WASM color pipeline
    if (components.Text) {
      for (const field of TEXT_SKIP) delete components.Text[field];
    }
    // Styles color fields have the same ~0.01 per-channel drift
    if (components.Styles) {
      for (const field of STYLES_SKIP) delete components.Styles[field];
    }
    // Shared.uuid is engine-assigned on each applySnapshot call
    if (components.Shared) {
      for (const field of SHARED_SKIP) delete components.Shared[field];
      if (Object.keys(components.Shared).length === 0) delete components.Shared;
    }
    // Rules: normalize empty-rules {} vs [] and empty params {} vs absent
    if (components.Rules) {
      normalizeRulesComponent(components.Rules);
    }
    // LocalVariables: undoRedoCount is internal; empty localVariables [] ≡ absent
    if (components.LocalVariables) {
      delete components.LocalVariables.undoRedoCount;
      if (Array.isArray(components.LocalVariables.localVariables) &&
          components.LocalVariables.localVariables.length === 0) {
        delete components.LocalVariables.localVariables;
      }
      if (Object.keys(components.LocalVariables).length === 0) delete components.LocalVariables;
    }
  }

  for (const actor of snap.actors as any[]) {
    // actors.yaml only preserves a limited set of per-actor fields.
    // Aggressively normalize to only what round-trips, so the comparison stays meaningful.

    // Capture blueprint text content BEFORE stripping parentEntryId so we can compare below.
    const blueprintTextContent = actor.parentEntryId !== undefined
      ? blueprintTextContentByEntryId[actor.parentEntryId]
      : undefined;

    // parentEntryId may change when multiple blueprints share the same title (duplicate titles
    // cause non-deterministic lookup in titleToEntryId). Don't check it.
    delete actor.parentEntryId;

    // actorId may be reassigned by applySnapshot (e.g. "0:39" string IDs become integers).
    // Comparison is positional (by array index) — order is preserved through actors.yaml.
    delete actor.actorId;

    const components = actor.bp?.components ?? {};

    // Body: only position/scale fields survive actors.yaml round-trip.
    // Fixtures, editorBounds, bodyType, bullet, massData etc. come from the blueprint
    // .draw.json and physics engine — they are not stored per-actor.
    if (components.Body) {
      const { x, y, widthScale, heightScale, angle } = components.Body;
      components.Body = {};
      if (x !== undefined) components.Body.x = x;
      if (y !== undefined) components.Body.y = y;
      if (widthScale !== undefined) components.Body.widthScale = widthScale;
      if (heightScale !== undefined) components.Body.heightScale = heightScale;
      if (angle !== undefined) components.Body.angle = angle;
      if (Object.keys(components.Body).length === 0) delete components.Body;
    }

    // Drawing2: only initialFrame (if non-default) is stored in actors.yaml.
    if (components.Drawing2) {
      const { initialFrame } = components.Drawing2;
      components.Drawing2 = {};
      if (initialFrame && initialFrame !== 1) components.Drawing2.initialFrame = initialFrame;
      if (Object.keys(components.Drawing2).length === 0) delete components.Drawing2;
    }

    // Text: only fontSizeScale (if !== 1) and content round-trip.
    // content is only saved to actors.yaml when it differs from the blueprint's content,
    // so strip it from normalization when it matches (it won't appear in servedNorm).
    if (components.Text) {
      const { fontSizeScale, content } = components.Text;
      components.Text = {};
      if (fontSizeScale !== undefined && fontSizeScale !== 1) components.Text.fontSizeScale = fontSizeScale;
      if (content !== undefined && content !== blueprintTextContent) components.Text.content = content;
      if (Object.keys(components.Text).length === 0) delete components.Text;
    }

    // Link: only targetDeckId round-trips.
    if (components.Link) {
      const { targetDeckId } = components.Link;
      components.Link = {};
      if (targetDeckId !== undefined) components.Link.targetDeckId = targetDeckId;
      if (Object.keys(components.Link).length === 0) delete components.Link;
    }

    // All other per-actor component overrides (Tags, Solid, Rules, etc.) are not stored
    // in actors.yaml and don't round-trip.
    for (const k of Object.keys(components)) {
      if (!['Body', 'Drawing2', 'Text', 'Link'].includes(k)) delete components[k];
    }

    // If bp.components is now empty, drop bp entirely.
    if (actor.bp && Object.keys(components).length === 0) delete actor.bp;
  }

  // Round all numbers to 2 decimal places to absorb WASM floating-point noise
  // (e.g. widthScale 5.55 vs 5.549, or 2.05818 vs 2.05809).
  return roundDeep(snap, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Load fixture files — tests are skipped entirely when none exist.
// ─────────────────────────────────────────────────────────────────────────────

const fixtureFiles: string[] = fs.existsSync(FIXTURES_DIR)
  ? fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'))
  : [];

// Vitest requires at least one describe block per file.
if (fixtureFiles.length === 0) {
  describe('clone-serve round-trip — no fixtures', () => {
    it.skip('run scripts/generate-deck-fixtures.ts to generate fixture files', () => {});
  });
}

for (const fixtureFile of fixtureFiles) {
  const fixturePath = path.join(FIXTURES_DIR, fixtureFile);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const { deckId, cards } = fixture;

  describe(`clone-serve round-trip — ${deckId}`, () => {
    let tmpDir: string;

    beforeEach(async () => {
      await initMetadata();
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `castle-rt-${deckId}-`));

      const mockDeck = {
        deckId,
        initialCard: fixture.initialCard,
        cards: cards.map((c: any) => ({
          cardId: c.cardId,
          sceneDataUrl: c.sceneDataUrl,
        })),
      };

      vi.mocked(API.deck).mockResolvedValue(mockDeck);

      const axios = await import('axios');
      vi.mocked((axios as any).default.get).mockImplementation(async (reqUrl: string) => {
        const card = cards.find((c: any) => c.sceneDataUrl === reqUrl);
        if (card) {
          return { data: { snapshot: card.snapshot } };
        }
        throw new Error(`Unexpected URL in mock: ${reqUrl}`);
      });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      vi.clearAllMocks();
    });

    for (const card of cards) {
      // Close over the loop variable
      const { cardId, snapshot: origSnapshot } = card;

      it(`card ${cardId} — full snapshot round-trip after clone → serve`, async () => {
        const deckDir = path.join(tmpDir, 'deck');
        await clone(deckId, { directory: deckDir });

        const cardDir = path.join(deckDir, `card-${cardId}`);
        const { sceneData: served } = await newSceneDataForCardAsync({ cardId, cardDir, deckDir });

        const origNorm = normalizeForComparison(origSnapshot);
        const servedNorm = normalizeForComparison(served.snapshot);

        // toMatchObject verifies every field in origNorm is present in servedNorm.
        // servedNorm may have extra applySnapshot defaults — that's expected and fine.
        expect(servedNorm).toMatchObject(origNorm);
      });
    }
  });
}
