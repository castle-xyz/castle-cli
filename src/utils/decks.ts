import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Axios from 'axios';
import { glob } from 'glob';
import yaml from 'yaml';
import _ from 'lodash';

import * as API from './api.js';
import * as config from './config.js';
import * as Behaviors from './behaviors.js';
import { applySnapshot, getCastleMetadata } from './castle-core-node.js';

// Read drawPreviews flag from deck.yaml. Returns true (previews enabled) unless explicitly false.
export function isDrawPreviewsEnabled(deckDir: string): boolean {
  try {
    const config = yaml.parse(fs.readFileSync(path.join(deckDir, 'deck.yaml'), 'utf8'));
    return config?.drawPreviews !== false;
  } catch {
    return true;
  }
}

// Regenerate {slug}.preview.png if drawPreviewHashes[slug] doesn't match the current Drawing2.hash.
// Mutates drawPreviewHashes in-place on success (safe: JS is single-threaded).
// Silently skips on any error so the serve flow is never blocked.
export async function maybeRegenerateDrawPreviewAsync(
  bpDir: string,
  slug: string,
  drawing2: any,
  drawPreviewHashes: Record<string, string>,
): Promise<void> {
  const hash: string | undefined = drawing2?.hash;
  if (!hash || !drawing2?.drawData) return;
  if (drawPreviewHashes[slug] === hash) return;

  try {
    const { renderDrawDataPng } = await import('./castle-core-node.js');
    const base64Png = await renderDrawDataPng(drawing2, 0, 256);
    fs.writeFileSync(path.join(bpDir, `${slug}.preview.png`), Buffer.from(base64Png, 'base64'));
    drawPreviewHashes[slug] = hash;
  } catch (e: any) {
    console.warn(`[draw-preview] Failed to generate preview for ${slug}: ${e?.message ?? e}`);
  }
}

