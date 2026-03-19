import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import {
  titleToSlug,
  writeState,
  detectChanges,
  mobileStateToSceneData,
} from '../src/utils/mobile-files.js';
import type { StateMessage } from '../src/utils/mobile-protocol.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'castle-test-'));
}

function makeStateMessage(overrides = {}): StateMessage {
  return {
    type: 'state',
    deckId: 'deck-123',
    cardId: 'card-456',
    cliSessionId: 'session-abc',
    blueprints: {
      'entry-001': {
        entryId: 'entry-001',
        title: 'Player',
        components: {
          Body: { widthScale: 0.5, heightScale: 0.5 },
          Drawing2: { initialFrame: 1 },
          Script: { code: '' },
        },
        scriptCode: 'function update() end',
      },
    },
    actors: {
      a100: {
        title: 'Player', // mobile sends title (from extractActorsInfo)
        x: 10,
        y: 20,
        angle: 0.785,    // radians (internal engine format from mobile)
        widthScale: 5.0, // ×10 (mobile sends widthScale * 10)
        heightScale: 5.0,
      } as any,
    },
    variables: [
      { variableId: 'var-1', name: 'score', initialValue: 0, lifetime: 'card' },
    ],
    prompt: 'test prompt',
    ...overrides,
  };
}

describe('titleToSlug', () => {
  it('converts simple titles', () => {
    expect(titleToSlug('Player Ship')).toBe('Player-Ship');
    expect(titleToSlug('Enemy')).toBe('Enemy');
  });

  it('handles special characters', () => {
    expect(titleToSlug('My Actor!')).toBe('My-Actor');
    expect(titleToSlug('  Leading Spaces  ')).toBe('Leading-Spaces');
  });

  it('returns untitled for empty/whitespace', () => {
    expect(titleToSlug('')).toBe('untitled');
    expect(titleToSlug('---')).toBe('untitled');
  });
});

describe('writeState', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes blueprint YAML and lua files', () => {
    const state = makeStateMessage();
    writeState(tmpDir, state);

    const bpDir = path.join(tmpDir, 'blueprints');
    expect(fs.existsSync(bpDir)).toBe(true);

    const yamlFile = path.join(bpDir, 'Player.yaml');
    expect(fs.existsSync(yamlFile)).toBe(true);

    const luaFile = path.join(bpDir, 'Player.lua');
    expect(fs.existsSync(luaFile)).toBe(true);
    expect(fs.readFileSync(luaFile, 'utf-8')).toBe('function update() end');
  });

  it('writes actors.yaml in flat format with title and degrees', () => {
    const state = makeStateMessage();
    writeState(tmpDir, state);

    const actorsPath = path.join(tmpDir, 'actors.yaml');
    expect(fs.existsSync(actorsPath)).toBe(true);

    const actorsObj = yaml.load(fs.readFileSync(actorsPath, 'utf-8')) as any;
    expect(actorsObj['a100']).toBeDefined();
    // Flat format: title, not entryId or nested components
    expect(actorsObj['a100'].title).toBe('Player');
    expect(actorsObj['a100'].components).toBeUndefined();
    expect(actorsObj['a100'].x).toBe(10);
    expect(actorsObj['a100'].y).toBe(20);
    // Angle converted from radians (0.785) to degrees (~44.97)
    expect(actorsObj['a100'].angle).toBeCloseTo(44.97, 1);
    // widthScale stays ×10 (mobile sends ×10, we pass through)
    expect(actorsObj['a100'].widthScale).toBe(5.0);
  });

  it('writes variables.yaml', () => {
    const state = makeStateMessage();
    writeState(tmpDir, state);

    const varsPath = path.join(tmpDir, 'variables.yaml');
    expect(fs.existsSync(varsPath)).toBe(true);

    const content = fs.readFileSync(varsPath, 'utf-8');
    expect(content).toContain('score');
  });

  it('writes AGENTS.md and CLAUDE.md combining state.prompt with CLI docs', () => {
    const state = makeStateMessage({ prompt: '## Scene Context\nThis is a chess game.' });
    writeState(tmpDir, state);

    const agentsPath = path.join(tmpDir, 'AGENTS.md');
    const claudePath = path.join(tmpDir, 'CLAUDE.md');
    expect(fs.existsSync(agentsPath)).toBe(true);
    expect(fs.existsSync(claudePath)).toBe(true);

    const content = fs.readFileSync(agentsPath, 'utf-8');
    // Should contain client prompt
    expect(content).toContain('chess game');
    // Should contain CLI docs
    expect(content).toContain('actors.yaml');
  });

  it('writes meta.json with hashes and blueprintIdMap', () => {
    const state = makeStateMessage();
    writeState(tmpDir, state);

    const metaPath = path.join(tmpDir, '.castle', 'meta.json');
    expect(fs.existsSync(metaPath)).toBe(true);

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    expect(meta.deckId).toBe('deck-123');
    expect(meta.cardId).toBe('card-456');
    expect(meta.hashes).toBeDefined();
    expect(meta.blueprintIdMap).toBeDefined();
    expect(meta.blueprintIdMap['Player']).toBe('entry-001');
  });
});

