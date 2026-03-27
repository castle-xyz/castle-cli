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
  detectConflicts,
  computeDiskVsMobileDelta,
} from '../src/utils/mobile-files.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'castle-sync-test-'));
}

const TEST_BLUEPRINTS: Record<string, any> = {
  'bp-001': { title: 'Player', components: { Body: { widthScale: 0.5, heightScale: 0.5 } } },
};

function actorsDictToList(actors: Record<string, any>): any[] {
  return Object.entries(actors).map(([k, v]) => ({
    actorId: k.startsWith('a') ? k.slice(1) : k,
    ...(v as any),
  }));
}

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
  fs.writeFileSync(path.join(cardDir, 'actors.yaml'), yaml.stringify(actorsDictToList(actors), { lineWidth: 120 }));

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
  const currentList: any[] = (yaml.parse(raw) as any[]) || [];
  const currentIds = new Set(currentList.map((a: any) => `a${a.actorId}`));

  // Satisfied if every key we *added* is now present (mobile may have extra game actors).
  if (addedKeys.every(k => currentIds.has(k))) {
    return true; // satisfied
  }

  // Some added actors are missing from mobile's state — re-write and re-send.
  fs.writeFileSync(actorsPath, yaml.stringify(actorsDictToList(desired), { lineWidth: 120 }));
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
    fs.writeFileSync(path.join(tmpDir, 'actors.yaml'), yaml.stringify([], { lineWidth: 120 }));
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
    fs.writeFileSync(path.join(tmpDir, 'actors.yaml'), yaml.stringify([{ actorId: '100', ...userActorA }], { lineWidth: 120 }));
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
    const actorsAfterReapply = yaml.parse(fs.readFileSync(path.join(tmpDir, 'actors.yaml'), 'utf-8')) as any[];
    expect(actorsAfterReapply?.some((a: any) => String(a.actorId) === '100')).toBe(true);

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

// ---------------------------------------------------------------------------
// Helpers for conflict detection / delta tests
// ---------------------------------------------------------------------------

// A minimal StateInternalMessage-shaped object for testing (no WASM needed)
function makeMobileState(options: {
  blueprints?: Record<string, { title: string; components?: any }>;
  actors?: Record<string, { parentEntryId: string; bp?: { components?: { Body?: any } } }>;
  variables?: any;
} = {}): any {
  const blueprints: Record<string, any> = {};
  for (const [id, bp] of Object.entries(options.blueprints ?? {})) {
    blueprints[id] = { entryType: 'actorBlueprint', title: bp.title, actorBlueprint: { components: bp.components ?? {} } };
  }
  return {
    type: 'state_internal',
    deckId: 'deck-1',
    cardId: 'card-1',
    cliSessionId: 'session-1',
    blueprints,
    actors: options.actors ?? {},
    variables: options.variables ?? null,
    sceneProperties: null,
  };
}

// Write disk files as if mobile had previously synced them
function writeDiskState(cardDir: string, options: {
  blueprints?: Record<string, { entryId: string; title: string; components?: any }>;
  actors?: Record<string, any>;
  variables?: any;
}) {
  const bpDir = path.join(cardDir, 'blueprints');
  fs.mkdirSync(bpDir, { recursive: true });
  fs.mkdirSync(path.join(cardDir, '.castle'), { recursive: true });

  const blueprintIdMap: Record<string, string> = {};
  for (const [_id, bp] of Object.entries(options.blueprints ?? {})) {
    const slug = titleToSlug(bp.title);
    blueprintIdMap[slug] = bp.entryId;
    fs.writeFileSync(
      path.join(bpDir, `${slug}.yaml`),
      yaml.stringify({ title: bp.title, entryId: bp.entryId, components: bp.components ?? {} }, { lineWidth: 120 })
    );
  }

  fs.writeFileSync(
    path.join(cardDir, 'actors.yaml'),
    yaml.stringify(actorsDictToList(options.actors ?? {}), { lineWidth: 120 })
  );
  fs.writeFileSync(
    path.join(cardDir, 'variables.yaml'),
    yaml.stringify(options.variables ?? null, { lineWidth: 120 })
  );
  fs.writeFileSync(
    path.join(cardDir, '.castle', 'meta.json'),
    JSON.stringify({ deckId: 'deck-1', cardId: 'card-1', hashes: {}, blueprintIdMap })
  );
  updateMetaHashes(cardDir);
}

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
    fs.writeFileSync(path.join(tmpDir, 'actors.yaml'), yaml.stringify(actorsDictToList(userActors), { lineWidth: 120 }));

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

