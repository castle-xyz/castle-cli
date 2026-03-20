import * as API from '../utils/api.js';
import * as config from '../utils/config.js';

export async function logout() {
  let me = await API.me();
  if (!me) {
    console.log('You are not logged in');
    return;
  }

  try {
    await API.logout();
  } catch (e: any) {
    console.error(`Logout request failed: ${e?.message ?? e}`);
  }
  config.setToken(null);
  console.log('Successfully logged out');
}
