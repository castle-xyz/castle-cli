import { Command } from '@oclif/core';
import * as API from '../utils/api.js';

export default class WhoAmI extends Command {
  static description = 'Display the current logged in user';

  public async run(): Promise<void> {
    let me = await API.me();
    if (me) {
      this.log(`You are logged in as ${me.username}`);
    } else {
      this.log(`You are not logged in.`);
    }
  }
}
