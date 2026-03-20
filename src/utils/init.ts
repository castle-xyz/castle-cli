import { initBehaviors } from './behaviors.js';
import { initRules } from './rules.js';

export async function initMetadata() {
  await Promise.all([initBehaviors(), initRules()]);
}
