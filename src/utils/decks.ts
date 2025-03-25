import * as fs from 'fs';
import * as path from 'path';
import Axios from 'axios';
import { glob } from 'glob';
import * as yaml from 'js-yaml';
import _ from 'lodash';

import * as API from './api.js';

const COMPONENTS_TO_SKIP = ['Body', 'Script', 'Drawing2'];

const DEFAULT_ACTOR = {
  bp: {
    components: {
      Body: {
        x: 0,
        y: 0,
        angle: 0,
        widthScale: 0.17497,
        heightScale: 0.17497,
      },
      Drawing2: {
        initialFrame: 1,
      },
    },
  },
};

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
  let result = path.join(deckDir, '.castle', '.cache');

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

function serializeComponent(component) {
  if (!component.disabled) {
    delete component.disabled;
  }

  return component;
}

function serializeComponents(components) {
  let result = {};
  for (const key in components) {
    if (COMPONENTS_TO_SKIP.includes(key)) {
      continue;
    }
    result[key] = serializeComponent(components[key]);
  }
  return result;
}

function serializeActor(actor) {
  let components = actor.bp.components;
  let drawing = components.Drawing2;
  if (drawing) {
    let keys = Object.keys(drawing);
    if (keys.length == 1 && keys[0] == 'initialFrame' && drawing.initialFrame == 1) {
      delete components.Drawing2;
    }
  }

  return {
    actorId: actor.actorId,
    entryId: actor.parentEntryId,
    components,
  };
}

function deserializeActor(actor) {
  return {
    actorId: actor.actorId,
    parentEntryId: actor.entryId,
    bp: {
      components: actor.components,
    },
  };
}

