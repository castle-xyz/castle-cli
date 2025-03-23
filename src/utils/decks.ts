import * as fs from 'fs';
import * as path from 'path';
import Axios from 'axios';
import { glob } from 'glob';

import * as API from './api.js';

function headerForEntryId(entryId) {
  return `-- DO NOT MODIFY THIS LINE! castle-cli-config entryId:${entryId}\n\n`;
}

function removeHeader(script) {
  let result = script
    .split('\n')
    .filter((line) => !line.includes('castle-cli-config'))
    .join('\n');

  if (result.startsWith('\n')) {
    result = result.substring(1);
  }

  if (result.startsWith('\n')) {
    result = result.substring(1);
  }

  return result;
}

function getCastleDir(deckDir) {
  let result = path.join(deckDir, '.castle');

  if (!fs.existsSync(result)) {
    fs.mkdirSync(result, { recursive: true });
  }

  return result;
}

function getCacheDir(deckDir) {
  let result = path.join(deckDir, '.castle', 'cache');

  if (!fs.existsSync(result)) {
    fs.mkdirSync(result, { recursive: true });
  }

  return result;
}

function getBlueprintsDir(cardDir) {
  // blueprints can be moved anywhere, this is just the default
  const blueprintsDir = path.join(cardDir, 'blueprints');
  if (!fs.existsSync(blueprintsDir)) {
    fs.mkdirSync(blueprintsDir);
  }

  return blueprintsDir;
}

export async function syncSceneDataAsync({ deckDir, cardId, sceneDataUrl }) {
  const response = await Axios.get(sceneDataUrl);
  const sceneData = response.data;
  const cacheDir = getCacheDir(deckDir);
  const cacheFilePath = path.join(cacheDir, `${cardId}.json`);

  fs.writeFileSync(cacheFilePath, JSON.stringify(sceneData, null, 2));

  let castleDir = getCastleDir(deckDir);
  let cardVersionsFilePath = path.join(castleDir, 'cardversions.json');
  let cardVersions = {};

  try {
    cardVersions = JSON.parse(fs.readFileSync(cardVersionsFilePath, 'utf8'));
  } catch (e) {}

  cardVersions[cardId] = sceneDataUrl;
  fs.writeFileSync(cardVersionsFilePath, JSON.stringify(cardVersions, null, 2));

  return sceneData;
}

export async function cloneCardAsync({ cardId, sceneDataUrl, cardDir, deckDir }) {
  const sceneData = await syncSceneDataAsync({ cardId, sceneDataUrl, deckDir });
  const library = sceneData.snapshot.library;

  const entryIds = Object.keys(library);

  const blueprintsDir = getBlueprintsDir(cardDir);

  for (const entryId of entryIds) {
    const entry = library[entryId];
    if (entry.entryType == 'actorBlueprint') {
      const title = entry.title;
      const components = entry.actorBlueprint.components;
      const script = components.Script;

      if (script && script.code) {
        let dedupedTitle = title.replace(/[^a-zA-Z0-9]/g, '_');
        let filename = path.join(blueprintsDir, `${dedupedTitle}.lua`);

        if (fs.existsSync(filename)) {
          let counter = 0;
          while (fs.existsSync(filename)) {
            counter++;
            filename = path.join(blueprintsDir, `${dedupedTitle}_${counter}.lua`);
          }
          dedupedTitle = `${dedupedTitle}_${counter}`;
        }

        let codeWithHeader = `${headerForEntryId(entryId)}${script.code}`;

        fs.writeFileSync(filename, codeWithHeader);
      }
    }
  }
}

export async function readDeckFromDirectoryAsync({ dir, log }) {
  if (!dir) {
    dir = '.';
  }

  let filePath = path.join(dir, 'deck.json');

  if (!fs.existsSync(filePath)) {
    log(`No deck.json found in the current directory.`);
    return;
  }

  let deckId = null;
  try {
    const deckConfig = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    deckId = deckConfig.deckId;
  } catch (e) {
    log(`Error reading deck.json: ${e}`);
    return;
  }

  if (!deckId) {
    log(`No deck ID found in deck.json.`);
    return;
  }

  let deck;

  try {
    deck = await API.deck(deckId);
  } catch (e) {}

  if (!deck) {
    log(`Deck with ID ${deckId} not found.`);
    return;
  }

  return deck;
}

