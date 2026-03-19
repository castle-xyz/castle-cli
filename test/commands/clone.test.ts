import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'yaml';

// Mock API and network calls
vi.mock('../../src/utils/api.js', () => ({
  deck: vi.fn(),
  resolveDeepLink: vi.fn(),
}));

vi.mock('axios');

import * as API from '../../src/utils/api.js';
import { clone } from '../../src/commands/clone.js';
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
            Tags: { tagsString: 'manager', disabled: false },
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
            Body: { x: 10, y: 20, angle: 0.785, widthScale: 0.5, heightScale: 0.5 },
          },
        },
      },
    ],
  },
};

const MOCK_DECK = {
  deckId: 'deck-abc',
  initialCard: { cardId: 'card-xyz' },
  cards: [
    {
      cardId: 'card-xyz',
      sceneDataUrl: 'https://example.com/scenedata/card-xyz.json',
    },
  ],
};

describe('clone command', () => {
  let tmpDir: string;

  beforeEach(async () => {
    await initMetadata();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'castle-clone-test-'));

    // Mock API
    vi.mocked(API.deck).mockResolvedValue(MOCK_DECK);

    // Mock axios for scene data download
    const axios = await import('axios');
    vi.mocked((axios as any).default.get).mockResolvedValue({ data: MOCK_SCENE_DATA });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('creates deck.yaml with deckId', async () => {
    const deckDir = path.join(tmpDir, 'test-deck');
    await clone('deck-abc', { directory: deckDir });

    const deckYaml = path.join(deckDir, 'deck.yaml');
    expect(fs.existsSync(deckYaml)).toBe(true);

    const data = yaml.parse(fs.readFileSync(deckYaml, 'utf-8'));
    expect(data.deckId).toBe('deck-abc');
  });

  it('creates card directory with card.yaml', async () => {
    const deckDir = path.join(tmpDir, 'test-deck');
    await clone('deck-abc', { directory: deckDir });

    const cardDir = path.join(deckDir, 'card-card-xyz');
    expect(fs.existsSync(cardDir)).toBe(true);

    const cardYaml = path.join(cardDir, 'card.yaml');
    expect(fs.existsSync(cardYaml)).toBe(true);

    const data = yaml.parse(fs.readFileSync(cardYaml, 'utf-8'));
    expect(data.cardId).toBe('card-xyz');
  });

  it('creates actors.yaml in flat format with title and degrees', async () => {
    const deckDir = path.join(tmpDir, 'test-deck');
    await clone('deck-abc', { directory: deckDir });

    const actorsYaml = path.join(deckDir, 'card-card-xyz', 'actors.yaml');
    expect(fs.existsSync(actorsYaml)).toBe(true);

    const actors = yaml.parse(fs.readFileSync(actorsYaml, 'utf-8'));
    // Should be object format, not array
    expect(typeof actors).toBe('object');
    expect(Array.isArray(actors)).toBe(false);

    // Should have a-prefixed key with flat format
    expect(actors['a123']).toBeDefined();
    expect(actors['a123'].title).toBe('Player'); // title instead of entryId
    expect(actors['a123'].entryId).toBeUndefined();
    expect(actors['a123'].components).toBeUndefined(); // flat format, no nested components
    expect(actors['a123'].x).toBe(10);
    expect(actors['a123'].y).toBe(20);
    // Angle converted from radians (0.785) to degrees (~44.97)
    expect(actors['a123'].angle).toBeCloseTo(44.97, 1);
    expect(actors['a123'].widthScale).toBeCloseTo(5.0, 1); // ×10
  });

  it('creates blueprints directory with blueprint files', async () => {
    const deckDir = path.join(tmpDir, 'test-deck');
    await clone('deck-abc', { directory: deckDir });

    const bpDir = path.join(deckDir, 'card-card-xyz', 'blueprints');
    expect(fs.existsSync(bpDir)).toBe(true);

    // Check for blueprint yaml
    const files = fs.readdirSync(bpDir);
    const yamlFiles = files.filter(f => f.endsWith('.yaml'));
    expect(yamlFiles.length).toBeGreaterThan(0);
  });

  it('creates .castle/.cache directory', async () => {
    const deckDir = path.join(tmpDir, 'test-deck');
    await clone('deck-abc', { directory: deckDir });

    const cacheDir = path.join(deckDir, '.castle', '.cache');
    expect(fs.existsSync(cacheDir)).toBe(true);
  });

  it('preserves Tags.tagsString in blueprint YAML', async () => {
    const deckDir = path.join(tmpDir, 'test-deck');
    await clone('deck-abc', { directory: deckDir });

    const bpDir = path.join(deckDir, 'card-card-xyz', 'blueprints');
    const files = fs.readdirSync(bpDir).filter(f => f.endsWith('.yaml'));
    expect(files.length).toBeGreaterThan(0);

    const bpData = yaml.parse(fs.readFileSync(path.join(bpDir, files[0]), 'utf-8'));
    expect(bpData.components.Tags).toBeDefined();
    expect(bpData.components.Tags.tagsString).toBe('manager');
  });
});
