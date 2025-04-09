import { expect } from 'chai';
import * as Rules from '../rules.js';
import SlingFixture from './fixtures/sling.json' with { type: 'json' };

describe('rules', () => {
  it('sling.json serialization / deserialization', async () => {
    let serialized = Rules.serializeRule(SlingFixture);
    let deserialized = Rules.deserializeRule(serialized);

    expect(SlingFixture).to.deep.equal(deserialized);
  });
});