export async function pullCardAsync({ cardId, sceneDataUrl, cardDir, deckDir }) {
  const sceneData = await syncSceneDataAsync({ cardId, sceneDataUrl, deckDir });
  const library = sceneData.snapshot.library;

  const entryIds = Object.keys(library);

  const entryIdToScriptFilename = {};

  const scriptFiles = await glob('**/*.lua', {
    cwd: cardDir,
    ignore: ['node_modules/**'],
  });

  for (const scriptFile of scriptFiles) {
    try {
      let scriptData = fs.readFileSync(path.join(cardDir, scriptFile), 'utf8');
      let lines = scriptData.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('castle-cli-config')) {
          try {
            let entryId = lines[0].split('entryId:')[1].split(' ')[0].trim();
            entryIdToScriptFilename[entryId] = scriptFile;
          } catch (e) {}

          break;
        }
      }
    } catch (e) {}
  }

  for (const entryId of entryIds) {
    const entry = library[entryId];
    if (entry.entryType == 'actorBlueprint') {
      const title = entry.title;
      const components = entry.actorBlueprint.components;
      const script = components.Script;

      if (script && script.code) {
        let filename;

        if (entryIdToScriptFilename[entryId]) {
          filename = path.join(cardDir, entryIdToScriptFilename[entryId]);
        } else {
          const blueprintsDir = getBlueprintsDir(cardDir);

          let dedupedTitle = title.replace(/[^a-zA-Z0-9]/g, '_');
          filename = path.join(blueprintsDir, `${dedupedTitle}.lua`);

          if (fs.existsSync(filename)) {
            let counter = 0;
            while (fs.existsSync(filename)) {
              counter++;
              filename = path.join(blueprintsDir, `${dedupedTitle}_${counter}.lua`);
            }
            dedupedTitle = `${dedupedTitle}_${counter}`;
          }
        }

        let codeWithHeader = `${headerForEntryId(entryId)}${script.code}`;

        fs.writeFileSync(filename, codeWithHeader);
      }
    }
  }
}

interface DeckInput {
  deckId: string;
}

interface CardInput {
  cardId: string;
  sceneData: object;
}

async function updateCardAndDeckAsync(deck: DeckInput, card: CardInput) {
  await API.updateCardAndDeckV2(
    {
      blocks: [],
      ...card,
    },
    deck
  );
}

export async function newSceneDataForCardAsync({ cardId, cardDir, deckDir }) {
  const cacheDir = getCacheDir(deckDir);
  const sceneData = JSON.parse(fs.readFileSync(path.join(cacheDir, `${cardId}.json`), 'utf8'));

  let library = sceneData.snapshot.library;

  const entryIds = Object.keys(library);

  const entryIdToScriptFilename = {};

  const scriptFiles = await glob('**/*.lua', {
    cwd: cardDir,
    ignore: ['node_modules/**'],
  });

  for (const scriptFile of scriptFiles) {
    try {
      let scriptData = fs.readFileSync(path.join(cardDir, scriptFile), 'utf8');
      let lines = scriptData.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('castle-cli-config')) {
          try {
            let entryId = lines[0].split('entryId:')[1].split(' ')[0].trim();
            entryIdToScriptFilename[entryId] = scriptFile;
          } catch (e) {}

          break;
        }
      }
    } catch (e) {}
  }

  let modified = false;

  for (const entryId of entryIds) {
    const entry = library[entryId];
    if (entry.entryType == 'actorBlueprint') {
      const components = entry.actorBlueprint.components;
      const script = components.Script;

      if (script && script.code) {
        if (entryIdToScriptFilename[entryId]) {
          let filename = path.join(cardDir, entryIdToScriptFilename[entryId]);
          let fileScript = fs.readFileSync(filename, 'utf8');

          let codeWithoutHeader = removeHeader(fileScript);

          if (codeWithoutHeader.trim() !== script.code.trim()) {
            modified = true;

            library[entryId].actorBlueprint.components.Script.code = codeWithoutHeader;
          }
        }
      }
    }
  }

  if (modified) {
    sceneData.snapshot.library = library;
  }

  return {
    sceneData,
    modified,
  };
}

export async function pushCardAsync({ deckId, cardId, cardDir, deckDir }) {
  let { sceneData, modified } = await newSceneDataForCardAsync({ cardDir, deckDir, cardId });

  if (modified) {
    await updateCardAndDeckAsync({ deckId }, { cardId, sceneData });
  }
}
