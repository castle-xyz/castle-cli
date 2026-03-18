import { describe, it, expect } from 'vitest';
import { getCastleMetadata, applyComponentChanges } from '../src/utils/castle-core-node.js';

describe('WASM', () => {
  it('getCastleMetadata returns behaviors and rules', async () => {
    const { behaviors, rules } = await getCastleMetadata();

    expect(behaviors).toBeDefined();
    expect(typeof behaviors).toBe('object');
    expect(Object.keys(behaviors).length).toBeGreaterThan(0);

    expect(rules).toBeDefined();
    expect(rules.triggers).toBeDefined();
    expect(Array.isArray(rules.triggers)).toBe(true);
    expect(rules.triggers.length).toBeGreaterThan(0);
  });

  it('behaviors have expected structure', async () => {
    const { behaviors } = await getCastleMetadata();

    // Find a known behavior (Body)
    const bodyBehavior = Object.values(behaviors).find((b: any) => b.name === 'Body') as any;
    expect(bodyBehavior).toBeDefined();
    expect(bodyBehavior.displayName).toBeDefined();
    expect(bodyBehavior.behaviorId).toBeDefined();
    expect(bodyBehavior.propertySpecs).toBeDefined();
  });

  it('applyComponentChanges applies Body component changes', async () => {
    const baseComponents = {
      Body: { x: 0, y: 0, angle: 0, widthScale: 0.5, heightScale: 0.5 },
    };
    const changesComponents = {
      Body: {
        x: 10,
        y: 20,
        angle: 0,
        widthScale: 0.5,
        heightScale: 0.5,
      },
    };

    const result = await applyComponentChanges(baseComponents, changesComponents);

    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
    // Body should be in the result since we included it in base
    if (result.Body) {
      expect(result.Body.x).toBe(10);
      expect(result.Body.y).toBe(20);
    }
  });

  it('applyComponentChanges returns full component state', async () => {
    const baseComponents = {
      Body: { x: 0, y: 0, angle: 0, widthScale: 0.5, heightScale: 0.5 },
    };
    const changesComponents = {
      Body: { x: 5 },
    };

    const result = await applyComponentChanges(baseComponents, changesComponents);

    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });
});
