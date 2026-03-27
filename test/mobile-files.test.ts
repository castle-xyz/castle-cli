import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'yaml';
import {
  titleToSlug,
  writeStateInternal,
  detectChanges,
  updateMetaHashes,
} from '../src/utils/mobile-files.js';
import type { StateInternalMessage } from '../src/utils/mobile-protocol.js';
import { initMetadata } from '../src/utils/init.js';
import { newSceneDataForCardAsync } from '../src/utils/decks.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'castle-test-'));
}

function writeTestState(cardDir: string) {
  const bpDir = path.join(cardDir, 'blueprints');
  fs.mkdirSync(bpDir, { recursive: true });
  fs.mkdirSync(path.join(cardDir, '.castle'), { recursive: true });

  const slug = titleToSlug('Player');
  const bpData = { title: 'Player', entryId: 'entry-001', components: { Layout: { widthScale: 0.5, heightScale: 0.5 } } };
  fs.writeFileSync(path.join(bpDir, `${slug}.yaml`), yaml.stringify(bpData, { lineWidth: 120 }));

  const actors = { a0: { title: 'Player', x: 10, y: 20 } };
  fs.writeFileSync(path.join(cardDir, 'actors.yaml'), yaml.stringify(actors, { lineWidth: 120 }));

  const variables = [{ variableId: 'var-1', name: 'score', initialValue: 0, lifetime: 'card' }];
  fs.writeFileSync(path.join(cardDir, 'variables.yaml'), yaml.stringify(variables, { lineWidth: 120 }));

  fs.writeFileSync(path.join(cardDir, '.castle', 'meta.json'), JSON.stringify({
    deckId: 'deck-123',
    cardId: 'card-456',
    hashes: {},
    blueprintIdMap: { [slug]: 'entry-001' },
  }));
  updateMetaHashes(cardDir);
}

