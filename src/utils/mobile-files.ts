import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import yaml from 'yaml';
import { v4 as uuidv4 } from 'uuid';
import { StateInternalMessage, VariableData } from './mobile-protocol.js';
import { serializeComponents } from './behaviors.js';
import { getSnapshotExternalValues } from './castle-core-node.js';
import { writeCardYamlFields, extractDrawData, maybeRegenerateDrawPreviewAsync, isDrawPreviewsEnabled } from './decks.js';

const BLUEPRINTS_DIR = 'blueprints';
const ACTORS_FILE = 'actors.yaml';
const VARIABLES_FILE = 'variables.yaml';
const CARD_YAML_FILE = 'card.yaml';
const CASTLE_DIR = '.castle';
const META_FILE = path.join(CASTLE_DIR, 'meta.json');


// Convert a blueprint title to a safe filename slug (lowercase, underscores)
export function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'untitled';
}

// Content hash for change detection
function contentHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

interface FileHashes {
  [filePath: string]: string;
}

interface MetaData {
  deckId: string;
  cardId: string;
  hashes: FileHashes;
  blueprintIdMap: Record<string, string>; // slug -> entryId
  lastActors?: any[]; // actors list last written to disk (disk format, for diff computation)
  drawPreviewHashes?: Record<string, string>; // slug → Drawing2.hash, for stale-preview detection
}

export function readMeta(dir: string): MetaData | null {
  const metaPath = path.join(dir, META_FILE);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch (e) {
    console.warn('[files] failed to parse meta.json:', e);
    return null;
  }
}

function writeMeta(dir: string, meta: MetaData): void {
  fs.writeFileSync(path.join(dir, META_FILE), JSON.stringify(meta, null, 2));
}

export interface BlueprintChange {
  entryId: string;
  title?: string;
  components?: string; // YAML string
  script?: Array<{ code: string }>;
  isNew?: boolean;
  forkBlueprintId?: string;
  drawing?: any;  // raw draw data object from .draw.json ({ Drawing2: { drawData, physicsBodyData, hash }, Body: {...} })
  removeBlueprint?: boolean;
}

export interface FileChanges {
  changedBlueprints: Record<string, BlueprintChange>;
  changedActors: Record<string, any> | null;
  changedVariables: Record<string, any> | null;
  changedSceneProperties?: any;
  hasChanges: boolean;
}

export interface ConflictSummary {
  localOnlyBlueprintSlugs: string[];    // blueprints on disk but not in mobile
  mobileOnlyBlueprintEntryIds: string[]; // blueprints in mobile but not on disk
  actorsDiffer: boolean;
  variablesDiffer: boolean;
  hasConflicts: boolean;
}

