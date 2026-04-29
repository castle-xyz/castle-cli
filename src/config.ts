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

function writeConfigFile(filename: string, data: any) {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, filename), JSON.stringify(data));
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
