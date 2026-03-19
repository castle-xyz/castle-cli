import { describe, it, expect } from 'vitest';
import { getCastleMetadata } from '../src/utils/castle-core-node.js';

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
});