describe('titleToSlug', () => {
  it('converts simple titles', () => {
    expect(titleToSlug('Player Ship')).toBe('player_ship');
    expect(titleToSlug('Enemy')).toBe('enemy');
  });

  it('handles special characters', () => {
    expect(titleToSlug('My Actor!')).toBe('my_actor');
    expect(titleToSlug('  Leading Spaces  ')).toBe('leading_spaces');
  });

  it('returns untitled for empty/whitespace', () => {
    expect(titleToSlug('')).toBe('untitled');
    expect(titleToSlug('---')).toBe('untitled');
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

  it('detects no changes after writeTestState', () => {
    writeTestState(tmpDir);

    const changes = detectChanges(tmpDir);
    expect(changes).toBeDefined();
    expect(changes!.hasChanges).toBe(false);
  });

  it('detects changed blueprint YAML', () => {
    writeTestState(tmpDir);

    // Modify blueprint YAML
    const yamlPath = path.join(tmpDir, 'blueprints', 'player.yaml');
    const content = fs.readFileSync(yamlPath, 'utf-8');
    fs.writeFileSync(yamlPath, content + '\n# modified');

    const changes = detectChanges(tmpDir);
    expect(changes!.hasChanges).toBe(true);
    expect(Object.keys(changes!.changedBlueprints).length).toBeGreaterThan(0);
  });

  it('detects changed actors.yaml', () => {
    writeTestState(tmpDir);

    // Modify actors.yaml
    const actorsPath = path.join(tmpDir, 'actors.yaml');
    const content = fs.readFileSync(actorsPath, 'utf-8');
    fs.writeFileSync(actorsPath, content.replace('10', '99'));

    const changes = detectChanges(tmpDir);
    expect(changes!.hasChanges).toBe(true);
  });

  it('detects changed variables.yaml', () => {
    writeTestState(tmpDir);

    // Modify variables.yaml
    const varsPath = path.join(tmpDir, 'variables.yaml');
    const content = fs.readFileSync(varsPath, 'utf-8');
    fs.writeFileSync(varsPath, content + '\n- variableId: var-2\n  name: lives\n  initialValue: 3\n  lifetime: card\n');

    const changes = detectChanges(tmpDir);
    expect(changes!.hasChanges).toBe(true);
  });

  it('detects changed sceneProperties in card.yaml', () => {
    writeTestState(tmpDir);

    // Write a card.yaml with sceneProperties
    const cardYamlPath = path.join(tmpDir, 'card.yaml');
    fs.writeFileSync(cardYamlPath, yaml.stringify({
      cardId: 'card-456',
      sceneProperties: { backgroundColor: { r: 1, g: 0, b: 0, a: 1 } },
    }, { lineWidth: 120 }));

    const changes = detectChanges(tmpDir);
    expect(changes!.hasChanges).toBe(true);
  });
});

describe('writeStateInternal', () => {
  let tmpDir: string;

  beforeEach(async () => {
    await initMetadata();
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes .draw.json companion file when drawing data is present', async () => {
    const state: StateInternalMessage = {
      type: 'state_internal',
      deckId: 'deck-1',
      cardId: 'card-1',
      cliSessionId: 'sess-1',
      blueprints: {
        'e1': {
          entryType: 'actorBlueprint',
          title: 'Test',
          actorBlueprint: {
            components: {
              Body: { widthScale: 0.3, heightScale: 0.3 },
              Drawing2: {
                initialFrame: 1,
                drawData: { framesBounds: [{ minX: 0, maxX: 100, minY: 0, maxY: 100 }] },
                physicsBodyData: { shapes: [] },
                hash: 'abc123',
              },
            },
          },
        } as any,
      },
      actors: {},
      variables: [],
    } as any;

    await writeStateInternal(tmpDir, state);

    const bpDir = path.join(tmpDir, 'blueprints');

    // Blueprint YAML must exist (without drawData)
    const yamlPath = path.join(bpDir, 'test.yaml');
    expect(fs.existsSync(yamlPath)).toBe(true);
    const bpData = yaml.parse(fs.readFileSync(yamlPath, 'utf-8'));
    expect(bpData.components?.Drawing?.drawData).toBeUndefined();

    // Companion .draw.json must exist with drawing data
    const drawPath = path.join(bpDir, 'test.draw.json');
    expect(fs.existsSync(drawPath)).toBe(true);
    const drawData = JSON.parse(fs.readFileSync(drawPath, 'utf-8'));
    expect(drawData.Drawing2.drawData).toBeDefined();
    expect(drawData.Drawing2.physicsBodyData).toBeDefined();
    expect(drawData.Drawing2.hash).toBe('abc123');
  });

  it('cleans up stale .draw.json files when blueprint is removed', async () => {
    // First write with two blueprints
    const state1: any = {
      type: 'state_internal',
      deckId: 'deck-1',
      cardId: 'card-1',
      cliSessionId: 'sess-1',
      blueprints: {
        'e1': {
          entryType: 'actorBlueprint',
          title: 'Alpha',
          actorBlueprint: {
            components: {
              Body: { widthScale: 0.3 },
              Drawing2: { drawData: { x: 1 }, hash: 'h1' },
            },
          },
        },
        'e2': {
          entryType: 'actorBlueprint',
          title: 'Beta',
          actorBlueprint: {
            components: {
              Body: { widthScale: 0.3 },
              Drawing2: { drawData: { x: 2 }, hash: 'h2' },
            },
          },
        },
      },
      actors: {},
      variables: [],
    };
    await writeStateInternal(tmpDir, state1);

    const bpDir = path.join(tmpDir, 'blueprints');
    expect(fs.existsSync(path.join(bpDir, 'alpha.draw.json'))).toBe(true);
    expect(fs.existsSync(path.join(bpDir, 'beta.draw.json'))).toBe(true);

    // Second write with only Alpha — Beta should be cleaned up
    const state2: any = { ...state1, blueprints: { 'e1': state1.blueprints['e1'] } };
    await writeStateInternal(tmpDir, state2);

    expect(fs.existsSync(path.join(bpDir, 'alpha.draw.json'))).toBe(true);
    expect(fs.existsSync(path.join(bpDir, 'beta.draw.json'))).toBe(false);
  });

  it('writes sceneProperties to card.yaml', async () => {
    const state: StateInternalMessage = {
      type: 'state_internal',
      deckId: 'deck-1',
      cardId: 'card-1',
      cliSessionId: 'sess-1',
      blueprints: {},
      actors: {},
      variables: [],
      sceneProperties: { backgroundColor: { r: 1, g: 0, b: 0, a: 1 }, clock: { tempo: 120 } },
      actorBlueprintInherit: true,
      linkTargetDeckIds: ['deck-abc'],
    };

    await writeStateInternal(tmpDir, state);

    const cardYamlPath = path.join(tmpDir, 'card.yaml');
    expect(fs.existsSync(cardYamlPath)).toBe(true);
    const cardData = yaml.parse(fs.readFileSync(cardYamlPath, 'utf-8'));
    expect(cardData.sceneProperties).toEqual({ backgroundColor: { r: 1, g: 0, b: 0, a: 1 }, clock: { tempo: 120 } });
    expect(cardData.actorBlueprintInherit).toBe(true);
    expect(cardData.linkTargetDeckIds).toEqual(['deck-abc']);
  });

  it('sceneProperties round-trips through newSceneDataForCardAsync', async () => {
    // Create a minimal deck.yaml so newSceneDataForCardAsync can find deckId
    const deckDir = path.join(tmpDir, '..');
    fs.writeFileSync(path.join(tmpDir, 'deck.yaml'), yaml.stringify({ deckId: 'deck-1' }));

    const state: StateInternalMessage = {
      type: 'state_internal',
      deckId: 'deck-1',
      cardId: 'card-1',
      cliSessionId: 'sess-1',
      blueprints: {},
      actors: {},
      variables: [],
      sceneProperties: { backgroundColor: { r: 0, g: 0, b: 1, a: 1 }, clock: { tempo: 90 } },
      actorBlueprintInherit: true,
      linkTargetDeckIds: ['deck-xyz'],
    };

    await writeStateInternal(tmpDir, state);

    const { sceneData } = await newSceneDataForCardAsync({
      cardId: 'card-1',
      cardDir: tmpDir,
      deckDir: tmpDir,
    });

    expect(sceneData.snapshot.sceneProperties).toEqual({ backgroundColor: { r: 0, g: 0, b: 1, a: 1 }, clock: { tempo: 90 } });
    expect(sceneData.snapshot.actorBlueprintInherit).toBe(true);
    expect(sceneData.snapshot.linkTargetDeckIds).toEqual(['deck-xyz']);
  });

  it('preserves existing .draw.json when draw data absent but hash present', async () => {
    // First write: full state with draw data
    const stateWithDraw: any = {
      type: 'state_internal',
      deckId: 'deck-1',
      cardId: 'card-1',
      cliSessionId: 'sess-1',
      blueprints: {
        'e1': {
          entryType: 'actorBlueprint',
          title: 'Sprite',
          actorBlueprint: {
            components: {
              Drawing2: {
                initialFrame: 1,
                drawData: { framesBounds: [{ minX: 0, maxX: 50, minY: 0, maxY: 50 }] },
                physicsBodyData: { shapes: [] },
                hash: 'hash-xyz',
              },
            },
          },
        },
      },
      actors: {},
      variables: [],
    };
    await writeStateInternal(tmpDir, stateWithDraw);

    const bpDir = path.join(tmpDir, 'blueprints');
    const drawPath = path.join(bpDir, 'sprite.draw.json');
    expect(fs.existsSync(drawPath)).toBe(true);
    const originalDraw = fs.readFileSync(drawPath, 'utf-8');

    // Second write: same hash, draw data omitted (mobile skipped sending blobs)
    const stateWithoutDrawData: any = {
      ...stateWithDraw,
      blueprints: {
        'e1': {
          ...stateWithDraw.blueprints['e1'],
          actorBlueprint: {
            components: {
              Drawing2: {
                initialFrame: 1,
                hash: 'hash-xyz',
                // drawData and physicsBodyData intentionally absent
              },
            },
          },
        },
      },
    };
    await writeStateInternal(tmpDir, stateWithoutDrawData);

    // .draw.json must be unchanged (preserved)
    expect(fs.existsSync(drawPath)).toBe(true);
    expect(fs.readFileSync(drawPath, 'utf-8')).toBe(originalDraw);
  });

  it('cleans up stale .preview.png files when blueprint is removed', async () => {
    // First write: two blueprints
    const state1: any = {
      type: 'state_internal',
      deckId: 'deck-1',
      cardId: 'card-1',
      cliSessionId: 'sess-1',
      blueprints: {
        'e1': {
          entryType: 'actorBlueprint',
          title: 'Alpha',
          actorBlueprint: { components: { Body: { widthScale: 0.3 } } },
        },
        'e2': {
          entryType: 'actorBlueprint',
          title: 'Beta',
          actorBlueprint: { components: { Body: { widthScale: 0.3 } } },
        },
      },
      actors: {},
      variables: [],
    };
    await writeStateInternal(tmpDir, state1);

    const bpDir = path.join(tmpDir, 'blueprints');

    // Manually place .preview.png files (simulating generated previews)
    fs.writeFileSync(path.join(bpDir, 'alpha.preview.png'), 'fake-png-alpha');
    fs.writeFileSync(path.join(bpDir, 'beta.preview.png'), 'fake-png-beta');

    // Second write: only Alpha — Beta should be cleaned up (including its .preview.png)
    const state2: any = { ...state1, blueprints: { 'e1': state1.blueprints['e1'] } };
    await writeStateInternal(tmpDir, state2);

    expect(fs.existsSync(path.join(bpDir, 'alpha.preview.png'))).toBe(true);
    expect(fs.existsSync(path.join(bpDir, 'beta.preview.png'))).toBe(false);
  });

  it('writes new .draw.json when draw hash changes', async () => {
    // First write
    const state1: any = {
      type: 'state_internal',
      deckId: 'deck-1',
      cardId: 'card-1',
      cliSessionId: 'sess-1',
      blueprints: {
        'e1': {
          entryType: 'actorBlueprint',
          title: 'Shape',
          actorBlueprint: {
            components: {
              Drawing2: {
                drawData: { framesBounds: [{ minX: 0, maxX: 10, minY: 0, maxY: 10 }] },
                hash: 'hash-v1',
              },
            },
          },
        },
      },
      actors: {},
      variables: [],
    };
    await writeStateInternal(tmpDir, state1);

    const drawPath = path.join(tmpDir, 'blueprints', 'shape.draw.json');
    const data1 = JSON.parse(fs.readFileSync(drawPath, 'utf-8'));
    expect(data1.Drawing2.hash).toBe('hash-v1');

    // Second write: different hash, new draw data included
    const state2: any = {
      ...state1,
      blueprints: {
        'e1': {
          ...state1.blueprints['e1'],
          actorBlueprint: {
            components: {
              Drawing2: {
                drawData: { framesBounds: [{ minX: 0, maxX: 20, minY: 0, maxY: 20 }] },
                hash: 'hash-v2',
              },
            },
          },
        },
      },
    };
    await writeStateInternal(tmpDir, state2);

    const data2 = JSON.parse(fs.readFileSync(drawPath, 'utf-8'));
    expect(data2.Drawing2.hash).toBe('hash-v2');
    expect(data2.Drawing2.drawData.framesBounds[0].maxX).toBe(20);
  });
});

describe('detectChanges — .draw.json detection', () => {
  let tmpDir: string;

  beforeEach(async () => {
    await initMetadata();
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects .draw.json changes and includes drawing data', async () => {
    // Write initial state so meta.json and blueprints exist
    const state: any = {
      type: 'state_internal',
      deckId: 'deck-1',
      cardId: 'card-1',
      cliSessionId: 'sess-1',
      blueprints: {
        'e1': {
          entryType: 'actorBlueprint',
          title: 'Tile',
          actorBlueprint: {
            components: {
              Drawing2: {
                drawData: { framesBounds: [{ minX: 0, maxX: 5, minY: 0, maxY: 5 }] },
                hash: 'hash-initial',
              },
            },
          },
        },
      },
      actors: {},
      variables: [],
    };
    await writeStateInternal(tmpDir, state);
    updateMetaHashes(tmpDir);

    // Now modify the .draw.json file directly (simulating user editing the draw data)
    const drawPath = path.join(tmpDir, 'blueprints', 'tile.draw.json');
    const updatedDraw = {
      Drawing2: {
        drawData: { framesBounds: [{ minX: 0, maxX: 99, minY: 0, maxY: 99 }] },
        hash: 'hash-updated',
      },
    };
    fs.writeFileSync(drawPath, JSON.stringify(updatedDraw, null, 2));

    const changes = detectChanges(tmpDir);
    expect(changes).not.toBeNull();
    expect(changes!.hasChanges).toBe(true);
    expect(Object.keys(changes!.changedBlueprints)).toContain('e1');
    const bp = changes!.changedBlueprints['e1'];
    expect(bp.drawing).toBeDefined();
    expect(bp.drawing.Drawing2.hash).toBe('hash-updated');
  });
});

