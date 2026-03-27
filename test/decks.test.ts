import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'yaml';
import { writeActorsAndVariablesAsync, newSceneDataForCardAsync } from '../src/utils/decks.js';
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
      path.join(cardDir, 'blueprints', 'player.yaml'),
      yaml.stringify({ title: 'Player', entryId: 'entry-001', components: {} })
    );
  });

  afterEach(() => {
    fs.rmSync(deckDir, { recursive: true, force: true });
  });

  it('writes actors.yaml in flat format with title and degrees', async () => {
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

    const actorsList: any[] = yaml.parse(fs.readFileSync(actorsPath, 'utf-8'));
    expect(actorsList).toBeDefined();
    expect(Array.isArray(actorsList)).toBe(true);

    // Should have an entry with actorId '123'
    const actor123 = actorsList.find(a => String(a.actorId) === '123');
    expect(actor123).toBeDefined();
    // Flat format: title instead of entryId
    expect(actor123.title).toBe('Player');
    expect(actor123.entryId).toBeUndefined();
    expect(actor123.components).toBeUndefined();

    // Flat properties
    expect(actor123.x).toBe(10);
    expect(actor123.y).toBe(20);
    // Angle converted from radians (0.785) to degrees (~44.97)
    expect(actor123.angle).toBeCloseTo(44.97, 1);
    // widthScale ×10 (external format)
    expect(actor123.widthScale).toBe(5.0);
    expect(actor123.heightScale).toBe(5.0);
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
    expect(meta.blueprintIdMap['player']).toBe('entry-001');
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

    // Create blueprint file in external format (widthScale ×10)
    fs.mkdirSync(path.join(cardDir, 'blueprints'));
    const bpData = {
      title: 'Player',
      entryId: 'entry-001',
      components: {
        Layout: { widthScale: 5.0, heightScale: 5.0 }, // external format (×10)
        Drawing: { initialFrame: 1 },
      },
    };
    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'player.yaml'),
      yaml.stringify(bpData)
    );

    // Write companion .draw.json with drawing data
    const drawData = {
      Drawing2: { drawData: { framesBounds: [{ minX: 0, maxX: 100, minY: 0, maxY: 100 }] } },
    };
    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'player.draw.json'),
      JSON.stringify(drawData, null, 2)
    );

    // Create actors.yaml in list format (actorId, title, degrees, ×10 widthScale)
    const actorsList = [
      {
        actorId: '123',
        title: 'Player',
        x: 10,
        y: 20,
        angle: 44.97, // 0.785 rad * (180/π) ≈ 44.97°
        widthScale: 5.0,
        heightScale: 5.0,
      },
    ];
    fs.writeFileSync(path.join(cardDir, 'actors.yaml'), yaml.stringify(actorsList));
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
    // applySnapshot converts degrees → radians: 44.97° → ~0.785 rad
    expect(actor.bp.components.Body.angle).toBeCloseTo(0.785, 2);
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

  function writeActors() {
    // Write actors.yaml in list format (actorId, title, degrees, ×10 widthScale)
    const actorsList = [{ actorId: '1', title: 'Test', x: 0, y: 0, widthScale: 3.0, heightScale: 3.0 }];
    fs.writeFileSync(path.join(cardDir, 'actors.yaml'), yaml.stringify(actorsList));
  }

  it('preserves Drawing2.hash from draw.json companion file when blueprint omits it', async () => {
    // Write blueprint YAML — no hash/drawData (simulates what a user-edited blueprint looks like)
    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({
        title: 'Test',
        entryId: 'e1',
        components: {
          Layout: { widthScale: 3.0, heightScale: 3.0 }, // external format (×10)
          Drawing: { initialFrame: 1 },
        },
      })
    );

    // Write companion .draw.json with hash and drawData
    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.draw.json'),
      JSON.stringify({ Drawing2: { hash: 'original-hash-xyz', drawData: 'big-data-blob' } })
    );

    writeActors();

    const result = await newSceneDataForCardAsync({ cardId: 'rt', cardDir, deckDir });
    const components = result.sceneData.snapshot.library['e1'].actorBlueprint.components;

    // hash and drawData must be preserved from the .draw.json companion file
    expect(components.Drawing2.hash).toBe('original-hash-xyz');
    expect(components.Drawing2.drawData).toBe('big-data-blob');
  });

  it('round-trips Body.widthScale: blueprint stores external format (×10), serve converts back', async () => {
    // Blueprint YAML stores values in external format (×10)
    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({
        title: 'Test',
        entryId: 'e1',
        components: {
          Layout: { widthScale: 3.0, heightScale: 2.0 }, // external format (×10)
        },
      })
    );
    writeActors();

    const result = await newSceneDataForCardAsync({ cardId: 'rt', cardDir, deckDir });
    const body = result.sceneData.snapshot.library['e1'].actorBlueprint.components.Body;

    // Must be back in internal format (÷10)
    expect(body.widthScale).toBeCloseTo(0.3);
    expect(body.heightScale).toBeCloseTo(0.2);
  });

  it('preserves Body.visible as true when blueprint sets it to true', async () => {
    // Blueprint YAML has visible: true (correct bool)
    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({
        title: 'Test',
        entryId: 'e1',
        components: {
          Layout: { widthScale: 3.0, heightScale: 3.0, visible: true },
        },
      })
    );
    writeActors();

    const result = await newSceneDataForCardAsync({ cardId: 'rt', cardDir, deckDir });
    const body = result.sceneData.snapshot.library['e1'].actorBlueprint.components.Body;

    // visible must be true
    expect(body.visible).toBe(true);
  });

  it('preserves Rules.rules from local blueprint file — not dropped by WASM', async () => {
    // Minimal serialized rules in the inline format (rule-0, rule-1 keys, name/behaviorName)
    const inlineRules = {
      'rule-0': {
        trigger: { name: 'create', behaviorName: 'Rules' },
        responses: [{ name: 'log', behaviorName: 'Log', params: { text: 'hello' } }],
      },
    };

    // Blueprint YAML with inline rules (new format)
    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({
        title: 'Test',
        entryId: 'e1',
        components: {
          Layout: { widthScale: 3.0, heightScale: 3.0 },
          Rules: { rules: inlineRules },
        },
      })
    );
    writeActors();

    const result = await newSceneDataForCardAsync({ cardId: 'rt', cardDir, deckDir });
    const rulesComp = result.sceneData.snapshot.library['e1'].actorBlueprint.components.Rules;

    // Rules must not be dropped — the three-way merge must restore them from local blueprint
    expect(rulesComp).toBeDefined();
    expect(rulesComp.rules).toBeDefined();
    expect(Array.isArray(rulesComp.rules)).toBe(true);
    expect(rulesComp.rules.length).toBeGreaterThan(0);
  });

  it('round-trips angle: stores degrees in actors.yaml, applySnapshot converts to radians', async () => {
    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({ title: 'Test', entryId: 'e1', components: { Layout: { widthScale: 3.0 } } })
    );

    // actors.yaml stores angle in degrees (~44.97°)
    const actorsList = [{ actorId: '1', title: 'Test', x: 5, y: 3, angle: 44.97, widthScale: 3.0 }];
    fs.writeFileSync(path.join(cardDir, 'actors.yaml'), yaml.stringify(actorsList));

    const result = await newSceneDataForCardAsync({ cardId: 'rt', cardDir, deckDir });
    const actor = result.sceneData.snapshot.actors.find((a: any) => String(a.actorId) === '1');
    expect(actor).toBeDefined();
    expect(actor.bp.components.Body.x).toBe(5);
    expect(actor.bp.components.Body.y).toBe(3);
    // applySnapshot converts degrees → radians: 44.97° → ~0.785 rad
    expect(actor.bp.components.Body.angle).toBeCloseTo(0.785, 2);
  });

  it('preserves Tags.tagsString from blueprint YAML through newSceneDataForCardAsync', async () => {
    writeActors();

    // Blueprint YAML has Tags with tagsString (as written by clone)
    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({
        title: 'Test',
        entryId: 'e1',
        components: {
          Layout: { widthScale: 3.0, heightScale: 3.0 },
          Tags: { tagsString: 'manager' },
        },
      })
    );

    const result = await newSceneDataForCardAsync({ cardId: 'rt', cardDir, deckDir });
    const tags = result.sceneData.snapshot.library['e1'].actorBlueprint.components.Tags;

    expect(tags).toBeDefined();
    expect(tags.tagsString).toBe('manager');
  });

  it('round-trips initialFrame: non-default value written to and read from actors.yaml', async () => {
    const sceneData = {
      snapshot: {
        library: {
          e1: {
            entryType: 'actorBlueprint',
            title: 'Test',
            actorBlueprint: { components: { Body: { widthScale: 0.3 }, Drawing2: { initialFrame: 1 } } },
          },
        },
        actors: [{ actorId: '1', parentEntryId: 'e1', bp: { components: { Body: { x: 0, y: 0, widthScale: 0.3 }, Drawing2: { initialFrame: 3 } } } }],
      },
    };

    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({ title: 'Test', entryId: 'e1', components: { Layout: { widthScale: 3.0 }, Drawing: { initialFrame: 1 } } })
    );

    // Write actors.yaml using the write path
    await (await import('../src/utils/decks.js')).writeActorsAndVariablesAsync({
      sceneData, cardDir, library: sceneData.snapshot.library, deckId: 'deck-1', cardId: 'rt',
    });

    // Verify initialFrame is written (non-default value 3 != 1)
    const actorsList: any[] = yaml.parse(fs.readFileSync(path.join(cardDir, 'actors.yaml'), 'utf-8'));
    expect(actorsList.find(a => String(a.actorId) === '1').initialFrame).toBe(3);

    // Verify round-trip read
    const result = await newSceneDataForCardAsync({ cardId: 'rt', cardDir, deckDir });
    const actor = result.sceneData.snapshot.actors.find((a: any) => String(a.actorId) === '1');
    expect(actor).toBeDefined();
    expect(actor.bp.components.Drawing2.initialFrame).toBe(3);
  });

  it('does NOT write initialFrame when it equals the default (1)', async () => {
    const sceneData = {
      snapshot: {
        library: {
          e1: {
            entryType: 'actorBlueprint',
            title: 'Test',
            actorBlueprint: { components: { Body: { widthScale: 0.3 }, Drawing2: { initialFrame: 1 } } },
          },
        },
        actors: [{ actorId: '1', parentEntryId: 'e1', bp: { components: { Body: { x: 0, y: 0, widthScale: 0.3 }, Drawing2: { initialFrame: 1 } } } }],
      },
    };

    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({ title: 'Test', entryId: 'e1', components: { Layout: { widthScale: 3.0 } } })
    );

    await (await import('../src/utils/decks.js')).writeActorsAndVariablesAsync({
      sceneData, cardDir, library: sceneData.snapshot.library, deckId: 'deck-1', cardId: 'rt',
    });

    const actorsList: any[] = yaml.parse(fs.readFileSync(path.join(cardDir, 'actors.yaml'), 'utf-8'));
    expect(actorsList.find(a => String(a.actorId) === '1').initialFrame).toBeUndefined();
  });

  it('round-trips fontSizeScale: non-default value written to and read from actors.yaml', async () => {
    const sceneData = {
      snapshot: {
        library: {
          e1: {
            entryType: 'actorBlueprint',
            title: 'Test',
            actorBlueprint: { components: { Body: { widthScale: 0.3 }, Text: { content: 'Hello' } } },
          },
        },
        actors: [{ actorId: '1', parentEntryId: 'e1', bp: { components: { Body: { x: 0, y: 0, widthScale: 0.3 }, Text: { fontSizeScale: 2.5 } } } }],
      },
    };

    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({ title: 'Test', entryId: 'e1', components: { Layout: { widthScale: 3.0 }, Text: { content: 'Hello' } } })
    );

    await (await import('../src/utils/decks.js')).writeActorsAndVariablesAsync({
      sceneData, cardDir, library: sceneData.snapshot.library, deckId: 'deck-1', cardId: 'rt',
    });

    const actorsList: any[] = yaml.parse(fs.readFileSync(path.join(cardDir, 'actors.yaml'), 'utf-8'));
    expect(actorsList.find(a => String(a.actorId) === '1').fontSizeScale).toBe(2.5);

    const result = await newSceneDataForCardAsync({ cardId: 'rt', cardDir, deckDir });
    const actor = result.sceneData.snapshot.actors.find((a: any) => String(a.actorId) === '1');
    expect(actor).toBeDefined();
    expect(actor.bp.components.Text.fontSizeScale).toBe(2.5);
  });

  it('does NOT write fontSizeScale when it equals the default (1)', async () => {
    const sceneData = {
      snapshot: {
        library: {
          e1: {
            entryType: 'actorBlueprint',
            title: 'Test',
            actorBlueprint: { components: { Body: { widthScale: 0.3 } } },
          },
        },
        actors: [{ actorId: '1', parentEntryId: 'e1', bp: { components: { Body: { x: 0, y: 0, widthScale: 0.3 }, Text: { fontSizeScale: 1 } } } }],
      },
    };

    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({ title: 'Test', entryId: 'e1', components: { Layout: { widthScale: 3.0 } } })
    );

    await (await import('../src/utils/decks.js')).writeActorsAndVariablesAsync({
      sceneData, cardDir, library: sceneData.snapshot.library, deckId: 'deck-1', cardId: 'rt',
    });

    const actorsList: any[] = yaml.parse(fs.readFileSync(path.join(cardDir, 'actors.yaml'), 'utf-8'));
    expect(actorsList.find(a => String(a.actorId) === '1').fontSizeScale).toBeUndefined();
  });

  it('round-trips content: differs from blueprint default, written to and read from actors.yaml', async () => {
    const sceneData = {
      snapshot: {
        library: {
          e1: {
            entryType: 'actorBlueprint',
            title: 'Test',
            actorBlueprint: { components: { Body: { widthScale: 0.3 }, Text: { content: 'Default text' } } },
          },
        },
        actors: [{ actorId: '1', parentEntryId: 'e1', bp: { components: { Body: { x: 0, y: 0, widthScale: 0.3 }, Text: { content: 'Custom text' } } } }],
      },
    };

    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({ title: 'Test', entryId: 'e1', components: { Layout: { widthScale: 3.0 }, Text: { content: 'Default text' } } })
    );

    await (await import('../src/utils/decks.js')).writeActorsAndVariablesAsync({
      sceneData, cardDir, library: sceneData.snapshot.library, deckId: 'deck-1', cardId: 'rt',
    });

    const actorsList: any[] = yaml.parse(fs.readFileSync(path.join(cardDir, 'actors.yaml'), 'utf-8'));
    expect(actorsList.find(a => String(a.actorId) === '1').content).toBe('Custom text');

    const result = await newSceneDataForCardAsync({ cardId: 'rt', cardDir, deckDir });
    const actor = result.sceneData.snapshot.actors.find((a: any) => String(a.actorId) === '1');
    expect(actor).toBeDefined();
    expect(actor.bp.components.Text.content).toBe('Custom text');
  });

  it('does NOT write content when it matches the blueprint default', async () => {
    const sceneData = {
      snapshot: {
        library: {
          e1: {
            entryType: 'actorBlueprint',
            title: 'Test',
            actorBlueprint: { components: { Body: { widthScale: 0.3 }, Text: { content: 'Same text' } } },
          },
        },
        actors: [{ actorId: '1', parentEntryId: 'e1', bp: { components: { Body: { x: 0, y: 0, widthScale: 0.3 }, Text: { content: 'Same text' } } } }],
      },
    };

    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({ title: 'Test', entryId: 'e1', components: { Layout: { widthScale: 3.0 }, Text: { content: 'Same text' } } })
    );

    await (await import('../src/utils/decks.js')).writeActorsAndVariablesAsync({
      sceneData, cardDir, library: sceneData.snapshot.library, deckId: 'deck-1', cardId: 'rt',
    });

    const actorsList: any[] = yaml.parse(fs.readFileSync(path.join(cardDir, 'actors.yaml'), 'utf-8'));
    expect(actorsList.find(a => String(a.actorId) === '1').content).toBeUndefined();
  });

  it('round-trips targetDeckId: differs from blueprint default, written to and read from actors.yaml', async () => {
    const sceneData = {
      snapshot: {
        library: {
          e1: {
            entryType: 'actorBlueprint',
            title: 'Test',
            actorBlueprint: { components: { Body: { widthScale: 0.3 }, Link: { targetDeckId: 'defaultDeck' } } },
          },
        },
        actors: [{ actorId: '1', parentEntryId: 'e1', bp: { components: { Body: { x: 0, y: 0, widthScale: 0.3 }, Link: { targetDeckId: 'customDeck' } } } }],
      },
    };

    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({ title: 'Test', entryId: 'e1', components: { Layout: { widthScale: 3.0 }, Link: { targetDeckId: 'defaultDeck' } } })
    );

    await (await import('../src/utils/decks.js')).writeActorsAndVariablesAsync({
      sceneData, cardDir, library: sceneData.snapshot.library, deckId: 'deck-1', cardId: 'rt',
    });

    const actorsList: any[] = yaml.parse(fs.readFileSync(path.join(cardDir, 'actors.yaml'), 'utf-8'));
    expect(actorsList.find(a => String(a.actorId) === '1').targetDeckId).toBe('customDeck');

    const result = await newSceneDataForCardAsync({ cardId: 'rt', cardDir, deckDir });
    const actor = result.sceneData.snapshot.actors.find((a: any) => String(a.actorId) === '1');
    expect(actor).toBeDefined();
    expect(actor.bp.components.Link.targetDeckId).toBe('customDeck');
  });

  it('does NOT write targetDeckId when it matches the blueprint default', async () => {
    const sceneData = {
      snapshot: {
        library: {
          e1: {
            entryType: 'actorBlueprint',
            title: 'Test',
            actorBlueprint: { components: { Body: { widthScale: 0.3 }, Link: { targetDeckId: 'sameDeck' } } },
          },
        },
        actors: [{ actorId: '1', parentEntryId: 'e1', bp: { components: { Body: { x: 0, y: 0, widthScale: 0.3 }, Link: { targetDeckId: 'sameDeck' } } } }],
      },
    };

    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Test.yaml'),
      yaml.stringify({ title: 'Test', entryId: 'e1', components: { Layout: { widthScale: 3.0 }, Link: { targetDeckId: 'sameDeck' } } })
    );

    await (await import('../src/utils/decks.js')).writeActorsAndVariablesAsync({
      sceneData, cardDir, library: sceneData.snapshot.library, deckId: 'deck-1', cardId: 'rt',
    });

    const actorsList: any[] = yaml.parse(fs.readFileSync(path.join(cardDir, 'actors.yaml'), 'utf-8'));
    expect(actorsList.find(a => String(a.actorId) === '1').targetDeckId).toBeUndefined();
  });

  it('reads actor by title from actors.yaml — title→entryId lookup', async () => {
    fs.writeFileSync(
      path.join(cardDir, 'blueprints', 'Bullet.yaml'),
      yaml.stringify({ title: 'Bullet', entryId: 'e1', components: { Layout: { widthScale: 3.0 } } })
    );

    // Actor referenced by title (not entryId)
    const actorsList = [{ actorId: '1', title: 'Bullet', x: 1, y: 2, widthScale: 3.0 }];
    fs.writeFileSync(path.join(cardDir, 'actors.yaml'), yaml.stringify(actorsList));

    const result = await newSceneDataForCardAsync({ cardId: 'rt', cardDir, deckDir });
    const actor = result.sceneData.snapshot.actors.find((a: any) => String(a.actorId) === '1');
    expect(actor).toBeDefined();
    expect(actor.parentEntryId).toBe('e1');
    expect(actor.bp.components.Body.x).toBe(1);
    expect(actor.bp.components.Body.y).toBe(2);
  });
});
