import * as fs from 'fs';
import * as path from 'path';

export interface SocketEndpoint {
  path: string;
  displayPath: string;
  cwd?: string;
}

const MAX_UNIX_SOCKET_PATH_BYTES = process.platform === 'darwin' ? 100 : 104;

export function projectSocketEndpoint(kind: string, projectDir: string): SocketEndpoint {
  const castleDir = path.join(projectDir, '.castle');
  fs.mkdirSync(castleDir, { recursive: true });
  const displayPath = path.join(castleDir, `${kind}.sock`);

  if (Buffer.byteLength(displayPath) <= MAX_UNIX_SOCKET_PATH_BYTES) {
    return { path: displayPath, displayPath };
  }

  return {
    path: `${kind}.sock`,
    displayPath,
    cwd: castleDir,
  };
}

export function projectSocketPath(kind: string, projectDir: string): string {
  return projectSocketEndpoint(kind, projectDir).displayPath;
}

export function socketEndpointFromRegistry(registry: any): SocketEndpoint | null {
  if (!registry?.sockPath) return null;
  return {
    path: registry.sockCwd && registry.sockName ? registry.sockName : registry.sockPath,
    displayPath: registry.sockPath,
    cwd: registry.sockCwd,
  };
}

export function socketExists(endpoint: SocketEndpoint): boolean {
  return fs.existsSync(endpoint.displayPath);
}

export function unlinkSocket(endpoint: SocketEndpoint): void {
  fs.unlinkSync(endpoint.displayPath);
}

export function withSocketCwd<T>(endpoint: SocketEndpoint, fn: () => T): T {
  if (!endpoint.cwd) return fn();

  const previousCwd = process.cwd();
  process.chdir(endpoint.cwd);
  try {
    return fn();
  } finally {
    process.chdir(previousCwd);
  }
}
