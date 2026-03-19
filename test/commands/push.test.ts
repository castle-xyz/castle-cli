import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'yaml';

vi.mock('../../src/utils/api.js', () => ({
  deck: vi.fn(),
  createSceneDataUploadConfig: vi.fn(),
  uploadSceneData: vi.fn(),
  me: vi.fn(),
}));

vi.mock('axios');

import * as API from '../../src/utils/api.js';
import { push } from '../../src/commands/push.js';
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
            Body: { x: 10, y: 20, angle: 0, widthScale: 0.5, heightScale: 0.5 },
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

describe('push command', () => {
  let deckDir: string;

  beforeEach(async () => {
    await initMetadata();
    deckDir = fs.mkdtempSync(path.join(os.tmpdir(), 'castle-push-test-'));

    // Set up deck structure
    fs.writeFileSync(path.join(deckDir, 'deck.yaml'), yaml.stringify({ deckId: 'deck-abc' }));
    fs.mkdirSync(path.join(deckDir, '.castle', '.cache'), { recursive: true });
    fs.mkdirSync(path.join(deckDir, 'card-card-xyz', 'blueprints'), { recursive: true });
    fs.writeFileSync(
      path.join(deckDir, 'card-card-xyz', 'card.yaml'),
      yaml.stringify({ cardId: 'card-xyz' })
    );

    // Write cache with scene data
    fs.writeFileSync(
      path.join(deckDir, '.castle', '.cache', 'card-xyz.json'),
      JSON.stringify(MOCK_SCENE_DATA, null, 2)
    );

    // Write actors.yaml in new nested display-name format (widthScale ×10, x modified)
    const modifiedActors = {
      a123: {
        entryId: 'entry-001',
        components: {
          Layout: { x: 50, y: 20, angle: 0, widthScale: 5.0, heightScale: 5.0 }, // x modified from 10 to 50
        },
      },
    };
    fs.writeFileSync(path.join(deckDir, 'card-card-xyz', 'actors.yaml'), yaml.stringify(modifiedActors));
    fs.writeFileSync(path.join(deckDir, 'card-card-xyz', 'variables.yaml'), yaml.stringify([]));

    // Write blueprint in external format (widthScale ×10)
    const bpData = {
      title: 'Player',
      entryId: 'entry-001',
      components: {
        Body: { widthScale: 5.0, heightScale: 5.0 }, // external format (×10)
        Drawing2: { initialFrame: 1 },
      },
    };
    fs.writeFileSync(
      path.join(deckDir, 'card-card-xyz', 'blueprints', 'Player.yaml'),
      yaml.stringify(bpData)
    );

    // Write cardversions.json pointing to the scene data URL
    fs.writeFileSync(
      path.join(deckDir, '.castle', 'cardversions.json'),
      JSON.stringify({ 'card-xyz': 'https://example.com/card-xyz.json' })
    );
    // Write version file so force sync doesn't re-download
    fs.writeFileSync(
      path.join(deckDir, '.castle', '.cache', 'card-xyz.version'),
      'https://example.com/card-xyz.json'
    );

    // Mock API
    vi.mocked(API.deck).mockResolvedValue(MOCK_DECK);
    vi.mocked(API.createSceneDataUploadConfig).mockResolvedValue([
      {
        cardId: 'card-xyz',
        uploadId: 'upload-123',
        postUrl: 'https://example.com/upload',
        postFields: { key: 'value' },
      },
    ]);
    vi.mocked(API.uploadSceneData).mockResolvedValue([
      {
        cardId: 'card-xyz',
        sceneDataUrl: 'https://example.com/card-xyz-new.json',
      },
    ]);

    const axios = await import('axios');
    vi.mocked((axios as any).default.get).mockResolvedValue({ data: MOCK_SCENE_DATA });
    vi.mocked((axios as any).default.post).mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    fs.rmSync(deckDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('detects modifications and calls upload API', async () => {
    await push({ directory: deckDir });

    // Should have called createSceneDataUploadConfig
    expect(API.createSceneDataUploadConfig).toHaveBeenCalled();
    expect(API.uploadSceneData).toHaveBeenCalled();
  });
});
