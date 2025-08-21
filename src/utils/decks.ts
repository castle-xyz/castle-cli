import * as fs from 'fs';
import * as path from 'path';
import Axios from 'axios';
import { glob } from 'glob';
import yaml from 'yaml';
import _ from 'lodash';
import { v4 as uuidv4 } from 'uuid';

import * as API from './api.js';
import * as Behaviors from './behaviors.js';
import * as Utils from './utils.js';

export const DEFAULT_ACTOR = {
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

function getCastleDir(deckDir) {
  let result = path.join(deckDir, '.castle');

  if (!fs.existsSync(result)) {
    fs.mkdirSync(result, { recursive: true });
  }

  return result;
}

export function getCacheDir(deckDir) {
  let result = path.join(deckDir, '.castle', '.cache');

  if (!fs.existsSync(result)) {
    fs.mkdirSync(result, { recursive: true });
  }

  return result;
}

export function getBlueprintsDir(cardDir) {
  // blueprints can be moved anywhere, this is just the default
  const blueprintsDir = path.join(cardDir, 'blueprints');
  if (!fs.existsSync(blueprintsDir)) {
    fs.mkdirSync(blueprintsDir);
  }

  return blueprintsDir;
}

/**
 * Get the deck ID of the current deck.
 * By checking the deck.yaml file explicitly,
 * we take an extra step to ensure that the deck is valid.
 * @param deckDir - string
 * @returns string | undefined
 */
export function getCurrentDeck(deckDir: string = '.'): string | undefined {
  let filePath = path.join(deckDir, 'deck.yaml');
  try {
    const deckConfig = yaml.parse(fs.readFileSync(filePath, 'utf8'));
    return deckConfig.deckId;
  } catch (e) {
    console.error(`Error reading deck.yaml: ${e.message ?? e}`);
    return undefined;
  }
}

/**
 * Get the card IDs of the cards in the current deck.
 * @param deckDir - string
 * @returns string[]
 */
export function getCurrentDeckCards(deckDir: string = '.'): string[] {
  try {
    const cards = fs.readdirSync(deckDir).filter(file => file.startsWith('card-'));
    return cards.map(card => card.replace('card-', ''));
  } catch (e) {
    console.error(`Error reading cards: ${e.message ?? e}`);
    return [];
  }
}

function roundSize(size) {
  return Math.round(size * 100) / 100;
}

export function serializeActor({ actor, entry }) {
  actor = _.cloneDeep(actor);
  entry = _.cloneDeep(entry);

  let components = actor.bp.components;
  let drawing = components.Drawing2;
  if (drawing) {
    let keys = Object.keys(drawing);
    if (keys.length == 1 && keys[0] == 'initialFrame' && drawing.initialFrame == 1) {
      delete components.Drawing2;
    }
  }

  let actorId = actor.actorId;
  try {
    actorId = parseInt(actorId);
  } catch (e) {}

  const BODY_FIELDS = ['x', 'y', 'angle', 'widthScale', 'heightScale'];

  let body = _.pick(_.cloneDeep(components.Body), BODY_FIELDS);
  components.Body = _.omit(body, BODY_FIELDS);

  if (body.angle) {
    body.angle = Utils.serializeAngle(body.angle);
  }

  if (_.isEmpty(components.Body)) {
    delete components.Body;
  }

  let result: any = {
    actorId,
    title: entry.title ? entry.title : undefined,
    entryId: actor.parentEntryId,
  };

  try {
    try {
      let drawing2 = entry.actorBlueprint.components.Drawing2;
      let drawData = drawing2.drawData;
      let initialFrame = drawing2.initialFrame - 1;
      let frameBounds = drawData.framesBounds[initialFrame];

      let frameWidth = frameBounds.maxX - frameBounds.minX;
      let frameHeight = frameBounds.maxY - frameBounds.minY;

      // this is needed for the case where the drawing is a single vertical or horizontal line
      // there's no width / height because the line width is from the hard coded line width in the
      // client
      if (frameWidth == 0) {
        frameWidth = 1;
      }
      if (frameHeight == 0) {
        frameHeight = 1;
      }

      body.width = roundSize(frameWidth * body.widthScale);
      body.height = roundSize(frameHeight * body.heightScale);

      delete body.widthScale;
      delete body.heightScale;
    } catch (e) {
      console.warn(`error serializing actor1 ${actorId}: ${e}`);
    }

    result = {
      ...result,
      ...body,
    };
  } catch (e) {
    console.warn(`error serializing actor2 ${actorId}: ${e}`);
  }

  if (!_.isEmpty(components)) {
    result = {
      ...result,
      components,
    };
  }

  return result;
}

function deserializeActor({ actor, entry }) {
  actor = _.cloneDeep(actor);
  entry = _.cloneDeep(entry);

  let body = actor?.components?.Body || {};
  body.x = actor.x;
  body.y = actor.y;
  body.angle = Utils.deserializeAngle(actor.angle || 0);
  body.widthScale = actor.widthScale || 0;
  body.heightScale = actor.heightScale || 0;

  try {
    let width = actor.width;
    let height = actor.height;

    let drawing2 = entry.actorBlueprint.components.Drawing2;
    let drawData = drawing2.drawData;
    let initialFrame = drawing2.initialFrame - 1;
    let frameBounds = drawData.framesBounds[initialFrame];

    let frameWidth = frameBounds.maxX - frameBounds.minX;
    let frameHeight = frameBounds.maxY - frameBounds.minY;

    // this is needed for the case where the drawing is a single vertical or horizontal line
    // there's no width / height because the line width is from the hard coded line width in the
    // client
    if (frameWidth == 0) {
      frameWidth = 1;
    }
    if (frameHeight == 0) {
      frameHeight = 1;
    }

    if (width) {
      body.widthScale = width / frameWidth;
      delete body.width;
    }

    if (height) {
      body.heightScale = height / frameHeight;
      delete body.height;
    }
  } catch (e) {}

  if (!actor.components) {
    actor.components = {};
  }

  actor.components.Body = body;

  return {
    actorId: `${actor.actorId}` || uuidv4(),
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

async function writeSceneLayoutAsync({ sceneData, cardDir, library }) {
  const actors = sceneData.snapshot.actors;

  let layout = actors
    .map((actor) => {
      actor.entry = library[actor.parentEntryId];

      return actor;
    })
    .filter((actor) => {
      return !!actor.entry;
    })
    .map((actor) => {
      return serializeActor({ actor, entry: actor.entry });
    });

  fs.writeFileSync(path.join(cardDir, 'layout.yaml'), yaml.stringify(layout));
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

      const blueprintFilename = newFilenameForTitle({ title, extension: 'yaml', blueprintsDir });
      const scriptFilename = path.relative(
        blueprintsDir,
        newFilenameForTitle({ title: title + '_script', extension: 'lua', blueprintsDir })
      );
      const rulesFilename = path.relative(
        blueprintsDir,
        newFilenameForTitle({ title: title + '_rules', extension: 'yaml', blueprintsDir })
      );

      const writeRulesFile = (content) => {
        fs.writeFileSync(path.join(blueprintsDir, rulesFilename), content);

        return rulesFilename;
      };

      const writeScriptFile = (content) => {
        fs.writeFileSync(path.join(blueprintsDir, scriptFilename), content);

        return scriptFilename;
      };

      const blueprintData = {
        title,
        entryId,
        components: Behaviors.serializeComponents({ components, writeRulesFile, writeScriptFile }),
      };
      fs.writeFileSync(blueprintFilename, yaml.stringify(blueprintData));
    }
  }

  await writeSceneLayoutAsync({ sceneData, cardDir, library });
}

export async function readDeckFromDirectoryAsync({ dir, log }) {
  if (!dir) {
    dir = '.';
  }

  let filePath = path.join(dir, 'deck.yaml');

  if (!fs.existsSync(filePath)) {
    log(`No deck.yaml found in the current directory.`);
    return;
  }

  let deckId = null;
  try {
    const deckConfig = yaml.parse(fs.readFileSync(filePath, 'utf8'));
    deckId = deckConfig.deckId;
  } catch (e) {
    log(`Error reading deck.yaml: ${e}`);
    return;
  }

  if (!deckId) {
    log(`No deck ID found in deck.yaml.`);
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

  const entryIdToBlueprintFilename = await getEntryIdToBlueprintFilenameAsync(cardDir);

  const blueprintsDir = getBlueprintsDir(cardDir);

  for (const entryId of entryIds) {
    const entry = library[entryId];
    if (entry.entryType == 'actorBlueprint') {
      const title = entry.title;

      const components = entry.actorBlueprint.components;
      let localComponents: any = null;

      let blueprintFilename;
      if (entryIdToBlueprintFilename[entryId]) {
        blueprintFilename = path.join(cardDir, entryIdToBlueprintFilename[entryId]);

        let localBlueprintData = yaml.parse(fs.readFileSync(blueprintFilename, 'utf8'));
        if (localBlueprintData) {
          localComponents = localBlueprintData.components;
        }
      } else {
        blueprintFilename = newFilenameForTitle({ title, extension: 'yaml', blueprintsDir });
      }

      let scriptFilename = path.relative(
        blueprintsDir,
        newFilenameForTitle({ title: title + '_script', extension: 'lua', blueprintsDir })
      );
      let rulesFilename = path.relative(
        blueprintsDir,
        newFilenameForTitle({ title: title + '_rules', extension: 'yaml', blueprintsDir })
      );

      if (localComponents) {
        const script = localComponents.Script;
        if (script && script.file) {
          scriptFilename = script.file;
        }

        const rules = localComponents.Rules;
        if (rules && rules.file) {
          rulesFilename = rules.file;
        }
      }

      const writeRulesFile = (content) => {
        fs.writeFileSync(path.join(blueprintsDir, rulesFilename), content);

        return rulesFilename;
      };

      const writeScriptFile = (content) => {
        fs.writeFileSync(path.join(blueprintsDir, scriptFilename), content);

        return scriptFilename;
      };

      const blueprintData = {
        title,
        entryId,
        components: Behaviors.serializeComponents({ components, writeRulesFile, writeScriptFile }),
      };
      fs.writeFileSync(blueprintFilename, yaml.stringify(blueprintData));
    }
  }

  await writeSceneLayoutAsync({ sceneData, cardDir, library });
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
      let data = yaml.parse(configData);
      if (data.entryId) {
        entryIdToConfigFilename[data.entryId] = configFile;
      }
    } catch (e) {}
  }

  return entryIdToConfigFilename;
}

