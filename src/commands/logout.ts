import { Command } from '@oclif/core';
import * as API from '../utils/api.js';
import * as config from '../utils/config.js';

export default class Logout extends Command {
  static description = 'Log out from your Castle account';

  public async run(): Promise<void> {
    let me = await API.me();
    if (!me) {
      this.log('You are not logged in');
      return;
    }

    await API.logout();
    config.setToken(null);
    this.log('Successfully logged out');
  }
}
