import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
import { materializeProjectCard } from './project.js';

interface LocalEditOptions {
  cardDir: string;
  args: any;
}

function readYaml(filePath: string, fallback: any = null): any {
  try {
    return YAML.parse(fs.readFileSync(filePath, 'utf8')) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeYaml(filePath: string, value: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, YAML.stringify(value, { lineWidth: 120 }), 'utf8');
}

function parseYamlValue(value: any): any {
  if (typeof value !== 'string') return value ?? {};
  return YAML.parse(value) ?? {};
}

function normalizeComponentName(name: string): string {
  if (name === 'Body') return 'Layout';
  if (name === 'Drawing2') return 'Drawing';
  return name;
}

function normalizeActorKey(key: string, actors: Record<string, any>): string {
  if (key.startsWith('new')) {
    let index = 0;
    while (actors[`a${index}`]) index++;
    return `a${index}`;
  }
  if (/^\d+$/.test(key)) return `a${key}`;
  return key;
}

function listBlueprints(cardDir: string): Array<{ slug: string; filePath: string; data: any }> {
  const blueprintsDir = path.join(cardDir, 'scene', 'blueprints');
  if (!fs.existsSync(blueprintsDir)) return [];
  return fs.readdirSync(blueprintsDir)
    .filter((file) => file.endsWith('.yaml'))
    .map((file) => {
      const filePath = path.join(blueprintsDir, file);
      return {
        slug: file.replace(/\.yaml$/, ''),
        filePath,
        data: readYaml(filePath, {}),
      };
    });
}

function findBlueprint(cardDir: string, key: string): { slug: string; filePath: string; data: any } | null {
  return listBlueprints(cardDir).find((blueprint) => {
    return blueprint.slug === key || blueprint.data?.id === key || blueprint.data?.entryId === key || blueprint.data?.title === key;
  }) ?? null;
}

function ensureScriptComponent(blueprint: any): any {
  blueprint.actorBlueprint ??= {};
  blueprint.actorBlueprint.components ??= {};
  blueprint.actorBlueprint.components.Script ??= {};
  if (!Array.isArray(blueprint.behaviors)) blueprint.behaviors = [];
  if (!blueprint.behaviors.includes('Script')) blueprint.behaviors.push('Script');
  return blueprint.actorBlueprint.components.Script;
}

function applyBlueprintComponents(blueprint: any, componentsInput: any, scriptPath: string): string[] {
  const changed: string[] = [];
  const components = parseYamlValue(componentsInput);
  blueprint.actorBlueprint ??= {};
  blueprint.actorBlueprint.components ??= {};
  if (!Array.isArray(blueprint.behaviors)) blueprint.behaviors = [];

  for (const [rawName, rawValue] of Object.entries(components) as [string, any][]) {
    const name = normalizeComponentName(rawName);
    const value = rawValue ?? {};
    if (value?.removeBehavior === true) {
      delete blueprint.actorBlueprint.components[name];
      blueprint.behaviors = blueprint.behaviors.filter((behavior: string) => behavior !== name);
      changed.push(`removed ${name}`);
      continue;
    }

    blueprint.actorBlueprint.components[name] ??= {};
    const nextValue = { ...value };
    if (name === 'Script' && typeof nextValue.code === 'string') {
      fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
      fs.writeFileSync(scriptPath, nextValue.code, 'utf8');
      delete nextValue.code;
      changed.push('updated script');
    }
    Object.assign(blueprint.actorBlueprint.components[name], nextValue);
    if (!blueprint.behaviors.includes(name)) blueprint.behaviors.push(name);
    changed.push(`updated ${name}`);
  }

  return changed;
}

function applyActorComponents(actor: any, componentsInput: any): string[] {
  const changed: string[] = [];
  const components = parseYamlValue(componentsInput);

  for (const [rawName, value] of Object.entries(components) as [string, any][]) {
    const name = normalizeComponentName(rawName);
    if (!value || typeof value !== 'object') continue;

    if (name === 'Layout') {
      for (const key of ['x', 'y', 'angle', 'widthScale', 'heightScale']) {
        if (value[key] !== undefined) actor[key] = value[key];
      }
      changed.push('updated actor layout');
    } else if (name === 'Drawing') {
      if (value.initialFrame !== undefined) actor.initialFrame = value.initialFrame;
      changed.push('updated actor drawing');
    } else if (name === 'Text') {
      if (value.content !== undefined) actor.content = value.content;
      if (value.fontSizeScale !== undefined) actor.fontSizeScale = value.fontSizeScale;
      changed.push('updated actor text');
    } else if (name === 'Link') {
      if (value.targetDeckId !== undefined) actor.targetDeckId = value.targetDeckId;
      changed.push('updated actor link');
    }
  }

  return changed;
}

export async function applyLocalEdit({ cardDir, args }: LocalEditOptions): Promise<{ summary: string }> {
  if (!args || typeof args !== 'object') {
    throw new Error('edit payload must be a JSON object');
  }

  const changed: string[] = [];
  const blueprints = args.blueprints ?? {};

  for (const [key, update] of Object.entries(blueprints) as [string, any][]) {
    if (!update || typeof update !== 'object') throw new Error(`Invalid blueprint edit: ${key}`);
    const blueprint = findBlueprint(cardDir, key);
    if (!blueprint) throw new Error(`Blueprint not found: ${key}`);
    if (update.removeBlueprint) {
      fs.unlinkSync(blueprint.filePath);
      const jsonPath = blueprint.filePath.replace(/\.yaml$/, '.json');
      const scriptPath = path.join(cardDir, 'scripts', `${blueprint.slug}.lua`);
      try { fs.unlinkSync(jsonPath); } catch {}
      try { fs.unlinkSync(scriptPath); } catch {}
      changed.push(`removed blueprint ${blueprint.data.title || blueprint.slug}`);
      continue;
    }

    if (update.title !== undefined) {
      blueprint.data.title = update.title;
      changed.push(`renamed blueprint ${blueprint.slug}`);
    }
    if (update.category !== undefined) {
      blueprint.data.category = update.category;
      changed.push(`updated category ${blueprint.slug}`);
    }
    if (update.components !== undefined) {
      changed.push(...applyBlueprintComponents(
        blueprint.data,
        update.components,
        path.join(cardDir, 'scripts', `${blueprint.slug}.lua`)
      ));
    }
    if (Array.isArray(update.script) && update.script.length > 0) {
      const code = update.script.find((scriptUpdate: any) => typeof scriptUpdate?.code === 'string')?.code;
      if (typeof code === 'string') {
        ensureScriptComponent(blueprint.data);
        fs.mkdirSync(path.join(cardDir, 'scripts'), { recursive: true });
        fs.writeFileSync(path.join(cardDir, 'scripts', `${blueprint.slug}.lua`), code, 'utf8');
        changed.push(`updated script ${blueprint.slug}`);
      }
    }
    writeYaml(blueprint.filePath, blueprint.data);
  }

  if (args.actors !== undefined) {
    const actorsPath = path.join(cardDir, 'scene', 'actors.yaml');
    const actors = readYaml(actorsPath, {}) ?? {};
    for (const [rawKey, update] of Object.entries(args.actors) as [string, any][]) {
      if (!update || typeof update !== 'object') throw new Error(`Invalid actor edit: ${rawKey}`);
      const key = normalizeActorKey(rawKey, actors);
      if (update.removeActor) {
        delete actors[key];
        changed.push(`removed actor ${key}`);
        continue;
      }

      actors[key] ??= {};
      if (update.title !== undefined) actors[key].title = update.title;
      if (update.components !== undefined) changed.push(...applyActorComponents(actors[key], update.components));
      changed.push(`updated actor ${key}`);
    }
    writeYaml(actorsPath, actors);
  }

  if (args.variables !== undefined) {
    writeYaml(path.join(cardDir, 'scene', 'variables.yaml'), args.variables);
    changed.push('updated variables');
  }

  await materializeProjectCard(cardDir);

  return {
    summary: changed.length > 0 ? changed.join(', ') : 'validated scene data',
  };
}
