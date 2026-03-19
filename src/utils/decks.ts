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
import { applySnapshot, getSnapshotExternalValues } from './castle-core-node.js';

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

// Body fields that are engine-computed and must not be written to blueprint YAMLs.
// handleWriteComponent includes these, but handleSetProperty applies them in ways that
// can corrupt physics bodies (e.g. fixtures override the drawing-computed physics body,
// breaking tap detection). User-editable Body props are widthScale/heightScale/visible/
// relativeToCamera; x/y/angle are per-actor and live in actors.yaml instead.
const BODY_COMPUTED_FIELDS = [
  'x', 'y', 'angle',
  'width', 'height',
  'fixtures',
  'editorBounds',
  'relativeToCameraFix',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'layerName',
];

function stripBlueprintComponents(components: any): void {
  if (components.Drawing2) {
    delete components.Drawing2.hash;
    delete components.Drawing2.drawData;
    delete components.Drawing2.physicsBodyData;
    delete components.Drawing2.currentFrame;
  }
  if (components.Body) {
    for (const field of BODY_COMPUTED_FIELDS) {
      delete components.Body[field];
    }
  }
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

// Build the actors.yaml object from internal-format sceneData actors.
// Converts Body → Layout display name and applies ×10 to widthScale/heightScale.
function buildActorsYamlObj(actors: any[], library: any): any {
  const actorsObj: any = {};
  for (const actor of actors) {
    const entry = library[actor.parentEntryId];
    if (!entry) continue;

    const key = `a${actor.actorId}`;
    const body = actor.bp?.components?.Body ?? {};
    const drawing2 = actor.bp?.components?.Drawing2 ?? {};

    const layout: any = { x: body.x ?? 0, y: body.y ?? 0 };
    if (body.angle) layout.angle = body.angle; // radians — unchanged
    if (body.widthScale !== undefined) layout.widthScale = body.widthScale * 10; // ×10
    if (body.heightScale !== undefined) layout.heightScale = body.heightScale * 10; // ×10

    const components: any = { Layout: layout };
    if (drawing2.initialFrame && drawing2.initialFrame !== 1) {
      components.Drawing = { initialFrame: drawing2.initialFrame };
    }

    actorsObj[key] = { entryId: actor.parentEntryId, components };
  }
  return actorsObj;
}

// Write actors.yaml (nested display-name format) and variables.yaml for a card.
// Also writes .castle/meta.json for mobile sync compatibility.
// Actors are in internal sceneData format; this function converts to external format.
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
  const actorsObj = buildActorsYamlObj(actors, library);

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

  fs.writeFileSync(path.join(cardDir, '.castle', 'meta.json'), JSON.stringify(meta, null, 2));
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

  const blueprintsDir = getBlueprintsDir(cardDir);

  // Convert the whole snapshot internal→external in one WASM call
  const externalSnapshot = await getSnapshotExternalValues(sceneData.snapshot);

  // Restore Rules.rules from original sceneData (WASM only processes Prop values)
  // and strip engine-computed/per-instance fields from library blueprints
  for (const [entryId, entry] of Object.entries(externalSnapshot.library) as [string, any][]) {
    const origEntry = library[entryId];
    const components = entry.actorBlueprint?.components ?? {};

    stripBlueprintComponents(components);
    // Restore Rules.rules (WASM strips non-Prop complex data)
    if (origEntry?.actorBlueprint?.components?.Rules?.rules !== undefined) {
      if (!components.Rules) components.Rules = {};
      components.Rules.rules = origEntry.actorBlueprint.components.Rules.rules;
    }
  }

  // Write blueprint YAMLs
  for (const [entryId, entry] of Object.entries(externalSnapshot.library) as [string, any][]) {
    if (entry.entryType !== 'actorBlueprint') continue;
    const title = entry.title;
    const components = entry.actorBlueprint?.components ?? {};

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

  const entryIdToBlueprintFilename = await getEntryIdToBlueprintFilenameAsync(cardDir);
  const blueprintsDir = getBlueprintsDir(cardDir);

  // Convert the whole snapshot internal→external in one WASM call
  const externalSnapshot = await getSnapshotExternalValues(sceneData.snapshot);

  // Restore Rules.rules from original sceneData and strip engine-computed/per-instance fields
  for (const [entryId, entry] of Object.entries(externalSnapshot.library) as [string, any][]) {
    const origEntry = library[entryId];
    const components = entry.actorBlueprint?.components ?? {};

    stripBlueprintComponents(components);
    if (origEntry?.actorBlueprint?.components?.Rules?.rules !== undefined) {
      if (!components.Rules) components.Rules = {};
      components.Rules.rules = origEntry.actorBlueprint.components.Rules.rules;
    }
  }

  // Write blueprint YAMLs (preserving existing filenames if available)
  for (const [entryId, entry] of Object.entries(externalSnapshot.library) as [string, any][]) {
    if (entry.entryType !== 'actorBlueprint') continue;
    const title = entry.title;
    const components = entry.actorBlueprint?.components ?? {};

    let blueprintFilename: string;
    let localComponents: any = null;

    if (entryIdToBlueprintFilename[entryId]) {
      blueprintFilename = path.join(cardDir, entryIdToBlueprintFilename[entryId]);
      const localBlueprintData = yaml.parse(fs.readFileSync(blueprintFilename, 'utf8'));
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
      if (localComponents.Script?.file) scriptFilename = localComponents.Script.file;
      if (localComponents.Rules?.file) rulesFilename = localComponents.Rules.file;
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

  const library = sceneData.snapshot.library;
  const entryIds = Object.keys(library);
  const entryIdToBlueprintFilename = await getEntryIdToBlueprintFilenameAsync(cardDir);

  // 1. Build local library from blueprint YAMLs (external format, display→internal names)
  const localLibrary: any = {};
  for (const entryId of entryIds) {
    const entry = library[entryId];
    if (entry.entryType !== 'actorBlueprint') continue;
    if (!entryIdToBlueprintFilename[entryId]) continue;

    const blueprintFilename = path.join(cardDir, entryIdToBlueprintFilename[entryId]);
    const localBlueprintData = yaml.parse(fs.readFileSync(blueprintFilename, 'utf8'));
    if (!localBlueprintData) continue;

    const localComponents = Behaviors.deserializeComponents({
      components: localBlueprintData.components ?? {},
      readFile: (relativePath) =>
        fs.readFileSync(path.join(path.dirname(blueprintFilename), relativePath), 'utf8'),
    });

    localLibrary[entryId] = {
      entryType: 'actorBlueprint',
      title: localBlueprintData.title,
      actorBlueprint: { components: localComponents },
    };
  }

  // 2. Build local actors from actors.yaml (Layout→Body, Drawing→Drawing2, external values)
  const localActors: any[] = [];
  // Angle is stored in radians in actors.yaml but handleSetProperty converts degrees→radians.
  // We bypass WASM for angle and restore it directly after applySnapshot.
  const actorAngleMap: Record<string, number> = {};
  const actorsFilePath = path.join(cardDir, 'actors.yaml');
  let actorsFileExists = false;

  if (fs.existsSync(actorsFilePath)) {
    const actorsObj = yaml.parse(fs.readFileSync(actorsFilePath, 'utf8'));
    if (actorsObj && typeof actorsObj === 'object' && !Array.isArray(actorsObj)) {
      actorsFileExists = true;
      for (const [key, data] of Object.entries(actorsObj) as [string, any][]) {
        const actorId = key.startsWith('a') ? key.slice(1) : key;
        if (!library[data.entryId]) continue;

        const layout = data.components?.Layout ?? {};
        const drawing = data.components?.Drawing ?? {};

        // Store angle separately — bypass WASM (handleSetProperty treats input as degrees)
        if (layout.angle !== undefined) {
          actorAngleMap[actorId] = layout.angle; // radians, set directly after applySnapshot
        }

        // Map Layout → Body (exclude angle; applySnapshot converts widthScale ÷10 via handleSetProperty)
        const components: any = {
          Body: {
            x: layout.x ?? 0,
            y: layout.y ?? 0,
            widthScale: layout.widthScale ?? 0, // external ×10; applySnapshot converts ÷10
            heightScale: layout.heightScale ?? 0,
          },
        };

        // Map Drawing → Drawing2 (initialFrame only if non-default)
        if (drawing.initialFrame && drawing.initialFrame !== 1) {
          components.Drawing2 = { initialFrame: drawing.initialFrame };
        }

        localActors.push({ actorId, parentEntryId: data.entryId, bp: { components } });
      }
    }
  }

  // 3. Single WASM call — converts external values → internal for the whole snapshot
  const localSnapshot = { library: localLibrary, actors: localActors };
  const processedSnapshot = await applySnapshot(localSnapshot);

  // 4. Merge processed library with cache to restore engine-computed fields and local Rules.rules
  let modifiedLibrary = false;
  for (const entryId of Object.keys(processedSnapshot.library)) {
    const cached = library[entryId]?.actorBlueprint;
    if (!cached) continue;

    const localBP = localLibrary[entryId]?.actorBlueprint ?? {};
    const processed = processedSnapshot.library[entryId].actorBlueprint;

    // Three-way merge:
    // - cached: has Drawing2.hash/drawData, server Rules.rules (complex data)
    // - localBP: has local Rules.rules (from blueprint file, takes priority over cached)
    // - processed: has WASM-converted Prop values (widthScale÷10, etc.)
    // Use mergeWith to replace arrays (not deep-merge) so local Rules.rules wins
    const merged = _.mergeWith(
      _.cloneDeep(cached),
      localBP,
      processed,
      (dst: any, src: any) => {
        if (Array.isArray(src)) return _.cloneDeep(src);
      }
    );

    if (!Utils.isEqualUnordered(merged, cached)) {
      modifiedLibrary = true;
    }

    library[entryId] = {
      ...library[entryId],
      title: localLibrary[entryId]?.title ?? library[entryId].title,
      actorBlueprint: merged,
    };

    if (localLibrary[entryId]?.title && localLibrary[entryId].title !== library[entryId].title) {
      modifiedLibrary = true;
    }
  }

  if (modifiedLibrary) {
    sceneData.snapshot.library = library;
  }

  // 5. Apply processed actors from actors.yaml (if file exists)
  // Restore angles bypassed during applySnapshot (actors.yaml stores radians,
  // but handleSetProperty for angle converts degrees→radians — so we skip WASM for angle)
  for (const actor of processedSnapshot.actors) {
    const angle = actorAngleMap[actor.actorId];
    if (angle !== undefined && actor.bp?.components?.Body) {
      actor.bp.components.Body.angle = angle;
    }
  }

  let modifiedLayout = false;
  if (actorsFileExists) {
    const oldActors = sceneData.snapshot.actors;
    sceneData.snapshot.actors = processedSnapshot.actors;
    if (!Utils.isEqualUnordered(processedSnapshot.actors, oldActors)) {
      modifiedLayout = true;
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