// Read files and detect changes against last known hashes
export function detectChanges(cardDir: string): FileChanges | null {
  const meta = readMeta(cardDir);
  if (!meta) return null;

  const result: FileChanges = {
    changedBlueprints: {},
    changedActors: null,
    changedVariables: null,
    hasChanges: false,
  };

  const bpDir = path.join(cardDir, BLUEPRINTS_DIR);

  // Check blueprint files
  if (fs.existsSync(bpDir)) {
    const yamlFiles = fs.readdirSync(bpDir).filter(f => f.endsWith('.yaml'));

    for (const yamlFile of yamlFiles) {
      const slug = yamlFile.replace('.yaml', '');
      const entryId = meta.blueprintIdMap[slug];

      const yamlPath = path.join(BLUEPRINTS_DIR, yamlFile);
      const yamlContent = fs.readFileSync(path.join(cardDir, yamlPath), 'utf-8');
      let bpData: any;
      try {
        bpData = yaml.parse(yamlContent) as any;
      } catch (e: any) {
        console.error(`[files] failed to parse ${yamlFile}: ${e.reason || e.message}`);
        continue;
      }

      // Check lua file
      const luaPath = path.join(BLUEPRINTS_DIR, `${slug}.lua`);
      const luaFullPath = path.join(cardDir, luaPath);
      let luaContent: string | null = null;
      if (fs.existsSync(luaFullPath)) {
        luaContent = fs.readFileSync(luaFullPath, 'utf-8');
      }

      if (!entryId) {
        // New blueprint file — fork from specified or Empty
        result.hasChanges = true;
        const newKey = `new-${slug}`;
        const edit: BlueprintChange = {
          entryId: newKey,
          isNew: true,
          forkBlueprintId: bpData?.forkBlueprintId || 'default-blueprint-0',
          title: bpData?.title || slug,
          ...(bpData?.drawing && { drawing: bpData.drawing }),
        };

        if (bpData?.components) {
          const components = { ...bpData.components };
          if (components.Script?.file) {
            const { file, ...rest } = components.Script;
            components.Script = rest;
          }
          edit.components = yaml.stringify(components, { lineWidth: 120 });
        }

        if (luaContent) {
          edit.script = [{ code: luaContent }];
        }

        result.changedBlueprints[newKey] = edit;
        continue;
      }

      // Existing blueprint — check for changes
      const yamlChanged = meta.hashes[yamlPath] !== contentHash(yamlContent);
      let luaChanged = false;
      if (luaContent !== null) {
        luaChanged = meta.hashes[luaPath] !== contentHash(luaContent);
      }

      // Check .draw.json file
      const drawJsonRelPath = path.join(BLUEPRINTS_DIR, `${slug}.draw.json`);
      const drawJsonFullPath = path.join(cardDir, drawJsonRelPath);
      let drawChanged = false;
      let drawFileData: any = null;
      if (fs.existsSync(drawJsonFullPath)) {
        const drawContent = fs.readFileSync(drawJsonFullPath, 'utf-8');
        if (meta.hashes[drawJsonRelPath] !== contentHash(drawContent)) {
          drawChanged = true;
          try {
            drawFileData = JSON.parse(drawContent);
          } catch (e) {
            console.error(`[files] failed to parse ${slug}.draw.json:`, e);
          }
        }
      }

      if (yamlChanged || luaChanged || drawChanged) {
        result.hasChanges = true;

        const edit: BlueprintChange = { entryId };

        if (yamlChanged && bpData) {
          if (bpData.title) edit.title = bpData.title;
          if (bpData.removeBlueprint) edit.removeBlueprint = true;

          if (bpData.components) {
            const components = { ...bpData.components };
            if (components.Script?.file) {
              const { file, ...rest } = components.Script;
              components.Script = rest;
            }
            edit.components = yaml.stringify(components, { lineWidth: 120 });
          }
        }

        if (luaChanged && luaContent !== null) {
          edit.script = [{ code: luaContent }];
        }

        if (drawChanged && drawFileData) {
          edit.drawing = drawFileData;
        }

        result.changedBlueprints[entryId] = edit;
      }
    }
  }

  // Check actors — compute a sparse diff vs. the last written state
  const actorsPath = path.join(cardDir, ACTORS_FILE);
  if (fs.existsSync(actorsPath)) {
    const content = fs.readFileSync(actorsPath, 'utf-8');
    if (meta.hashes[ACTORS_FILE] !== contentHash(content)) {
      try {
        const currentActors = (yaml.parse(content) as any[]) ?? [];
        // If lastActors is missing (old meta without diff support), skip actor diff.
        if (meta.lastActors !== undefined) {
          const lastActors: any[] = meta.lastActors;
          const lastById = new Map(lastActors.map(a => [String(a.actorId), a]));
          const actorsDiff: Record<string, any> = {};

          // Added or changed actors
          for (const actor of currentActors) {
            const id = String(actor.actorId);
            const { actorId, ...rest } = actor;
            const last = lastById.get(id);
            if (!last) {
              actorsDiff[`a${id}`] = rest; // new
            } else {
              const { actorId: _lid, ...lastRest } = last;
              if (JSON.stringify(rest) !== JSON.stringify(lastRest)) {
                actorsDiff[`a${id}`] = rest; // changed
              }
            }
          }

          // Removed actors
          for (const last of lastActors) {
            if (!currentActors.some(a => String(a.actorId) === String(last.actorId))) {
              actorsDiff[`a${last.actorId}`] = { removeActor: true };
            }
          }

          if (Object.keys(actorsDiff).length > 0) {
            result.hasChanges = true;
            result.changedActors = actorsDiff;
          }
        }
      } catch (e: any) {
        console.error(`[files] failed to parse actors.yaml: ${e.reason || e.message}`);
      }
    }
  }

  // Check variables
  const variablesPath = path.join(cardDir, VARIABLES_FILE);
  if (fs.existsSync(variablesPath)) {
    const content = fs.readFileSync(variablesPath, 'utf-8');
    if (meta.hashes[VARIABLES_FILE] !== contentHash(content)) {
      try {
        result.changedVariables = yaml.parse(content) as any;
        result.hasChanges = true;
      } catch (e: any) {
        console.error(`[files] failed to parse variables.yaml: ${e.reason || e.message}`);
      }
    }
  }

  // Check card.yaml (sceneProperties)
  const cardYamlPath = path.join(cardDir, CARD_YAML_FILE);
  if (fs.existsSync(cardYamlPath)) {
    const content = fs.readFileSync(cardYamlPath, 'utf-8');
    if (meta.hashes[CARD_YAML_FILE] !== contentHash(content)) {
      try {
        const cardData = yaml.parse(content) as any;
        result.changedSceneProperties = cardData?.sceneProperties;
        result.hasChanges = true;
      } catch (e: any) {
        console.error(`[files] failed to parse card.yaml: ${e.reason || e.message}`);
      }
    }
  }

  return result;
}

