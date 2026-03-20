import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import yaml from 'yaml';
import { StateInternalMessage, StateInternalDiffMessage, VariableData } from './mobile-protocol.js';
import { serializeComponents } from './behaviors.js';
import { getSnapshotExternalValues } from './castle-core-node.js';

const BLUEPRINTS_DIR = 'blueprints';
const ACTORS_FILE = 'actors.yaml';
const VARIABLES_FILE = 'variables.yaml';
const CASTLE_DIR = '.castle';
const META_FILE = path.join(CASTLE_DIR, 'meta.json');


// Convert a blueprint title to a safe filename slug
export function titleToSlug(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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
  lastActors?: Record<string, any>; // actors dict last written to disk (disk format, for diff computation)
}

function readMeta(dir: string): MetaData | null {
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
  drawing?: string;
  removeBlueprint?: boolean;
}

export interface FileChanges {
  changedBlueprints: Record<string, BlueprintChange>;
  changedActors: Record<string, any> | null;
  changedVariables: Record<string, any> | null;
  hasChanges: boolean;
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

      if (yamlChanged || luaChanged) {
        result.hasChanges = true;

        const edit: BlueprintChange = { entryId };

        if (yamlChanged && bpData) {
          if (bpData.title) edit.title = bpData.title;
          if (bpData.drawing) edit.drawing = bpData.drawing;
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
        const currentActors = (yaml.parse(content) as Record<string, any>) ?? {};
        // If lastActors is missing (old meta without diff support), skip actor diff.
        if (meta.lastActors !== undefined) {
          const lastActors = meta.lastActors;
          const actorsDiff: Record<string, any> = {};

          // Added or changed actors
          for (const [key, data] of Object.entries(currentActors)) {
            if (!(key in lastActors)) {
              actorsDiff[key] = data; // new
            } else if (JSON.stringify(data) !== JSON.stringify(lastActors[key])) {
              actorsDiff[key] = data; // changed
            }
          }

          // Removed actors
          for (const key of Object.keys(lastActors)) {
            if (!(key in currentActors)) {
              actorsDiff[key] = { removeActor: true };
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

  return result;
}

// Update stored hashes to reflect current file state (call after sending an EditMessage)
export function updateMetaHashes(cardDir: string): void {
  const meta = readMeta(cardDir);
  if (!meta) return;

  const bpDir = path.join(cardDir, BLUEPRINTS_DIR);
  if (fs.existsSync(bpDir)) {
    for (const file of fs.readdirSync(bpDir)) {
      if (file.endsWith('.yaml') || file.endsWith('.lua')) {
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
      meta.lastActors = (yaml.parse(actorsContent) as Record<string, any>) ?? {};
    } catch (e) {
      console.warn('[files] failed to parse actors.yaml in updateMetaHashes:', e);
    }
  }

  const variablesPath = path.join(cardDir, VARIABLES_FILE);
  if (fs.existsSync(variablesPath)) {
    meta.hashes[VARIABLES_FILE] = contentHash(fs.readFileSync(variablesPath, 'utf-8'));
  }

  writeMeta(cardDir, meta);
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

  // Write blueprint files
  const writtenSlugs = new Set<string>();
  for (const [entryId, entry] of Object.entries(state.blueprints)) {
    const entryTyped = entry as any;
    if (entryTyped.entryType !== 'actorBlueprint') continue;

    const title = entryTyped.title ?? 'untitled';
    let slug = titleToSlug(title);

    if (writtenSlugs.has(slug)) {
      let counter = 2;
      while (writtenSlugs.has(`${slug}-${counter}`)) counter++;
      slug = `${slug}-${counter}`;
    }
    writtenSlugs.add(slug);
    blueprintIdMap[slug] = entryId;

    // Use display-format components from WASM conversion; fall back to internal
    const rawComponents = { ...(externalLibrary[entryId]?.actorBlueprint?.components ?? entryTyped.actorBlueprint?.components ?? {}) };

    // Extract engine-computed drawing/physics data before stripping — stored in companion .draw.json
    const drawFileData: any = {};
    if (rawComponents.Drawing2) {
      const d2extract: any = {};
      if (rawComponents.Drawing2.drawData !== undefined) d2extract.drawData = rawComponents.Drawing2.drawData;
      if (rawComponents.Drawing2.physicsBodyData !== undefined) d2extract.physicsBodyData = rawComponents.Drawing2.physicsBodyData;
      if (rawComponents.Drawing2.hash !== undefined) d2extract.hash = rawComponents.Drawing2.hash;
      if (Object.keys(d2extract).length > 0) drawFileData.Drawing2 = d2extract;
    }
    if (rawComponents.Body) {
      const bodyExtract: any = {};
      if (rawComponents.Body.fixtures !== undefined) bodyExtract.fixtures = rawComponents.Body.fixtures;
      if (rawComponents.Body.editorBounds !== undefined) bodyExtract.editorBounds = rawComponents.Body.editorBounds;
      if (Object.keys(bodyExtract).length > 0) drawFileData.Body = bodyExtract;
    }
    if (Object.keys(drawFileData).length > 0) {
      fs.writeFileSync(path.join(bpDir, `${slug}.draw.json`), JSON.stringify(drawFileData, null, 2));
    }

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

  // Write actors.yaml — convert internal format (widthScale 0–1, radians) to disk format (×10, degrees)
  const actorsForDisk: Record<string, any> = {};
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

    const actorEntry: any = { title };
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

    actorsForDisk[key] = actorEntry;
  }
  const actorsContent = yaml.stringify(actorsForDisk, { lineWidth: 120 });
  fs.writeFileSync(path.join(cardDir, ACTORS_FILE), actorsContent);
  hashes[ACTORS_FILE] = contentHash(actorsContent);

  // Write variables
  const variablesContent = yaml.stringify(state.variables, { lineWidth: 120 });
  fs.writeFileSync(path.join(cardDir, VARIABLES_FILE), variablesContent);
  hashes[VARIABLES_FILE] = contentHash(variablesContent);

  const meta: MetaData = {
    deckId: state.deckId,
    cardId: state.cardId,
    hashes,
    blueprintIdMap,
    lastActors: actorsForDisk,
  };
  writeMeta(cardDir, meta);

  return meta;
}

// Merge a StateInternalDiffMessage into a full StateInternalMessage.
export function applyStateDiff(
  base: StateInternalMessage,
  diff: StateInternalDiffMessage
): StateInternalMessage {
  const blueprints = { ...base.blueprints };
  for (const [id, change] of Object.entries(diff.blueprintChanges ?? {})) {
    if ((change as any).removed) delete blueprints[id];
    else blueprints[id] = change;
  }
  const actors = { ...base.actors };
  for (const [key, change] of Object.entries(diff.actorChanges ?? {})) {
    if ((change as any).removed) delete actors[key];
    else actors[key] = change;
  }
  return {
    ...base,
    blueprints,
    actors,
    variables: diff.variables ?? base.variables,
  };
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

  return {
    snapshot: {
      library,
      actors,
    },
  };
}

