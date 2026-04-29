import * as fs from 'fs';
import * as path from 'path';

export function projectSocketPath(kind: string, projectDir: string): string {
  const castleDir = path.join(projectDir, '.castle');
  fs.mkdirSync(castleDir, { recursive: true });
  return path.join(castleDir, `${kind}.sock`);
}
