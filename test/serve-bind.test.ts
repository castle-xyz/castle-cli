import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const ENTRY = path.join(ROOT, 'src', 'index.ts');

function get(port: number, host: string, hostHeader: string, pathname = '/scene-data') {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.get({ host, port, path: pathname, headers: { host: hostHeader } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  });
}

async function startServe(args: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'castle-cli-serve-'));
  const env = { ...process.env, CASTLE_CLI_HOME: path.join(root, 'home') };
  delete (env as any).CASTLE_HOME;
  const deckDir = path.join(root, 'deck');
  const init = spawnSync(TSX, [ENTRY, 'init', deckDir, '--title', 'Bind Test'], { env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(init.status, 0, init.stderr);
  const child: ChildProcess = spawn(TSX, [ENTRY, 'serve', deckDir, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout!.on('data', (c) => (output += c));
  child.stderr!.on('data', (c) => (output += c));
  const infoPath = path.join(deckDir, '.castle', 'serve.json');
  const deadline = Date.now() + 60_000;
  while (!fs.existsSync(infoPath)) {
    if (Date.now() > deadline || child.exitCode !== null) throw new Error(`serve did not start:\n${output}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  const stop = () => {
    child.kill('SIGTERM');
    fs.rmSync(root, { recursive: true, force: true });
  };
  return { info, stop, output: () => output };
}

function lanAddress(): string | undefined {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (!a.internal && a.family === 'IPv4') return a.address;
  }
}

test('default serve listens on loopback only and rejects foreign Host headers', { timeout: 120_000 }, async () => {
  const { info, stop, output } = await startServe([]);
  try {
    assert.equal(info.url, `http://localhost:${info.httpPort}`);
    const ok = await get(info.httpPort, '127.0.0.1', `localhost:${info.httpPort}`);
    assert.equal(ok.status, 200);
    const rebound = await get(info.httpPort, '127.0.0.1', `attacker.example:${info.httpPort}`);
    assert.equal(rebound.status, 403);
    assert.doesNotMatch(output(), /WARNING/);
    const lan = lanAddress();
    if (lan) {
      await assert.rejects(get(info.httpPort, lan, `${lan}:${info.httpPort}`), /ECONNREFUSED|EADDRNOTAVAIL|timeout/);
    }
  } finally {
    stop();
  }
});

test('--lan listens on all interfaces and warns', { timeout: 120_000 }, async () => {
  const { info, stop, output } = await startServe(['--lan']);
  try {
    assert.match(output(), /WARNING: serve is listening on 0\.0\.0\.0/);
    const lan = lanAddress();
    if (lan) {
      const res = await get(info.httpPort, lan, `${lan}:${info.httpPort}`);
      assert.equal(res.status, 200);
    }
  } finally {
    stop();
  }
});
