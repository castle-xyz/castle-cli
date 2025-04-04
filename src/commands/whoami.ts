import { BaseCommand } from '../baseCommand.js';
import * as API from '../utils/api.js';

export default class WhoAmI extends BaseCommand<typeof WhoAmI> {
  static description = 'Display the current logged in user';

  public async run(): Promise<{ username: string | null }> {
    let me = await API.me();
    if (me) {
      this.log(`You are logged in as ${me.username}`);

      return {
        username: me.username,
      };
    } else {
      this.log(`You are not logged in.`);

      return {
        username: null,
      };
    }
  }
}
