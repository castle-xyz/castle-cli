import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bindFromAddress,
  exposedServeWarning,
  isAllowedHostHeader,
  isLoopbackAddress,
  localServeUrl,
  resolveServeBind,
} from '../src/utils/serve-host.js';

test('serve binds loopback by default', () => {
  assert.deepEqual(resolveServeBind({}), { host: '127.0.0.1', exposed: false });
});

test('--lan and non-loopback --host are exposed; loopback --host is not', () => {
  assert.deepEqual(resolveServeBind({ lan: true }), { host: '0.0.0.0', exposed: true });
  assert.deepEqual(resolveServeBind({ host: '0.0.0.0' }), { host: '0.0.0.0', exposed: true });
  assert.deepEqual(resolveServeBind({ host: '192.168.1.5' }), { host: '192.168.1.5', exposed: true });
  assert.deepEqual(resolveServeBind({ host: '[::]' }), { host: '::', exposed: true });
  assert.deepEqual(resolveServeBind({ host: '::1' }), { host: '::1', exposed: false });
  assert.deepEqual(resolveServeBind({ host: 'localhost' }), { host: 'localhost', exposed: false });
  assert.deepEqual(resolveServeBind({ host: '0:0:0:0:0:0:0:1' }), { host: '::1', exposed: false });
  assert.deepEqual(resolveServeBind({ host: '::ffff:127.0.0.1' }).exposed, false);
  assert.throws(() => resolveServeBind({ host: '0.0.0.0', lan: true }));
  assert.throws(() => resolveServeBind({ host: ' ' }));
});

test('loopback detection', () => {
  for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]', 'deck.localhost']) {
    assert.equal(isLoopbackAddress(h), true, h);
  }
  for (const h of ['0.0.0.0', '::', '192.168.1.5', 'example.com', 'localhost.example.com', '127.0.0.1.nip.io']) {
    assert.equal(isLoopbackAddress(h), false, h);
  }
});

test('host header check blocks rebinding names on a loopback bind', () => {
  const bind = resolveServeBind({});
  assert.equal(isAllowedHostHeader(bind, 'localhost:4321'), true);
  assert.equal(isAllowedHostHeader(bind, '127.0.0.1:4321'), true);
  assert.equal(isAllowedHostHeader(bind, '[::1]:4321'), true);
  assert.equal(isAllowedHostHeader(bind, 'evil.example:4321'), false);
  assert.equal(isAllowedHostHeader(bind, 'localhost.evil.example'), false);
  assert.equal(isAllowedHostHeader(bind, undefined), false);
  assert.equal(isAllowedHostHeader(bind, ''), false);
  assert.equal(isAllowedHostHeader(resolveServeBind({ lan: true }), 'my-mac.lan:4321'), true);
});

test('printed URLs and warning', () => {
  assert.equal(localServeUrl(resolveServeBind({}), 4321), 'http://localhost:4321');
  assert.equal(localServeUrl(resolveServeBind({ lan: true }), 4321), 'http://localhost:4321');
  assert.equal(localServeUrl(resolveServeBind({ host: '192.168.1.5' }), 4321), 'http://192.168.1.5:4321');
  assert.equal(localServeUrl(resolveServeBind({ host: 'fd00::5' }), 4321), 'http://[fd00::5]:4321');
  const warning = exposedServeWarning(resolveServeBind({ host: '192.168.1.5' }), 4321);
  assert.match(warning, /WARNING/);
  assert.match(warning, /without signing in/);
  assert.match(warning, /http:\/\/192\.168\.1\.5:4321/);
});

test('the bound address decides exposure, not the requested spelling', () => {
  const requested = resolveServeBind({ host: 'preview.localhost' });
  assert.equal(bindFromAddress(requested, '127.0.0.1').exposed, false);
  assert.equal(bindFromAddress(requested, '192.168.1.5').exposed, true);
  assert.equal(bindFromAddress(resolveServeBind({}), '::1').exposed, false);
  assert.equal(bindFromAddress(resolveServeBind({ lan: true }), '0.0.0.0').exposed, true);
  assert.equal(bindFromAddress(resolveServeBind({ host: '::' }), '::').exposed, true);
});

test('explicit loopback binds advertise their own address', () => {
  assert.equal(localServeUrl(resolveServeBind({ host: '127.0.0.2' }), 4321), 'http://127.0.0.2:4321');
  assert.equal(localServeUrl(resolveServeBind({ host: '::1' }), 4321), 'http://[::1]:4321');
  assert.match(exposedServeWarning(resolveServeBind({ lan: true }), 1), /cover save-deck uploads/);
});
