const ospath = require('ospath');
import * as path from 'path';
import * as fs from 'fs';

export function getConfigDir() {
  return path.join(ospath.home(), '.castle');
}

export function readConfigFile(filename: string) {
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

export function writeConfigFile(filename: string, data: any) {
  const configDir = getConfigDir();
  const configFilePath = path.join(configDir, filename);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir);
  }

  fs.writeFileSync(configFilePath, JSON.stringify(data));
}

export function getToken() {
  const config = readConfigFile('config.json');
  return config ? config.token : null;
}

export function setToken(token: string) {
  const config = readConfigFile('config.json') || {};
  config.token = token;
  writeConfigFile('config.json', config);
}