// Update stored hashes to reflect current file state (call after sending an EditMessage)
export function updateMetaHashes(cardDir: string): void {
  const meta = readMeta(cardDir);
  if (!meta) return;

  const bpDir = path.join(cardDir, BLUEPRINTS_DIR);
  if (fs.existsSync(bpDir)) {
    for (const file of fs.readdirSync(bpDir)) {
      if (file.endsWith('.yaml') || file.endsWith('.lua') || file.endsWith('.draw.json')) {
        const relPath = path.join(BLUEPRINTS_DIR, file);
        const content = fs.readFileSync(path.join(cardDir, relPath), 'utf-8');
        meta.hashes[relPath] = contentHash(content);
      }
    }
  }

  const actorsPath = path.join(cardDir, ACTORS_FILE);
  if (fs.existsSync(actorsPath)) {
    const actorsContent = fs.readFileSync(actorsPath, 'utf-8');
    meta.hashes[ACTORS_FILE] = contentHash(actorsContent);
    try {
      meta.lastActors = (yaml.parse(actorsContent) as any[]) ?? [];
    } catch (e) {
      console.warn('[files] failed to parse actors.yaml in updateMetaHashes:', e);
    }
  }

  const variablesPath = path.join(cardDir, VARIABLES_FILE);
  if (fs.existsSync(variablesPath)) {
    meta.hashes[VARIABLES_FILE] = contentHash(fs.readFileSync(variablesPath, 'utf-8'));
  }

  const cardYamlPath = path.join(cardDir, CARD_YAML_FILE);
  if (fs.existsSync(cardYamlPath)) {
    meta.hashes[CARD_YAML_FILE] = contentHash(fs.readFileSync(cardYamlPath, 'utf-8'));
  }

  writeMeta(cardDir, meta);
}

// For new blueprints (isNew: true), generate a stable CLI-assigned UUID and persist it to
// blueprintIdMap immediately. This replaces the temporary "new-{slug}" key with the real UUID
// in `changes.changedBlueprints` so that (1) detectChanges() never re-detects the same
// blueprint as new on subsequent file changes, and (2) mobile can use the same UUID so
// subsequent edits reference the correct entryId without waiting for a state echo.
export function stabilizeNewBlueprintIds(changes: FileChanges, cardDir: string): void {
  const isNewEntries = Object.entries(changes.changedBlueprints).filter(([, bp]) => bp.isNew);
  if (isNewEntries.length === 0) return;

  const meta = readMeta(cardDir);
  if (!meta) return;

  let metaChanged = false;
  for (const [key, bp] of isNewEntries) {
    const slug = key.replace(/^new-/, '');
    if (!meta.blueprintIdMap[slug]) {
      meta.blueprintIdMap[slug] = uuidv4();
      metaChanged = true;
    }
    const uuid = meta.blueprintIdMap[slug];
    delete changes.changedBlueprints[key];
    bp.entryId = uuid;
    changes.changedBlueprints[uuid] = bp;
  }

  if (metaChanged) writeMeta(cardDir, meta);
}

// Convert mobile state actors (internal format: angle in radians, widthScale 0–1) to
// disk format (angle in degrees, widthScale ×10). Returns a list with explicit actorId fields.
export function mobileActorsToDiskFormat(state: StateInternalMessage): any[] {
  const actorsList: any[] = [];
  for (const [key, actor] of Object.entries(state.actors)) {
    const actorTyped = actor as any;
    const body = actorTyped.bp?.components?.Body ?? {};
    const drawing2 = actorTyped.bp?.components?.Drawing2 ?? {};
    const text = actorTyped.bp?.components?.Text ?? {};
    const link = actorTyped.bp?.components?.Link ?? {};

    const parentEntryId = actorTyped.parentEntryId;
    const entry = state.blueprints[parentEntryId] as any;
    const title = entry?.title;
    if (!title) continue;

    const actorId = actorTyped.actorId ?? (key.startsWith('a') ? key.slice(1) : key);
    const actorEntry: any = { actorId, title };
    actorEntry.x = body.x ?? 0;
    actorEntry.y = body.y ?? 0;
    if (body.angle) actorEntry.angle = Math.round(body.angle * (180 / Math.PI) * 1000) / 1000;
    if (body.widthScale !== undefined) actorEntry.widthScale = body.widthScale * 10;
    if (body.heightScale !== undefined) actorEntry.heightScale = body.heightScale * 10;
    if (drawing2.initialFrame && drawing2.initialFrame !== 1) actorEntry.initialFrame = drawing2.initialFrame;
    if (text.fontSizeScale !== undefined && text.fontSizeScale !== 1) actorEntry.fontSizeScale = text.fontSizeScale;
    const blueprintContent = entry.actorBlueprint?.components?.Text?.content;
    if (text.content !== undefined && text.content !== blueprintContent) actorEntry.content = text.content;
    const blueprintTargetDeckId = entry.actorBlueprint?.components?.Link?.targetDeckId;
    if (link.targetDeckId !== undefined && link.targetDeckId !== blueprintTargetDeckId) actorEntry.targetDeckId = link.targetDeckId;

    actorsList.push(actorEntry);
  }
  return actorsList;
}

