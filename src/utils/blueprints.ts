
import * as Behaviors from './behaviors.js';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'yaml';

import BlueprintTemplate from '../assets/blueprints.json' with { type: 'json' };
import { DEFAULT_ACTOR, getBlueprintsDir, getCacheDir, serializeActor } from './decks.js';

export type YamlString = string;

export const DEFAULT_BLUEPRINTS = BlueprintTemplate.templates as Blueprint[];

export interface Blueprint {
  title: string,
  entryId: string;
  entryType: string;
  library: {
    blueprintAssetId: string,
    parentBlueprintAssetId: string,
    originCardId: string,
    originDeckId: string,
  };
  description: string;
  actorBlueprint: {
    components: Record<Behaviors.BehaviorKey, any>;
  };
  base64Png?: string;

  isBlank?: boolean;
  isBlankEmpty?: boolean;
  isBlankEmptyDrawing?: boolean;
}

export interface ActorBlueprint {
  rulesFile?: YamlString;
  scriptFile?: string;
  components: Record<Behaviors.BehaviorKey, any> 
}

export enum BlueprintEntryType {
  actorBlueprint = 'actorBlueprint',
}

/**
 * Given a list of blueprints, write them to a destination directory.
 * The output will be multiple files in YAML format, including:
 * - <blueprint-name>.yaml
 * - <blueprint-name>_rules.yaml
 * - <blueprint-name>_script.lua
 * @param blueprints - Blueprint[]
 * @param destinationDir - string
 */
export const writeBlueprintsSync = (blueprints: Blueprint[], destinationDir: string) => {
  if (!fs.existsSync(destinationDir)) {
    fs.mkdirSync(destinationDir, { recursive: true });
  }

  for (const blueprint of blueprints) {
    if (blueprint.entryType !== BlueprintEntryType.actorBlueprint) {
      console.error(`Blueprint entry type ${blueprint.entryType} not supported`);
      continue;
    }

    const actorBlueprint = serializeBlueprintComponents(blueprint);
    const actorComponents = actorBlueprint.components;

    if (actorBlueprint.rulesFile !== undefined) {
        const rulesFilename = path.relative(
          destinationDir,
          newFilename(blueprint.title + '_rules', 'yaml', destinationDir)
        );
        fs.writeFileSync(path.join(destinationDir, rulesFilename), actorBlueprint.rulesFile);
        actorComponents[Behaviors.BehaviorKey.Rules] = {
          file: rulesFilename,
        };
    }

    if (actorBlueprint.scriptFile !== undefined) {
      const scriptFilename = path.relative(
        destinationDir,
        newFilename(blueprint.title + '_script', 'lua', destinationDir)
      );
      fs.writeFileSync(path.join(destinationDir, scriptFilename), actorBlueprint.scriptFile);
      actorComponents[Behaviors.BehaviorKey.Script] = {
        file: scriptFilename,
      };
    }
  
    const blueprintData = {
      title: blueprint.title,
      entryId: blueprint.entryId,
      components: actorComponents,
    };
    const blueprintFilename = newFilename(blueprint.title, 'yaml', destinationDir);
    fs.writeFileSync(blueprintFilename, yaml.stringify(blueprintData));
  }
}

/**
 * Given a list of blueprints, extract its actor blueprints, and serialize them into ActorBlueprints.
 * @param blueprints - Blueprint[]
 * @returns ActorBlueprint[]
 */
export const serializeBlueprintsActors = (blueprints: Blueprint[]): ActorBlueprint[] => {
  const result: ActorBlueprint[] = [];

  for (const blueprint of blueprints) {
    if (blueprint.entryType !== BlueprintEntryType.actorBlueprint) {
      console.error(`Blueprint entry type ${blueprint.entryType} not supported`);
      continue;
    }

    result.push(serializeBlueprintComponents(blueprint));
  }

  return result;
};

/**
 * Given a blueprint, extract its actor blueprint, and serialize it into a typed ActorBlueprint.
 * @param blueprints - Blueprint[]
 * @returns ActorBlueprint
 */
const serializeBlueprintComponents = (blueprint: Blueprint): ActorBlueprint => {
  const components = blueprint.actorBlueprint.components;
  return Behaviors.serializePartialComponents({ components });;
};

