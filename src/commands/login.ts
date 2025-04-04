import { BaseCommand } from '../baseCommand.js';
import open from 'open';
import * as API from '../utils/api.js';
import * as config from '../utils/config.js';

export default class Login extends BaseCommand<typeof Login> {
  static description = 'Log in to your Castle account';

  public async run(): Promise<{ username: string }> {
    let { pollToken, url } = await API.startCLILogin();
    this.log(`Please open the following URL in your browser to log in:\n${url}`);
    this.log(`Once you've logged in, you can return to the CLI.`);

    await open(url);

    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        let user = await API.pollForCLILogin(pollToken);

        config.setToken(user.token);

        this.log(`Successfully logged in as ${user.username}`);

        return {
          username: user.username,
        };

        break;
      } catch (e) {
        // Ignore errors, keep polling
      }
    }
  }
}