// ---------------------------------------------------------------------------
// detectConflicts tests
// ---------------------------------------------------------------------------

describe('detectConflicts', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns null when deck has no actors.yaml (empty deck)', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const mobile = makeMobileState({ blueprints: { 'bp-1': { title: 'Player' } }, actors: {} });
    expect(detectConflicts(tmpDir, mobile)).toBeNull();
  });

  it('returns hasConflicts=false when disk matches mobile state', () => {
    const mobile = makeMobileState({
      blueprints: { 'bp-1': { title: 'Player' } },
      actors: { a1: { parentEntryId: 'bp-1', bp: { components: { Body: { x: 10, y: 20 } } } } },
    });
    writeDiskState(tmpDir, {
      blueprints: { 'bp-1': { entryId: 'bp-1', title: 'Player' } },
      actors: { a1: { title: 'Player', x: 10, y: 20 } },
    });
    const result = detectConflicts(tmpDir, mobile);
    expect(result).not.toBeNull();
    expect(result!.hasConflicts).toBe(false);
  });

  it('detects local-only blueprint (on disk but not in mobile)', () => {
    const mobile = makeMobileState({ blueprints: { 'bp-1': { title: 'Player' } }, actors: {} });
    writeDiskState(tmpDir, {
      blueprints: {
        'bp-1': { entryId: 'bp-1', title: 'Player' },
        'bp-2': { entryId: 'bp-2', title: 'Enemy' },
      },
      actors: {},
    });
    const result = detectConflicts(tmpDir, mobile);
    expect(result!.hasConflicts).toBe(true);
    expect(result!.localOnlyBlueprintSlugs).toContain('enemy');
    expect(result!.mobileOnlyBlueprintEntryIds).toHaveLength(0);
  });

  it('detects mobile-only blueprint (in mobile but not on disk)', () => {
    const mobile = makeMobileState({
      blueprints: { 'bp-1': { title: 'Player' }, 'bp-2': { title: 'Enemy' } },
      actors: {},
    });
    writeDiskState(tmpDir, {
      blueprints: { 'bp-1': { entryId: 'bp-1', title: 'Player' } },
      actors: {},
    });
    const result = detectConflicts(tmpDir, mobile);
    expect(result!.hasConflicts).toBe(true);
    expect(result!.mobileOnlyBlueprintEntryIds).toContain('bp-2');
    expect(result!.localOnlyBlueprintSlugs).toHaveLength(0);
  });

  it('detects actor differences', () => {
    const mobile = makeMobileState({
      blueprints: { 'bp-1': { title: 'Player' } },
      actors: { a1: { parentEntryId: 'bp-1', bp: { components: { Body: { x: 10, y: 20 } } } } },
    });
    writeDiskState(tmpDir, {
      blueprints: { 'bp-1': { entryId: 'bp-1', title: 'Player' } },
      actors: {
        a1: { title: 'Player', x: 10, y: 20 },
        a2: { title: 'Player', x: 50, y: 50 }, // extra actor on disk
      },
    });
    const result = detectConflicts(tmpDir, mobile);
    expect(result!.hasConflicts).toBe(true);
    expect(result!.actorsDiffer).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeDiskVsMobileDelta tests
// ---------------------------------------------------------------------------

describe('computeDiskVsMobileDelta', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns no changes when disk matches mobile', () => {
    const mobile = makeMobileState({
      blueprints: { 'bp-1': { title: 'Player' } },
      actors: { a1: { parentEntryId: 'bp-1', bp: { components: { Body: { x: 10, y: 20 } } } } },
    });
    writeDiskState(tmpDir, {
      blueprints: { 'bp-1': { entryId: 'bp-1', title: 'Player' } },
      actors: { a1: { title: 'Player', x: 10, y: 20 } },
    });
    const delta = computeDiskVsMobileDelta(tmpDir, mobile);
    expect(delta.hasChanges).toBe(false);
  });

  it('includes actor addition when disk has actor mobile does not', () => {
    const mobile = makeMobileState({
      blueprints: { 'bp-1': { title: 'Player' } },
      actors: { a1: { parentEntryId: 'bp-1', bp: { components: { Body: { x: 10, y: 20 } } } } },
    });
    writeDiskState(tmpDir, {
      blueprints: { 'bp-1': { entryId: 'bp-1', title: 'Player' } },
      actors: {
        a1: { title: 'Player', x: 10, y: 20 },
        a2: { title: 'Player', x: 50, y: 50 },
      },
    });
    const delta = computeDiskVsMobileDelta(tmpDir, mobile);
    expect(delta.hasChanges).toBe(true);
    expect(delta.changedActors!['a2']).toBeDefined();
    expect(delta.changedActors!['a2'].removeActor).toBeUndefined();
  });

  it('includes actor deletion when mobile has actor disk does not', () => {
    const mobile = makeMobileState({
      blueprints: { 'bp-1': { title: 'Player' } },
      actors: {
        a1: { parentEntryId: 'bp-1', bp: { components: { Body: { x: 10, y: 20 } } } },
        a2: { parentEntryId: 'bp-1', bp: { components: { Body: { x: 50, y: 50 } } } },
      },
    });
    writeDiskState(tmpDir, {
      blueprints: { 'bp-1': { entryId: 'bp-1', title: 'Player' } },
      actors: { a1: { title: 'Player', x: 10, y: 20 } },
    });
    const delta = computeDiskVsMobileDelta(tmpDir, mobile);
    expect(delta.hasChanges).toBe(true);
    expect(delta.changedActors!['a2']).toEqual({ removeActor: true });
  });

  it('includes blueprint removal when mobile has blueprint disk does not', () => {
    const mobile = makeMobileState({
      blueprints: { 'bp-1': { title: 'Player' }, 'bp-2': { title: 'Enemy' } },
      actors: {},
    });
    writeDiskState(tmpDir, {
      blueprints: { 'bp-1': { entryId: 'bp-1', title: 'Player' } },
      actors: {},
    });
    const delta = computeDiskVsMobileDelta(tmpDir, mobile);
    expect(delta.hasChanges).toBe(true);
    expect(delta.changedBlueprints['bp-2']).toEqual({ entryId: 'bp-2', removeBlueprint: true });
  });

  it('includes blueprint addition when disk has blueprint mobile does not', () => {
    const mobile = makeMobileState({
      blueprints: { 'bp-1': { title: 'Player' } },
      actors: {},
    });
    writeDiskState(tmpDir, {
      blueprints: {
        'bp-1': { entryId: 'bp-1', title: 'Player' },
        'bp-2': { entryId: 'bp-2', title: 'Enemy' },
      },
      actors: {},
    });
    const delta = computeDiskVsMobileDelta(tmpDir, mobile);
    expect(delta.hasChanges).toBe(true);
    expect(delta.changedBlueprints['bp-2']).toBeDefined();
    expect(delta.changedBlueprints['bp-2'].removeBlueprint).toBeUndefined();
    expect(delta.changedBlueprints['bp-2'].title).toBe('Enemy');
  });

  it('includes actor update when content differs', () => {
    const mobile = makeMobileState({
      blueprints: { 'bp-1': { title: 'Player' } },
      actors: { a1: { parentEntryId: 'bp-1', bp: { components: { Body: { x: 10, y: 20 } } } } },
    });
    writeDiskState(tmpDir, {
      blueprints: { 'bp-1': { entryId: 'bp-1', title: 'Player' } },
      actors: { a1: { title: 'Player', x: 99, y: 99 } }, // different position
    });
    const delta = computeDiskVsMobileDelta(tmpDir, mobile);
    expect(delta.hasChanges).toBe(true);
    expect(delta.changedActors!['a1']).toBeDefined();
    expect(delta.changedActors!['a1'].x).toBe(99);
  });
});
