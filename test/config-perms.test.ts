import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getConfigDir, getToken, setToken } from '../src/config.js';

const posix = process.platform !== 'win32';
let home: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = { CASTLE_CLI_HOME: process.env.CASTLE_CLI_HOME, CASTLE_HOME: process.env.CASTLE_HOME };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'castle-cli-config-'));
  home = path.join(root, 'home', '.castle');
  process.env.CASTLE_CLI_HOME = home;
  delete process.env.CASTLE_HOME;
  assert.equal(getConfigDir(), home, 'config dir must be the temp dir before writing');
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(path.dirname(path.dirname(home)), { recursive: true, force: true });
});

const mode = (p: string) => fs.statSync(p).mode & 0o777;

test('a new token file is 0600 in a 0700 directory', { skip: !posix }, () => {
  setToken('test-token-a');
  assert.equal(getToken(), 'test-token-a');
  assert.equal(mode(home), 0o700);
  assert.equal(mode(path.join(home, 'config.json')), 0o600);
});

test('existing permissive file and directory are tightened on the next write', { skip: !posix }, () => {
  fs.mkdirSync(home, { recursive: true, mode: 0o755 });
  fs.chmodSync(home, 0o755);
  const file = path.join(home, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ token: 'old', other: 1 }), { mode: 0o644 });
  fs.chmodSync(file, 0o644);
  setToken('test-token-b');
  assert.equal(mode(home), 0o700);
  assert.equal(mode(file), 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { token: 'test-token-b', other: 1 });
  setToken(null);
  assert.equal(mode(file), 0o600);
  assert.deepEqual(fs.readdirSync(home), ['config.json'], 'no temp files left behind');
});
