import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import yaml from 'js-yaml';
import { StateMessage, BlueprintData, ActorData, VariableData } from './mobile-protocol.js';

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
}

function readMeta(dir: string): MetaData | null {
  const metaPath = path.join(dir, META_FILE);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeMeta(dir: string, meta: MetaData): void {
  fs.writeFileSync(path.join(dir, META_FILE), JSON.stringify(meta, null, 2));
}

// Check if a directory is safe to write to (empty, or same deck)
export function canWriteToDir(dir: string, deckId: string): { ok: boolean; reason?: string } {
  if (!fs.existsSync(dir)) return { ok: true };

  const entries = fs.readdirSync(dir).filter(e => !e.startsWith('.'));
  if (entries.length === 0) return { ok: true };

  const meta = readMeta(dir);
  if (meta && meta.deckId === deckId) return { ok: true };
  if (meta && meta.deckId !== deckId) {
    return { ok: false, reason: `directory contains data for deck ${meta.deckId}, not ${deckId}` };
  }

  // Has files but no meta — don't overwrite an existing project
  return { ok: false, reason: 'directory contains existing files without castle-cli metadata' };
}

// Write scene state to disk (cardDir is the per-card directory)
export function writeState(cardDir: string, state: StateMessage): MetaData {
  // Ensure directories exist
  if (!fs.existsSync(cardDir)) fs.mkdirSync(cardDir, { recursive: true });
  const bpDir = path.join(cardDir, BLUEPRINTS_DIR);
  if (!fs.existsSync(bpDir)) fs.mkdirSync(bpDir, { recursive: true });
  const castleDir = path.join(cardDir, CASTLE_DIR);
  if (!fs.existsSync(castleDir)) fs.mkdirSync(castleDir, { recursive: true });

  const hashes: FileHashes = {};
  const blueprintIdMap: Record<string, string> = {};

  // Write blueprint files
  const writtenSlugs = new Set<string>();
  for (const [entryId, bp] of Object.entries(state.blueprints)) {
    let slug = titleToSlug(bp.title);

    // Handle duplicate slugs
    if (writtenSlugs.has(slug)) {
      let counter = 2;
      while (writtenSlugs.has(`${slug}-${counter}`)) counter++;
      slug = `${slug}-${counter}`;
    }
    writtenSlugs.add(slug);
    blueprintIdMap[slug] = entryId;

    // Write YAML (components without script code)
    const bpData: any = {
      title: bp.title,
      entryId: bp.entryId,
      components: bp.components,
    };

    // Reference the lua file if there's script code
    if (bp.scriptCode) {
      if (bpData.components?.Script) {
        bpData.components.Script.file = `${slug}.lua`;
      }
    }

    const yamlContent = yaml.dump(bpData, { lineWidth: 120, noRefs: true });
    const yamlPath = path.join(BLUEPRINTS_DIR, `${slug}.yaml`);
    fs.writeFileSync(path.join(cardDir, yamlPath), yamlContent);
    hashes[yamlPath] = contentHash(yamlContent);

    // Write lua file
    if (bp.scriptCode) {
      const luaPath = path.join(BLUEPRINTS_DIR, `${slug}.lua`);
      fs.writeFileSync(path.join(cardDir, luaPath), bp.scriptCode);
      hashes[luaPath] = contentHash(bp.scriptCode);
    }
  }

  // Clean up blueprint files that no longer exist
  const existingBpFiles = fs.existsSync(bpDir) ? fs.readdirSync(bpDir) : [];
  for (const file of existingBpFiles) {
    const slug = file.replace(/\.(yaml|lua)$/, '');
    if (!writtenSlugs.has(slug) && (file.endsWith('.yaml') || file.endsWith('.lua'))) {
      fs.unlinkSync(path.join(bpDir, file));
    }
  }

  // Write actors in nested display-name format (Layout/Drawing keys, ×10 widthScale/heightScale)
  const actorsForDisk: Record<string, any> = {};
  for (const [key, actorData] of Object.entries(state.actors) as [string, ActorData][]) {
    const ad = actorData;
    const layout: any = { x: ad.x ?? 0, y: ad.y ?? 0 };
    if (ad.angle !== undefined) layout.angle = ad.angle; // radians — unchanged
    if (ad.widthScale !== undefined) layout.widthScale = ad.widthScale * 10; // ×10
    if (ad.heightScale !== undefined) layout.heightScale = ad.heightScale * 10; // ×10
    const components: any = { Layout: layout };
    if (ad.initialFrame && ad.initialFrame !== 1) {
      components.Drawing = { initialFrame: ad.initialFrame };
    }
    if (ad.content !== undefined) {
      components.Text = {
        content: ad.content,
        ...(ad.fontSizeScale !== undefined && { fontSizeScale: ad.fontSizeScale }),
      };
    }
    if (ad.targetDeckId !== undefined) {
      components.Link = { targetDeckId: ad.targetDeckId };
    }
    actorsForDisk[key] = { entryId: ad.entryId, components };
  }
  const actorsContent = yaml.dump(actorsForDisk, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(path.join(cardDir, ACTORS_FILE), actorsContent);
  hashes[ACTORS_FILE] = contentHash(actorsContent);

  // Write variables
  const variablesContent = yaml.dump(state.variables, { lineWidth: 120, noRefs: true });
  fs.writeFileSync(path.join(cardDir, VARIABLES_FILE), variablesContent);
  hashes[VARIABLES_FILE] = contentHash(variablesContent);

  // Write meta
  const meta: MetaData = {
    deckId: state.deckId,
    cardId: state.cardId,
    hashes,
    blueprintIdMap,
  };
  writeMeta(cardDir, meta);

  return meta;
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
        bpData = yaml.load(yamlContent) as any;
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
          edit.components = yaml.dump(components, { lineWidth: 120, noRefs: true });
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
            edit.components = yaml.dump(components, { lineWidth: 120, noRefs: true });
          }
        }

        if (luaChanged && luaContent !== null) {
          edit.script = [{ code: luaContent }];
        }

        result.changedBlueprints[entryId] = edit;
      }
    }
  }

  // Check actors
  const actorsPath = path.join(cardDir, ACTORS_FILE);
  if (fs.existsSync(actorsPath)) {
    const content = fs.readFileSync(actorsPath, 'utf-8');
    if (meta.hashes[ACTORS_FILE] !== contentHash(content)) {
      try {
        result.hasChanges = true;
        result.changedActors = yaml.load(content) as any;
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
        result.hasChanges = true;
        result.changedVariables = yaml.load(content) as any;
      } catch (e: any) {
        console.error(`[files] failed to parse variables.yaml: ${e.reason || e.message}`);
      }
    }
  }

  return result;
}

