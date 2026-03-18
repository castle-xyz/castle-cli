import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'yaml';
import { writeActorsAndVariablesAsync, newSceneDataForCardAsync, getCacheDir } from '../src/utils/decks.js';
import { initMetadata } from '../src/utils/init.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'castle-test-decks-'));
}

function makeSceneData(overrides: any = {}) {
  return {
    snapshot: {
      library: {
        'entry-001': {
          entryType: 'actorBlueprint',
          title: 'Player',
          actorBlueprint: {
            components: {
              Body: { widthScale: 0.5, heightScale: 0.5 },
              Drawing2: { initialFrame: 1, drawData: { framesBounds: [{ minX: 0, maxX: 100, minY: 0, maxY: 100 }] } },
            },
          },
        },
      },
      actors: [
        {
          actorId: '123',
          parentEntryId: 'entry-001',
          bp: {
            components: {
              Body: {
                x: 10,
                y: 20,
                angle: 0.785,
                widthScale: 0.5,
                heightScale: 0.5,
              },
              Drawing2: { initialFrame: 1 },
            },
          },
        },
      ],
    },
    ...overrides,
  };
}

describe('writeActorsAndVariablesAsync', () => {
  let deckDir: string;
  let cardDir: string;

  beforeEach(() => {
    deckDir = makeTempDir();
    cardDir = path.join(deckDir, 'card-456');
    fs.mkdirSync(cardDir, { recursive: true });
    // Create blueprints dir with a blueprint file so meta can include it
    fs.mkdirSync(path.join(cardDir, 'blueprints'));
    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Player.yaml'),
      yaml.stringify({ title: 'Player', entryId: 'entry-001', components: {} })
    );
  });

  afterEach(() => {
    fs.rmSync(deckDir, { recursive: true, force: true });
  });

  it('writes actors.yaml in object format with a-prefixed keys', async () => {
    const sceneData = makeSceneData();
    const library = sceneData.snapshot.library;

    // Write deck.yaml
    fs.writeFileSync(path.join(deckDir, 'deck.yaml'), yaml.stringify({ deckId: 'deck-123' }));

    await writeActorsAndVariablesAsync({
      sceneData,
      cardDir,
      library,
      deckId: 'deck-123',
      cardId: '456',
    });

    const actorsPath = path.join(cardDir, 'actors.yaml');
    expect(fs.existsSync(actorsPath)).toBe(true);

    const actorsObj = yaml.parse(fs.readFileSync(actorsPath, 'utf-8'));
    expect(actorsObj).toBeDefined();

    // Should have a key like "a123"
    expect(actorsObj['a123']).toBeDefined();
    expect(actorsObj['a123'].entryId).toBe('entry-001');
    expect(actorsObj['a123'].x).toBe(10);
    expect(actorsObj['a123'].y).toBe(20);
    // Raw radians angle (no degree conversion)
    expect(actorsObj['a123'].angle).toBe(0.785);
    // Raw scales (no pixel conversion)
    expect(actorsObj['a123'].widthScale).toBe(0.5);
    expect(actorsObj['a123'].heightScale).toBe(0.5);
  });

  it('writes variables.yaml as empty array', async () => {
    const sceneData = makeSceneData();
    const library = sceneData.snapshot.library;

    await writeActorsAndVariablesAsync({
      sceneData,
      cardDir,
      library,
      deckId: 'deck-123',
      cardId: '456',
    });

    const varsPath = path.join(cardDir, 'variables.yaml');
    expect(fs.existsSync(varsPath)).toBe(true);

    const vars = yaml.parse(fs.readFileSync(varsPath, 'utf-8'));
    expect(Array.isArray(vars)).toBe(true);
    expect(vars.length).toBe(0);
  });

  it('writes meta.json with correct structure', async () => {
    const sceneData = makeSceneData();
    const library = sceneData.snapshot.library;

    await writeActorsAndVariablesAsync({
      sceneData,
      cardDir,
      library,
      deckId: 'deck-123',
      cardId: '456',
    });

    const metaPath = path.join(cardDir, '.castle', 'meta.json');
    expect(fs.existsSync(metaPath)).toBe(true);

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    expect(meta.deckId).toBe('deck-123');
    expect(meta.cardId).toBe('456');
    expect(meta.hashes['actors.yaml']).toBeDefined();
    expect(meta.hashes['variables.yaml']).toBeDefined();
    expect(meta.blueprintIdMap['Player']).toBe('entry-001');
  });
});

describe('newSceneDataForCardAsync', () => {
  let deckDir: string;
  let cardDir: string;

  beforeEach(async () => {
    await initMetadata();
    deckDir = makeTempDir();
    cardDir = path.join(deckDir, 'card-456');
    fs.mkdirSync(cardDir, { recursive: true });

    // Create cache
    const cacheDir = getCacheDir(deckDir);
    const sceneData = makeSceneData();
    fs.writeFileSync(path.join(cacheDir, '456.json'), JSON.stringify(sceneData, null, 2));

    // Create blueprint file
    fs.mkdirSync(path.join(cardDir, 'blueprints'));
    const bpData = {
      title: 'Player',
      entryId: 'entry-001',
      components: {
        Body: { widthScale: 0.5, heightScale: 0.5 },
        Drawing2: { initialFrame: 1 },
      },
    };
    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Player.yaml'),
      yaml.stringify(bpData)
    );

    // Create actors.yaml in object format
    const actorsObj = {
      a123: {
        title: 'Player',
        entryId: 'entry-001',
        x: 10,
        y: 20,
        angle: 0.785,
        widthScale: 0.5,
        heightScale: 0.5,
      },
    };
    fs.writeFileSync(path.join(cardDir, 'actors.yaml'), yaml.stringify(actorsObj));
  });

  afterEach(() => {
    fs.rmSync(deckDir, { recursive: true, force: true });
  });

  it('reads actors.yaml and returns scene data', async () => {
    const result = await newSceneDataForCardAsync({
      cardId: '456',
      cardDir,
      deckDir,
    });

    expect(result.sceneData).toBeDefined();
    expect(result.sceneData.snapshot.actors).toBeDefined();
    expect(Array.isArray(result.sceneData.snapshot.actors)).toBe(true);
  });

  it('converts actors.yaml object to internal actor format with raw values', async () => {
    const result = await newSceneDataForCardAsync({
      cardId: '456',
      cardDir,
      deckDir,
    });

    const actors = result.sceneData.snapshot.actors;
    expect(actors.length).toBeGreaterThan(0);

    const actor = actors[0];
    expect(actor.actorId).toBe('123');
    expect(actor.parentEntryId).toBe('entry-001');
    expect(actor.bp.components.Body.x).toBe(10);
    expect(actor.bp.components.Body.y).toBe(20);
    // Raw radians — no conversion to degrees
    expect(actor.bp.components.Body.angle).toBe(0.785);
    // Raw scales — no pixel conversion
    expect(actor.bp.components.Body.widthScale).toBe(0.5);
    expect(actor.bp.components.Body.heightScale).toBe(0.5);
  });
});
