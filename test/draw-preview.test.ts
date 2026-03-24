import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'yaml';
import { newSceneDataForCardAsync } from '../src/utils/decks.js';
import { drawPreview } from '../src/commands/draw-preview.js';
import { initMetadata } from '../src/utils/init.js';

// Mock renderDrawDataPng so these tests don't need real WASM rendering.
// Real WASM rendering is tested separately in render-draw-data-png.test.ts.
// applySnapshot and getCastleMetadata are spread from the real module so they still work.
vi.mock('../src/utils/castle-core-node.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/utils/castle-core-node.js')>();
  return {
    ...real,
    renderDrawDataPng: vi.fn().mockResolvedValue('iVBORw0KGgo='),
  };
});

// ── Group 1: Hash-based PNG auto-generation via newSceneDataForCardAsync ──────

describe('PNG auto-generation in newSceneDataForCardAsync', () => {
  let deckDir: string;
  let cardDir: string;
  let bpDir: string;

  function writeBlueprint(drawData: any) {
    fs.mkdirSync(bpDir, { recursive: true });
    fs.writeFileSync(
      path.join(bpDir, 'Test.yaml'),
      yaml.stringify({ title: 'Test', entryId: 'e1', components: { Layout: {} } })
    );
    fs.writeFileSync(path.join(bpDir, 'Test.draw.json'), JSON.stringify({ Drawing2: drawData }));
    fs.writeFileSync(path.join(cardDir, 'actors.yaml'), yaml.stringify({}));
  }

  beforeEach(async () => {
    await initMetadata();
    deckDir = fs.mkdtempSync(path.join(os.tmpdir(), 'castle-draw-preview-'));
    cardDir = path.join(deckDir, 'card-c1');
    bpDir = path.join(cardDir, 'blueprints');
    fs.mkdirSync(cardDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(deckDir, { recursive: true, force: true });
  });

  function readMetaDrawPreviewHashes(): Record<string, string> {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(cardDir, '.castle', 'meta.json'), 'utf-8'));
      return meta.drawPreviewHashes ?? {};
    } catch { return {}; }
  }

  it('generates preview.png and stores hash in meta.json when hash is new', async () => {
    writeBlueprint({ drawData: { layers: [] }, hash: 'hash-abc' });

    await newSceneDataForCardAsync({ cardId: 'c1', cardDir, deckDir });

    expect(fs.existsSync(path.join(bpDir, 'Test.preview.png'))).toBe(true);
    expect(readMetaDrawPreviewHashes()['Test']).toBe('hash-abc');
  });

  it('skips rendering when meta.json hash matches', async () => {
    const { renderDrawDataPng } = await import('../src/utils/castle-core-node.js');
    writeBlueprint({ drawData: { layers: [] }, hash: 'hash-abc' });
    // Pre-populate meta.json with matching hash
    const castleDir = path.join(cardDir, '.castle');
    fs.mkdirSync(castleDir, { recursive: true });
    fs.writeFileSync(path.join(castleDir, 'meta.json'), JSON.stringify({ drawPreviewHashes: { Test: 'hash-abc' } }));
    fs.writeFileSync(path.join(bpDir, 'Test.preview.png'), Buffer.from('old-png'));

    await newSceneDataForCardAsync({ cardId: 'c1', cardDir, deckDir });

    expect(renderDrawDataPng).not.toHaveBeenCalled();
  });

  it('regenerates when meta.json hash is stale', async () => {
    const { renderDrawDataPng } = await import('../src/utils/castle-core-node.js');
    writeBlueprint({ drawData: { layers: [] }, hash: 'hash-new' });
    // Stale meta.json hash
    const castleDir = path.join(cardDir, '.castle');
    fs.mkdirSync(castleDir, { recursive: true });
    fs.writeFileSync(path.join(castleDir, 'meta.json'), JSON.stringify({ drawPreviewHashes: { Test: 'hash-old' } }));
    fs.writeFileSync(path.join(bpDir, 'Test.preview.png'), Buffer.from('old-png'));

    await newSceneDataForCardAsync({ cardId: 'c1', cardDir, deckDir });

    expect(renderDrawDataPng).toHaveBeenCalled();
    expect(readMetaDrawPreviewHashes()['Test']).toBe('hash-new');
  });

  it('skips silently when Drawing2 has no drawData field', async () => {
    const { renderDrawDataPng } = await import('../src/utils/castle-core-node.js');
    writeBlueprint({ hash: 'hash-abc' }); // drawData absent

    await newSceneDataForCardAsync({ cardId: 'c1', cardDir, deckDir });

    expect(renderDrawDataPng).not.toHaveBeenCalled();
  });

  it('skips silently when draw.json has no Drawing2 section', async () => {
    const { renderDrawDataPng } = await import('../src/utils/castle-core-node.js');
    fs.mkdirSync(bpDir, { recursive: true });
    fs.writeFileSync(
      path.join(bpDir, 'Test.yaml'),
      yaml.stringify({ title: 'Test', entryId: 'e1', components: { Layout: {} } })
    );
    fs.writeFileSync(path.join(bpDir, 'Test.draw.json'), JSON.stringify({ Body: {} }));
    fs.writeFileSync(path.join(cardDir, 'actors.yaml'), yaml.stringify({}));

    await newSceneDataForCardAsync({ cardId: 'c1', cardDir, deckDir });

    expect(renderDrawDataPng).not.toHaveBeenCalled();
  });

  it('does not throw when renderDrawDataPng fails', async () => {
    const { renderDrawDataPng } = await import('../src/utils/castle-core-node.js');
    (renderDrawDataPng as any).mockRejectedValueOnce(new Error('WASM render error'));
    writeBlueprint({ drawData: { layers: [] }, hash: 'hash-abc' });

    // Serve must never throw — error is swallowed inside maybeRegenerateDrawPreviewAsync
    await expect(
      newSceneDataForCardAsync({ cardId: 'c1', cardDir, deckDir })
    ).resolves.toBeDefined();
  });
});