describe('detectChanges', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null if no meta.json', () => {
    const result = detectChanges(tmpDir);
    expect(result).toBeNull();
  });

  it('detects no changes after writeState', () => {
    const state = makeStateMessage();
    writeState(tmpDir, state);

    const changes = detectChanges(tmpDir);
    expect(changes).toBeDefined();
    expect(changes!.hasChanges).toBe(false);
  });

  it('detects changed blueprint YAML', () => {
    const state = makeStateMessage();
    writeState(tmpDir, state);

    // Modify blueprint YAML
    const yamlPath = path.join(tmpDir, 'blueprints', 'Player.yaml');
    const content = fs.readFileSync(yamlPath, 'utf-8');
    fs.writeFileSync(yamlPath, content + '\n# modified');

    const changes = detectChanges(tmpDir);
    expect(changes!.hasChanges).toBe(true);
    expect(Object.keys(changes!.changedBlueprints).length).toBeGreaterThan(0);
  });

  it('detects changed actors.yaml', () => {
    const state = makeStateMessage();
    writeState(tmpDir, state);

    // Modify actors.yaml
    const actorsPath = path.join(tmpDir, 'actors.yaml');
    const content = fs.readFileSync(actorsPath, 'utf-8');
    fs.writeFileSync(actorsPath, content.replace('10', '99'));

    const changes = detectChanges(tmpDir);
    expect(changes!.hasChanges).toBe(true);
    expect(changes!.changedActors).toBeDefined();
  });

  it('detects changed variables.yaml', () => {
    const state = makeStateMessage();
    writeState(tmpDir, state);

    // Modify variables.yaml
    const varsPath = path.join(tmpDir, 'variables.yaml');
    const content = fs.readFileSync(varsPath, 'utf-8');
    fs.writeFileSync(varsPath, content + '\n- variableId: var-2\n  name: lives\n  initialValue: 3\n  lifetime: card\n');

    const changes = detectChanges(tmpDir);
    expect(changes!.hasChanges).toBe(true);
    expect(changes!.changedVariables).toBeDefined();
  });
});

describe('mobileStateToSceneData', () => {
  it('converts state to scene data format', () => {
    const state = makeStateMessage();
    const sceneData = mobileStateToSceneData(state);

    expect(sceneData.snapshot).toBeDefined();
    expect(sceneData.snapshot.library).toBeDefined();
    expect(sceneData.snapshot.actors).toBeDefined();
  });

  it('builds library from blueprints', () => {
    const state = makeStateMessage();
    const sceneData = mobileStateToSceneData(state);

    const library = sceneData.snapshot.library;
    expect(library['entry-001']).toBeDefined();
    expect(library['entry-001'].entryType).toBe('actorBlueprint');
    expect(library['entry-001'].title).toBe('Player');
    expect(library['entry-001'].actorBlueprint.components).toBeDefined();
  });

  it('builds actors array from actors object with correct internal format', () => {
    const state = makeStateMessage();
    const sceneData = mobileStateToSceneData(state);

    const actors = sceneData.snapshot.actors;
    expect(Array.isArray(actors)).toBe(true);
    expect(actors.length).toBe(1);

    const actor = actors[0];
    expect(actor.actorId).toBe('100'); // "a100" -> "100"
    // parentEntryId looked up from title 'Player' → 'entry-001'
    expect(actor.parentEntryId).toBe('entry-001');
    expect(actor.bp.components.Body.x).toBe(10);
    expect(actor.bp.components.Body.y).toBe(20);
    expect(actor.bp.components.Body.angle).toBe(0.785); // radians (internal — unchanged)
    // widthScale ÷10: mobile sends 5.0 (×10) → cache stores 0.5 (internal)
    expect(actor.bp.components.Body.widthScale).toBeCloseTo(0.5);
  });
});
