import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import { applySnapshot, getSnapshotExternalValues } from '../src/utils/castle-core-node.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURES: Record<string, { cardId: string; snapshot: any }> = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'snapshots.json'), 'utf-8')
);

// Strip Drawing2 fields that are engine-computed/runtime state from a component set.
// currentFrame causes a WASM modulo-by-zero crash in applySnapshot when fed back in.
function stripDrawing2Computed(components: any): void {
  if (components.Drawing2) {
    delete components.Drawing2.currentFrame;
    delete components.Drawing2.hash;
    delete components.Drawing2.drawData;
    delete components.Drawing2.physicsBodyData;
  }
}

// Mirrors what cloneCardAsync does after getSnapshotExternalValues: strip fields that are
// engine-computed or per-instance so they don't get written to disk or fed back to applySnapshot.
function stripComputedFields(externalSnapshot: any): any {
  const snapshot = JSON.parse(JSON.stringify(externalSnapshot)); // deep clone
  for (const entry of Object.values(snapshot.library) as any[]) {
    const components = entry.actorBlueprint?.components ?? {};
    stripDrawing2Computed(components);
    // Body position is per-actor, not a blueprint property
    if (components.Body) {
      delete components.Body.x;
      delete components.Body.y;
      delete components.Body.angle;
    }
  }
  // Actors from the server snapshot can also carry Drawing2 with currentFrame
  for (const actor of snapshot.actors as any[]) {
    stripDrawing2Computed(actor.bp?.components ?? {});
  }
  return snapshot;
}

