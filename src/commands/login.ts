import { Command } from '@oclif/core';
import * as API from '../utils/api';
import * as config from '../utils/config';

export default class Login extends Command {
  public async run(): Promise<void> {
    let { pollToken, url } = await API.startCLILogin();
    this.log(`Please open the following URL in your browser to log in:\n${url}`);
    this.log(`Once you've logged in, you can return to the CLI.`);

    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        let user = await API.pollForCLILogin(pollToken);

        config.setToken(user.token);

        this.log(`Successfully logged in as ${user.username}`);
        break;
      } catch (e) {
        // Ignore errors, keep polling
      }
    }
  }
}