// ── Group 2: drawPreview CLI command ──────────────────────────────────────────

describe('drawPreview CLI command', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'castle-draw-preview-cmd-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes PNG to default output path (replaces .draw.json with .preview.png)', async () => {
    const drawJsonPath = path.join(tmpDir, 'Foo.draw.json');
    fs.writeFileSync(
      drawJsonPath,
      JSON.stringify({ Drawing2: { drawData: { layers: [] }, hash: 'h1' } })
    );

    await drawPreview(drawJsonPath);

    expect(fs.existsSync(path.join(tmpDir, 'Foo.preview.png'))).toBe(true);
  });

  it('writes PNG to --output path when specified', async () => {
    const drawJsonPath = path.join(tmpDir, 'Foo.draw.json');
    const outputPath = path.join(tmpDir, 'custom-output.png');
    fs.writeFileSync(
      drawJsonPath,
      JSON.stringify({ Drawing2: { drawData: { layers: [] }, hash: 'h1' } })
    );

    await drawPreview(drawJsonPath, { output: outputPath });

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'Foo.preview.png'))).toBe(false);
  });

  it('exits with error when draw.json file does not exist', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);

    await expect(drawPreview('/nonexistent/path/Foo.draw.json')).rejects.toThrow();
    mockExit.mockRestore();
  });

  it('exits with error when Drawing2.drawData is absent', async () => {
    const drawJsonPath = path.join(tmpDir, 'Foo.draw.json');
    fs.writeFileSync(drawJsonPath, JSON.stringify({ Drawing2: { hash: 'h1' } }));
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);

    await expect(drawPreview(drawJsonPath)).rejects.toThrow();
    mockExit.mockRestore();
  });

  it('exits with error when Drawing2 section is missing entirely', async () => {
    const drawJsonPath = path.join(tmpDir, 'Foo.draw.json');
    fs.writeFileSync(drawJsonPath, JSON.stringify({ Body: {} }));
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);

    await expect(drawPreview(drawJsonPath)).rejects.toThrow();
    mockExit.mockRestore();
  });
});