export async function syncSceneDataAsync({ deckDir, cardId, sceneDataUrl }) {
  const response = await Axios.get(sceneDataUrl);
  const sceneData = response.data;
  const cacheDir = getCacheDir(deckDir);
  const cacheFilePath = path.join(cacheDir, `${cardId}.json`);

  fs.writeFileSync(cacheFilePath, JSON.stringify(sceneData, null, 2));
  fs.writeFileSync(path.join(cacheDir, `${cardId}.version`), sceneDataUrl);

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

function newFilenameForTitle({ title, extension, blueprintsDir }) {
  let dedupedTitle = title.replace(/[^a-zA-Z0-9]/g, '_');
  let filename = path.join(blueprintsDir, `${dedupedTitle}.${extension}`);

  if (fs.existsSync(filename)) {
    let counter = 0;
    while (fs.existsSync(filename)) {
      counter++;
      filename = path.join(blueprintsDir, `${dedupedTitle}_${counter}.${extension}`);
    }
  }

  return filename;
}

async function writeSceneLayoutAsync({ sceneData, cardDir, entryIdToTitle }) {
  const actors = sceneData.snapshot.actors;

  let layout = actors.map(serializeActor).map((actor) => {
    return {
      actorId: actor.actorId,
      title: entryIdToTitle ? entryIdToTitle[actor.entryId] : undefined,
      entryId: actor.entryId,
      components: actor.components,
    };
  });

  fs.writeFileSync(path.join(cardDir, 'layout.yaml'), yaml.dump(layout));
}

export async function cloneCardAsync({ cardId, sceneDataUrl, cardDir, deckDir }) {
  const sceneData = await syncSceneDataAsync({ cardId, sceneDataUrl, deckDir });
  const library = sceneData.snapshot.library;

  const entryIds = Object.keys(library);

  const blueprintsDir = getBlueprintsDir(cardDir);
  const entryIdToTitle = {};

  for (const entryId of entryIds) {
    const entry = library[entryId];
    if (entry.entryType == 'actorBlueprint') {
      const title = entry.title;

      entryIdToTitle[entryId] = title;

      const components = entry.actorBlueprint.components;
      const script = components.Script;
      let scriptPath: any = null;

      if (script && script.code) {
        let filename = newFilenameForTitle({ title, extension: 'lua', blueprintsDir });

        let codeWithHeader = `${headerForEntryId(entryId)}${script.code}`;

        fs.writeFileSync(filename, codeWithHeader);

        scriptPath = path.relative(blueprintsDir, filename);
      }

      const blueprintFilename = newFilenameForTitle({ title, extension: 'yaml', blueprintsDir });
      const blueprintData = {
        title,
        entryId,
        components: serializeComponents(components),
      };
      fs.writeFileSync(blueprintFilename, yaml.dump(blueprintData));
    }
  }

  await writeSceneLayoutAsync({ sceneData, cardDir, entryIdToTitle });
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

  const entryIdToScriptFilename = await getEntryIdToScriptFilenameAsync(cardDir);
  const entryIdToBlueprintFilename = await getEntryIdToBlueprintFilenameAsync(cardDir);

  const blueprintsDir = getBlueprintsDir(cardDir);
  const entryIdToTitle = {};

  for (const entryId of entryIds) {
    const entry = library[entryId];
    if (entry.entryType == 'actorBlueprint') {
      const title = entry.title;

      entryIdToTitle[entryId] = title;

      const components = entry.actorBlueprint.components;
      const script = components.Script;
      let scriptPath: any = null;

      if (script && script.code) {
        let filename;

        if (entryIdToScriptFilename[entryId]) {
          filename = path.join(cardDir, entryIdToScriptFilename[entryId]);
        } else {
          filename = newFilenameForTitle({ title, extension: 'lua', blueprintsDir });
        }

        let codeWithHeader = `${headerForEntryId(entryId)}${script.code}`;

        fs.writeFileSync(filename, codeWithHeader);

        scriptPath = path.relative(blueprintsDir, filename);
      }

      let blueprintFilename;
      if (entryIdToBlueprintFilename[entryId]) {
        blueprintFilename = path.join(cardDir, entryIdToBlueprintFilename[entryId]);
      } else {
        blueprintFilename = newFilenameForTitle({ title, extension: 'yaml', blueprintsDir });
      }

      const blueprintData = {
        title,
        entryId,
        components: serializeComponents(components),
      };
      fs.writeFileSync(blueprintFilename, yaml.dump(blueprintData));
    }
  }

  await writeSceneLayoutAsync({ sceneData, cardDir, entryIdToTitle });
}

async function getEntryIdToScriptFilenameAsync(cardDir) {
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

  return entryIdToScriptFilename;
}

async function getEntryIdToBlueprintFilenameAsync(cardDir) {
  const entryIdToConfigFilename = {};

  const configFiles = await glob('**/*.yaml', {
    cwd: cardDir,
    ignore: ['node_modules/**'],
  });

  for (const configFile of configFiles) {
    try {
      let configData = fs.readFileSync(path.join(cardDir, configFile), 'utf8');
      let data = yaml.load(configData);
      if (data.entryId) {
        entryIdToConfigFilename[data.entryId] = configFile;
      }
    } catch (e) {}
  }

  return entryIdToConfigFilename;
}

export async function newSceneDataForCardAsync({ cardId, cardDir, deckDir }) {
  const cacheDir = getCacheDir(deckDir);
  const sceneData = JSON.parse(fs.readFileSync(path.join(cacheDir, `${cardId}.json`), 'utf8'));

  let library = sceneData.snapshot.library;

  const entryIds = Object.keys(library);

  const entryIdToScriptFilename = await getEntryIdToScriptFilenameAsync(cardDir);
  const entryIdToBlueprintFilename = await getEntryIdToBlueprintFilenameAsync(cardDir);

  let modifiedLibrary = false;

  for (const entryId of entryIds) {
    const entry = library[entryId];
    if (entry.entryType == 'actorBlueprint') {
      const components = entry.actorBlueprint.components;
      const script = components.Script;

      if (entryIdToBlueprintFilename[entryId]) {
        let filename = path.join(cardDir, entryIdToBlueprintFilename[entryId]);
        let fileConfigData = yaml.load(fs.readFileSync(filename, 'utf8'));
        if (fileConfigData) {
          let title = fileConfigData.title;

          if (!_.isEqual(title, entry.title)) {
            modifiedLibrary = true;
            library[entryId].title = title;
          }

          delete fileConfigData.title;
          delete fileConfigData.entryId;

          let actorBlueprint = _.merge(
            _.cloneDeep(library[entryId].actorBlueprint),
            fileConfigData
          );

          if (!_.isEqual(actorBlueprint, library[entryId].actorBlueprint)) {
            modifiedLibrary = true;

            /*
            console.log(JSON.stringify(actorBlueprint));
            console.log('\n\n\n')
            console.log(JSON.stringify(library[entryId].actorBlueprint));
            console.log('\n\n\n')*/

            library[entryId].actorBlueprint = actorBlueprint;
          }
        }
      }

      if (script && script.code) {
        if (entryIdToScriptFilename[entryId]) {
          let filename = path.join(cardDir, entryIdToScriptFilename[entryId]);
          let fileScript = fs.readFileSync(filename, 'utf8');

          let codeWithoutHeader = removeHeader(fileScript);

          if (codeWithoutHeader.trim() !== script.code.trim()) {
            modifiedLibrary = true;

            library[entryId].actorBlueprint.components.Script.code = codeWithoutHeader;
          }
        }
      }
    }
  }

  if (modifiedLibrary) {
    sceneData.snapshot.library = library;
  }

  let modifiedLayout = false;
  const layoutFilePath = path.join(cardDir, 'layout.yaml');
  if (fs.existsSync(layoutFilePath)) {
    let layoutData = yaml.load(fs.readFileSync(layoutFilePath, 'utf8'));
    if (layoutData) {
      let actorIdToActor = {};

      sceneData.snapshot.actors.forEach((actor) => {
        actorIdToActor[actor.actorId] = actor;
      });

      sceneData.snapshot.actors = layoutData.map((actor) => {
        let newActor = deserializeActor(actor);

        let oldActor = actorIdToActor[newActor.actorId];
        if (oldActor) {
          newActor = _.merge(_.cloneDeep(oldActor), newActor);

          if (!_.isEqual(newActor, oldActor)) {
            /*
            console.log(JSON.stringify(newActor));
            console.log(JSON.stringify(oldActor));
            */

            modifiedLayout = true;
          }
        } else {
          newActor = _.merge(_.cloneDeep(DEFAULT_ACTOR), newActor);
          modifiedLayout = true;
        }

        return newActor;
      });
    }
  }

  /*
  console.log(`modifiedLibrary: ${modifiedLibrary}`);
  console.log(`modifiedLayout: ${modifiedLayout}`);*/

  return {
    sceneData,
    modified: modifiedLibrary || modifiedLayout,
  };
}

async function pushCardAsync({ cardId, cardDir, deckDir }) {
  let { sceneData, modified } = await newSceneDataForCardAsync({ cardDir, deckDir, cardId });

  if (modified) {
    return {
      cardId,
      sceneData,
    };
  }

  return null;
}

export async function pushCardsAsync({ deckDir, cards }) {
  let cardIdsToSceneData: any = {};

  for (let card of cards) {
    let cardData = await pushCardAsync({ cardId: card.cardId, cardDir: card.cardDir, deckDir });
    if (cardData) {
      cardIdsToSceneData[cardData.cardId] = cardData.sceneData;
    }
  }

  if (_.keys(cardIdsToSceneData).length == 0) {
    return;
  }

  let sceneDataUploadConfigs = await API.createSceneDataUploadConfig(_.keys(cardIdsToSceneData));
  let uploads: any = [];

  for (let i = 0; i < sceneDataUploadConfigs.length; i++) {
    let sceneDataUploadConfig = sceneDataUploadConfigs[i];
    let cardId = sceneDataUploadConfig.cardId;

    try {
      let sceneData = cardIdsToSceneData[cardId];

      const formData = new FormData();

      formData.append('Content-Type', 'application/json');

      Object.entries(sceneDataUploadConfig.postFields).forEach(([k, v]) => {
        formData.append(k, `${v}`);
      });

      formData.append('file', new Blob([JSON.stringify(sceneData)]));

      await Axios.post(sceneDataUploadConfig.postUrl, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      uploads.push({
        cardId,
        uploadId: sceneDataUploadConfig.uploadId,
      });
    } catch (e) {
      console.warn(`error uploading scene data for card ${cardId}: ${e}`);
    }
  }

  let uploadResults = await API.uploadSceneData(uploads);
  for (let uploadResult of uploadResults) {
    await syncSceneDataAsync({
      deckDir,
      cardId: uploadResult.cardId,
      sceneDataUrl: uploadResult.sceneDataUrl,
    });
  }
}

export async function syncCardVersionsAsync({ deckDir }) {
  let castleDir = getCastleDir(deckDir);
  let cardVersionsFilePath = path.join(castleDir, 'cardversions.json');
  let cardVersions = {};

  try {
    cardVersions = JSON.parse(fs.readFileSync(cardVersionsFilePath, 'utf8'));
  } catch (e) {}

  let cardIds = Object.keys(cardVersions);
  let cacheDir = getCacheDir(deckDir);

  for (let cardId of cardIds) {
    console.log(`checking card ${cardId}...`);
    const sceneDataUrl = cardVersions[cardId];

    let cachedSceneDataUrl = '';
    try {
      cachedSceneDataUrl = fs.readFileSync(path.join(cacheDir, `${cardId}.version`), 'utf8').trim();
    } catch (e) {}

    if (cachedSceneDataUrl != sceneDataUrl) {
      console.log(`Syncing card ${cardId}...`);
      await syncSceneDataAsync({ deckDir, cardId, sceneDataUrl });
    }
  }
}
