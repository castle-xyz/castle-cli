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

    // Write actors.yaml in flat format (prompt.md format: title, degrees, ×10 widthScale)
    const actors = {
      a123: {
        title: 'Player',
        x: 10,
        y: 20,
        widthScale: 5.0,
        heightScale: 5.0,
      },
    };
    fs.writeFileSync(path.join(deckDir, 'card-card-xyz', 'actors.yaml'), yaml.stringify(actors));

    // Write blueprint (external format: ×10 widthScale)
    fs.writeFileSync(
      path.join(deckDir, 'card-card-xyz', 'blueprints', 'Player.yaml'),
      yaml.stringify({
        title: 'Player',
        entryId: 'entry-001',
        components: {
          Body: { widthScale: 5.0, heightScale: 5.0 },
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
    expect(html).toContain('/scene-data');
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

  it('GET /variables returns empty variables when no variables.yaml exists', async () => {
    const result = await serve(deckDir, { port: '0' });
    expect(result).toBeDefined();

    const port = result!.port;
    const response = await fetch(`http://localhost:${port}/variables`);
    expect(response.status).toBe(200);

    const data = await response.json() as any;
    expect(data.variables).toBeDefined();
    expect(Array.isArray(data.variables)).toBe(true);
    expect(data.passes).toBeDefined();
    expect(data.cards).toBeDefined();
  });

  it('GET /variables maps variableId to id from variables.yaml', async () => {
    // Write variables.yaml with mobile protocol format (variableId field)
    const variables = [
      { variableId: 'var-001', name: 'score', initialValue: 0, lifetime: 'deck' },
      { variableId: 'var-002', name: 'lives', initialValue: 3, lifetime: 'card' },
    ];
    fs.writeFileSync(
      path.join(deckDir, 'card-card-xyz', 'variables.yaml'),
      yaml.stringify(variables)
    );

    const result = await serve(deckDir, { port: '0' });
    expect(result).toBeDefined();

    const port = result!.port;
    const response = await fetch(`http://localhost:${port}/variables`);
    expect(response.status).toBe(200);

    const data = await response.json() as any;
    expect(data.variables).toBeDefined();
    expect(data.variables.length).toBe(2);

    // variableId must be remapped to id
    expect(data.variables[0].id).toBe('var-001');
    expect(data.variables[0].name).toBe('score');
    expect(data.variables[0].initialValue).toBe(0);
    expect(data.variables[0].lifetime).toBe('deck');

    expect(data.variables[1].id).toBe('var-002');
    expect(data.variables[1].name).toBe('lives');
    expect(data.variables[1].initialValue).toBe(3);
    expect(data.variables[1].lifetime).toBe('card');
  });
});
