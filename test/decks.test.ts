import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'yaml';
import { writeActorsAndVariablesAsync, newSceneDataForCardAsync, getCacheDir } from '../src/utils/decks.js';
import { initMetadata } from '../src/utils/init.js';
import * as Behaviors from '../src/utils/behaviors.js';

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

  it('writes actors.yaml in nested display-name format with a-prefixed keys', async () => {
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

    // New nested format: components.Layout.*
    expect(actorsObj['a123'].components).toBeDefined();
    expect(actorsObj['a123'].components.Layout).toBeDefined();
    expect(actorsObj['a123'].components.Layout.x).toBe(10);
    expect(actorsObj['a123'].components.Layout.y).toBe(20);
    // Raw radians angle (no degree conversion)
    expect(actorsObj['a123'].components.Layout.angle).toBe(0.785);
    // widthScale ×10 (external format)
    expect(actorsObj['a123'].components.Layout.widthScale).toBe(5.0);
    expect(actorsObj['a123'].components.Layout.heightScale).toBe(5.0);
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

    // Create blueprint file in external format (widthScale ×10)
    fs.mkdirSync(path.join(cardDir, 'blueprints'));
    const bpData = {
      title: 'Player',
      entryId: 'entry-001',
      components: {
        Body: { widthScale: 5.0, heightScale: 5.0 }, // external format (×10)
        Drawing2: { initialFrame: 1 },
      },
    };
    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Player.yaml'),
      yaml.stringify(bpData)
    );

    // Create actors.yaml in new nested display-name format (widthScale ×10)
    const actorsObj = {
      a123: {
        entryId: 'entry-001',
        components: {
          Layout: { x: 10, y: 20, angle: 0.785, widthScale: 5.0, heightScale: 5.0 },
        },
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

  it('converts actors.yaml Layout components to internal Body format via applySnapshot', async () => {
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
    // applySnapshot converts external ×10 → internal ÷10
    expect(actor.bp.components.Body.widthScale).toBeCloseTo(0.5);
    expect(actor.bp.components.Body.heightScale).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// Round-trip tests: verify that serialize (clone) → deserialize (serve) is
// stable — complex data is preserved and scalar props round-trip correctly.
// ---------------------------------------------------------------------------
describe('newSceneDataForCardAsync round-trip', () => {
  let deckDir: string;
  let cardDir: string;

  beforeEach(async () => {
    await initMetadata();
    deckDir = fs.mkdtempSync(path.join(os.tmpdir(), 'castle-rt-'));
    cardDir = path.join(deckDir, 'card-rt');
    fs.mkdirSync(cardDir, { recursive: true });
    fs.mkdirSync(path.join(cardDir, 'blueprints'));
  });

  afterEach(() => {
    fs.rmSync(deckDir, { recursive: true, force: true });
  });

  function writeCacheAndActors(sceneData: any) {
    const cacheDir = getCacheDir(deckDir);
    fs.writeFileSync(path.join(cacheDir, 'rt.json'), JSON.stringify(sceneData));
    // Write actors.yaml in new nested format (widthScale ×10)
    const actorsObj = { a1: { entryId: 'e1', components: { Layout: { x: 0, y: 0, widthScale: 3.0, heightScale: 3.0 } } } };
    fs.writeFileSync(path.join(cardDir, 'actors.yaml'), yaml.stringify(actorsObj));
  }

  it('preserves Drawing2.hash from cached scene when blueprint omits it', async () => {
    const sceneData = {
      snapshot: {
        library: {
          e1: {
            entryType: 'actorBlueprint',
            title: 'Test',
            actorBlueprint: {
              components: {
                Body: { widthScale: 0.3, heightScale: 0.3 },
                Drawing2: { initialFrame: 1, hash: 'original-hash-xyz', drawData: 'big-data-blob' },
              },
            },
          },
        },
        actors: [{ actorId: '1', parentEntryId: 'e1', bp: { components: { Body: { x: 0, y: 0, widthScale: 0.3, heightScale: 0.3 } } } }],
      },
    };
    writeCacheAndActors(sceneData);

    // Blueprint YAML has no hash/drawData — simulates what a user-edited blueprint looks like
    // Values in external format (widthScale ×10)
    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({
        title: 'Test',
        entryId: 'e1',
        components: {
          Body: { widthScale: 3.0, heightScale: 3.0 }, // external format (×10)
          Drawing2: { initialFrame: 1 },
        },
      })
    );

    const result = await newSceneDataForCardAsync({ cardId: 'rt', cardDir, deckDir });
    const components = result.sceneData.snapshot.library['e1'].actorBlueprint.components;

    // hash and drawData must be preserved from the cached scene data
    expect(components.Drawing2.hash).toBe('original-hash-xyz');
    expect(components.Drawing2.drawData).toBe('big-data-blob');
  });

  it('round-trips Body.widthScale: blueprint stores external format (×10), serve converts back', async () => {
    const sceneData = {
      snapshot: {
        library: {
          e1: {
            entryType: 'actorBlueprint',
            title: 'Test',
            actorBlueprint: {
              components: {
                Body: { widthScale: 0.3, heightScale: 0.2 },
              },
            },
          },
        },
        actors: [{ actorId: '1', parentEntryId: 'e1', bp: { components: { Body: { x: 0, y: 0, widthScale: 0.3, heightScale: 0.2 } } } }],
      },
    };
    writeCacheAndActors(sceneData);

    // Blueprint YAML stores values in external format (×10)
    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({
        title: 'Test',
        entryId: 'e1',
        components: {
          Body: { widthScale: 3.0, heightScale: 2.0 }, // external format (×10)
        },
      })
    );

    const result = await newSceneDataForCardAsync({ cardId: 'rt', cardDir, deckDir });
    const body = result.sceneData.snapshot.library['e1'].actorBlueprint.components.Body;

    // Must be back in internal format (÷10)
    expect(body.widthScale).toBeCloseTo(0.3);
    expect(body.heightScale).toBeCloseTo(0.2);
  });

  it('preserves Body.visible as true when blueprint sets it to true', async () => {
    const sceneData = {
      snapshot: {
        library: {
          e1: {
            entryType: 'actorBlueprint',
            title: 'Test',
            actorBlueprint: {
              components: {
                Body: { widthScale: 0.3, heightScale: 0.3, visible: true },
              },
            },
          },
        },
        actors: [{ actorId: '1', parentEntryId: 'e1', bp: { components: { Body: { x: 0, y: 0, widthScale: 0.3, heightScale: 0.3 } } } }],
      },
    };
    writeCacheAndActors(sceneData);

    // Blueprint YAML has visible: true (correct bool)
    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({
        title: 'Test',
        entryId: 'e1',
        components: {
          Body: { widthScale: 3.0, heightScale: 3.0, visible: true },
        },
      })
    );

    const result = await newSceneDataForCardAsync({ cardId: 'rt', cardDir, deckDir });
    const body = result.sceneData.snapshot.library['e1'].actorBlueprint.components.Body;

    // visible must be true
    expect(body.visible).toBe(true);
  });

  it('preserves Rules.rules from local blueprint file — not dropped by WASM', async () => {
    // Minimal serialized rules in the format serializeRule produces
    const serializedRules = [
      { trigger: { type: 'create' }, responses: [{ type: 'log', behavior: 'Log', params: { text: 'hello' } }] },
    ];

    const sceneData = {
      snapshot: {
        library: {
          e1: {
            entryType: 'actorBlueprint',
            title: 'Test',
            actorBlueprint: {
              components: {
                Body: { widthScale: 0.3, heightScale: 0.3 },
                Rules: { rules: [] }, // server rules (empty — local file overrides)
              },
            },
          },
        },
        actors: [{ actorId: '1', parentEntryId: 'e1', bp: { components: { Body: { x: 0, y: 0, widthScale: 0.3, heightScale: 0.3 } } } }],
      },
    };
    writeCacheAndActors(sceneData);

    // Write rules.yaml file
    const rulesFile = path.join(cardDir, 'blueprints', 'Test_rules.yaml');
    fs.writeFileSync(rulesFile, yaml.stringify(serializedRules));

    // Blueprint YAML points at the rules file
    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({
        title: 'Test',
        entryId: 'e1',
        components: {
          Body: { widthScale: 3.0, heightScale: 3.0 },
          Rules: { file: 'Test_rules.yaml' },
        },
      })
    );

    const result = await newSceneDataForCardAsync({ cardId: 'rt', cardDir, deckDir });
    const rulesComp = result.sceneData.snapshot.library['e1'].actorBlueprint.components.Rules;

    // Rules must not be dropped — the three-way merge must restore them from local blueprint
    expect(rulesComp).toBeDefined();
    expect(rulesComp.rules).toBeDefined();
    expect(Array.isArray(rulesComp.rules)).toBe(true);
    expect(rulesComp.rules.length).toBeGreaterThan(0);
  });
});
