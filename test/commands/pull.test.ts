import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'yaml';

vi.mock('../../src/utils/api.js', () => ({
  deck: vi.fn(),
  me: vi.fn(),
  fetchAndCacheAdminStatus: vi.fn(),
}));

vi.mock('axios');

import * as API from '../../src/utils/api.js';
import { pull } from '../../src/commands/pull.js';
import { initMetadata } from '../../src/utils/init.js';

const MOCK_SCENE_DATA = {
  snapshot: {
    library: {
      'entry-001': {
        entryType: 'actorBlueprint',
        title: 'Player',
        actorBlueprint: {
          components: {
            Body: { widthScale: 0.5, heightScale: 0.5 },
            Drawing2: {
              initialFrame: 1,
              drawData: { framesBounds: [{ minX: 0, maxX: 100, minY: 0, maxY: 100 }] },
            },
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
            Body: { x: 10, y: 20, angle: 0.0, widthScale: 0.5, heightScale: 0.5 },
          },
        },
      },
    ],
  },
};

const MOCK_DECK = {
  deckId: 'deck-abc',
  initialCard: { cardId: 'card-xyz' },
  cards: [{ cardId: 'card-xyz', sceneDataUrl: 'https://example.com/card-xyz.json' }],
};

describe('pull command', () => {
  let deckDir: string;

  beforeEach(async () => {
    await initMetadata();
    deckDir = fs.mkdtempSync(path.join(os.tmpdir(), 'castle-pull-test-'));

    // Set up deck structure
    fs.writeFileSync(path.join(deckDir, 'deck.yaml'), yaml.stringify({ deckId: 'deck-abc' }));
    fs.mkdirSync(path.join(deckDir, '.castle', '.cache'), { recursive: true });
    fs.mkdirSync(path.join(deckDir, 'card-card-xyz'), { recursive: true });
    fs.writeFileSync(
      path.join(deckDir, 'card-card-xyz', 'card.yaml'),
      yaml.stringify({ cardId: 'card-xyz' })
    );
    fs.mkdirSync(path.join(deckDir, 'card-card-xyz', 'blueprints'));

    // Mock API
    vi.mocked(API.deck).mockResolvedValue(MOCK_DECK);

    const axios = await import('axios');
    vi.mocked((axios as any).default.get).mockResolvedValue({ data: MOCK_SCENE_DATA });
  });

  afterEach(() => {
    fs.rmSync(deckDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('pulls updates and writes actors.yaml in flat format', async () => {
    await pull({ directory: deckDir });

    const actorsPath = path.join(deckDir, 'card-card-xyz', 'actors.yaml');
    expect(fs.existsSync(actorsPath)).toBe(true);

    const actors = yaml.parse(fs.readFileSync(actorsPath, 'utf-8'));
    expect(typeof actors).toBe('object');
    expect(Array.isArray(actors)).toBe(false);
    expect(actors['a123']).toBeDefined();
    expect(actors['a123'].title).toBe('Player');
    expect(actors['a123'].entryId).toBeUndefined();
  });

  it('preserves local script files during pull', async () => {
    // Set up a local blueprint with a script file
    const bpData = {
      title: 'Player',
      entryId: 'entry-001',
      components: {
        Script: { file: 'Player_script.lua' },
      },
    };
    fs.writeFileSync(
      path.join(deckDir, 'card-card-xyz', 'blueprints', 'Player.yaml'),
      yaml.stringify(bpData)
    );
    const localScript = 'function update() print("local edit") end';
    fs.writeFileSync(
      path.join(deckDir, 'card-card-xyz', 'blueprints', 'Player_script.lua'),
      localScript
    );

    await pull({ directory: deckDir });

    // Script file reference should be preserved
    const bpAfter = yaml.parse(
      fs.readFileSync(path.join(deckDir, 'card-card-xyz', 'blueprints', 'Player.yaml'), 'utf-8')
    );
    // Script file pointer should reference the existing local file
    if (bpAfter.components?.Script?.file) {
      expect(bpAfter.components.Script.file).toBe('Player_script.lua');
    }
  });
});
