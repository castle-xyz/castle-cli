import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Axios from 'axios';
import { glob } from 'glob';
import yaml from 'yaml';
import _ from 'lodash';
import { v4 as uuidv4 } from 'uuid';

import * as API from './api.js';
import * as Behaviors from './behaviors.js';
import * as Utils from './utils.js';
import { applyComponentChanges, getComponentScriptValues } from './castle-core-node.js';

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

function contentHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

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
 */
export function getCurrentDeck(deckDir: string = '.'): string | undefined {
  let filePath = path.join(deckDir, 'deck.yaml');
  try {
    const deckConfig = yaml.parse(fs.readFileSync(filePath, 'utf8'));
    return deckConfig.deckId;
  } catch (e: any) {
    console.error(`Error reading deck.yaml: ${e.message ?? e}`);
    return undefined;
  }
}

/**
 * Get the card IDs of the cards in the current deck.
 */
export function getCurrentDeckCards(deckDir: string = '.'): string[] {
  try {
    const cards = fs.readdirSync(deckDir).filter(file => file.startsWith('card-'));
    return cards.map(card => card.replace('card-', ''));
  } catch (e: any) {
    console.error(`Error reading cards: ${e.message ?? e}`);
    return [];
  }
}

// Serialize an actor from internal sceneData format → actors.yaml object format (raw values)
function serializeActorToYaml({ actor, entry }) {
  const body = actor.bp?.components?.Body || {};

  let result: any = {
    title: entry?.title,
    entryId: actor.parentEntryId,
    x: body.x || 0,
    y: body.y || 0,
  };

  if (body.angle) {
    result.angle = body.angle; // raw radians, no conversion
  }

  if (body.widthScale !== undefined) {
    result.widthScale = body.widthScale; // raw, no conversion
  }

  if (body.heightScale !== undefined) {
    result.heightScale = body.heightScale; // raw, no conversion
  }

  // Drawing2 initialFrame if not 1
  const drawing2 = actor.bp?.components?.Drawing2;
  if (drawing2 && drawing2.initialFrame && drawing2.initialFrame !== 1) {
    result.initialFrame = drawing2.initialFrame;
  }

  return result;
}

