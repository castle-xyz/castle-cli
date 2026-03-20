import open from 'open';
import * as API from '../utils/api.js';
import * as config from '../utils/config.js';

export async function login() {
  let pollToken: string;
  let url: string;
  try {
    ({ pollToken, url } = await API.startCLILogin());
  } catch (e: any) {
    console.error(`Login failed: ${e?.message ?? e}`);
    process.exit(1);
  }
  console.log(`Please open the following URL in your browser to log in:\n${url}`);
  console.log(`Once you've logged in, you can return to the CLI.`);

  await open(url);

  const MAX_ATTEMPTS = 600; // 10 minutes
  let attempts = 0;
  while (true) {
    if (++attempts > MAX_ATTEMPTS) {
      console.error('Login timed out. Please try again.');
      process.exit(1);
    }
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
