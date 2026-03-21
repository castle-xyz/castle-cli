import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function getConfigDir() {
  return path.join(os.homedir(), '.castle');
}

function readConfigFile(filename: string): any {
  const configDir = getConfigDir();
  const configFilePath = path.join(configDir, filename);

  try {
    if (fs.existsSync(configFilePath)) {
      const configFileContent = fs.readFileSync(configFilePath, 'utf-8');
      return JSON.parse(configFileContent);
    }
  } catch (e) {
    console.warn(`error reading config file at ${configFilePath}:`, e);
  }

  return null;
}

function writeConfigFile(filename: string, data: any) {
  const configDir = getConfigDir();
  const configFilePath = path.join(configDir, filename);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configFilePath, JSON.stringify(data));
}

export function getToken(): string | null {
  const config = readConfigFile('config.json');
  return config ? config.token : null;
}

export function setToken(token: string | null) {
  const config = readConfigFile('config.json') || {};
  config.token = token;
  writeConfigFile('config.json', config);
}
