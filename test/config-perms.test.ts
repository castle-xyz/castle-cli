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

test('the file is replaced, not rewritten in place', { skip: !posix }, () => {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = path.join(home, 'config.json');
  fs.writeFileSync(file, '{}', { mode: 0o644 });
  const before = fs.statSync(file).ino;
  setToken('test-token-c');
  assert.notEqual(fs.statSync(file).ino, before);
  assert.equal(mode(file), 0o600);
});

test('a symlinked config dir resolves to its private target', { skip: !posix }, () => {
  const target = path.join(path.dirname(home), 'dotfiles-castle');
  fs.mkdirSync(target, { recursive: true, mode: 0o755 });
  fs.chmodSync(target, 0o755);
  fs.symlinkSync(target, home);
  setToken('test-token-d');
  assert.equal(mode(target), 0o700, 'owned target is tightened');
  assert.equal(mode(path.join(target, 'config.json')), 0o600);
  assert.equal(fs.lstatSync(home).isSymbolicLink(), true, 'symlink kept');
});

test('refuses to write into a directory others can modify', { skip: !posix || process.getuid?.() === 0 }, () => {
  // /tmp is root-owned and world-writable (1777): we cannot tighten it, so the
  // token must not be written there.
  const shared = fs.realpathSync('/tmp');
  assert.notEqual(fs.statSync(shared).mode & 0o022, 0);
  process.env.CASTLE_CLI_HOME = shared;
  assert.throws(() => setToken('test-token-e'), /Refusing to write credentials/);
});

test('reading the token tightens a legacy world-readable file', { skip: !posix }, () => {
  fs.mkdirSync(home, { recursive: true, mode: 0o755 });
  fs.chmodSync(home, 0o755);
  const file = path.join(home, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ token: 'legacy' }), { mode: 0o644 });
  fs.chmodSync(file, 0o644);
  assert.equal(getToken(), 'legacy');
  assert.equal(mode(file), 0o600);
  assert.equal(mode(home), 0o700);
});

test('reading through a symlinked config.json tightens the real file', { skip: !posix }, () => {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const real = path.join(path.dirname(home), 'real-config.json');
  fs.writeFileSync(real, JSON.stringify({ token: 'linked' }), { mode: 0o644 });
  fs.chmodSync(real, 0o644);
  fs.symlinkSync(real, path.join(home, 'config.json'));
  assert.equal(getToken(), 'linked');
  assert.equal(mode(real), 0o600);
});
