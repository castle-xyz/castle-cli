/**
 * Tests for the circular edit problem.
 *
 * Strategy: when the user sends an EditMessage, we record which actor keys were
 * NEWLY ADDED (present in desired but absent from the last mobile-written state).
 * After writeState() runs (which may overwrite those additions), we check whether
 * all newly-added keys are present in the written state.
 *
 * - Additions: re-applied until mobile confirms they are present.
 * - Deletions: fire-and-forget. We send the edit; if mobile races us with the old
 *   state the file reverts briefly, but mobile will process the delete eventually.
 *   We do NOT re-apply deletions so game-managed actors cannot cause infinite loops.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'yaml';
import {
  titleToSlug,
  detectChanges,
  updateMetaHashes,
} from '../src/utils/mobile-files.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'castle-sync-test-'));
}

const TEST_BLUEPRINTS: Record<string, any> = {
  'bp-001': { title: 'Player', components: { Body: { widthScale: 0.5, heightScale: 0.5 } } },
};

function writeTestState(cardDir: string, actors: Record<string, any>) {
  const bpDir = path.join(cardDir, 'blueprints');
  fs.mkdirSync(bpDir, { recursive: true });
  fs.mkdirSync(path.join(cardDir, '.castle'), { recursive: true });

  const blueprintIdMap: Record<string, string> = {};
  for (const [entryId, bp] of Object.entries(TEST_BLUEPRINTS)) {
    const slug = titleToSlug(bp.title);
    blueprintIdMap[slug] = entryId;
    fs.writeFileSync(
      path.join(bpDir, `${slug}.yaml`),
      yaml.stringify({ title: bp.title, entryId, components: bp.components }, { lineWidth: 120 })
    );
  }
  fs.writeFileSync(path.join(cardDir, 'actors.yaml'), yaml.stringify(actors, { lineWidth: 120 }));

  fs.writeFileSync(path.join(cardDir, '.castle', 'meta.json'), JSON.stringify({
    deckId: 'deck-1',
    cardId: 'card-1',
    hashes: {},
    blueprintIdMap,
  }));
  updateMetaHashes(cardDir);
}

/**
 * Simulates CLIMobileConnection._reapplyPendingActors.
 *
 * `addedKeys`: the actor keys that were newly added by the user's last edit
 *              (computed when _sendChanges ran: keys in desired but not in lastMobileState).
 * `desired`:   the full actors dict the user has in their file.
 *
 * Returns true if all added keys are present in the current written state
 * (satisfied → pendingActors should be cleared), false if the file was re-written.
 */
function reapplyPendingActors(
  cardDir: string,
  addedKeys: string[],
  desired: Record<string, any>,
): boolean {
  const actorsPath = path.join(cardDir, 'actors.yaml');
  const raw = fs.existsSync(actorsPath) ? fs.readFileSync(actorsPath, 'utf-8') : '';
  const current: Record<string, any> = (yaml.parse(raw) as any) || {};
  const currentKeys = new Set(Object.keys(current));

  // Satisfied if every key we *added* is now present (mobile may have extra game actors).
  if (addedKeys.every(k => currentKeys.has(k))) {
    return true; // satisfied
  }

  // Some added actors are missing from mobile's state — re-write and re-send.
  fs.writeFileSync(actorsPath, yaml.stringify(desired, { lineWidth: 120 }));
  return false;
}