function addActorIdsToLayoutFile(layoutFilePath) {
  let layoutData = yaml.parse(fs.readFileSync(layoutFilePath, 'utf8'));
  if (layoutData) {
    let needsUpdate = false;
    for (let actor of layoutData) {
      if (!actor.actorId) {
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      let maxActorId = -1000000000;

      for (let actor of layoutData) {
        if (actor.actorId) {
          try {
            let actorId = parseInt(actor.actorId);
            if (actorId > maxActorId) {
              maxActorId = actorId;
            }
          } catch (e) {}
        }
      }

      for (let actor of layoutData) {
        if (!actor.actorId) {
          actor.actorId = `${maxActorId + 1}`;
        }
      }

      fs.writeFileSync(layoutFilePath, yaml.stringify(layoutData));
    }
  }
}

export async function newSceneDataForCardAsync({
  cardId,
  cardDir,
  deckDir,
  updateLayoutFile = false,
}) {
  const cacheDir = getCacheDir(deckDir);
  const sceneData = JSON.parse(fs.readFileSync(path.join(cacheDir, `${cardId}.json`), 'utf8'));

  let library = sceneData.snapshot.library;

  const entryIds = Object.keys(library);

  const entryIdToBlueprintFilename = await getEntryIdToBlueprintFilenameAsync(cardDir);

  let modifiedLibrary = false;

  for (const entryId of entryIds) {
    const entry = library[entryId];
    if (entry.entryType == 'actorBlueprint') {
      if (entryIdToBlueprintFilename[entryId]) {
        let blueprintFilename = path.join(cardDir, entryIdToBlueprintFilename[entryId]);
        let localBlueprintData = yaml.parse(fs.readFileSync(blueprintFilename, 'utf8'));
        if (localBlueprintData) {
          let title = localBlueprintData.title;

          if (!_.isEqual(title, entry.title)) {
            modifiedLibrary = true;
            library[entryId].title = title;
          }

          delete localBlueprintData.title;
          delete localBlueprintData.entryId;

          if (localBlueprintData.components) {
            localBlueprintData.components = Behaviors.deserializeComponents({
              components: localBlueprintData.components,
              readFile: (relativePath) => {
                return fs.readFileSync(
                  path.join(path.dirname(blueprintFilename), relativePath),
                  'utf8'
                );
              },
            });
          }

          let actorBlueprint = Utils.mergeSkipArray(
            _.cloneDeep(library[entryId].actorBlueprint),
            localBlueprintData
          );

          if (!Utils.isEqualUnordered(actorBlueprint, library[entryId].actorBlueprint)) {
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
    }
  }

  if (modifiedLibrary) {
    sceneData.snapshot.library = library;
  }

  let modifiedLayout = false;
  const layoutFilePath = path.join(cardDir, 'layout.yaml');
  if (fs.existsSync(layoutFilePath)) {
    if (updateLayoutFile) {
      addActorIdsToLayoutFile(layoutFilePath);
    }

    let layoutData = yaml.parse(fs.readFileSync(layoutFilePath, 'utf8'));
    if (layoutData) {
      let actorIdToActor = {};

      sceneData.snapshot.actors.forEach((actor) => {
        if (actor.actorId) {
          actorIdToActor[actor.actorId] = actor;
        }
      });

      sceneData.snapshot.actors = layoutData
        .map((actor) => {
          actor.entry = library[actor.entryId];

          return actor;
        })
        .filter((actor) => {
          return !!actor.entry;
        })
        .map((actor) => {
          let newActor = deserializeActor({ actor, entry: actor.entry });

          let oldActor = actorIdToActor[newActor.actorId];
          if (oldActor) {
            newActor = Utils.mergeSkipArray(_.cloneDeep(oldActor), newActor);

            if (!Utils.isEqualUnordered(newActor, oldActor)) {
              /*
            console.log(JSON.stringify(newActor));
            console.log(JSON.stringify(oldActor));
            */

              modifiedLayout = true;
            }
          } else {
            newActor = Utils.mergeSkipArray(_.cloneDeep(DEFAULT_ACTOR), newActor);
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
  let { sceneData, modified } = await newSceneDataForCardAsync({
    cardDir,
    deckDir,
    cardId,
    updateLayoutFile: true,
  });

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
    } else {
      console.log(`No changes for card ${card.cardId}`);
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

    console.log(`Pushing updates for card ${cardId}...`);

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

export async function syncCardVersionsAsync({ deckDir, force = false }) {
  let castleDir = getCastleDir(deckDir);
  let cardVersionsFilePath = path.join(castleDir, 'cardversions.json');
  let cardVersions = {};

  try {
    cardVersions = JSON.parse(fs.readFileSync(cardVersionsFilePath, 'utf8'));
  } catch (e) {}

  let cardIds = Object.keys(cardVersions);
  let cacheDir = getCacheDir(deckDir);

  for (let cardId of cardIds) {
    // console.log(`checking card ${cardId}...`);
    const sceneDataUrl = cardVersions[cardId];

    let cachedSceneDataUrl = '';
    try {
      cachedSceneDataUrl = fs.readFileSync(path.join(cacheDir, `${cardId}.version`), 'utf8').trim();
    } catch (e) {}

    if (cachedSceneDataUrl != sceneDataUrl || force) {
      console.log(`Syncing card ${cardId}...`);
      await syncSceneDataAsync({ deckDir, cardId, sceneDataUrl });
    }
  }
}
