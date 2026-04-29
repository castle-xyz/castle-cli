import * as crypto from 'crypto';
import * as path from 'path';

export function shortSocketPath(kind: string, key: string): string {
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
  return path.join('/tmp', `castle-cli4-${kind}-${hash}.sock`);
}
