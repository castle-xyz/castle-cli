import open from 'open';
import * as API from '../utils/api.js';
import * as config from '../utils/config.js';

export async function login() {
  let { pollToken, url } = await API.startCLILogin();
  console.log(`Please open the following URL in your browser to log in:\n${url}`);
  console.log(`Once you've logged in, you can return to the CLI.`);

  await open(url);

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      let user = await API.pollForCLILogin(pollToken);

      config.setToken(user.token);

      console.log(`Successfully logged in as ${user.username}`);
      return { username: user.username };
    } catch (e) {
      // Ignore errors, keep polling
    }
  }
}
