import * as API from '../utils/api.js';
import * as config from '../utils/config.js';

export async function logout() {
  let me = await API.me();
  if (!me) {
    console.log('You are not logged in');
    return;
  }

  await API.logout();
  config.setToken(null);
  console.log('Successfully logged out');
}