// Body fields that are engine-computed and should not be written to blueprint YAMLs
// (same list as BODY_COMPUTED_FIELDS in decks.ts)
const BP_BODY_STRIP_FIELDS = [
  'x', 'y', 'angle',
  'width', 'height',
  'fixtures',
  'editorBounds',
  'relativeToCameraFix',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'layerName',
];

// Write scene state from raw EDITOR_LIBRARY/EDITOR_ACTORS (internal format) to disk.
// Converts blueprint component values to display format via WASM before writing YAML.
export async function writeStateInternal(cardDir: string, state: StateInternalMessage): Promise<MetaData> {
  if (!fs.existsSync(cardDir)) fs.mkdirSync(cardDir, { recursive: true });
  const bpDir = path.join(cardDir, BLUEPRINTS_DIR);
  if (!fs.existsSync(bpDir)) fs.mkdirSync(bpDir, { recursive: true });
  const castleDir = path.join(cardDir, CASTLE_DIR);
  if (!fs.existsSync(castleDir)) fs.mkdirSync(castleDir, { recursive: true });

  const hashes: FileHashes = {};
  const blueprintIdMap: Record<string, string> = {};

  // Convert blueprint component values from internal → display format (for YAML compatibility).
  // Build an internal-format snapshot for WASM conversion.
  const internalLibrary: any = {};
  for (const [entryId, entry] of Object.entries(state.blueprints)) {
    if ((entry as any).entryType !== 'actorBlueprint') continue;
    internalLibrary[entryId] = {
      entryType: 'actorBlueprint',
      title: (entry as any).title,
      actorBlueprint: { components: { ...((entry as any).actorBlueprint?.components ?? {}) } },
    };
  }

  let externalLibrary: Record<string, any>;
  try {
    const externalSnapshot = await getSnapshotExternalValues({ library: internalLibrary, actors: [] });
    externalLibrary = externalSnapshot.library ?? {};
  } catch (e) {
    // If WASM conversion fails, use the internal library as-is
    externalLibrary = internalLibrary;
  }

  const drawPreviewsEnabled = isDrawPreviewsEnabled(path.dirname(cardDir));
  const drawPreviewHashes: Record<string, string> = readMeta(cardDir)?.drawPreviewHashes ?? {};

  // Write blueprint files
  const writtenSlugs = new Set<string>();
  const previewPromises: Promise<void>[] = [];
  for (const [entryId, entry] of Object.entries(state.blueprints)) {
    const entryTyped = entry as any;
    if (entryTyped.entryType !== 'actorBlueprint') continue;

    const title = entryTyped.title ?? 'untitled';
    let slug = titleToSlug(title);

    if (writtenSlugs.has(slug)) {
      let counter = 2;
      while (writtenSlugs.has(`${slug}_${counter}`)) counter++;
      slug = `${slug}_${counter}`;
    }
    writtenSlugs.add(slug);
    blueprintIdMap[slug] = entryId;

    // Use display-format components from WASM conversion; fall back to internal
    const rawComponents = { ...(externalLibrary[entryId]?.actorBlueprint?.components ?? entryTyped.actorBlueprint?.components ?? {}) };

    // Extract engine-computed/complex data into companion .draw.json using the original
    // mobile state (before WASM conversion, which strips LocalVariables and other fields).
    const originalComponents = entryTyped.actorBlueprint?.components ?? {};

    // If mobile omitted drawData/physicsBodyData (Drawing2.hash present but blobs absent),
    // it means the hash is unchanged and the existing .draw.json is still valid — preserve it.
    // Check originalComponents (raw mobile state) not rawComponents (WASM may synthesize drawData).
    const origDrawing2 = originalComponents.Drawing2;
    const drawDataOmitted = origDrawing2 !== undefined
      && origDrawing2.hash !== undefined
      && origDrawing2.drawData === undefined
      && origDrawing2.physicsBodyData === undefined;

    if (!drawDataOmitted) {
      const drawFileData = extractDrawData({
        ...originalComponents,
        // Drawing2/Body physics come from WASM-converted rawComponents (same values, but
        // rawComponents is authoritative for those blobs)
        ...(rawComponents.Drawing2 !== undefined ? { Drawing2: rawComponents.Drawing2 } : {}),
        ...(rawComponents.Body !== undefined ? { Body: rawComponents.Body } : {}),
      });
      if (drawFileData) {
        fs.writeFileSync(path.join(bpDir, `${slug}.draw.json`), JSON.stringify(drawFileData, null, 2));
        if (drawPreviewsEnabled) {
          previewPromises.push(maybeRegenerateDrawPreviewAsync(bpDir, slug, drawFileData.Drawing2, drawPreviewHashes));
        }
      }
    }
    // drawDataOmitted: slug is already in writtenSlugs so the cleanup loop won't delete .draw.json

    // Strip engine-only Drawing2 fields (not needed in YAML; stored in .draw.json above)
    if (rawComponents.Drawing2) {
      const d2 = { ...rawComponents.Drawing2 };
      delete d2.drawData;
      delete d2.physicsBodyData;
      delete d2.hash;
      delete d2.currentFrame;
      rawComponents.Drawing2 = d2;
    }

    // Strip engine-computed Body fields
    if (rawComponents.Body) {
      const body = { ...rawComponents.Body };
      for (const field of BP_BODY_STRIP_FIELDS) {
        delete body[field];
      }
      rawComponents.Body = body;
    }

    // Serialize components: maps internal names → display names, serializes Rules/Script
    let scriptCode: string | null = null;
    const serializedComponents = serializeComponents({
      components: rawComponents,
      writeScriptFile: (code: string) => {
        scriptCode = code;
        return `${slug}.lua`;
      },
    });

    const bpData: any = { title, entryId, components: serializedComponents };

    // Reference lua file in Script component if script was written
    if (scriptCode && serializedComponents.Script) {
      serializedComponents.Script = { file: `${slug}.lua` };
    }

    const yamlContent = yaml.stringify(bpData, { lineWidth: 120 });
    const yamlPath = path.join(BLUEPRINTS_DIR, `${slug}.yaml`);
    fs.writeFileSync(path.join(cardDir, yamlPath), yamlContent);
    hashes[yamlPath] = contentHash(yamlContent);

    if (scriptCode) {
      const luaPath = path.join(BLUEPRINTS_DIR, `${slug}.lua`);
      fs.writeFileSync(path.join(cardDir, luaPath), scriptCode);
      hashes[luaPath] = contentHash(scriptCode);
    }
  }

  // Clean up blueprint files that no longer exist (including .draw.json companions)
  const existingBpFiles = fs.existsSync(bpDir) ? fs.readdirSync(bpDir) : [];
  for (const file of existingBpFiles) {
    const slug = file.endsWith('.draw.json')
      ? file.slice(0, -'.draw.json'.length)
      : file.replace(/\.(yaml|lua)$/, '');
    if (!writtenSlugs.has(slug) && (file.endsWith('.yaml') || file.endsWith('.lua') || file.endsWith('.draw.json'))) {
      fs.unlinkSync(path.join(bpDir, file));
    }
  }

  await Promise.all(previewPromises);

  // Write actors.yaml — convert internal format (widthScale 0–1, radians) to disk format (×10, degrees)
  const actorsForDisk = mobileActorsToDiskFormat(state);
  const actorsContent = yaml.stringify(actorsForDisk, { lineWidth: 120 });
  fs.writeFileSync(path.join(cardDir, ACTORS_FILE), actorsContent);
  hashes[ACTORS_FILE] = contentHash(actorsContent);

  // Write variables
  const variablesContent = yaml.stringify(state.variables, { lineWidth: 120 });
  fs.writeFileSync(path.join(cardDir, VARIABLES_FILE), variablesContent);
  hashes[VARIABLES_FILE] = contentHash(variablesContent);

  // Write sceneProperties, actorBlueprintInherit, and linkTargetDeckIds to card.yaml
  writeCardYamlFields(cardDir, {
    cardId: state.cardId,
    sceneProperties: state.sceneProperties,
    actorBlueprintInherit: state.actorBlueprintInherit,
    linkTargetDeckIds: state.linkTargetDeckIds,
  });
  // Hash card.yaml so detectChanges treats this write as baseline (no spurious echo)
  const cardYamlContent = fs.readFileSync(path.join(cardDir, CARD_YAML_FILE), 'utf-8');
  hashes[CARD_YAML_FILE] = contentHash(cardYamlContent);

  const meta: MetaData = {
    deckId: state.deckId,
    cardId: state.cardId,
    hashes,
    blueprintIdMap,
    lastActors: actorsForDisk,
    drawPreviewHashes,
  };
  writeMeta(cardDir, meta);

  return meta;
}

