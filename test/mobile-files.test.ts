import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'yaml';
import {
  titleToSlug,
  writeStateInternal,
  detectChanges,
  updateMetaHashes,
} from '../src/utils/mobile-files.js';
import type { StateInternalMessage } from '../src/utils/mobile-protocol.js';
import { initMetadata } from '../src/utils/init.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'castle-test-'));
}

function writeTestState(cardDir: string) {
  const bpDir = path.join(cardDir, 'blueprints');
  fs.mkdirSync(bpDir, { recursive: true });
  fs.mkdirSync(path.join(cardDir, '.castle'), { recursive: true });

  const slug = titleToSlug('Player');
  const bpData = { title: 'Player', entryId: 'entry-001', components: { Body: { widthScale: 0.5, heightScale: 0.5 } } };
  fs.writeFileSync(path.join(bpDir, `${slug}.yaml`), yaml.stringify(bpData, { lineWidth: 120 }));

  const actors = { a100: { title: 'Player', x: 10, y: 20 } };
  fs.writeFileSync(path.join(cardDir, 'actors.yaml'), yaml.stringify(actors, { lineWidth: 120 }));

  const variables = [{ variableId: 'var-1', name: 'score', initialValue: 0, lifetime: 'card' }];
  fs.writeFileSync(path.join(cardDir, 'variables.yaml'), yaml.stringify(variables, { lineWidth: 120 }));

  fs.writeFileSync(path.join(cardDir, '.castle', 'meta.json'), JSON.stringify({
    deckId: 'deck-123',
    cardId: 'card-456',
    hashes: {},
    blueprintIdMap: { [slug]: 'entry-001' },
  }));
  updateMetaHashes(cardDir);
}

describe('titleToSlug', () => {
  it('converts simple titles', () => {
    expect(titleToSlug('Player Ship')).toBe('Player-Ship');
    expect(titleToSlug('Enemy')).toBe('Enemy');
  });

  it('handles special characters', () => {
    expect(titleToSlug('My Actor!')).toBe('My-Actor');
    expect(titleToSlug('  Leading Spaces  ')).toBe('Leading-Spaces');
  });

  it('returns untitled for empty/whitespace', () => {
    expect(titleToSlug('')).toBe('untitled');
    expect(titleToSlug('---')).toBe('untitled');
  });
});

describe('detectChanges', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null if no meta.json', () => {
    const result = detectChanges(tmpDir);
    expect(result).toBeNull();
  });

  it('detects no changes after writeTestState', () => {
    writeTestState(tmpDir);

    const changes = detectChanges(tmpDir);
    expect(changes).toBeDefined();
    expect(changes!.hasChanges).toBe(false);
  });

  it('detects changed blueprint YAML', () => {
    writeTestState(tmpDir);

    // Modify blueprint YAML
    const yamlPath = path.join(tmpDir, 'blueprints', 'Player.yaml');
    const content = fs.readFileSync(yamlPath, 'utf-8');
    fs.writeFileSync(yamlPath, content + '\n# modified');

    const changes = detectChanges(tmpDir);
    expect(changes!.hasChanges).toBe(true);
    expect(Object.keys(changes!.changedBlueprints).length).toBeGreaterThan(0);
  });

  it('detects changed actors.yaml', () => {
    writeTestState(tmpDir);

    // Modify actors.yaml
    const actorsPath = path.join(tmpDir, 'actors.yaml');
    const content = fs.readFileSync(actorsPath, 'utf-8');
    fs.writeFileSync(actorsPath, content.replace('10', '99'));

    const changes = detectChanges(tmpDir);
    expect(changes!.hasChanges).toBe(true);
    expect(changes!.changedActors).toBeDefined();
  });

  it('detects changed variables.yaml', () => {
    writeTestState(tmpDir);

    // Modify variables.yaml
    const varsPath = path.join(tmpDir, 'variables.yaml');
    const content = fs.readFileSync(varsPath, 'utf-8');
    fs.writeFileSync(varsPath, content + '\n- variableId: var-2\n  name: lives\n  initialValue: 3\n  lifetime: card\n');

    const changes = detectChanges(tmpDir);
    expect(changes!.hasChanges).toBe(true);
    expect(changes!.changedVariables).toBeDefined();
  });
});

describe('writeStateInternal', () => {
  let tmpDir: string;

  beforeEach(async () => {
    await initMetadata();
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes .draw.json companion file when drawing data is present', async () => {
    const state: StateInternalMessage = {
      type: 'state_internal',
      deckId: 'deck-1',
      cardId: 'card-1',
      cliSessionId: 'sess-1',
      blueprints: {
        'e1': {
          entryType: 'actorBlueprint',
          title: 'Test',
          actorBlueprint: {
            components: {
              Body: { widthScale: 0.3, heightScale: 0.3 },
              Drawing2: {
                initialFrame: 1,
                drawData: { framesBounds: [{ minX: 0, maxX: 100, minY: 0, maxY: 100 }] },
                physicsBodyData: { shapes: [] },
                hash: 'abc123',
              },
            },
          },
        } as any,
      },
      actors: {},
      variables: [],
    } as any;

    await writeStateInternal(tmpDir, state);

    const bpDir = path.join(tmpDir, 'blueprints');

    // Blueprint YAML must exist (without drawData)
    const yamlPath = path.join(bpDir, 'Test.yaml');
    expect(fs.existsSync(yamlPath)).toBe(true);
    const bpData = yaml.parse(fs.readFileSync(yamlPath, 'utf-8'));
    expect(bpData.components?.Drawing2?.drawData).toBeUndefined();

    // Companion .draw.json must exist with drawing data
    const drawPath = path.join(bpDir, 'Test.draw.json');
    expect(fs.existsSync(drawPath)).toBe(true);
    const drawData = JSON.parse(fs.readFileSync(drawPath, 'utf-8'));
    expect(drawData.Drawing2.drawData).toBeDefined();
    expect(drawData.Drawing2.physicsBodyData).toBeDefined();
    expect(drawData.Drawing2.hash).toBe('abc123');
  });

  it('cleans up stale .draw.json files when blueprint is removed', async () => {
    // First write with two blueprints
    const state1: any = {
      type: 'state_internal',
      deckId: 'deck-1',
      cardId: 'card-1',
      cliSessionId: 'sess-1',
      blueprints: {
        'e1': {
          entryType: 'actorBlueprint',
          title: 'Alpha',
          actorBlueprint: {
            components: {
              Body: { widthScale: 0.3 },
              Drawing2: { drawData: { x: 1 }, hash: 'h1' },
            },
          },
        },
        'e2': {
          entryType: 'actorBlueprint',
          title: 'Beta',
          actorBlueprint: {
            components: {
              Body: { widthScale: 0.3 },
              Drawing2: { drawData: { x: 2 }, hash: 'h2' },
            },
          },
        },
      },
      actors: {},
      variables: [],
    };
    await writeStateInternal(tmpDir, state1);

    const bpDir = path.join(tmpDir, 'blueprints');
    expect(fs.existsSync(path.join(bpDir, 'Alpha.draw.json'))).toBe(true);
    expect(fs.existsSync(path.join(bpDir, 'Beta.draw.json'))).toBe(true);

    // Second write with only Alpha — Beta should be cleaned up
    const state2: any = { ...state1, blueprints: { 'e1': state1.blueprints['e1'] } };
    await writeStateInternal(tmpDir, state2);

    expect(fs.existsSync(path.join(bpDir, 'Alpha.draw.json'))).toBe(true);
    expect(fs.existsSync(path.join(bpDir, 'Beta.draw.json'))).toBe(false);
  });
});