// Collect Body components from all library entries and actors.
// Returns a map of "lib:<entryId>" or "actor:<actorId>" → Body component object.
function collectBodyProps(snapshot: any): Map<string, any> {
  const result = new Map<string, any>();
  for (const [entryId, entry] of Object.entries(snapshot.library as Record<string, any>)) {
    const body = (entry as any).actorBlueprint?.components?.Body;
    if (body) result.set(`lib:${entryId}`, body);
  }
  for (const actor of snapshot.actors as any[]) {
    const body = actor.bp?.components?.Body;
    if (body) result.set(`actor:${actor.actorId}`, body);
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Per-deck round-trip tests using real scene data fetched from castle.xyz
// ────────────────────────────────────────────────────────────────────────────

const DECKS = [
  // wgWUDokID: Chess game — 3 library entries, 2 actors, widthScale 0.3 / 0.64999
  { deckId: 'wgWUDokID', desc: 'Chess (wgWUDokID)' },
  // 78CejfIdF: 3 library entries, 5 actors, varied widthScale (0.1, 0.3, 0.96249)
  { deckId: '78CejfIdF', desc: 'Explore deck 78CejfIdF' },
  // Af-1kWA8u: 3 library entries, 5 actors including one with angle=4.71225 rad (270°)
  { deckId: 'Af-1kWA8u', desc: 'Explore deck Af-1kWA8u (has rotated actor)' },
  // cF9tkk3yxK: 3 library entries with visible=false, 5 actors
  { deckId: 'cF9tkk3yxK', desc: 'Explore deck cF9tkk3yxK (has visible=false entries)' },
];

for (const { deckId, desc } of DECKS) {
  describe(`snapshot round-trip — ${desc}`, () => {
    const { snapshot } = FIXTURES[deckId];

    it('getSnapshotExternalValues converts Body.widthScale to ×10 external format', async () => {
      const external = await getSnapshotExternalValues(snapshot);

      // Library entries
      for (const [entryId, entry] of Object.entries(external.library as Record<string, any>)) {
        const origBody = (snapshot.library as any)[entryId]?.actorBlueprint?.components?.Body;
        const extBody = (entry as any).actorBlueprint?.components?.Body;
        if (origBody?.widthScale != null && extBody?.widthScale != null) {
          expect(extBody.widthScale, `lib entry ${entryId} widthScale`).toBeCloseTo(
            origBody.widthScale * 10,
            3
          );
        }
        if (origBody?.heightScale != null && extBody?.heightScale != null) {
          expect(extBody.heightScale, `lib entry ${entryId} heightScale`).toBeCloseTo(
            origBody.heightScale * 10,
            3
          );
        }
      }

      // Actors (actorId comes back as string from WASM)
      for (const actor of external.actors as any[]) {
        const origActor = (snapshot.actors as any[]).find(
          a => String(a.actorId) === String(actor.actorId)
        );
        const origBody = origActor?.bp?.components?.Body;
        const extBody = actor.bp?.components?.Body;
        if (origBody?.widthScale != null && extBody?.widthScale != null) {
          expect(extBody.widthScale, `actor ${actor.actorId} widthScale`).toBeCloseTo(
            origBody.widthScale * 10,
            3
          );
        }
      }
    });

    it('round-trips Body.widthScale and heightScale through serialize → deserialize', async () => {
      const external = await getSnapshotExternalValues(snapshot);
      const stripped = stripComputedFields(external);
      const restored = await applySnapshot(stripped);

      const origBodies = collectBodyProps(snapshot);
      const resBodies = collectBodyProps(restored);

      for (const [key, origBody] of origBodies) {
        const resBody = resBodies.get(key);
        if (!resBody) continue;
        if (origBody.widthScale != null) {
          expect(resBody.widthScale, `${key} widthScale`).toBeCloseTo(origBody.widthScale, 3);
        }
        if (origBody.heightScale != null) {
          expect(resBody.heightScale, `${key} heightScale`).toBeCloseTo(origBody.heightScale, 3);
        }
      }
    });

    it('round-trips actor Body.x and Body.y through serialize → deserialize', async () => {
      const external = await getSnapshotExternalValues(snapshot);
      const stripped = stripComputedFields(external);
      const restored = await applySnapshot(stripped);

      for (const actor of restored.actors as any[]) {
        const origActor = (snapshot.actors as any[]).find(
          a => String(a.actorId) === String(actor.actorId)
        );
        const origBody = origActor?.bp?.components?.Body;
        const resBody = actor.bp?.components?.Body;
        if (!origBody || !resBody) continue;
        if (origBody.x != null) {
          expect(resBody.x, `actor ${actor.actorId} x`).toBeCloseTo(origBody.x, 3);
        }
        if (origBody.y != null) {
          expect(resBody.y, `actor ${actor.actorId} y`).toBeCloseTo(origBody.y, 3);
        }
      }
    });

    it('preserves library entry IDs and actor IDs through round-trip', async () => {
      const external = await getSnapshotExternalValues(snapshot);
      const stripped = stripComputedFields(external);
      const restored = await applySnapshot(stripped);

      expect(Object.keys(restored.library).sort()).toEqual(Object.keys(snapshot.library).sort());

      const origActorIds = (snapshot.actors as any[]).map(a => String(a.actorId)).sort();
      const resActorIds = (restored.actors as any[]).map(a => String(a.actorId)).sort();
      expect(resActorIds).toEqual(origActorIds);
    });

    it('preserves actor parentEntryId through round-trip', async () => {
      const external = await getSnapshotExternalValues(snapshot);
      const stripped = stripComputedFields(external);
      const restored = await applySnapshot(stripped);

      for (const actor of restored.actors as any[]) {
        const origActor = (snapshot.actors as any[]).find(
          a => String(a.actorId) === String(actor.actorId)
        );
        expect(actor.parentEntryId, `actor ${actor.actorId} parentEntryId`).toBe(
          origActor?.parentEntryId
        );
      }
    });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Targeted checks on specific decks
// ────────────────────────────────────────────────────────────────────────────

describe('snapshot round-trip — angle handling', () => {
  it('getSnapshotExternalValues converts 4.71225 rad to ~270 degrees', async () => {
    const { snapshot } = FIXTURES['Af-1kWA8u'];
    const external = await getSnapshotExternalValues(snapshot);

    // Actor 4 has Body.angle = 4.71225 radians in internal format
    const actor = (external.actors as any[]).find(a => String(a.actorId) === '4');
    expect(actor).toBeDefined();
    const extAngle = actor.bp?.components?.Body?.angle;
    // handleGetProperty converts radians → degrees: 4.71225 * (180/π) ≈ 270
    expect(extAngle).toBeCloseTo(270, 0);
  });

  it('round-trips 4.71225 rad angle through serialize → deserialize', async () => {
    const { snapshot } = FIXTURES['Af-1kWA8u'];
    const external = await getSnapshotExternalValues(snapshot);
    const stripped = stripComputedFields(external);
    const restored = await applySnapshot(stripped);

    const origActor = (snapshot.actors as any[]).find(a => String(a.actorId) === '4');
    const resActor = (restored.actors as any[]).find(a => String(a.actorId) === '4');
    expect(origActor?.bp?.components?.Body?.angle).toBeCloseTo(4.71225, 3);
    expect(resActor?.bp?.components?.Body?.angle).toBeCloseTo(4.71225, 3);
  });
});

describe('snapshot round-trip — visible=false', () => {
  it('round-trips Body.visible=false through serialize → deserialize', async () => {
    const { snapshot } = FIXTURES['cF9tkk3yxK'];
    const external = await getSnapshotExternalValues(snapshot);
    const stripped = stripComputedFields(external);
    const restored = await applySnapshot(stripped);

    // All library entries in this deck have visible=false
    for (const [entryId, entry] of Object.entries(snapshot.library as Record<string, any>)) {
      const origVisible = (entry as any).actorBlueprint?.components?.Body?.visible;
      if (origVisible !== false) continue;
      const resBody = (restored.library as any)[entryId]?.actorBlueprint?.components?.Body;
      expect(resBody?.visible, `entry ${entryId} visible`).toBe(false);
    }
  });

  it('round-trips Body.visible=true through serialize → deserialize', async () => {
    const { snapshot } = FIXTURES['wgWUDokID'];
    const external = await getSnapshotExternalValues(snapshot);
    const stripped = stripComputedFields(external);
    const restored = await applySnapshot(stripped);

    for (const [entryId, entry] of Object.entries(snapshot.library as Record<string, any>)) {
      const origVisible = (entry as any).actorBlueprint?.components?.Body?.visible;
      if (origVisible !== true) continue;
      const resBody = (restored.library as any)[entryId]?.actorBlueprint?.components?.Body;
      expect(resBody?.visible, `entry ${entryId} visible`).toBe(true);
    }
  });
});

describe('snapshot round-trip — Drawing2.initialFrame', () => {
  it('round-trips Drawing2.initialFrame=1 through serialize → deserialize', async () => {
    const { snapshot } = FIXTURES['wgWUDokID'];
    const external = await getSnapshotExternalValues(snapshot);
    const stripped = stripComputedFields(external);
    const restored = await applySnapshot(stripped);

    for (const [entryId, entry] of Object.entries(snapshot.library as Record<string, any>)) {
      const origFrame = (entry as any).actorBlueprint?.components?.Drawing2?.initialFrame;
      if (origFrame == null) continue;
      const resFrame = (restored.library as any)[entryId]?.actorBlueprint?.components?.Drawing2
        ?.initialFrame;
      expect(resFrame, `entry ${entryId} Drawing2.initialFrame`).toBe(origFrame);
    }
  });
});