// Convert StateInternalMessage → scene data JSON (for web player cache).
// Uses EDITOR_LIBRARY directly, preserving drawData and physicsBodyData.
export function mobileInternalStateToSceneData(state: StateInternalMessage): any {
  // Build library directly from raw EDITOR_LIBRARY entries (drawData preserved)
  const library: any = {};
  for (const [entryId, entry] of Object.entries(state.blueprints)) {
    const entryTyped = entry as any;
    library[entryId] = {
      entryType: entryTyped.entryType ?? 'actorBlueprint',
      title: entryTyped.title,
      actorBlueprint: {
        components: entryTyped.actorBlueprint?.components ?? {},
      },
    };
  }

  // Build actors array from state.actors (internal format: widthScale 0–1, angle radians)
  const actors: any[] = [];
  for (const [key, actor] of Object.entries(state.actors)) {
    const actorTyped = actor as any;
    const actorId = actorTyped.actorId ?? (key.startsWith('a') ? key.slice(1) : key);
    actors.push({
      actorId,
      parentEntryId: actorTyped.parentEntryId,
      bp: actorTyped.bp ?? {},
    });
  }

  const snapshot: any = { library, actors };
  if (state.sceneProperties) snapshot.sceneProperties = state.sceneProperties;
  if (state.actorBlueprintInherit !== undefined) snapshot.actorBlueprintInherit = state.actorBlueprintInherit;
  if (state.linkTargetDeckIds !== undefined) snapshot.linkTargetDeckIds = state.linkTargetDeckIds;

  return { snapshot };
}

