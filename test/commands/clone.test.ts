import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'yaml';

// Mock API and network calls
vi.mock('../../src/utils/api.js', () => ({
  deck: vi.fn(),
  resolveDeepLink: vi.fn(),
  fetchAndCacheAdminStatus: vi.fn(),
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

  it('creates actors.yaml in map format with title and degrees', async () => {
    const deckDir = path.join(tmpDir, 'test-deck');
    await clone('deck-abc', { directory: deckDir });

    const actorsYaml = path.join(deckDir, 'card-card-xyz', 'actors.yaml');
    expect(fs.existsSync(actorsYaml)).toBe(true);

    const actorsMap: Record<string, any> = yaml.parse(fs.readFileSync(actorsYaml, 'utf-8'));
    // Should be map format (not array)
    expect(Array.isArray(actorsMap)).toBe(false);

    // First actor gets key 'a0'
    const actorEntry = actorsMap['a0'];
    expect(actorEntry).toBeDefined();
    expect(actorEntry.title).toBe('Player'); // title instead of entryId
    expect(actorEntry.actorId).toBeUndefined(); // no actorId in map values
    expect(actorEntry.entryId).toBeUndefined();
    expect(actorEntry.components).toBeUndefined(); // flat format, no nested components
    expect(actorEntry.x).toBe(10);
    expect(actorEntry.y).toBe(20);
    // Angle converted from radians (0.785) to degrees (~44.97)
    expect(actorEntry.angle).toBeCloseTo(44.97, 1);
    // widthScale stripped when matching blueprint default (0.5 internal = 5.0 ×10)
    expect(actorEntry.widthScale).toBeUndefined();
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

  it('creates .castle directory and writes .draw.json companion files', async () => {
    const deckDir = path.join(tmpDir, 'test-deck');
    await clone('deck-abc', { directory: deckDir });

    const castleDir = path.join(deckDir, '.castle');
    expect(fs.existsSync(castleDir)).toBe(true);

    // Blueprint draw companion file should exist
    const bpDir = path.join(deckDir, 'card-card-xyz', 'blueprints');
    const drawFiles = fs.readdirSync(bpDir).filter(f => f.endsWith('.draw.json'));
    expect(drawFiles.length).toBeGreaterThan(0);

    // The draw.json should contain Drawing2 data
    const drawData = JSON.parse(fs.readFileSync(path.join(bpDir, drawFiles[0]), 'utf-8'));
    expect(drawData.Drawing2).toBeDefined();
    expect(drawData.Drawing2.drawData).toBeDefined();
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
