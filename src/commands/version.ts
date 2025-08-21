import { Flags } from '@oclif/core';
import { BaseCommand } from '../baseCommand.js';

import packageJson from '../../package.json' with { type: 'json' };

/**
 * The Version CLI command fetches the current CLI version
 * Usage:
 *   castle version
 */
export default class Version extends BaseCommand<typeof Version> {
  static description = 'Fetch the current CLI version';

  public async run(): Promise<void> {
    const { flags } = await this.parse(Version);

    // Get the version from the package.json file
    const version = packageJson.version;
    this.log('Current CLI version:', version);
  }
}