// Detect conflicts between existing disk files and incoming mobile state.
// Returns null if the deck has no files (empty deck — no conflict, use mobile-primary).
// Returns ConflictSummary with hasConflicts=false if states appear in sync.
export function detectConflicts(cardDir: string, mobileState: StateInternalMessage): ConflictSummary | null {
  const actorsPath = path.join(cardDir, ACTORS_FILE);
  if (!fs.existsSync(actorsPath)) return null; // empty deck

  // Build mobile blueprint slug → entryId map (same slug-dedup logic as writeStateInternal)
  const mobileBlueprintBySlug = new Map<string, string>();
  const mobileEntryIds = new Set<string>();
  const seenMobileSlugs = new Set<string>();
  for (const [entryId, entry] of Object.entries(mobileState.blueprints)) {
    const typed = entry as any;
    if (typed.entryType !== 'actorBlueprint') continue;
    const title = typed.title ?? 'untitled';
    let slug = titleToSlug(title);
    let counter = 2;
    while (seenMobileSlugs.has(slug)) { slug = `${slug}_${counter}`; counter++; }
    seenMobileSlugs.add(slug);
    mobileBlueprintBySlug.set(slug, entryId);
    mobileEntryIds.add(entryId);
  }

  // Build disk blueprint slugs and entryId set
  const diskBlueprintSlugs = new Set<string>();
  const diskEntryIds = new Set<string>();
  const diskSlugToEntryId = new Map<string, string>();
  const bpDir = path.join(cardDir, BLUEPRINTS_DIR);
  if (fs.existsSync(bpDir)) {
    for (const file of fs.readdirSync(bpDir)) {
      if (!file.endsWith('.yaml')) continue;
      const slug = file.replace('.yaml', '');
      diskBlueprintSlugs.add(slug);
      try {
        const bpData = yaml.parse(fs.readFileSync(path.join(bpDir, file), 'utf-8')) as any;
        if (bpData?.entryId) {
          diskEntryIds.add(bpData.entryId);
          diskSlugToEntryId.set(slug, bpData.entryId);
        }
      } catch {}
    }
  }

  // Compare by entryId when available (reliable across filename convention changes).
  // Fall back to slug comparison only when the disk YAML has no entryId.
  const localOnlyBlueprintSlugs = [...diskBlueprintSlugs].filter(s => {
    const entryId = diskSlugToEntryId.get(s);
    if (entryId) return !mobileEntryIds.has(entryId);
    return !mobileBlueprintBySlug.has(s);
  });
  const mobileOnlyBlueprintEntryIds = [...mobileEntryIds].filter(id => !diskEntryIds.has(id));

  // Compare actors by actorId: match each disk actor to its mobile counterpart, then compare content.
  const mobileActors = mobileActorsToDiskFormat(mobileState);
  let diskActors: any[] = [];
  try { diskActors = yaml.parse(fs.readFileSync(actorsPath, 'utf-8')) ?? []; } catch {}
  const mobileById = new Map(mobileActors.map(a => [String(a.actorId), a]));
  let actorsDiffer = diskActors.length !== mobileActors.length;
  if (!actorsDiffer) {
    for (const diskActor of diskActors) {
      const mobileActor = mobileById.get(String(diskActor.actorId));
      if (!mobileActor) { actorsDiffer = true; break; }
      const { actorId: _d, ...diskContent } = diskActor;
      const { actorId: _m, ...mobileContent } = mobileActor;
      if (JSON.stringify(diskContent) !== JSON.stringify(mobileContent)) { actorsDiffer = true; break; }
    }
  }

  // Compare variables. Sort by variableId so ordering differences don't produce false positives.
  // Also skip if disk is empty — clone always writes [] so a non-empty mobile state is not a real conflict.
  let variablesDiffer = false;
  const variablesPath = path.join(cardDir, VARIABLES_FILE);
  if (fs.existsSync(variablesPath)) {
    try {
      const diskVariables: any[] = yaml.parse(fs.readFileSync(variablesPath, 'utf-8')) ?? [];
      const mobileVariables: any[] = Array.isArray(mobileState.variables) ? mobileState.variables : [];
      if (diskVariables.length > 0 || mobileVariables.length > 0) {
        const sortVars = (vars: any[]) =>
          [...vars].sort((a, b) => (a.variableId ?? a.name ?? '').localeCompare(b.variableId ?? b.name ?? ''));
        variablesDiffer = diskVariables.length > 0 &&
          JSON.stringify(sortVars(diskVariables)) !== JSON.stringify(sortVars(mobileVariables));
      }
    } catch {}
  }

  const hasConflicts = localOnlyBlueprintSlugs.length > 0 ||
    mobileOnlyBlueprintEntryIds.length > 0 ||
    actorsDiffer ||
    variablesDiffer;

  return { localOnlyBlueprintSlugs, mobileOnlyBlueprintEntryIds, actorsDiffer, variablesDiffer, hasConflicts };
}

