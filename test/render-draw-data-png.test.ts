import { describe, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Tests that use the real WASM module to verify renderDrawDataPng produces valid PNG output.
// These tests are separate from draw-preview.test.ts which uses a vi.mock for isolation.

describe('renderDrawDataPng (real WASM)', () => {
  it('returns a valid base64 PNG for real drawData from fixture', async () => {
    const { renderDrawDataPng } = await import('../src/utils/castle-core-node.js');
    const snapshots = JSON.parse(
      fs.readFileSync(path.join('test', 'fixtures', 'snapshots.json'), 'utf-8')
    );

    // Find first library entry with a Drawing2 component that has drawData and hash
    let drawing2: any = null;
    for (const fixture of Object.values(snapshots) as any[]) {
      for (const entry of Object.values(fixture.snapshot?.library ?? {}) as any[]) {
        const d2 = entry.actorBlueprint?.components?.Drawing2;
        if (d2?.drawData && d2?.hash) {
          drawing2 = d2;
          break;
        }
      }
      if (drawing2) break;
    }

    if (!drawing2) {
      // No drawing fixture available — skip gracefully
      return;
    }

    const base64Png = await renderDrawDataPng(drawing2);

    expect(typeof base64Png).toBe('string');
    expect(base64Png.length).toBeGreaterThan(100);

    // Decode and verify PNG magic bytes: 89 50 4E 47
    const bytes = Buffer.from(base64Png, 'base64');
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50); // 'P'
    expect(bytes[2]).toBe(0x4E); // 'N'
    expect(bytes[3]).toBe(0x47); // 'G'
  });

  it('throws when drawing2.drawData is missing', async () => {
    const { renderDrawDataPng } = await import('../src/utils/castle-core-node.js');
    await expect(renderDrawDataPng({ hash: 'some-hash' })).rejects.toThrow('renderDrawDataPng:');
  });

  it('throws when drawing2 is empty', async () => {
    const { renderDrawDataPng } = await import('../src/utils/castle-core-node.js');
    await expect(renderDrawDataPng({})).rejects.toThrow('renderDrawDataPng:');
  });
});
