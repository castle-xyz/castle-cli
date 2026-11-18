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

// The config directory holds the Castle token, so keep it owner-only. It may be a
// symlink (dotfile managers do this); what matters is the real directory. Tighten
// it when this user owns it, then refuse to write the token unless nobody else can
// add, remove or swap entries in it: owned by this user (or root) and not group- or
// world-writable.
function ensurePrivateDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true, mode: CONFIG_DIR_MODE });
  const realDir = fs.realpathSync(dir);
  if (process.platform === 'win32') return realDir;
  const uid = process.getuid?.();
  let stat = fs.statSync(realDir);
  if (uid !== undefined && stat.uid === uid && (stat.mode & 0o777) !== CONFIG_DIR_MODE) {
    try {
      fs.chmodSync(realDir, CONFIG_DIR_MODE);
    } catch {}
    stat = fs.statSync(realDir);
  }
  const trustedOwner = uid === undefined || stat.uid === uid || stat.uid === 0;
  if (!stat.isDirectory() || !trustedOwner || (stat.mode & 0o022) !== 0) {
    throw new Error(
      `Refusing to write credentials: ${realDir} can be modified by other users. ` +
        'Make it owned by you with mode 0700, or set CASTLE_CLI_HOME to a private directory.',
    );
  }
  return realDir;
}

// Tighten a token file and directory left open by an older CLI, without rewriting
// the file. Works on what is actually opened: the real directory behind any symlink,
// and the file through its descriptor, so a symlinked config.json is tightened too.
function tightenExisting(dir: string, filename: string) {
  if (process.platform === 'win32') return;
  const uid = process.getuid?.();
  if (uid === undefined) return;
  try {
    const realDir = fs.realpathSync(dir);
    const stat = fs.statSync(realDir);
    if (stat.isDirectory() && stat.uid === uid && (stat.mode & 0o077) !== 0) {
      fs.chmodSync(realDir, CONFIG_DIR_MODE);
    }
  } catch {}
  let fd: number | undefined;
  try {
    fd = fs.openSync(path.join(dir, filename), fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
    const stat = fs.fstatSync(fd);
    if (stat.isFile() && (stat.mode & 0o077) !== 0) {
      if (stat.uid === uid) {
        try {
          fs.fchmodSync(fd, CONFIG_FILE_MODE);
        } catch {}
      }
      if ((fs.fstatSync(fd).mode & 0o077) !== 0) {
        console.error(
          `Warning: ${path.join(dir, filename)} holds your Castle token and other users can read it. ` +
            'Run `chmod 600` on it; on a shared machine, treat the token as exposed and log in again.',
        );
      }
    }
  } catch {
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Write via a 0600 temp file and rename, so the token is never readable by other
// users, even briefly, and an existing world-readable file is replaced, not reused.
// The mode is set on the open descriptor, so no pathname is followed after creation.
export function writePrivateFile(filePath: string, contents: string) {
  filePath = path.join(ensurePrivateDir(path.dirname(filePath)), path.basename(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  let created = false;
  try {
    const fd = fs.openSync(tmpPath, 'wx', CONFIG_FILE_MODE);
    created = true;
    try {
      if (process.platform !== 'win32') fs.fchmodSync(fd, CONFIG_FILE_MODE);
      fs.writeFileSync(fd, contents);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    if (created) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {}
    }
    throw error;
  }
}

function writeConfigFile(filename: string, data: any) {
  writePrivateFile(path.join(getConfigDir(), filename), JSON.stringify(data));
}

export function getToken(): string | null {
  tightenExisting(getConfigDir(), 'config.json');
  const config = readConfigFile('config.json');
  return config?.token ?? null;
}

export function setToken(token: string | null) {
  const config = readConfigFile('config.json') || {};
  config.token = token;
  writeConfigFile('config.json', config);
}
