import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export function getConfigDir() {
  const override = process.env.CASTLE_CLI_HOME || process.env.CASTLE_HOME;
  if (override) return path.resolve(override);
  return path.join(os.homedir(), '.castle');
}

function readConfigFile(filename: string): any {
  const configPath = path.join(getConfigDir(), filename);
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch {}
  return null;
}

const CONFIG_DIR_MODE = 0o700;
const CONFIG_FILE_MODE = 0o600;

// The config directory holds the Castle token, so keep it owner-only. An existing
// directory is tightened only when this user owns it (CASTLE_CLI_HOME may point
// somewhere shared).
function ensurePrivateDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: CONFIG_DIR_MODE });
  if (process.platform === 'win32') return;
  try {
    const stat = fs.statSync(dir);
    const uid = process.getuid?.();
    if (uid !== undefined && stat.uid === uid && (stat.mode & 0o777) !== CONFIG_DIR_MODE) {
      fs.chmodSync(dir, CONFIG_DIR_MODE);
    }
  } catch {}
}

// Write via a 0600 temp file and rename, so the token is never readable by other
// users, even briefly, and an existing world-readable file is replaced, not reused.
export function writePrivateFile(filePath: string, contents: string) {
  ensurePrivateDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, contents, { mode: CONFIG_FILE_MODE, flag: 'wx' });
    fs.chmodSync(tmpPath, CONFIG_FILE_MODE);
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
    throw error;
  }
  try {
    fs.chmodSync(filePath, CONFIG_FILE_MODE);
  } catch {}
}

function writeConfigFile(filename: string, data: any) {
  writePrivateFile(path.join(getConfigDir(), filename), JSON.stringify(data));
}

export function getToken(): string | null {
  const config = readConfigFile('config.json');
  return config?.token ?? null;
}

export function setToken(token: string | null) {
  const config = readConfigFile('config.json') || {};
  config.token = token;
  writeConfigFile('config.json', config);
}
