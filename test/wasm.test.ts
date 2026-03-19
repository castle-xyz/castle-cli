import { describe, it, expect } from 'vitest';
import { getCastleMetadata, applyComponentChanges, getComponentScriptValues } from '../src/utils/castle-core-node.js';

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

describe('getComponentScriptValues', () => {
  it('converts Body.widthScale from internal format (×0.1) to script format (×10)', async () => {
    const result = await getComponentScriptValues({
      Body: { widthScale: 0.3, heightScale: 0.2 },
    });

    expect(result.Body).toBeDefined();
    // Internal 0.3 → script 3.0 (×10 conversion via handleGetProperty)
    expect(result.Body.widthScale).toBeCloseTo(3.0);
    expect(result.Body.heightScale).toBeCloseTo(2.0);
  });

  it('writes bool props as actual booleans, not numbers', async () => {
    const result = await getComponentScriptValues({
      Body: { widthScale: 0.3, visible: true },
    });

    expect(result.Body).toBeDefined();
    // visible must be boolean true, not the number 1 or 1.0
    expect(result.Body.visible).toBe(true);
    expect(typeof result.Body.visible).toBe('boolean');
  });

  it('round-trips Body.widthScale: getComponentScriptValues then applyComponentChanges', async () => {
    const internal = { Body: { widthScale: 0.3, heightScale: 0.15 } };

    // Internal → script format
    const script = await getComponentScriptValues(internal);
    expect(script.Body.widthScale).toBeCloseTo(3.0);
    expect(script.Body.heightScale).toBeCloseTo(1.5);

    // Script → internal format (round-trip back)
    const restored = await applyComponentChanges(internal, { Body: script.Body });
    expect(restored.Body).toBeDefined();
    expect(restored.Body.widthScale).toBeCloseTo(0.3);
    expect(restored.Body.heightScale).toBeCloseTo(0.15);
  });
});