// Compute what needs to change on mobile so its state matches disk files.
// Returns FileChanges in the same format as detectChanges() — can be passed directly to _sendChanges().
export function computeDiskVsMobileDelta(cardDir: string, mobileState: StateInternalMessage): FileChanges {
  const result: FileChanges = {
    changedBlueprints: {},
    changedActors: null,
    changedVariables: null,
    hasChanges: false,
  };

  const meta = readMeta(cardDir);
  const bpDir = path.join(cardDir, BLUEPRINTS_DIR);

  // Build set of all mobile blueprint entryIds
  const mobileEntryIds = new Set(Object.keys(mobileState.blueprints));

  // Process disk blueprints
  const diskEntryIds = new Set<string>();
  if (fs.existsSync(bpDir)) {
    for (const file of fs.readdirSync(bpDir)) {
      if (!file.endsWith('.yaml')) continue;
      const slug = file.replace('.yaml', '');
      const yamlContent = fs.readFileSync(path.join(bpDir, file), 'utf-8');
      let bpData: any;
      try { bpData = yaml.parse(yamlContent) as any; } catch { continue; }

      // entryId: from YAML file, or previously assigned UUID in meta.json blueprintIdMap
      const entryId: string | undefined = bpData?.entryId ?? meta?.blueprintIdMap[slug];

      if (entryId) {
        diskEntryIds.add(entryId);
        if (!mobileEntryIds.has(entryId)) {
          // Disk has this blueprint, mobile doesn't → send it
          result.hasChanges = true;
          const edit: BlueprintChange = { entryId, title: bpData?.title ?? slug };
          if (bpData?.components) {
            const components = { ...bpData.components };
            if (components.Script?.file) {
              const { file: _f, ...rest } = components.Script;
              components.Script = rest;
            }
            edit.components = yaml.stringify(components, { lineWidth: 120 });
          }
          const luaPath = path.join(bpDir, `${slug}.lua`);
          if (fs.existsSync(luaPath)) edit.script = [{ code: fs.readFileSync(luaPath, 'utf-8') }];
          if (bpData?.drawing) edit.drawing = bpData.drawing;
          result.changedBlueprints[entryId] = edit;
        }
        // Both have same entryId → skip content comparison for now (future work)
      } else {
        // No known entryId → treat as new blueprint for mobile
        const newKey = `new-${slug}`;
        result.hasChanges = true;
        const edit: BlueprintChange = {
          entryId: newKey,
          isNew: true,
          forkBlueprintId: bpData?.forkBlueprintId ?? 'default-blueprint-0',
          title: bpData?.title ?? slug,
        };
        if (bpData?.components) {
          const components = { ...bpData.components };
          if (components.Script?.file) {
            const { file: _f, ...rest } = components.Script;
            components.Script = rest;
          }
          edit.components = yaml.stringify(components, { lineWidth: 120 });
        }
        const luaPath = path.join(bpDir, `${slug}.lua`);
        if (fs.existsSync(luaPath)) edit.script = [{ code: fs.readFileSync(luaPath, 'utf-8') }];
        if (bpData?.drawing) edit.drawing = bpData.drawing;
        result.changedBlueprints[newKey] = edit;
      }
    }
  }

  // Mobile blueprints not on disk → remove from mobile
  for (const entryId of mobileEntryIds) {
    if (!diskEntryIds.has(entryId)) {
      result.hasChanges = true;
      result.changedBlueprints[entryId] = { entryId, removeBlueprint: true };
    }
  }

  // Actors: compute sparse diff (disk vs mobile-in-disk-format), matched by actorId
  const actorsPath = path.join(cardDir, ACTORS_FILE);
  const diskActors: any[] = fs.existsSync(actorsPath)
    ? (yaml.parse(fs.readFileSync(actorsPath, 'utf-8')) as any[]) ?? []
    : [];
  const mobileActors = mobileActorsToDiskFormat(mobileState);
  const mobileById = new Map(mobileActors.map(a => [String(a.actorId), a]));
  const diskById = new Map(diskActors.map(a => [String(a.actorId), a]));

  const actorsDiff: Record<string, any> = {};
  for (const diskActor of diskActors) {
    const { actorId, ...content } = diskActor;
    const mobileActor = mobileById.get(String(actorId));
    if (!mobileActor) {
      actorsDiff[`a${actorId}`] = content; // new actor on disk
    } else {
      const { actorId: _m, ...mobileContent } = mobileActor;
      if (JSON.stringify(content) !== JSON.stringify(mobileContent)) {
        actorsDiff[`a${actorId}`] = content; // changed
      }
    }
  }
  for (const mobileActor of mobileActors) {
    if (!diskById.has(String(mobileActor.actorId))) {
      actorsDiff[`a${mobileActor.actorId}`] = { removeActor: true };
    }
  }
  if (Object.keys(actorsDiff).length > 0) {
    result.hasChanges = true;
    result.changedActors = actorsDiff;
  }

  // Variables
  const variablesPath = path.join(cardDir, VARIABLES_FILE);
  if (fs.existsSync(variablesPath)) {
    try {
      const diskVariables = yaml.parse(fs.readFileSync(variablesPath, 'utf-8'));
      if (JSON.stringify(diskVariables) !== JSON.stringify(mobileState.variables)) {
        result.hasChanges = true;
        result.changedVariables = diskVariables;
      }
    } catch {}
  }

  // Scene properties (from card.yaml)
  const cardYamlPath = path.join(cardDir, CARD_YAML_FILE);
  if (fs.existsSync(cardYamlPath)) {
    try {
      const cardData = yaml.parse(fs.readFileSync(cardYamlPath, 'utf-8')) as any;
      if (JSON.stringify(cardData?.sceneProperties) !== JSON.stringify(mobileState.sceneProperties)) {
        result.changedSceneProperties = cardData?.sceneProperties;
        result.hasChanges = true;
      }
    } catch {}
  }

  return result;
}

