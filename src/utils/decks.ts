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
import { applySnapshot, getSnapshotExternalValues, getCastleMetadata } from './castle-core-node.js';

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

function getCastleDir(deckDir: string) {
  let result = path.join(deckDir, '.castle');

  if (!fs.existsSync(result)) {
    fs.mkdirSync(result, { recursive: true });
  }

  return result;
}

export function getCacheDir(deckDir: string) {
  let result = path.join(deckDir, '.castle', '.cache');

  if (!fs.existsSync(result)) {
    fs.mkdirSync(result, { recursive: true });
  }

  return result;
}

export function getBlueprintsDir(cardDir: string) {
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

export async function syncSceneDataAsync({ deckDir, cardId, sceneDataUrl }: { deckDir: string; cardId: string; sceneDataUrl: string }) {
  const response = await Axios.get(sceneDataUrl);
  const sceneData = response.data;
  const cacheDir = getCacheDir(deckDir);
  const cacheFilePath = path.join(cacheDir, `${cardId}.json`);

  fs.writeFileSync(cacheFilePath, JSON.stringify(sceneData, null, 2));
  fs.writeFileSync(path.join(cacheDir, `${cardId}.version`), sceneDataUrl);

  let castleDir = getCastleDir(deckDir);
  let cardVersionsFilePath = path.join(castleDir, 'cardversions.json');
  let cardVersions: Record<string, string> = {};

  try {
    cardVersions = JSON.parse(fs.readFileSync(cardVersionsFilePath, 'utf8'));
  } catch (e) {}

  cardVersions[cardId] = sceneDataUrl;
  fs.writeFileSync(cardVersionsFilePath, JSON.stringify(cardVersions, null, 2));

  return sceneData;
}

function newFilenameForTitle({ title, extension, blueprintsDir }: { title: string; extension: string; blueprintsDir: string }) {
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
// Writes flat format with title (not entryId), angle in degrees, widthScale ×10.
function buildActorsYamlObj(actors: any[], library: any): any {
  const actorsObj: any = {};
  for (const actor of actors) {
    const entry = library[actor.parentEntryId];
    if (!entry) continue;

    const key = `a${actor.actorId}`;
    const body = actor.bp?.components?.Body ?? {};
    const drawing2 = actor.bp?.components?.Drawing2 ?? {};

    const actorEntry: any = { title: entry.title };
    actorEntry.x = body.x ?? 0;
    actorEntry.y = body.y ?? 0;
    if (body.angle) actorEntry.angle = Math.round(body.angle * (180 / Math.PI) * 1000) / 1000; // degrees
    if (body.widthScale !== undefined) actorEntry.widthScale = body.widthScale * 10; // ×10
    if (body.heightScale !== undefined) actorEntry.heightScale = body.heightScale * 10; // ×10
    if (drawing2.initialFrame && drawing2.initialFrame !== 1) {
      actorEntry.initialFrame = drawing2.initialFrame;
    }
    const text = actor.bp?.components?.Text ?? {};
    if (text.fontSizeScale !== undefined && text.fontSizeScale !== 1) {
      actorEntry.fontSizeScale = text.fontSizeScale;
    }
    // Only save content if it differs from the blueprint default (same logic as castle-client)
    const blueprintContent = entry.actorBlueprint?.components?.Text?.content;
    if (text.content !== undefined && text.content !== blueprintContent) {
      actorEntry.content = text.content;
    }

    const link = actor.bp?.components?.Link ?? {};
    const blueprintTargetDeckId = entry.actorBlueprint?.components?.Link?.targetDeckId;
    if (link.targetDeckId !== undefined && link.targetDeckId !== blueprintTargetDeckId) {
      actorEntry.targetDeckId = link.targetDeckId;
    }

    actorsObj[key] = actorEntry;
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

// Generate static context from WASM metadata (same for all decks/cards).
export async function generateStaticContext(): Promise<string> {
  const { behaviors, rules } = await getCastleMetadata();

  // --- Behaviors ---
  const behaviorLines: string[] = [];
  for (const behavior of Object.values(behaviors) as any[]) {
    const props: string[] = [];
    for (const [propName, spec] of Object.entries(behavior.propertySpecs ?? {}) as [string, any][]) {
      if (!spec.attribs?.rulesGet && !spec.attribs?.rulesSet) continue;
      const label = spec.attribs?.label || spec.attribs?.scriptName || propName;
      let desc = spec.type ?? '';
      if (spec.attribs?.min != null) desc += `, min: ${spec.attribs.min}`;
      if (spec.attribs?.max != null) desc += `, max: ${spec.attribs.max}`;
      if (spec.attribs?.allowedValues?.length > 0) desc += `, values: [${spec.attribs.allowedValues.join(', ')}]`;
      props.push(`    ${label}: ${desc}`);
    }
    if (props.length > 0) {
      behaviorLines.push(`  ${behavior.displayName}:\n${props.join('\n')}`);
    } else {
      behaviorLines.push(`  ${behavior.displayName}: {}`);
    }
  }

  // --- Rules ---
  const ruleLines: string[] = [];
  const behaviorNameToDisplay: Record<string, string> = {};
  for (const b of Object.values(behaviors) as any[]) {
    behaviorNameToDisplay[b.name] = b.displayName;
  }
  for (const ruleType of ['triggers', 'responses', 'conditions']) {
    const section = (rules as any)[ruleType];
    if (!Array.isArray(section)) continue;
    ruleLines.push(`  ${ruleType}:`);
    for (const entry of section) {
      const display = behaviorNameToDisplay[entry.behaviorName] ?? entry.behaviorName;
      if (display === 'Counter') continue;
      const paramSpecs = entry.paramSpecs ?? [];
      const paramNames = Array.isArray(paramSpecs)
        ? paramSpecs.map((p: any) => p.name)
        : Object.keys(paramSpecs);
      const params = paramNames.join(', ');
      ruleLines.push(`    - name: ${entry.name}, behavior: ${display}${params ? `, params: [${params}]` : ''}`);
    }
  }

  const parts: string[] = [];
  if (behaviorLines.length > 0) {
    parts.push(`Available behaviors:\n${behaviorLines.join('\n')}`);
  }
  if (ruleLines.length > 0) {
    parts.push(`Available rules:\n${ruleLines.join('\n')}`);
  }
  return parts.join('\n\n');
}

// Generate per-card scene context (blueprints and actors) from scene data.
export async function generateSceneContext(sceneData: any): Promise<string> {
  const { behaviors } = await getCastleMetadata();
  const library = sceneData.snapshot.library ?? {};
  const actors = sceneData.snapshot.actors ?? [];

  // Build behaviorName (internal) → displayName map
  const behaviorInternalToDisplay: Record<string, string> = {};
  for (const b of Object.values(behaviors) as any[]) {
    behaviorInternalToDisplay[b.name] = b.displayName;
  }

  // --- Blueprints ---
  const bpLines: string[] = [];
  for (const [entryId, entry] of Object.entries(library) as [string, any][]) {
    if (entry.entryType !== 'actorBlueprint') continue;
    const behaviorNames = Object.keys(entry.actorBlueprint?.components ?? {})
      .map((k) => behaviorInternalToDisplay[k] ?? k);
    bpLines.push(`  - title: "${entry.title}", entryId: ${entryId}, behaviors: [${behaviorNames.join(', ')}]`);
  }

  // --- Actors ---
  const actorLines: string[] = [];
  for (const actor of actors) {
    const entry = library[actor.parentEntryId];
    if (!entry) continue;
    const body = actor.bp?.components?.Body ?? {};
    const angleDeg = body.angle != null ? Math.round(body.angle * (180 / Math.PI) * 10) / 10 : 0;
    actorLines.push(`  ${actor.actorId}: title="${entry.title}", x=${body.x ?? 0}, y=${body.y ?? 0}, angle=${angleDeg}°`);
  }

  const parts: string[] = [];
  if (bpLines.length > 0) {
    parts.push(`All blueprints in the deck:\n${bpLines.join('\n')}`);
  }
  if (actorLines.length > 0) {
    parts.push(`Actors in the scene (angles in degrees, positive Y is downward):\n${actorLines.join('\n')}`);
  }
  return parts.join('\n\n');
}

function loadCliDocs(): string | null {
  try {
    const assetPath = path.join(path.dirname(new URL(import.meta.url).pathname), '../assets/AGENTS.md');
    return fs.readFileSync(assetPath, 'utf8');
  } catch {
    return null;
  }
}

// Write AGENTS.md and CLAUDE.md at deck level: static context + CLI docs.
export async function writeDeckAgentFilesAsync(deckDir: string): Promise<void> {
  const cliDocs = loadCliDocs();
  if (!cliDocs) return;
  const staticContext = await generateStaticContext();
  const content = staticContext ? staticContext + '\n\n' + cliDocs : cliDocs;
  const agentsPath = path.join(deckDir, 'AGENTS.md');
  const existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : null;
  if (existing === content) return;
  fs.writeFileSync(agentsPath, content);
  fs.writeFileSync(path.join(deckDir, 'CLAUDE.md'), content);
}

async function writeAgentFilesAsync({ deckDir, cardDir, sceneData }: { deckDir: string; cardDir: string; sceneData: any }) {
  const sceneContext = await generateSceneContext(sceneData);
  if (sceneContext) {
    fs.writeFileSync(path.join(cardDir, 'SCENE.md'), sceneContext);
  }
  await writeDeckAgentFilesAsync(deckDir);
}

export async function cloneCardAsync({ cardId, sceneDataUrl, cardDir, deckDir }: { cardId: string; sceneDataUrl: string; cardDir: string; deckDir: string }) {
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

    const writeScriptFile = (content: string) => {
      fs.writeFileSync(path.join(blueprintsDir, scriptFilename), content);
      return scriptFilename;
    };

    const blueprintData = {
      title,
      entryId,
      components: Behaviors.serializeComponents({ components, writeScriptFile }),
    };
    fs.writeFileSync(blueprintFilename, yaml.stringify(blueprintData));
  }

  await writeActorsAndVariablesAsync({ sceneData, cardDir, library, deckId, cardId });

  await writeAgentFilesAsync({ deckDir, cardDir, sceneData });
}

export async function readDeckFromDirectoryAsync({ dir, log }: { dir?: string; log: (...args: any[]) => void }) {
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

export async function pullCardAsync({ cardId, sceneDataUrl, cardDir, deckDir }: { cardId: string; sceneDataUrl: string; cardDir: string; deckDir: string }) {
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

    if (localComponents) {
      if (localComponents.Script?.file) scriptFilename = localComponents.Script.file;
    }

    const writeScriptFile = (content: string) => {
      fs.writeFileSync(path.join(blueprintsDir, scriptFilename), content);
      return scriptFilename;
    };

    const blueprintData = {
      title,
      entryId,
      components: Behaviors.serializeComponents({ components, writeScriptFile }),
    };
    fs.writeFileSync(blueprintFilename, yaml.stringify(blueprintData));
  }

  await writeActorsAndVariablesAsync({ sceneData, cardDir, library, deckId, cardId });

  await writeAgentFilesAsync({ deckDir, cardDir, sceneData });
}

async function getEntryIdToBlueprintFilenameAsync(cardDir: string) {
  const entryIdToConfigFilename: Record<string, string> = {};

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

  // 2. Build local actors from actors.yaml (flat format: title, degrees, ×10 widthScale)
  const localActors: any[] = [];
  const actorsFilePath = path.join(cardDir, 'actors.yaml');
  let actorsFileExists = false;

  // Build title→entryId map for looking up parentEntryId by title
  const titleToEntryId: Record<string, string> = {};
  for (const [entryId, entry] of Object.entries(library) as [string, any][]) {
    if (entry.title) titleToEntryId[entry.title] = entryId;
  }

  if (fs.existsSync(actorsFilePath)) {
    const actorsObj = yaml.parse(fs.readFileSync(actorsFilePath, 'utf8'));
    if (actorsObj && typeof actorsObj === 'object' && !Array.isArray(actorsObj)) {
      actorsFileExists = true;
      for (const [key, data] of Object.entries(actorsObj) as [string, any][]) {
        const actorId = key.startsWith('a') ? key.slice(1) : key;

        // Support both new flat format (title) and legacy nested format (entryId + components)
        const parentEntryId = data.entryId || (data.title && titleToEntryId[data.title]);
        if (!parentEntryId || !library[parentEntryId]) continue;

        // Flat format: { title, x, y, angle (degrees), widthScale ×10, initialFrame }
        const body: any = {
          x: data.x ?? 0,
          y: data.y ?? 0,
          widthScale: data.widthScale ?? 0, // ×10; applySnapshot converts ÷10
          heightScale: data.heightScale ?? 0,
        };
        if (data.angle !== undefined) body.angle = data.angle; // degrees; applySnapshot converts

        const components: any = { Body: body };
        if (data.initialFrame && data.initialFrame !== 1) {
          components.Drawing2 = { initialFrame: data.initialFrame };
        }
        if (data.fontSizeScale !== undefined || data.content !== undefined) {
          components.Text = {};
          if (data.fontSizeScale !== undefined) components.Text.fontSizeScale = data.fontSizeScale;
          if (data.content !== undefined) components.Text.content = data.content;
        }
        if (data.targetDeckId !== undefined) {
          components.Link = { targetDeckId: data.targetDeckId };
        }

        localActors.push({ actorId, parentEntryId, bp: { components } });
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

    // Strip engine-computed Body fields from `processed` so the cached values (e.g. fixtures,
    // editorBounds) are not overwritten with empty/default values from the WASM output.
    if (processed?.components?.Body) {
      for (const field of BODY_COMPUTED_FIELDS) {
        delete processed.components.Body[field];
      }
    }
    // Strip engine-computed Drawing2 fields from `processed` (same reason).
    if (processed?.components?.Drawing2) {
      delete processed.components.Drawing2.hash;
      delete processed.components.Drawing2.drawData;
      delete processed.components.Drawing2.physicsBodyData;
      delete processed.components.Drawing2.currentFrame;
    }

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
  let modifiedLayout = false;
  if (actorsFileExists) {
    const oldActors = sceneData.snapshot.actors;
    sceneData.snapshot.actors = processedSnapshot.actors;
    if (!Utils.isEqualUnordered(processedSnapshot.actors, oldActors)) {
      modifiedLayout = true;
    }
  }

  const modified = modifiedLibrary || modifiedLayout;

  if (modified) {
    await writeAgentFilesAsync({ deckDir, cardDir, sceneData });
  }

  return {
    sceneData,
    modified,
  };
}

async function pushCardAsync({ cardId, cardDir, deckDir }: { cardId: string; cardDir: string; deckDir: string }) {
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

export async function pushCardsAsync({ deckDir, cards }: { deckDir: string; cards: any[] }) {
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

export async function syncCardVersionsAsync({ deckDir, force = false }: { deckDir: string; force?: boolean }) {
  let castleDir = getCastleDir(deckDir);
  let cardVersionsFilePath = path.join(castleDir, 'cardversions.json');
  let cardVersions: Record<string, string> = {};

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
