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

export function isLoopbackAddress(host: string): boolean {
  const h = stripBrackets(host.trim().toLowerCase());
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1') return true;
  return /^127(\.\d{1,3}){3}$/.test(h);
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
  if (isLoopbackAddress(host)) return { host, exposed: false };
  return { host, exposed: true };
}

function isWildcard(host: string): boolean {
  return host === '0.0.0.0' || host === '::';
}

function urlHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

// The URL to open locally. Wildcard and loopback binds are reachable as localhost.
export function localServeUrl(bind: ServeBind, port: number): string {
  if (!bind.exposed || isWildcard(bind.host)) return `http://localhost:${port}`;
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
      urls.push(`http://${urlHost(address.address)}:${port}`);
    }
  }
  return urls;
}

export function exposedServeWarning(bind: ServeBind, port: number): string {
  const urls = networkServeUrls(bind, port);
  const lines = [
    `WARNING: serve is listening on ${bind.host}, not just this machine.`,
    'Anyone who can reach this machine on the network can load this deck, its scene data and variables,',
    'and post logs to it, without signing in. Use this only on a network you trust.',
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
