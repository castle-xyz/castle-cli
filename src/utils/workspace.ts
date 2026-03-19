import * as fs from 'fs';
import * as path from 'path';
import yaml from 'yaml';

const GITIGNORE_CONTENT = `.castle/.cache
.castle/logs.txt
.castle/commands.json
.castle/screenshots/
**/.castle/meta.json
**/.DS_Store
`;

export function initializeDeckDir(deckDir: string, deckId: string): void {
  if (!fs.existsSync(deckDir)) fs.mkdirSync(deckDir, { recursive: true });

  const deckYamlPath = path.join(deckDir, 'deck.yaml');
  if (!fs.existsSync(deckYamlPath)) {
    fs.writeFileSync(deckYamlPath, yaml.stringify({ deckId }));
  }

  const gitignorePath = path.join(deckDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT);
  }

  const castleDir = path.join(deckDir, '.castle');
  if (!fs.existsSync(castleDir)) fs.mkdirSync(castleDir);

  const cliApiVersionPath = path.join(castleDir, 'cli_api_version');
  if (!fs.existsSync(cliApiVersionPath)) {
    fs.writeFileSync(cliApiVersionPath, '1');
  }

  const logsPath = path.join(castleDir, 'logs.txt');
  if (!fs.existsSync(logsPath)) {
    fs.writeFileSync(logsPath, '');
  }

  const commandsPath = path.join(castleDir, 'commands.json');
  if (!fs.existsSync(commandsPath)) {
    fs.writeFileSync(commandsPath, '');
  }

  const cachePath = path.join(castleDir, '.cache');
  if (!fs.existsSync(cachePath)) fs.mkdirSync(cachePath);

  const screenshotsPath = path.join(castleDir, 'screenshots');
  if (!fs.existsSync(screenshotsPath)) fs.mkdirSync(screenshotsPath);
}

export function initializeCardDir(cardDir: string, cardId: string): void {
  if (!fs.existsSync(cardDir)) fs.mkdirSync(cardDir, { recursive: true });

  const cardYamlPath = path.join(cardDir, 'card.yaml');
  if (!fs.existsSync(cardYamlPath)) {
    fs.writeFileSync(cardYamlPath, yaml.stringify({ cardId }));
  }
}
