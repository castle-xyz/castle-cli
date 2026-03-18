import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'yaml';

// Mock node-watch to avoid fs watcher issues in tests
vi.mock('node-watch', () => ({
  default: vi.fn(),
}));

vi.mock('../../src/utils/api.js', () => ({
  deck: vi.fn(),
  me: vi.fn(),
}));

vi.mock('../../src/utils/config.js', () => ({
  getToken: vi.fn().mockReturnValue(null), // No token — disable mobile
  setToken: vi.fn(),
}));

vi.mock('axios');

import * as API from '../../src/utils/api.js';
import { serve } from '../../src/commands/serve.js';
import { initMetadata } from '../../src/utils/init.js';
import http from 'http';

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

describe('serve command', () => {
  let deckDir: string;
  let serverInstance: http.Server | null = null;

  beforeEach(async () => {
    await initMetadata();
    deckDir = fs.mkdtempSync(path.join(os.tmpdir(), 'castle-serve-test-'));

    // Set up deck structure
    fs.writeFileSync(path.join(deckDir, 'deck.yaml'), yaml.stringify({ deckId: 'deck-abc' }));
    fs.mkdirSync(path.join(deckDir, '.castle', '.cache'), { recursive: true });
    fs.mkdirSync(path.join(deckDir, 'card-card-xyz', 'blueprints'), { recursive: true });
    fs.writeFileSync(
      path.join(deckDir, 'card-card-xyz', 'card.yaml'),
      yaml.stringify({ cardId: 'card-xyz' })
    );

    // Write cache
    fs.writeFileSync(
      path.join(deckDir, '.castle', '.cache', 'card-xyz.json'),
      JSON.stringify(MOCK_SCENE_DATA, null, 2)
    );

    // Write actors.yaml
    const actors = {
      a123: {
        title: 'Player',
        entryId: 'entry-001',
        x: 10,
        y: 20,
        angle: 0,
        widthScale: 0.5,
        heightScale: 0.5,
      },
    };
    fs.writeFileSync(path.join(deckDir, 'card-card-xyz', 'actors.yaml'), yaml.stringify(actors));

    // Write blueprint
    fs.writeFileSync(
      path.join(deckDir, 'card-card-xyz', 'blueprints', 'Player.yaml'),
      yaml.stringify({
        title: 'Player',
        entryId: 'entry-001',
        components: {
          Body: { widthScale: 0.5, heightScale: 0.5 },
          Drawing2: { initialFrame: 1 },
        },
      })
    );

    // Write cardversions
    fs.writeFileSync(
      path.join(deckDir, '.castle', 'cardversions.json'),
      JSON.stringify({ 'card-xyz': 'https://example.com/card-xyz.json' })
    );
    fs.writeFileSync(
      path.join(deckDir, '.castle', '.cache', 'card-xyz.version'),
      'https://example.com/card-xyz.json'
    );

    // Mock API
    vi.mocked(API.deck).mockResolvedValue(MOCK_DECK);

    const axios = await import('axios');
    vi.mocked((axios as any).default.get).mockResolvedValue({ data: MOCK_SCENE_DATA });
  });

  afterEach(() => {
    if (serverInstance) {
      serverInstance.close();
      serverInstance = null;
    }
    fs.rmSync(deckDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('starts Express server and returns app', async () => {
    const result = await serve(deckDir, { port: '0' });

    expect(result).toBeDefined();
    expect(result!.port).toBeGreaterThan(0);
    expect(result!.url).toContain('http://localhost');

    // Get the underlying server to close it
    serverInstance = result!.app.listen(0) as unknown as http.Server;
  });

  it('GET / returns HTML player page', async () => {
    const result = await serve(deckDir, { port: '0' });
    expect(result).toBeDefined();

    const port = result!.port;
    const response = await fetch(`http://localhost:${port}/`);
    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain('<html>');
    expect(html).toContain('castle.xyz');
  });

  it('GET /version returns version number', async () => {
    const result = await serve(deckDir, { port: '0' });
    expect(result).toBeDefined();

    const port = result!.port;
    const response = await fetch(`http://localhost:${port}/version?returnImmediate=true`);
    expect(response.status).toBe(200);

    const data = await response.json() as any;
    expect(data.version).toBeDefined();
    expect(typeof data.version).toBe('number');
  });

  it('GET /scene-data returns scene data JSON', async () => {
    const result = await serve(deckDir, { port: '0' });
    expect(result).toBeDefined();

    const port = result!.port;
    const response = await fetch(`http://localhost:${port}/scene-data`);
    expect(response.status).toBe(200);

    const data = await response.json() as any;
    expect(data.snapshot).toBeDefined();
    expect(data.snapshot.library).toBeDefined();
    expect(data.snapshot.actors).toBeDefined();
  });
});
