import * as net from 'net';
import * as os from 'os';
import { LOOPBACK_HOST } from './socket.js';

export const LAN_HOST = '0.0.0.0';

export interface ServeBind {
  // Address passed to server.listen().
  host: string;
  // True when the listener accepts connections from beyond this machine.
  exposed: boolean;
}

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

// Canonical form of an IP literal (IPv6 compressed, lowercase), or null for a name.
function canonicalIp(host: string): string | null {
  const h = stripBrackets(host.trim().toLowerCase());
  if (net.isIPv4(h)) return h;
  if (net.isIPv6(h)) {
    try {
      return stripBrackets(new URL(`http://[${h}]/`).hostname);
    } catch {
      return null;
    }
  }
  return null;
}

function isLoopbackIp(ip: string): boolean {
  if (net.isIPv4(ip)) return ip.startsWith('127.');
  if (ip === '::1') return true;
  const mapped = /^::ffff:(.+)$/.exec(ip);
  if (!mapped) return false;
  // URL canonicalizes ::ffff:127.0.0.1 to ::ffff:7f00:1.
  const tail = mapped[1];
  if (net.isIPv4(tail)) return tail.startsWith('127.');
  return /^7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(tail);
}

// For Host headers: a loopback IP literal, or `localhost` / `*.localhost`, which
// browsers always resolve to loopback themselves.
export function isLoopbackAddress(host: string): boolean {
  const ip = canonicalIp(host);
  if (ip) return isLoopbackIp(ip);
  const h = stripBrackets(host.trim().toLowerCase());
  return h === 'localhost' || h.endsWith('.localhost');
}

// After listen(), decide from the address the OS actually bound, so a hostname or an
// unusual spelling of an address cannot misclassify the listener.
export function bindFromAddress(requested: ServeBind, boundAddress: string): ServeBind {
  const ip = canonicalIp(boundAddress);
  const exposed = !(ip && isLoopbackIp(ip));
  return { host: requested.host, exposed };
}

// serve binds loopback unless the caller explicitly opts in with --host or --lan.
export function resolveServeBind(options: { host?: string; lan?: boolean }): ServeBind {
  if (options.host !== undefined && options.lan) {
    throw new Error('Use either --host or --lan, not both.');
  }
  if (options.lan) return { host: LAN_HOST, exposed: true };
  if (options.host === undefined) return { host: LOOPBACK_HOST, exposed: false };
  const host = stripBrackets(options.host.trim());
  if (!host) throw new Error('--host requires an address, e.g. --host 0.0.0.0');
  const ip = canonicalIp(host);
  if (ip) return { host: ip, exposed: !isLoopbackIp(ip) };
  // A hostname: provisional until bindFromAddress() sees what it resolved to.
  return { host, exposed: host.toLowerCase() !== 'localhost' };
}

function isWildcard(host: string): boolean {
  return host === '0.0.0.0' || host === '::';
}

function urlHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

// The URL to open locally. The default and wildcard binds are reachable as
// localhost (browsers try both ::1 and 127.0.0.1); any other address is printed as
// itself so the URL always reaches the listener.
export function localServeUrl(bind: ServeBind, port: number): string {
  if (bind.host === LOOPBACK_HOST || bind.host === 'localhost' || isWildcard(bind.host)) {
    return `http://localhost:${port}`;
  }
  return `http://${urlHost(bind.host)}:${port}`;
}

// Addresses other machines can use, for the warning printed on an exposed bind.
export function networkServeUrls(bind: ServeBind, port: number): string[] {
  if (!bind.exposed) return [];
  if (!isWildcard(bind.host)) return [`http://${urlHost(bind.host)}:${port}`];
  const urls: string[] = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.internal) continue;
      if (bind.host === '0.0.0.0' && address.family !== 'IPv4') continue;
      if (address.family === 'IPv6' && address.address.toLowerCase().startsWith('fe80')) continue;
      if (address.address.startsWith('169.254.')) continue;
      urls.push(`http://${urlHost(address.address)}:${port}`);
    }
  }
  return urls;
}

export function exposedServeWarning(bind: ServeBind, port: number): string {
  const urls = networkServeUrls(bind, port);
  const lines = [
    `WARNING: serve is listening on ${bind.host}, not just this machine.`,
    'Anyone who can reach this machine on the network can, without signing in: load this deck,',
    'its scene data and variables; post logs to it; and register as the preview, so the image',
    'they send can become a screenshot or the cover save-deck uploads. Use this only on a',
    'network you trust.',
  ];
  if (urls.length) lines.push(`Reachable at: ${urls.join(', ')}`);
  return lines.join('\n');
}

// On a loopback bind, only accept requests addressed to a loopback name. A web page
// that rebinds its own hostname to 127.0.0.1 still sends its own name in Host, so this
// keeps other sites from reading the preview through DNS rebinding.
export function isAllowedHostHeader(bind: ServeBind, hostHeader: string | undefined): boolean {
  if (bind.exposed) return true;
  if (!hostHeader) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname;
  } catch {
    return false;
  }
  return isLoopbackAddress(hostname);
}