// Patch drawPreviewHashes into meta.json, creating the file if it doesn't exist yet.
function patchDrawPreviewHashesInMeta(cardDir: string, drawPreviewHashes: Record<string, string>): void {
  if (Object.keys(drawPreviewHashes).length === 0) return;
  try {
    const metaPath = path.join(cardDir, '.castle', 'meta.json');
    let meta: any = {};
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
    meta.drawPreviewHashes = drawPreviewHashes;
    const castleDir = path.join(cardDir, '.castle');
    if (!fs.existsSync(castleDir)) fs.mkdirSync(castleDir, { recursive: true });
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch {}
}

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


export function writeCardYamlFields(
  cardDir: string,
  fields: { cardId?: string; sceneProperties?: any; actorBlueprintInherit?: boolean; linkTargetDeckIds?: any[] }
): void {
  const cardYamlPath = path.join(cardDir, 'card.yaml');
  let cardData: any = fields.cardId ? { cardId: fields.cardId } : {};
  try { cardData = yaml.parse(fs.readFileSync(cardYamlPath, 'utf8')); } catch {}
  if (fields.sceneProperties !== undefined) cardData.sceneProperties = fields.sceneProperties;
  if (fields.actorBlueprintInherit !== undefined) cardData.actorBlueprintInherit = fields.actorBlueprintInherit;
  if (fields.linkTargetDeckIds !== undefined) cardData.linkTargetDeckIds = fields.linkTargetDeckIds;
  fs.writeFileSync(cardYamlPath, yaml.stringify(cardData, { lineWidth: 120 }));
}

export function getBlueprintsDir(cardDir: string) {
  // blueprints can be moved anywhere, this is just the default
  const blueprintsDir = path.join(cardDir, 'blueprints');
  if (!fs.existsSync(blueprintsDir)) {
    fs.mkdirSync(blueprintsDir);
  }

  return blueprintsDir;
}

// Per-actor Body fields that are NOT written to blueprint YAML — they go in actors.yaml
// instead. Must match castle-client Scene::writeActor (see CLAUDE.md per-actor spec).
// Referenced in both blueprint stripping and the actor stripping in newSceneDataForCardAsync.
export const BODY_PER_ACTOR_FIELDS = new Set(['x', 'y', 'angle']);

// Behaviors whose handleWriteComponent output is entirely engine-computed and should be
// stripped from blueprint YAML (stored in .draw.json instead). Other behaviors' handleWriteComponent
// output (e.g. Rules.rules, LocalVariables.localVariables) is user data and must stay in the
// blueprint YAML.
//   Drawing2: hash, drawData, physicsBodyData → large computed blobs, stored in .draw.json
//   Script: errors (runtime compile results), behaviorProps (debug-only) → both engine state
const STRIP_NON_PROP_COMPONENTS = new Set(['Drawing2', 'Script']);

// Strip engine-computed and per-actor fields from blueprint components before writing to YAML.
// Uses WASM behavior metadata (getBehaviors) to determine which fields to strip:
//   - STRIP_NON_PROP_COMPONENTS fields not in propertySpecs → handleWriteComponent output (hash, drawData, etc.)
//     These are large computed blobs stored in .draw.json instead.
//   - Fields where rulesGet=false && rulesSet=false && !userEditable → computed/internal
//     (e.g. Body.width, height, fixtures, editorBounds, layerName, relativeToCameraFix)
//   - Body fields in BODY_PER_ACTOR_FIELDS → exclusively per-actor (go in actors.yaml)
// 'disabled' is always preserved.
function stripBlueprintComponents(components: any, behaviors: any): void {
  for (const compName of Object.keys(components)) {
    const comp = components[compName];
    if (!comp || typeof comp !== 'object') continue;
    const specs = behaviors[compName]?.propertySpecs ?? {};
    for (const field of Object.keys(comp)) {
      if (field === 'disabled') continue;
      const attribs = specs[field]?.attribs;
      if (!attribs) {
        // Not in propertySpecs → handleWriteComponent output.
        if (STRIP_NON_PROP_COMPONENTS.has(compName)) {
          delete comp[field];
        }
      } else if (!attribs.rulesGet && !attribs.rulesSet && !attribs.userEditable) {
        // Both rule flags false and not a client-compat exception → computed/internal
        // (e.g. Body.width, height, fixtures, editorBounds, layerName, relativeToCameraFix)
        delete comp[field];
      } else if (compName === 'Body' && BODY_PER_ACTOR_FIELDS.has(field)) {
        // Exclusively per-actor — goes in actors.yaml, not blueprint YAML
        delete comp[field];
      }
    }
  }
}

// Extract engine-computed draw/physics data from blueprint components into companion .draw.json format.
export function extractDrawData(components: any): Record<string, any> | null {
  const drawData: Record<string, any> = {};

  if (components.Drawing2) {
    const d2: any = {};
    if (components.Drawing2.drawData !== undefined) d2.drawData = components.Drawing2.drawData;
    if (components.Drawing2.physicsBodyData !== undefined) d2.physicsBodyData = components.Drawing2.physicsBodyData;
    if (components.Drawing2.hash !== undefined) d2.hash = components.Drawing2.hash;
    if (Object.keys(d2).length > 0) drawData.Drawing2 = d2;
  }

  if (components.Body) {
    const body: any = {};
    if (components.Body.fixtures !== undefined) body.fixtures = components.Body.fixtures;
    if (components.Body.editorBounds !== undefined) body.editorBounds = components.Body.editorBounds;
    if (Object.keys(body).length > 0) drawData.Body = body;
  }

  // Preserve complex data that WASM strips from applySnapshot
  if (Array.isArray(components.LocalVariables?.localVariables) && components.LocalVariables.localVariables.length > 0) {
    drawData.LocalVariables = { localVariables: components.LocalVariables.localVariables };
  }

  return Object.keys(drawData).length > 0 ? drawData : null;
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

  let castleDir = getCastleDir(deckDir);

  // Track last synced version in .castle/ (no longer in .castle/.cache/)
  fs.writeFileSync(path.join(castleDir, `${cardId}.version`), sceneDataUrl);

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
      const label = spec.attribs?.scriptName || propName;
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
    actorLines.push(`  a${actor.actorId}: title="${entry.title}", x=${body.x ?? 0}, y=${body.y ?? 0}, angle=${angleDeg}°`);
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

function loadCliDocs(isAdmin: boolean): string | null {
  try {
    const assetPath = path.join(path.dirname(new URL(import.meta.url).pathname), '../assets/AGENTS.md');
    let content = fs.readFileSync(assetPath, 'utf8');
    if (!isAdmin) {
      content = content.replace(/<!-- ADMIN_ONLY_START -->[\s\S]*?<!-- ADMIN_ONLY_END -->\n?/g, '');
    }
    return content;
  } catch {
    return null;
  }
}

// Write AGENTS.md and CLAUDE.md at deck level: static context + CLI docs.
export async function writeDeckAgentFilesAsync(deckDir: string): Promise<void> {
  const isAdmin = config.getIsAdmin();
  const cliDocs = loadCliDocs(isAdmin);
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
  const { behaviors } = await getCastleMetadata();

  // Get deckId for meta.json
  let deckId = '';
  try {
    const deckConfig = yaml.parse(fs.readFileSync(path.join(deckDir, 'deck.yaml'), 'utf8'));
    deckId = deckConfig.deckId || '';
  } catch (e) {}

  const blueprintsDir = getBlueprintsDir(cardDir);
  const drawPreviewsEnabled = isDrawPreviewsEnabled(deckDir);

  const drawPreviewHashes: Record<string, string> = {};
  const previewPromises: Promise<void>[] = [];

  // Write blueprint YAMLs + companion .draw.json files (work with internal library directly)
  for (const [entryId, entry] of Object.entries(library) as [string, any][]) {
    if (entry.entryType !== 'actorBlueprint') continue;
    const title = entry.title;
    const origComponents = entry.actorBlueprint?.components ?? {};

    // Deep copy and apply YAML conventions
    const components = JSON.parse(JSON.stringify(origComponents));
    stripBlueprintComponents(components, behaviors);
    // Apply ×10 for Body scale fields (YAML format uses 0–10 scale)
    if (components.Body) {
      if (components.Body.widthScale !== undefined) components.Body.widthScale *= 10;
      if (components.Body.heightScale !== undefined) components.Body.heightScale *= 10;
    }

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

    // Write companion .draw.json with engine-computed drawing/physics data
    const drawData = extractDrawData(origComponents);
    if (drawData) {
      fs.writeFileSync(blueprintFilename.replace(/\.yaml$/, '.draw.json'), JSON.stringify(drawData, null, 2));
      if (drawPreviewsEnabled) {
        previewPromises.push(
          maybeRegenerateDrawPreviewAsync(blueprintsDir, path.basename(blueprintFilename, '.yaml'), drawData.Drawing2, drawPreviewHashes)
        );
      }
    }
  }

  await Promise.all(previewPromises);

  await writeActorsAndVariablesAsync({ sceneData, cardDir, library, deckId, cardId });
  patchDrawPreviewHashesInMeta(cardDir, drawPreviewHashes);

  // Save sceneProperties, actorBlueprintInherit, and linkTargetDeckIds to card.yaml for use during serve.
  writeCardYamlFields(cardDir, {
    sceneProperties: sceneData.snapshot.sceneProperties,
    actorBlueprintInherit: sceneData.snapshot.actorBlueprintInherit,
    linkTargetDeckIds: sceneData.snapshot.linkTargetDeckIds,
  });

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
  const { behaviors } = await getCastleMetadata();

  // Get deckId for meta.json
  let deckId = '';
  try {
    const deckConfig = yaml.parse(fs.readFileSync(path.join(deckDir, 'deck.yaml'), 'utf8'));
    deckId = deckConfig.deckId || '';
  } catch (e) {}

  const entryIdToBlueprintFilename = await getEntryIdToBlueprintFilenameAsync(cardDir);
  const blueprintsDir = getBlueprintsDir(cardDir);
  const drawPreviewsEnabled = isDrawPreviewsEnabled(deckDir);

  const drawPreviewHashes: Record<string, string> = {};
  const previewPromises: Promise<void>[] = [];

  // Write blueprint YAMLs + companion .draw.json files (work with internal library directly)
  for (const [entryId, entry] of Object.entries(library) as [string, any][]) {
    if (entry.entryType !== 'actorBlueprint') continue;
    const title = entry.title;
    const origComponents = entry.actorBlueprint?.components ?? {};

    // Deep copy and apply YAML conventions
    const components = JSON.parse(JSON.stringify(origComponents));
    stripBlueprintComponents(components, behaviors);
    // Apply ×10 for Body scale fields (YAML format uses 0–10 scale)
    if (components.Body) {
      if (components.Body.widthScale !== undefined) components.Body.widthScale *= 10;
      if (components.Body.heightScale !== undefined) components.Body.heightScale *= 10;
    }

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

    // Write companion .draw.json with engine-computed drawing/physics data
    const drawData = extractDrawData(origComponents);
    if (drawData) {
      fs.writeFileSync(blueprintFilename.replace(/\.yaml$/, '.draw.json'), JSON.stringify(drawData, null, 2));
      if (drawPreviewsEnabled) {
        previewPromises.push(
          maybeRegenerateDrawPreviewAsync(blueprintsDir, path.basename(blueprintFilename, '.yaml'), drawData.Drawing2, drawPreviewHashes)
        );
      }
    }
  }

  await Promise.all(previewPromises);

  await writeActorsAndVariablesAsync({ sceneData, cardDir, library, deckId, cardId });
  patchDrawPreviewHashesInMeta(cardDir, drawPreviewHashes);

  // Save sceneProperties, actorBlueprintInherit, and linkTargetDeckIds to card.yaml for use during serve.
  writeCardYamlFields(cardDir, {
    sceneProperties: sceneData.snapshot.sceneProperties,
    actorBlueprintInherit: sceneData.snapshot.actorBlueprintInherit,
    linkTargetDeckIds: sceneData.snapshot.linkTargetDeckIds,
  });

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
  const bpDir = path.join(cardDir, 'blueprints');

  // Read sceneProperties, actorBlueprintInherit, and linkTargetDeckIds from card.yaml (saved during clone/pull).
  let sceneProperties: any = undefined;
  let actorBlueprintInherit: boolean | undefined = undefined;
  let linkTargetDeckIds: any[] | undefined = undefined;
  const cardYamlPath = path.join(cardDir, 'card.yaml');
  if (fs.existsSync(cardYamlPath)) {
    try {
      const cardData = yaml.parse(fs.readFileSync(cardYamlPath, 'utf8'));
      sceneProperties = cardData.sceneProperties;
      actorBlueprintInherit = cardData.actorBlueprintInherit;
      linkTargetDeckIds = cardData.linkTargetDeckIds;
    } catch {}
  }

  const drawPreviewsEnabled = isDrawPreviewsEnabled(deckDir);

  // Read existing preview hashes from meta.json so we can skip up-to-date previews.
  const drawPreviewHashes: Record<string, string> = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(cardDir, '.castle', 'meta.json'), 'utf8'))?.drawPreviewHashes ?? {};
    } catch { return {}; }
  })();

  // 1. Build local library from blueprint YAMLs + companion .draw.json files
  const localLibrary: any = {};
  const drawDataByEntryId: Record<string, any> = {};
  const previewPromises: Promise<void>[] = [];

  if (fs.existsSync(bpDir)) {
    const yamlFiles = fs.readdirSync(bpDir).filter(f => f.endsWith('.yaml'));
    for (const yamlFile of yamlFiles) {
      const slug = yamlFile.replace('.yaml', '');
      let bpData: any;
      try {
        bpData = yaml.parse(fs.readFileSync(path.join(bpDir, yamlFile), 'utf-8'));
      } catch { continue; }
      if (!bpData?.entryId) continue;

      const entryId = bpData.entryId;
      const localComponents = Behaviors.deserializeComponents({
        components: bpData.components ?? {},
        readFile: (relativePath) =>
          fs.readFileSync(path.join(bpDir, relativePath), 'utf-8'),
      });

      localLibrary[entryId] = {
        entryId,
        entryType: 'actorBlueprint',
        title: bpData.title,
        actorBlueprint: { components: localComponents },
      };

      // Read companion .draw.json if it exists
      const drawJsonPath = path.join(bpDir, `${slug}.draw.json`);
      if (fs.existsSync(drawJsonPath)) {
        try {
          const drawData = JSON.parse(fs.readFileSync(drawJsonPath, 'utf-8'));
          drawDataByEntryId[entryId] = drawData;
          // Inject localVariables into localLibrary so WASM can round-trip it
          if (drawData.LocalVariables?.localVariables) {
            if (!localComponents.LocalVariables) localComponents.LocalVariables = {};
            localComponents.LocalVariables.localVariables = drawData.LocalVariables.localVariables;
          }
          // Generate preview PNG if stale (errors are swallowed inside)
          if (drawPreviewsEnabled) {
            previewPromises.push(maybeRegenerateDrawPreviewAsync(bpDir, slug, drawData.Drawing2, drawPreviewHashes));
          }
        } catch {}
      }
    }
  }

  await Promise.all(previewPromises);
  patchDrawPreviewHashesInMeta(cardDir, drawPreviewHashes);

  // 2. Build local actors from actors.yaml (flat format: title, degrees, ×10 widthScale)
  const localActors: any[] = [];
  const actorsFilePath = path.join(cardDir, 'actors.yaml');
  let actorsFileExists = false;

  // Build title→entryId map for looking up parentEntryId by title
  const titleToEntryId: Record<string, string> = {};
  for (const [entryId, entry] of Object.entries(localLibrary) as [string, any][]) {
    if (entry.title) titleToEntryId[entry.title] = entryId;
  }

  if (fs.existsSync(actorsFilePath)) {
    const actorsObj = yaml.parse(fs.readFileSync(actorsFilePath, 'utf8'));
    if (actorsObj && typeof actorsObj === 'object' && !Array.isArray(actorsObj)) {
      actorsFileExists = true;
      for (const [key, data] of Object.entries(actorsObj) as [string, any][]) {
        const actorId = key.startsWith('a') ? key.slice(1) : key;

        // Support both title and entryId lookups
        const parentEntryId = data.entryId || (data.title && titleToEntryId[data.title]);
        if (!parentEntryId || !localLibrary[parentEntryId]) continue;

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
  let processedSnapshot: any;
  try {
    processedSnapshot = await applySnapshot(localSnapshot);
  } catch (e: any) {
    console.warn(`[serve] applySnapshot failed (${e.message}) — returning unprocessed scene data`);
    return { sceneData: { snapshot: { library: localLibrary, actors: localActors } }, modified: false };
  }

  // 4. Merge draw/physics data and restore WASM-stripped complex data
  const processedLibrary = processedSnapshot.library ?? {};
  for (const entryId of Object.keys(processedLibrary)) {
    const bp = processedLibrary[entryId].actorBlueprint;
    if (!bp) continue;
    if (!bp.components) bp.components = {};

    // Merge draw/physics data from companion .draw.json files
    const drawData = drawDataByEntryId[entryId];
    if (drawData) {
      if (drawData.Drawing2) {
        if (!bp.components.Drawing2) bp.components.Drawing2 = {};
        Object.assign(bp.components.Drawing2, drawData.Drawing2);
      }
      if (drawData.Body) {
        if (!bp.components.Body) bp.components.Body = {};
        Object.assign(bp.components.Body, drawData.Body);
      }
    }

    // Restore complex data stripped by applySnapshot from local blueprint definitions
    const localBPComponents = localLibrary[entryId]?.actorBlueprint?.components ?? {};

    // Rules.rules — applySnapshot strips all rule data
    const localRules = localBPComponents.Rules;
    if (localRules?.rules !== undefined) {
      if (!bp.components.Rules) bp.components.Rules = {};
      bp.components.Rules.rules = localRules.rules;
    }

    // LocalVariables.localVariables — applySnapshot strips them
    const localLV = localBPComponents.LocalVariables;
    if (localLV?.localVariables !== undefined) {
      if (!bp.components.LocalVariables) bp.components.LocalVariables = {};
      bp.components.LocalVariables.localVariables = localLV.localVariables;
    }

    // disabled:true on any behavior — applySnapshot strips the disabled flag;
    // disabled:true means the behavior is intentionally inactive and must be preserved
    for (const [compName, localComp] of Object.entries(localBPComponents) as [string, any][]) {
      if (localComp?.disabled === true) {
        if (!bp.components[compName]) bp.components[compName] = {};
        bp.components[compName].disabled = true;
      }
    }
  }

  // Strip actor bp.components to only per-actor overrides (x, y, angle, widthScale,
  // heightScale, initialFrame, Text, Link). applySnapshot inflates actors with all engine
  // defaults — the mobile client (castle-client Scene::writeActor) never includes those.
  // Note: x/y/angle are also listed in BODY_PER_ACTOR_FIELDS (used by stripBlueprintComponents).
  const processedActors: any[] = [];
  for (const actor of processedSnapshot.actors ?? []) {
    const comps = actor.bp?.components ?? {};
    const stripped: any = {};

    const body = comps.Body;
    if (body) {
      const b: any = {};
      if (body.x !== undefined) b.x = body.x;
      if (body.y !== undefined) b.y = body.y;
      if (body.angle !== undefined) b.angle = body.angle;
      if (body.widthScale !== undefined) b.widthScale = body.widthScale;
      if (body.heightScale !== undefined) b.heightScale = body.heightScale;
      if (Object.keys(b).length > 0) stripped.Body = b;
    }

    const d2 = comps.Drawing2;
    if (d2?.initialFrame !== undefined) stripped.Drawing2 = { initialFrame: d2.initialFrame };

    if (comps.Text && Object.keys(comps.Text).length > 0) stripped.Text = comps.Text;
    if (comps.Link && Object.keys(comps.Link).length > 0) stripped.Link = comps.Link;

    processedActors.push({ ...actor, bp: { components: stripped } });
  }

  const snapshot: any = {
    library: processedLibrary,
    actors: actorsFileExists ? processedActors : [],
  };
  if (sceneProperties !== undefined) snapshot.sceneProperties = sceneProperties;
  if (actorBlueprintInherit !== undefined) snapshot.actorBlueprintInherit = actorBlueprintInherit;
  snapshot.linkTargetDeckIds = linkTargetDeckIds ?? [];

  return { sceneData: { snapshot }, modified: true };
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

  for (let cardId of cardIds) {
    const sceneDataUrl = cardVersions[cardId];

    // Skip mobile-sourced entries (they have no URL to fetch)
    if (sceneDataUrl === 'mobile') continue;

    let cachedSceneDataUrl = '';
    try {
      cachedSceneDataUrl = fs.readFileSync(path.join(castleDir, `${cardId}.version`), 'utf8').trim();
    } catch (e) {}

    if (cachedSceneDataUrl != sceneDataUrl || force) {
      console.log(`Syncing card ${cardId}...`);
      const cardDir = path.join(deckDir, `card-${cardId}`);
      await pullCardAsync({ cardId, sceneDataUrl, cardDir, deckDir });
    }
  }
}