// Convert mobile StateMessage → scene data JSON (for web player cache)
export function mobileStateToSceneData(state: StateMessage): any {
  // Build library from blueprints
  const library: any = {};
  for (const [entryId, bp] of Object.entries(state.blueprints)) {
    library[entryId] = {
      entryType: 'actorBlueprint',
      title: bp.title,
      actorBlueprint: {
        components: bp.components,
      },
    };
  }

  // Build actors array from state.actors (object format: { "a123": { entryId, x, y, ... } })
  const actors: any[] = [];
  for (const [key, actorData] of Object.entries(state.actors)) {
    const actorId = key.startsWith('a') ? key.slice(1) : key;
    const ad = actorData as ActorData;

    const bodyComponents: any = {
      x: ad.x || 0,
      y: ad.y || 0,
      angle: ad.angle || 0,
      widthScale: ad.widthScale || 0,
      heightScale: ad.heightScale || 0,
    };

    const bpComponents: any = {
      Body: bodyComponents,
    };

    if (ad.initialFrame && ad.initialFrame !== 1) {
      bpComponents.Drawing2 = { initialFrame: ad.initialFrame };
    }

    actors.push({
      actorId,
      parentEntryId: ad.entryId,
      bp: {
        components: bpComponents,
      },
    });
  }

  return {
    snapshot: {
      library,
      actors,
    },
  };
}
