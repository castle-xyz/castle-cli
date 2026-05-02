import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
import { applySnapshot, getCastleMetadata, getSnapshotExternalValues } from './castle-core-node.js';

const INTERNAL_TO_YAML_COMPONENT: Record<string, string> = {
  Body: 'Layout',
  Drawing2: 'Drawing',
};

const YAML_TO_INTERNAL_COMPONENT: Record<string, string> = {
  Layout: 'Body',
  Drawing: 'Drawing2',
};

export interface ProjectCardInfo {
  cardId: string;
  title?: string;
  sceneDataUrl?: string;
}

export interface WriteProjectCardOptions {
  deckId: string;
  card: ProjectCardInfo;
  cardDir: string;
  sceneData: any;
  replace?: boolean;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(base: any, override: any): any {
  if (!isPlainObject(base) || !isPlainObject(override)) return clone(override);
  const result = clone(base);
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    result[key] = isPlainObject(result[key]) && isPlainObject(value)
      ? mergeDeep(result[key], value)
      : clone(value);
  }
  return result;
}

function slugify(title: string, fallback: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function uniqueSlug(base: string, used: Set<string>): string {
  let slug = base;
  let i = 2;
  while (used.has(slug)) {
    slug = `${base}-${i}`;
    i++;
  }
  used.add(slug);
  return slug;
}

async function getInternalDisplayNameMap(): Promise<Record<string, string>> {
  const { behaviors } = await getCastleMetadata();
  const result: Record<string, string> = {};
  for (const [name, behavior] of Object.entries(behaviors) as [string, any][]) {
    result[name] = behavior.displayName || name;
  }
  return result;
}

async function getYamlInternalNameMap(): Promise<Record<string, string>> {
  const displayByInternal = await getInternalDisplayNameMap();
  const result: Record<string, string> = {};
  for (const [internal, display] of Object.entries(displayByInternal)) {
    result[display] = internal;
  }
  return { ...result, ...YAML_TO_INTERNAL_COMPONENT };
}

function componentNameForYaml(internalName: string, displayByInternal: Record<string, string>): string {
  return INTERNAL_TO_YAML_COMPONENT[internalName] || displayByInternal[internalName] || internalName;
}

function componentNameForEngine(yamlName: string, internalByYaml: Record<string, string>): string {
  return internalByYaml[yamlName] || YAML_TO_INTERNAL_COMPONENT[yamlName] || yamlName;
}

function mapComponentKeys(
  components: Record<string, any>,
  mapName: (name: string) => string
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [name, component] of Object.entries(components || {})) {
    result[mapName(name)] = component;
  }
  return result;
}

function componentsForYaml(components: Record<string, any>): Record<string, any> {
  const result = clone(components ?? {});
  if (result.Body) {
    delete result.Body.fixtures;
  }
  if (result.Script) {
    delete result.Script.code;
  }
  if (result.Drawing2) {
    delete result.Drawing2.drawData;
    delete result.Drawing2.physicsBodyData;
  }
  return result;
}

