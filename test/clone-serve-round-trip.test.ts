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
import { getSnapshotExternalValues } from '../src/utils/castle-core-node.js';

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
]);

// Drawing2 fields that are engine-computed and not written to blueprint YAMLs.
const DRAWING2_SKIP = new Set(['currentFrame', 'hash', 'drawData', 'physicsBodyData']);

// Text properties that have known WASM color-space precision loss (~2/255 per channel)
// and are not the focus of the round-trip correctness we're verifying here.
const TEXT_SKIP = new Set(['color']);

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
function normalizeForComparison(externalSnapshot: any): any {
  const snap = JSON.parse(JSON.stringify(externalSnapshot));

  for (const entry of Object.values(snap.library) as any[]) {
    const components = entry.actorBlueprint?.components ?? {};

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

        const origExternal = await getSnapshotExternalValues(origSnapshot);
        const servedExternal = await getSnapshotExternalValues(served.snapshot);

        const origNorm = normalizeForComparison(origExternal);
        const servedNorm = normalizeForComparison(servedExternal);

        for (const entryId of Object.keys(origNorm.library)) {
          const origEntry = origNorm.library[entryId];
          const servedEntry = servedNorm.library[entryId];

          if (!origEntry?.actorBlueprint) continue;

          const origComp = origEntry.actorBlueprint.components ?? {};
          const servedComp = servedEntry?.actorBlueprint?.components ?? {};

          expect(
            servedComp,
            `deck ${deckId} card ${cardId} entry ${entryId} components`
          ).toEqual(origComp);
        }
      });

      it(`card ${cardId} — actor positions (x, y, widthScale) preserved after clone → serve`, async () => {
        const deckDir = path.join(tmpDir, 'deck');
        await clone(deckId, { directory: deckDir });

        const cardDir = path.join(deckDir, `card-${cardId}`);
        const { sceneData: served } = await newSceneDataForCardAsync({ cardId, cardDir, deckDir });

        const origExternal = await getSnapshotExternalValues(origSnapshot);
        const servedExternal = await getSnapshotExternalValues(served.snapshot);

        const servedActorMap = new Map(
          (servedExternal.actors as any[]).map(a => [String(a.actorId), a])
        );

        for (const origActor of origExternal.actors as any[]) {
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
