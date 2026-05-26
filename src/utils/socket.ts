export const REGISTRY_SCHEMA_VERSION = 2;
export const LOOPBACK_HOST = '127.0.0.1';

export interface Endpoint {
  host: string;
  port: number;
}

function isValidPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65535;
}

export function endpointLabel(endpoint: Endpoint): string {
  return `${endpoint.host}:${endpoint.port}`;
}

export function endpointFromRegistry(registry: any, source = 'CLI server registry'): Endpoint | null {
  if (!registry) return null;
  if (registry.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new Error(`${source} has an incompatible format. Restart castle serve or connect.`);
  }
  if (typeof registry.host !== 'string' || !isValidPort(registry.port)) {
    throw new Error(`${source} is missing a TCP endpoint. Restart castle serve or connect.`);
  }
  return { host: registry.host, port: registry.port };
}