// Deserialize an actor from actors.yaml object format → internal sceneData format (raw values, no conversion)
function deserializeActor({ actor, entry }) {
  actor = _.cloneDeep(actor);

  // actor has: { actorId, entryId (=parentEntryId), x, y, angle (radians), widthScale, heightScale, initialFrame? }
  let body: any = {
    x: actor.x || 0,
    y: actor.y || 0,
    angle: actor.angle || 0,           // raw radians, no conversion
    widthScale: actor.widthScale || 0,  // raw, no conversion
    heightScale: actor.heightScale || 0,
  };

  if (!actor.components) {
    actor.components = {};
  }

  actor.components.Body = body;

  // Preserve Drawing2 initialFrame if present and not 1
  if (actor.initialFrame && actor.initialFrame !== 1) {
    actor.components.Drawing2 = {
      ...actor.components.Drawing2,
      initialFrame: actor.initialFrame,
    };
  }

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

// Write actors.yaml (object format, raw values) and variables.yaml for a card.
// Also writes .castle/meta.json for mobile sync compatibility.
export async function writeActorsAndVariablesAsync({
  sceneData,
  cardDir,
  library,
  deckId,
  cardId,
}: {
  sceneData: any;
  cardDir: string;
  library: any;
  deckId: string;
  cardId: string;
}) {
  const actors = sceneData.snapshot.actors;

  const actorsObj: any = {};
  for (const actor of actors) {
    const entry = library[actor.parentEntryId];
    if (!entry) continue;

    const key = `a${actor.actorId}`;
    actorsObj[key] = serializeActorToYaml({ actor, entry });
  }

  const actorsContent = yaml.stringify(actorsObj);
  fs.writeFileSync(path.join(cardDir, 'actors.yaml'), actorsContent);

  // Write empty variables.yaml (server decks don't have mobile variables)
  const variablesContent = yaml.stringify([]);
  fs.writeFileSync(path.join(cardDir, 'variables.yaml'), variablesContent);

  // Write meta.json for mobile sync compatibility
  const castleDir = path.join(cardDir, '.castle');
  if (!fs.existsSync(castleDir)) fs.mkdirSync(castleDir, { recursive: true });

  const hashes: Record<string, string> = {};
  hashes['actors.yaml'] = contentHash(actorsContent);
  hashes['variables.yaml'] = contentHash(variablesContent);

  // Add blueprint hashes and blueprintIdMap
  const blueprintIdMap: Record<string, string> = {};
  const bpDir = path.join(cardDir, 'blueprints');
  if (fs.existsSync(bpDir)) {
    const yamlFiles = fs.readdirSync(bpDir).filter(f => f.endsWith('.yaml'));
    for (const f of yamlFiles) {
      const content = fs.readFileSync(path.join(bpDir, f), 'utf-8');
      const slug = f.replace('.yaml', '');
      hashes[path.join('blueprints', f)] = contentHash(content);

      try {
        const data = yaml.parse(content);
        if (data.entryId) blueprintIdMap[slug] = data.entryId;
      } catch (e) {}

      // Also hash .lua file if it exists
      const luaFile = f.replace('.yaml', '.lua');
      const luaPath = path.join(bpDir, luaFile);
      if (fs.existsSync(luaPath)) {
        const luaContent = fs.readFileSync(luaPath, 'utf-8');
        hashes[path.join('blueprints', luaFile)] = contentHash(luaContent);
      }
    }
  }

  const meta = {
    deckId,
    cardId,
    hashes,
    blueprintIdMap,
  };

  fs.writeFileSync(path.join(castleDir, 'meta.json'), JSON.stringify(meta, null, 2));
}

// Converts component values from internal (scene-data) format to script/rules format via WASM.
// Body.widthScale and heightScale are multiplied by 10 (handleGetProperty convention).
// Bools are preserved as actual booleans. Large computed fields (Drawing2 hash/drawData,
// per-instance Body position) are removed since they don't belong in blueprint YAML files.
async function toScriptFormat(components: Record<string, any>): Promise<Record<string, any>> {
  const result = await getComponentScriptValues(components);

  // Remove large computed Drawing2 fields — these are regenerated by the engine from art assets
  if (result.Drawing2) {
    delete result.Drawing2.hash;
    delete result.Drawing2.drawData;
    delete result.Drawing2.physicsBodyData;
  }

  // Remove per-instance Body position fields — these live in actors.yaml, not blueprint YAML
  if (result.Body) {
    delete result.Body.x;
    delete result.Body.y;
    delete result.Body.angle;
  }

  return result;
}

export async function cloneCardAsync({ cardId, sceneDataUrl, cardDir, deckDir }) {
  const sceneData = await syncSceneDataAsync({ cardId, sceneDataUrl, deckDir });
  const library = sceneData.snapshot.library;

  // Get deckId for meta.json
  let deckId = '';
  try {
    const deckConfig = yaml.parse(fs.readFileSync(path.join(deckDir, 'deck.yaml'), 'utf8'));
    deckId = deckConfig.deckId || '';
  } catch (e) {}

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

      // Convert internal format → script format via WASM (e.g. Body.widthScale ×10).
      const componentsForDisk = await toScriptFormat(components);

      // WASM strips Rules.rules (complex non-Prop array) — restore from original scene data
      // so serializeComponent can write the correct rules to the YAML file.
      if (components.Rules?.rules !== undefined) {
        if (!componentsForDisk.Rules) componentsForDisk.Rules = {};
        componentsForDisk.Rules.rules = components.Rules.rules;
      }

      // Include ALL components (Body and Drawing2 are no longer skipped)
      const blueprintData = {
        title,
        entryId,
        components: Behaviors.serializeComponents({ components: componentsForDisk, writeRulesFile, writeScriptFile }),
      };
      fs.writeFileSync(blueprintFilename, yaml.stringify(blueprintData));
    }
  }

  await writeActorsAndVariablesAsync({ sceneData, cardDir, library, deckId, cardId });
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

  // Get deckId for meta.json
  let deckId = '';
  try {
    const deckConfig = yaml.parse(fs.readFileSync(path.join(deckDir, 'deck.yaml'), 'utf8'));
    deckId = deckConfig.deckId || '';
  } catch (e) {}

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

      // Convert internal format → script format via WASM.
      const componentsForDisk = await toScriptFormat(components);

      // WASM strips Rules.rules (complex non-Prop array) — restore from original scene data.
      if (components.Rules?.rules !== undefined) {
        if (!componentsForDisk.Rules) componentsForDisk.Rules = {};
        componentsForDisk.Rules.rules = components.Rules.rules;
      }

      // Include ALL components (Body and Drawing2 are no longer skipped)
      const blueprintData = {
        title,
        entryId,
        components: Behaviors.serializeComponents({ components: componentsForDisk, writeRulesFile, writeScriptFile }),
      };
      fs.writeFileSync(blueprintFilename, yaml.stringify(blueprintData));
    }
  }

  await writeActorsAndVariablesAsync({ sceneData, cardDir, library, deckId, cardId });
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