// Create (or refresh) meta.json from existing disk files. Used in CLI-primary mode so the
// file watcher has a correct hash baseline without needing to write any mobile state.
export function initMetaFromDisk(cardDir: string, deckId: string, cardId: string): void {
  const existingMeta = readMeta(cardDir);
  const blueprintIdMap: Record<string, string> = existingMeta?.blueprintIdMap ?? {};
  const drawPreviewHashes: Record<string, string> = existingMeta?.drawPreviewHashes ?? {};
  const hashes: FileHashes = {};

  const bpDir = path.join(cardDir, BLUEPRINTS_DIR);
  if (fs.existsSync(bpDir)) {
    for (const file of fs.readdirSync(bpDir)) {
      if (!file.endsWith('.yaml') && !file.endsWith('.lua')) continue;
      const relPath = path.join(BLUEPRINTS_DIR, file);
      const content = fs.readFileSync(path.join(cardDir, relPath), 'utf-8');
      hashes[relPath] = contentHash(content);
      if (file.endsWith('.yaml')) {
        const slug = file.replace('.yaml', '');
        try {
          const bpData = yaml.parse(content) as any;
          if (bpData?.entryId && !blueprintIdMap[slug]) blueprintIdMap[slug] = bpData.entryId;
        } catch {}
      }
    }
  }

  let lastActors: any[] | undefined;
  const actorsPath = path.join(cardDir, ACTORS_FILE);
  if (fs.existsSync(actorsPath)) {
    const content = fs.readFileSync(actorsPath, 'utf-8');
    hashes[ACTORS_FILE] = contentHash(content);
    try { lastActors = (yaml.parse(content) as any[]) ?? []; } catch {}
  }

  const variablesPath = path.join(cardDir, VARIABLES_FILE);
  if (fs.existsSync(variablesPath)) {
    hashes[VARIABLES_FILE] = contentHash(fs.readFileSync(variablesPath, 'utf-8'));
  }

  const cardYamlPath = path.join(cardDir, CARD_YAML_FILE);
  if (fs.existsSync(cardYamlPath)) {
    hashes[CARD_YAML_FILE] = contentHash(fs.readFileSync(cardYamlPath, 'utf-8'));
  }

  writeMeta(cardDir, { deckId, cardId, hashes, blueprintIdMap, lastActors, drawPreviewHashes });
}
