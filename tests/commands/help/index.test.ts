import { runCommand } from '@oclif/test';
import { expect } from 'chai';

describe('help', () => {
  it('runs help cmd', async () => {
    const { stdout } = await runCommand('help');
    expect(stdout).to.contain('Clone a deck');
  });
});