function readJsonIfExists(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readYamlIfExists(filePath: string): any | null {
  try {
    return YAML.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeYaml(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, YAML.stringify(value, { lineWidth: 120 }), 'utf8');
}

function actorYamlKey(actor: any, index: number): string {
  const actorId = actor.actorId == null ? String(index) : String(actor.actorId);
  return actorId.startsWith('a') ? actorId : `a${actorId}`;
}

function actorIdFromYamlKey(key: string, index: number): string {
  if (!key) return String(index);
  return key.match(/^a\d+$/) ? key.slice(1) : key;
}

function stripActorComponents(actor: any): any {
  const components = actor.bp?.components ?? {};
  const stripped: Record<string, any> = {};

  if (components.Body) {
    const body: Record<string, any> = {};
    for (const key of ['x', 'y', 'angle', 'widthScale', 'heightScale']) {
      if (components.Body[key] !== undefined) body[key] = components.Body[key];
    }
    if (Object.keys(body).length > 0) stripped.Body = body;
  }

  if (components.Drawing2?.initialFrame !== undefined) {
    stripped.Drawing2 = { initialFrame: components.Drawing2.initialFrame };
  }
  if (components.Text && Object.keys(components.Text).length > 0) stripped.Text = components.Text;
  if (components.Link && Object.keys(components.Link).length > 0) stripped.Link = components.Link;

  return { ...actor, bp: { components: stripped } };
}

function actorToYaml(actor: any, library: Record<string, any>): Record<string, any> | null {
  const entry = library[actor.parentEntryId];
  if (!entry) return null;

  const body = actor.bp?.components?.Body ?? {};
  const drawing = actor.bp?.components?.Drawing2 ?? {};
  const text = actor.bp?.components?.Text ?? {};
  const link = actor.bp?.components?.Link ?? {};
  const entryBody = entry.actorBlueprint?.components?.Body ?? {};
  const entryText = entry.actorBlueprint?.components?.Text ?? {};
  const entryLink = entry.actorBlueprint?.components?.Link ?? {};

  const result: Record<string, any> = { title: entry.title };
  result.x = body.x ?? 0;
  result.y = body.y ?? 0;
  if (body.angle !== undefined && body.angle !== 0) result.angle = body.angle;
  if (body.widthScale !== undefined && body.widthScale !== entryBody.widthScale) result.widthScale = body.widthScale;
  if (body.heightScale !== undefined && body.heightScale !== entryBody.heightScale) result.heightScale = body.heightScale;
  if (drawing.initialFrame !== undefined && drawing.initialFrame !== 1) result.initialFrame = drawing.initialFrame;
  if (text.fontSizeScale !== undefined && text.fontSizeScale !== 1) result.fontSizeScale = text.fontSizeScale;
  if (text.content !== undefined && text.content !== entryText.content) result.content = text.content;
  if (link.targetDeckId !== undefined && link.targetDeckId !== entryLink.targetDeckId) result.targetDeckId = link.targetDeckId;
  return result;
}

function restoreOpaqueBlueprintData(processedEntry: any, baseEntry: any, mergedExternalEntry: any): any {
  const result = mergeDeep(baseEntry, processedEntry);
  result.entryId = baseEntry.entryId;
  result.entryType = baseEntry.entryType || 'actorBlueprint';
  result.library = mergeDeep(baseEntry.library ?? {}, processedEntry.library ?? {});
  if (processedEntry.title !== undefined) result.title = processedEntry.title;
  if (mergedExternalEntry.category !== undefined) result.category = mergedExternalEntry.category;

  const resultComponents = result.actorBlueprint?.components ?? {};
  const baseComponents = baseEntry.actorBlueprint?.components ?? {};
  const externalComponents = mergedExternalEntry.actorBlueprint?.components ?? {};

  if (baseComponents.Drawing2) {
    resultComponents.Drawing2 ??= {};
    for (const key of ['drawData', 'physicsBodyData', 'hash']) {
      if (baseComponents.Drawing2[key] !== undefined) resultComponents.Drawing2[key] = clone(baseComponents.Drawing2[key]);
    }
  }
  if (baseComponents.Body) {
    resultComponents.Body ??= {};
    for (const key of ['fixtures', 'editorBounds']) {
      if (baseComponents.Body[key] !== undefined) resultComponents.Body[key] = clone(baseComponents.Body[key]);
    }
  }
  if (externalComponents.Rules?.rules !== undefined) {
    resultComponents.Rules ??= {};
    resultComponents.Rules.rules = clone(externalComponents.Rules.rules);
  }
  if (externalComponents.LocalVariables?.localVariables !== undefined) {
    resultComponents.LocalVariables ??= {};
    resultComponents.LocalVariables.localVariables = clone(externalComponents.LocalVariables.localVariables);
  }
  for (const [name, component] of Object.entries(externalComponents) as [string, any][]) {
    if (component?.disabled === true) {
      resultComponents[name] ??= {};
      resultComponents[name].disabled = true;
    }
  }

  result.actorBlueprint ??= {};
  result.actorBlueprint.components = resultComponents;
  if (baseEntry.base64Png !== undefined) result.base64Png = baseEntry.base64Png;
  return result;
}

export async function writeProjectCardFromSceneData({
  deckId,
  card,
  cardDir,
  sceneData,
  replace = false,
}: WriteProjectCardOptions): Promise<void> {
  const snapshot = sceneData.snapshot ?? {};
  const internalLibrary = snapshot.library ?? {};
  const internalActors = snapshot.actors ?? [];
  const externalSnapshot = await getSnapshotExternalValues({
    library: internalLibrary,
    actors: internalActors,
  });
  const externalLibrary = externalSnapshot.library ?? {};
  const externalActors = externalSnapshot.actors ?? [];
  const displayByInternal = await getInternalDisplayNameMap();
  const usedSlugs = new Set<string>();

  if (replace) {
    fs.rmSync(path.join(cardDir, 'scene', 'blueprints'), { recursive: true, force: true });
    fs.rmSync(path.join(cardDir, 'scripts'), { recursive: true, force: true });
    fs.rmSync(path.join(cardDir, '.castle', 'slug-map.json'), { force: true });
  }

  fs.mkdirSync(path.join(cardDir, 'scene', 'blueprints'), { recursive: true });
  fs.mkdirSync(path.join(cardDir, 'scripts'), { recursive: true });

  const slugToEntryId: Record<string, string> = {};
  for (const [entryId, internalEntry] of Object.entries(internalLibrary) as [string, any][]) {
    if (internalEntry.entryType && internalEntry.entryType !== 'actorBlueprint') continue;
    const externalEntry = externalLibrary[entryId] ?? internalEntry;
    const slug = uniqueSlug(slugify(externalEntry.title || internalEntry.title || entryId, entryId), usedSlugs);
    slugToEntryId[slug] = entryId;

    const originalExternalComponents = externalEntry.actorBlueprint?.components ?? {};
    const scriptCode = originalExternalComponents.Script?.code;
    const externalComponents = componentsForYaml(originalExternalComponents);
    const yamlComponents = mapComponentKeys(externalComponents, (name) => componentNameForYaml(name, displayByInternal));
    if (typeof scriptCode === 'string') {
      fs.writeFileSync(path.join(cardDir, 'scripts', `${slug}.lua`), scriptCode, 'utf8');
    }

    const blueprintYaml: any = {
      id: entryId,
      title: externalEntry.title ?? internalEntry.title ?? slug,
      blueprintAssetId: internalEntry.library?.blueprintAssetId ?? '',
      behaviors: Object.keys(yamlComponents),
      actorBlueprint: {
        components: yamlComponents,
      },
    };
    const entryCategory = externalEntry.category || internalEntry.category;
    if (entryCategory) blueprintYaml.category = entryCategory;

    writeYaml(path.join(cardDir, 'scene', 'blueprints', `${slug}.yaml`), blueprintYaml);
    writeJson(path.join(cardDir, 'scene', 'blueprints', `${slug}.json`), internalEntry);
  }

  const actorsYaml: Record<string, any> = {};
  for (let i = 0; i < externalActors.length; i++) {
    const actor = externalActors[i];
    const actorYaml = actorToYaml(actor, externalLibrary);
    if (actorYaml) actorsYaml[actorYamlKey(actor, i)] = actorYaml;
  }
  writeYaml(path.join(cardDir, 'scene', 'actors.yaml'), actorsYaml);
  writeYaml(path.join(cardDir, 'scene', 'variables.yaml'), snapshot.variables ?? []);

  writeJson(path.join(cardDir, 'card.json'), {
    ...card,
    sceneProperties: snapshot.sceneProperties,
    actorBlueprintInherit: snapshot.actorBlueprintInherit,
    linkTargetDeckIds: snapshot.linkTargetDeckIds ?? [],
  });
  writeJson(path.join(cardDir, '.castle', 'slug-map.json'), slugToEntryId);
}

export async function materializeProjectCard(cardDir: string): Promise<any> {
  const blueprintsDir = path.join(cardDir, 'scene', 'blueprints');
  const scriptsDir = path.join(cardDir, 'scripts');
  const cardJson = readJsonIfExists(path.join(cardDir, 'card.json')) ?? {};
  const internalByYaml = await getYamlInternalNameMap();

  if (!fs.existsSync(blueprintsDir)) {
    throw new Error(`Missing project blueprints directory: ${blueprintsDir}`);
  }

  const baseLibrary: Record<string, any> = {};
  const slugByEntryId: Record<string, string> = {};
  for (const filename of fs.readdirSync(blueprintsDir).filter((file) => file.endsWith('.json'))) {
    const slug = filename.replace(/\.json$/, '');
    const entry = readJsonIfExists(path.join(blueprintsDir, filename));
    if (!entry?.entryId) continue;
    baseLibrary[entry.entryId] = entry;
    slugByEntryId[entry.entryId] = slug;
  }

  const externalBase = await getSnapshotExternalValues({ library: baseLibrary, actors: [] });
  const mergedExternalLibrary: Record<string, any> = externalBase.library ?? {};

  for (const filename of fs.readdirSync(blueprintsDir).filter((file) => file.endsWith('.yaml'))) {
    const slug = filename.replace(/\.yaml$/, '');
    const yamlData = readYamlIfExists(path.join(blueprintsDir, filename));
    if (!yamlData) continue;
    const entryId = yamlData.id || yamlData.entryId;
    if (!entryId || !mergedExternalLibrary[entryId]) continue;

    const yamlComponents = yamlData.actorBlueprint?.components ?? {};
    const engineComponents = mapComponentKeys(yamlComponents, (name) => componentNameForEngine(name, internalByYaml));
    const scriptPath = path.join(scriptsDir, `${slug}.lua`);
    if (fs.existsSync(scriptPath)) {
      engineComponents.Script ??= {};
      engineComponents.Script.code = fs.readFileSync(scriptPath, 'utf8');
    }

    const overlay: any = {
      title: yamlData.title,
      actorBlueprint: {
        components: engineComponents,
      },
    };
    if (yamlData.category !== undefined) overlay.category = yamlData.category;
    if (yamlData.blueprintAssetId !== undefined) {
      overlay.library = { blueprintAssetId: yamlData.blueprintAssetId };
    }
    mergedExternalLibrary[entryId] = mergeDeep(mergedExternalLibrary[entryId], overlay);
    slugByEntryId[entryId] = slug;
  }

  const titleToEntryId: Record<string, string> = {};
  for (const [entryId, entry] of Object.entries(mergedExternalLibrary) as [string, any][]) {
    if (entry.title) titleToEntryId[entry.title] = entryId;
  }

  const actorsYaml = readYamlIfExists(path.join(cardDir, 'scene', 'actors.yaml')) ?? {};
  const variablesYaml = readYamlIfExists(path.join(cardDir, 'scene', 'variables.yaml')) ?? [];
  const actorEntries: Array<[string, any]> = Array.isArray(actorsYaml)
    ? actorsYaml.map((actor, index) => [`a${index}`, actor])
    : Object.entries(actorsYaml);
  const externalActors: any[] = [];

  for (let index = 0; index < actorEntries.length; index++) {
    const [key, actor] = actorEntries[index];
    if (!actor) continue;
    const parentEntryId = actor.entryId || (actor.title ? titleToEntryId[actor.title] : null);
    if (!parentEntryId || !mergedExternalLibrary[parentEntryId]) continue;
    const blueprintBody = mergedExternalLibrary[parentEntryId].actorBlueprint?.components?.Body ?? {};

    const body: Record<string, any> = {
      x: actor.x ?? 0,
      y: actor.y ?? 0,
      widthScale: actor.widthScale ?? blueprintBody.widthScale ?? 1,
      heightScale: actor.heightScale ?? blueprintBody.heightScale ?? 1,
    };
    if (actor.angle !== undefined) body.angle = actor.angle;

    const components: Record<string, any> = { Body: body };
    if (actor.initialFrame !== undefined) components.Drawing2 = { initialFrame: actor.initialFrame };
    if (actor.content !== undefined || actor.fontSizeScale !== undefined) {
      components.Text = {};
      if (actor.content !== undefined) components.Text.content = actor.content;
      if (actor.fontSizeScale !== undefined) components.Text.fontSizeScale = actor.fontSizeScale;
    }
    if (actor.targetDeckId !== undefined) components.Link = { targetDeckId: actor.targetDeckId };

    externalActors.push({
      actorId: actorIdFromYamlKey(key, index),
      parentEntryId,
      bp: { components },
    });
  }

  const processed = await applySnapshot({
    library: mergedExternalLibrary,
    actors: externalActors,
  });

  const processedLibrary: Record<string, any> = {};
  for (const [entryId, processedEntry] of Object.entries(processed.library ?? {}) as [string, any][]) {
    const baseEntry = baseLibrary[entryId];
    const mergedExternalEntry = mergedExternalLibrary[entryId];
    processedLibrary[entryId] = baseEntry
      ? restoreOpaqueBlueprintData(processedEntry, baseEntry, mergedExternalEntry)
      : processedEntry;
  }

  return {
    snapshot: {
      library: processedLibrary,
      actors: (processed.actors ?? []).map(stripActorComponents),
      variables: variablesYaml,
      sceneProperties: cardJson.sceneProperties,
      actorBlueprintInherit: cardJson.actorBlueprintInherit,
      linkTargetDeckIds: cardJson.linkTargetDeckIds ?? [],
    },
  };
}

export function isProjectCardDir(cardDir: string): boolean {
  return fs.existsSync(path.join(cardDir, 'scene', 'blueprints'));
}
