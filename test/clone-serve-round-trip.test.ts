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
 * Recursive subset check: all fields in `expected` must be present and equal in `actual`.
 * `actual` may contain additional keys (applySnapshot defaults) that won't cause failures.
 * Arrays must have the same length and each element is subset-checked recursively.
 */
function expectSubset(actual: any, expected: any, path: string): void {
  if (expected === null || typeof expected !== 'object') {
    expect(actual, path).toEqual(expected);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), `${path} should be array`).toBe(true);
    expect((actual as any[])?.length, `${path}.length`).toEqual(expected.length);
    expected.forEach((item, i) => expectSubset((actual as any[])?.[i], item, `${path}[${i}]`));
    return;
  }
  for (const [key, val] of Object.entries(expected)) {
    expectSubset((actual ?? {})[key], val, `${path}.${key}`);
  }
}

/**
 * Round all numbers in a value to `places` decimal places (handles WASM float noise).
 */
function roundDeep(value: any, places = 3): any {
  if (typeof value === 'number') {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
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
 * Strip legitimately-differing computed fields from an external snapshot so
 * that deep-equal comparisons only cover user-editable properties.
 */
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

  for (const entry of Object.values(snap.library) as any[]) {
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
    // Script.code is large; we only check the file reference exists, not the content
    if (components.Script) {
      delete components.Script.code;
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
  }

  for (const actor of snap.actors as any[]) {
    const components = actor.bp?.components ?? {};
    if (components.Drawing2) {
      for (const field of DRAWING2_SKIP) delete components.Drawing2[field];
    }
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

      it(`card ${cardId} — all blueprint component properties preserved after clone → serve`, async () => {
        const deckDir = path.join(tmpDir, 'deck');
        await clone(deckId, { directory: deckDir });

        const cardDir = path.join(deckDir, `card-${cardId}`);
        const { sceneData: served } = await newSceneDataForCardAsync({ cardId, cardDir, deckDir });

        const origNorm = normalizeForComparison(origSnapshot);
        const servedNorm = normalizeForComparison(served.snapshot);

        for (const entryId of Object.keys(origNorm.library)) {
          const origEntry = origNorm.library[entryId];
          const servedEntry = servedNorm.library[entryId];

          if (!origEntry?.actorBlueprint) continue;

          const origComp = origEntry.actorBlueprint.components ?? {};
          const servedComp = servedEntry?.actorBlueprint?.components ?? {};

          // Subset check: verify all orig fields are preserved in served.
          // served may have extra applySnapshot defaults (Camera, visible, relativeToCamera,
          // framesPerSecond, opacity, etc.) that aren't in the original server snapshot.
          for (const [compName, origCompValue] of Object.entries(origComp)) {
            const servedCompValue: any = servedComp[compName] ?? {};
            const origCompObj = origCompValue as any;
            if (!origCompObj || typeof origCompObj !== 'object') continue;

            for (const [fieldName, fieldValue] of Object.entries(origCompObj)) {
              if (compName === 'Body' && BODY_SKIP.has(fieldName)) continue;
              if (compName === 'Drawing2' && DRAWING2_SKIP.has(fieldName)) continue;
              if (compName === 'Text' && TEXT_SKIP.has(fieldName)) continue;
              if (compName === 'Styles' && STYLES_SKIP.has(fieldName)) continue;
              if (compName === 'Shared' && SHARED_SKIP.has(fieldName)) continue;
              // Script.errors is a runtime field — not stored in YAML, not round-trippable
              if (compName === 'Script' && fieldName === 'errors') continue;
              // LocalVariables.undoRedoCount is an internal undo/redo counter not stored in YAML
              if (compName === 'LocalVariables' && fieldName === 'undoRedoCount') continue;
              // Empty localVariables array is semantically equivalent to absent (extractDrawData skips empty arrays)
              if (compName === 'LocalVariables' && fieldName === 'localVariables' && Array.isArray(fieldValue) && fieldValue.length === 0) continue;

              // For complex objects, do a recursive subset check — applySnapshot may add
              // engine defaults (e.g. Music.song sample fields) not in the original snapshot.
              const assertPath = `deck ${deckId} card ${cardId} entry ${entryId} ${compName}.${fieldName}`;
              if (fieldValue !== null && typeof fieldValue === 'object') {
                expectSubset(servedCompValue[fieldName], fieldValue, assertPath);
              } else {
                expect(servedCompValue[fieldName], assertPath).toEqual(fieldValue);
              }
            }
          }
        }
      });

      it(`card ${cardId} — actor positions (x, y, widthScale) preserved after clone → serve`, async () => {
        const deckDir = path.join(tmpDir, 'deck');
        await clone(deckId, { directory: deckDir });

        const cardDir = path.join(deckDir, `card-${cardId}`);
        const { sceneData: served } = await newSceneDataForCardAsync({ cardId, cardDir, deckDir });

        const servedActorMap = new Map(
          (served.snapshot.actors as any[]).map((a: any) => [String(a.actorId), a])
        );

        for (const origActor of origSnapshot.actors as any[]) {
          const servedActor = servedActorMap.get(String(origActor.actorId));
          if (!servedActor) continue;

          const oBody = origActor.bp?.components?.Body ?? {};
          const sBody = servedActor.bp?.components?.Body ?? {};

          const id = `deck ${deckId} card ${cardId} actor ${origActor.actorId}`;
          expect(sBody.x ?? 0, `${id} x`).toBeCloseTo(oBody.x ?? 0, 2);
          expect(sBody.y ?? 0, `${id} y`).toBeCloseTo(oBody.y ?? 0, 2);
          if (oBody.widthScale != null && sBody.widthScale != null) {
            expect(sBody.widthScale, `${id} widthScale`).toBeCloseTo(oBody.widthScale, 2);
          }
          if (oBody.heightScale != null && sBody.heightScale != null) {
            expect(sBody.heightScale, `${id} heightScale`).toBeCloseTo(oBody.heightScale, 2);
          }
        }
      });
    }
  });
}