/**
 * Add a blueprint to a deck.
 * Must specify the card within the deck to add the blueprint to.
 * The blueprint will be spawned as a new actor.
 * @param blueprint - Blueprint
 * @param deckDir - string
 * @param cardDir - string
 */
export const addBlueprintToDeck = (blueprint: Blueprint, deckDir: string, cardDir: string) => {
  const deckPath = path.resolve(deckDir);
  const cardPath = path.resolve(cardDir);

  writeBlueprintToDeck(blueprint, cardPath);

  spawnBlueprintInLayout(blueprint, cardPath);

  addBlueprintToDeckCache(blueprint, deckPath);
};

/**
 * Spawn an actor blueprint in the layout of a given card.
 * This will specify where the blueprint will be located in the card's layout.
 * @param blueprint - Blueprint
 * @param cardPath - string
 */
const spawnBlueprintInLayout = (blueprint: Blueprint, cardPath: string) => {
  const blueprintDefaultActor: any = DEFAULT_ACTOR;

  blueprintDefaultActor.parentEntryId = blueprint.entryId;
  blueprintDefaultActor.actorId = "99"; // TODO: need a new actor id !

  const blueprintSerializedActor = serializeActor({ actor: blueprintDefaultActor, entry: blueprint });

  // Use the yaml library to update the layout file with our actor information.
  const layoutFilePath = path.join(cardPath, 'layout.yaml');
  const layout = yaml.parse(fs.readFileSync(layoutFilePath, 'utf8'));
  layout.push(blueprintSerializedActor);
  fs.writeFileSync(layoutFilePath, yaml.stringify(layout));

  console.debug('Spawned blueprint in layout: ', layoutFilePath, blueprintSerializedActor);
};

/**
 * Write a blueprint at the given card location.
 * This includes the blueprint file, and the rules and script files.
 * @param blueprint - Blueprint
 * @param cardPath - string
 */
const writeBlueprintToDeck = (blueprint: Blueprint, cardPath: string) => {
  const blueprintsPath = getBlueprintsDir(cardPath);

  writeBlueprintsSync([blueprint], blueprintsPath);
};

/**
 * Add a blueprint to the deck cache.
 * The deck cache is usually stored in deck/.castle/cache/<card-id>.json
 * @param blueprint - Blueprint
 * @param deckPath - string
 */
const addBlueprintToDeckCache = (blueprint: Blueprint, deckPath: string) => {
  const entryId = blueprint.entryId;

  // Find the deck cache directory (assuming it's in the same directory as the CLI)
  const cacheDir = getCacheDir(deckPath);
  
  if (!fs.existsSync(cacheDir)) {
    throw new Error('Deck cache directory not found in ' + cacheDir);
  }

  // Find the .json file in the cache directory
  // TODO: if there are multiple cards, then there should be multiple cache files. Need a cardId parameter.
  const cacheFiles = fs.readdirSync(cacheDir).filter(file => file.endsWith('.json'));
  if (cacheFiles.length === 0) {
    throw new Error('No cache file found in deck');
  }

  const cacheFilePath = path.join(cacheDir, cacheFiles[0]);
  
  // Read and parse the JSON file
  const cacheData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
  
  // Ensure the library object exists
  if (!cacheData.snapshot) {
    cacheData.snapshot = {};
  }
  if (!cacheData.snapshot.library) {
    cacheData.snapshot.library = {};
  }

  // Add the blueprint to the library
  cacheData.snapshot.library[entryId] = blueprint;

  // Save the updated JSON file
  fs.writeFileSync(cacheFilePath, JSON.stringify(cacheData, null, 2));
};

/**
 * Create a name for blueprint-related files.
 */
function newFilename(title: string, extension: string, parentDir: string): string {
  let dedupedTitle = title.replace(/[^a-zA-Z0-9]/g, '_');
  let filename = path.join(parentDir, `${dedupedTitle}.${extension}`);

  if (fs.existsSync(filename)) {
    let counter = 0;
    while (fs.existsSync(filename)) {
      counter++;
      filename = path.join(parentDir, `${dedupedTitle}_${counter}.${extension}`);
    }
  }

  return filename;
}