export async function newSceneDataForCardAsync({
  cardId,
  cardDir,
  deckDir,
}: {
  cardId: string;
  cardDir: string;
  deckDir: string;
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

            // If local Rules.rules is empty but cache has rules, preserve cached rules.
            // Empty local rules files result from a WASM stripping bug during clone/pull
            // (Rules.rules is complex data not returned by getComponentScriptValues).
            const localRules = localBlueprintData.components?.Rules?.rules;
            const cachedRules = library[entryId].actorBlueprint?.components?.Rules?.rules;
            if (
              Array.isArray(localRules) &&
              localRules.length === 0 &&
              Array.isArray(cachedRules) &&
              cachedRules.length > 0
            ) {
              delete localBlueprintData.components.Rules.rules;
            }
          }

          let mergedBlueprint = Utils.mergeSkipArray(
            _.cloneDeep(library[entryId].actorBlueprint),
            localBlueprintData
          );
          // Apply local component changes through WASM to trigger handleSetProperty side effects
          // (e.g. Body.widthScale script-format ÷10 → internal format).
          const normalizedComponents = await applyComponentChanges(
            mergedBlueprint.components ?? {},
            localBlueprintData.components ?? {}
          );
          // WASM only serializes Prop structs, so complex data is dropped:
          // Rules.rules, Drawing2.hash/drawData/physicsBodyData, etc.
          // Preserve that data by merging WASM scalar-prop output on top of the merged blueprint.
          const finalComponents: any = {};
          const allBehaviors = new Set([
            ...Object.keys(mergedBlueprint.components ?? {}),
            ...Object.keys(normalizedComponents),
          ]);
          for (const behavior of allBehaviors) {
            const cached = ((mergedBlueprint.components ?? {}) as any)[behavior] ?? {};
            const wasm = (normalizedComponents as any)[behavior] ?? {};
            const final: any = { ...cached };
            for (const [key, wasmVal] of Object.entries(wasm)) {
              if (wasmVal === false && cached[key]) {
                // Bool-as-number bug: old WASM wrote booleans as numbers (e.g. visible: 1).
                // New WASM's applyComponentChanges treats number 1 as false for bool props.
                // If cached has a truthy value (1 or true) and WASM returned false, use true.
                final[key] = true;
              } else {
                final[key] = wasmVal;
              }
            }
            finalComponents[behavior] = final;
          }
          let actorBlueprint = { ...mergedBlueprint, components: finalComponents };

          if (!Utils.isEqualUnordered(actorBlueprint, library[entryId].actorBlueprint)) {
            modifiedLibrary = true;
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

  // Read actors.yaml (object format) instead of layout.yaml (array format)
  const actorsFilePath = path.join(cardDir, 'actors.yaml');
  if (fs.existsSync(actorsFilePath)) {
    const actorsObj = yaml.parse(fs.readFileSync(actorsFilePath, 'utf8'));
    if (actorsObj && typeof actorsObj === 'object' && !Array.isArray(actorsObj)) {
      let actorIdToActor: any = {};

      sceneData.snapshot.actors.forEach((actor) => {
        if (actor.actorId) {
          actorIdToActor[actor.actorId] = actor;
        }
      });

      sceneData.snapshot.actors = Object.entries(actorsObj)
        .map(([key, data]: [string, any]) => {
          // Convert object key to actorId (e.g. "a123" → "123")
          const actorId = key.startsWith('a') ? key.slice(1) : key;
          const entry = library[data.entryId];
          return {
            ...data,
            actorId,
            entry,
          };
        })
        .filter((actor) => !!actor.entry)
        .map((actor) => {
          let newActor = deserializeActor({ actor, entry: actor.entry });

          let oldActor = actorIdToActor[newActor.actorId];
          if (oldActor) {
            newActor = Utils.mergeSkipArray(_.cloneDeep(oldActor), newActor);

            if (!Utils.isEqualUnordered(newActor, oldActor)) {
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
    const sceneDataUrl = cardVersions[cardId];

    // Skip mobile-sourced entries (they have no URL to fetch)
    if (sceneDataUrl === 'mobile') continue;

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
