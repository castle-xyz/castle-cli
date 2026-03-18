import * as API from '../utils/api.js';

export async function whoami() {
  let me = await API.me();
  if (me) {
    console.log(`You are logged in as ${me.username}`);
    return { username: me.username };
  } else {
    console.log(`You are not logged in.`);
    return { username: null };
  }
}