describe('circular edit: delete actor then add it back', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('correctly handles the full delete-then-add-back cycle', () => {
    const mobileActor = { title: 'Player', x: 10, y: 20, angle: 0, widthScale: 5, heightScale: 5 };

    // ── Phase 1: Mobile sends initial state with actor A ─────────────────────
    writeTestState(tmpDir, { a100: mobileActor });
    expect(detectChanges(tmpDir)!.hasChanges).toBe(false);
    // lastMobileActors = { a100: ... }

    // ── Phase 2: User deletes actor A ────────────────────────────────────────
    fs.writeFileSync(path.join(tmpDir, 'actors.yaml'), yaml.stringify({}, { lineWidth: 120 }));
    expect(detectChanges(tmpDir)!.hasChanges).toBe(true);

    // Simulate _sendChanges: desired={}, lastMobile={a100} → addedKeys=[] (nothing added)
    updateMetaHashes(tmpDir);
    const addedKeysAfterDelete: string[] = []; // no additions, so nothing to re-apply
    const desiredAfterDelete: Record<string, any> = {};

    // ── Phase 3: Mobile sends RACING state WITH actor A ───────────────────────
    writeTestState(tmpDir, { a100: mobileActor });

    // _reapplyPendingActors: no added keys → vacuously satisfied → don't re-write.
    // Deletion is fire-and-forget: we sent the edit, mobile will process it.
    const satisfiedAfterDeleteRace = reapplyPendingActors(tmpDir, addedKeysAfterDelete, desiredAfterDelete);
    expect(satisfiedAfterDeleteRace).toBe(true); // no additions to enforce → satisfied

    // File temporarily has A (mobile's racing state won), but the delete edit was
    // already sent, so mobile will process it and remove A eventually.

    // ── Phase 4: Mobile processes delete, sends state WITHOUT actor A ─────────
    writeTestState(tmpDir, {});
    // No pending additions → _reapplyPendingActors does nothing
    expect(detectChanges(tmpDir)!.hasChanges).toBe(false); // stable ✓

    // ── Phase 5: User adds actor A BACK ──────────────────────────────────────
    const userActorA = { title: 'Player', x: 10, y: 20 };
    fs.writeFileSync(path.join(tmpDir, 'actors.yaml'), yaml.stringify({ a100: userActorA }, { lineWidth: 120 }));
    expect(detectChanges(tmpDir)!.hasChanges).toBe(true);

    // Simulate _sendChanges: desired={a100}, lastMobile={} → addedKeys=['a100']
    updateMetaHashes(tmpDir);
    const addedKeysAfterAdd = ['a100'];
    const desiredAfterAdd: Record<string, any> = { a100: userActorA };

    // ── Phase 6: Mobile sends RACING state WITHOUT actor A ────────────────────
    writeTestState(tmpDir, {});

    // _reapplyPendingActors: a100 missing from current → not satisfied → re-writes file
    const satisfiedAfterAddRace = reapplyPendingActors(tmpDir, addedKeysAfterAdd, desiredAfterAdd);
    expect(satisfiedAfterAddRace).toBe(false); // must re-apply

    // actors.yaml was re-written with actor A
    const actorsAfterReapply = yaml.parse(fs.readFileSync(path.join(tmpDir, 'actors.yaml'), 'utf-8')) as any;
    expect(actorsAfterReapply?.a100).toBeDefined();

    // detectChanges must find a change so FileWatcher re-sends the EditMessage
    expect(detectChanges(tmpDir)!.hasChanges).toBe(true); // ← critical re-send trigger

    // Simulate the re-send _sendChanges
    updateMetaHashes(tmpDir);

    // ── Phase 7: Mobile acknowledges add, sends state WITH actor A ────────────
    writeTestState(tmpDir, { a100: mobileActor }); // mobile writes with full actor fields

    // _reapplyPendingActors: a100 present → satisfied → clear
    const satisfiedAfterAddAck = reapplyPendingActors(tmpDir, addedKeysAfterAdd, desiredAfterAdd);
    expect(satisfiedAfterAddAck).toBe(true); // ✓

    // ── Phase 8: System must be stable ───────────────────────────────────────
    expect(detectChanges(tmpDir)!.hasChanges).toBe(false); // ← key assertion: no loop
  });
});

describe('circular edit: mobile has additional game actors beyond what user edited', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('does not loop when mobile state includes extra game actors not in pendingActors', () => {
    const mobileActorA = { title: 'Player', x: 10, y: 20, angle: 0, widthScale: 5, heightScale: 5 };
    const mobileActorB = { title: 'Enemy',  x: 50, y: 50, angle: 0, widthScale: 5, heightScale: 5 };

    // Mobile starts with just actor A (user's scene)
    writeTestState(tmpDir, { a100: mobileActorA });

    // User writes actor A to the file (no changes yet)
    expect(detectChanges(tmpDir)!.hasChanges).toBe(false);

    // User adds actor A (simulate the scenario where they deleted and re-added it)
    const userActors = { a100: { title: 'Player', x: 10, y: 20 } };
    fs.writeFileSync(path.join(tmpDir, 'actors.yaml'), yaml.stringify(userActors, { lineWidth: 120 }));

    // Simulate _sendChanges: lastMobile had {a100}, desired has {a100}
    // addedKeys = [] because a100 was already in lastMobile. But let's say the
    // baseline was {} (fresh state) so a100 is added.
    updateMetaHashes(tmpDir);

    // Simulate fresh state: mobile was empty, user added a100
    const addedKeys = ['a100'];
    const desired = userActors;

    // Mobile responds with {a100, a200} — game engine added a200 automatically
    writeTestState(tmpDir, { a100: mobileActorA, a200: mobileActorB });

    // _reapplyPendingActors: a100 is present in {a100, a200} → satisfied → NO loop
    const satisfied = reapplyPendingActors(tmpDir, addedKeys, desired);
    expect(satisfied).toBe(true); // ← was false before the fix, causing infinite loop

    // System is stable — no more changes should be detected
    expect(detectChanges(tmpDir)!.hasChanges).toBe(false);
  });
});
