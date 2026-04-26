import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import YAML from 'yaml';
import { findDrawingBlueprint, getAvailableDrawingColors, getDefaultBlueprints } from './agent-data.js';
import { getCastleMetadata } from './castle-core-node.js';
import { materializeProjectCard, writeProjectCardFromSceneData } from './project.js';

interface LocalEditOptions {
  cardDir: string;
  args: any;
  deckId?: string;
  cardId?: string;
}

interface AgentEditPayload {
  description: string;
  blueprints: any[];
  variables: any[];
  actors: any[];
  blueprintIdMapping: Record<string, string>;
}

const SCRIPT_PROPERTY_NAME_MAPPINGS = [
  ['Layout', 'angle', 'rotation'],
  ['Gravity', 'gravity', 'strength'],
  ['Slow Down', 'motionSlowdown', 'translation'],
  ['Slow Down', 'rotationSlowdown', 'rotation'],
  ['Dynamic Motion', 'angularVelocity', 'rotationSpeed'],
  ['Bounce', 'bounciness', 'rebound'],
  ['Speed Limit', 'maximumSpeed', 'maxSpeed'],
  ['Friction', 'friction', 'amount'],
  ['Axis Lock', 'isRotationAllowed', 'rotates'],
];

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

function readJsonIfExists(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseMap(value: any, label: string): Record<string, any> {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error: any) {
      throw new Error(`Failed to parse ${label}: ${error?.message || String(error)}`);
    }
  }
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  return value;
}

function parseYamlOrObject(value: any, label: string): Record<string, any> {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value === 'string') {
    try {
      const parsed = YAML.parse(value);
      return isPlainObject(parsed) ? parsed : {};
    } catch (error: any) {
      throw new Error(`Failed to parse ${label} YAML: ${error?.message || String(error)}`);
    }
  }
  if (!isPlainObject(value)) throw new Error(`${label} must be YAML or an object`);
  return value;
}

function toBehaviorScriptName(displayName: string): string {
  const noSpaces = displayName.replace(/ /g, '');
  return noSpaces.charAt(0).toLowerCase() + noSpaces.slice(1);
}

function fixScriptPropertyNames(code: string): string {
  let fixed = code;
  for (const [behavior, internal, scriptName] of SCRIPT_PROPERTY_NAME_MAPPINGS) {
    const behaviorScript = toBehaviorScriptName(behavior);
    fixed = fixed.replaceAll(`${behaviorScript}.${internal}`, `${behaviorScript}.${scriptName}`);
  }
  return fixed;
}

function fixComponentPropertyNames(behaviorDisplayName: string, props: any): any {
  if (!props || typeof props !== 'object') return props;
  const fixed = { ...props };
  for (const [behavior, internal, scriptName] of SCRIPT_PROPERTY_NAME_MAPPINGS) {
    if (behavior === behaviorDisplayName && fixed[scriptName] !== undefined && scriptName !== internal) {
      fixed[internal] = fixed[scriptName];
      delete fixed[scriptName];
    }
  }
  return fixed;
}

function fixRulePropertyName(behaviorDisplayName: string, propertyName: string): string {
  const propLower = propertyName.toLowerCase();
  for (const [behavior, internal, scriptName] of SCRIPT_PROPERTY_NAME_MAPPINGS) {
    if (behavior === behaviorDisplayName && propLower === scriptName.toLowerCase()) return internal;
  }
  return propertyName;
}

function applyScriptEdits(originalCode: string, edits: any[]): { result: string | null; error: string | null } {
  let currentCode = originalCode || '';
  for (const edit of edits) {
    if (edit.code !== undefined) {
      currentCode = fixScriptPropertyNames(edit.code);
    } else if (edit.before !== undefined && edit.after !== undefined) {
      if (!currentCode.includes(edit.before)) {
        const excerpt = edit.before.substring(0, 50);
        return { result: null, error: `Could not find "${excerpt}${edit.before.length > 50 ? '...' : ''}"` };
      }
      currentCode = currentCode.replaceAll(edit.before, fixScriptPropertyNames(edit.after));
    }
  }
  return { result: currentCode, error: null };
}

function behaviorMaps(allBehaviors: Record<string, any>): {
  displayToInternal: Record<string, string>;
  internalToDisplay: Record<string, string>;
} {
  const displayToInternal: Record<string, string> = {};
  const internalToDisplay: Record<string, string> = {};
  for (const behavior of Object.values(allBehaviors ?? {}) as any[]) {
    displayToInternal[behavior.displayName] = behavior.name;
    internalToDisplay[behavior.name] = behavior.displayName;
  }
  displayToInternal.Layout ??= 'Body';
  internalToDisplay.Body ??= 'Layout';
  return { displayToInternal, internalToDisplay };
}

function buildRuleBehaviorLookups(rulesData: any): {
  triggerNameToBehavior: Record<string, string | null>;
  responseNameToBehavior: Record<string, string | null>;
} {
  const triggerNameToBehavior: Record<string, string | null> = {};
  const responseNameToBehavior: Record<string, string | null> = {};

  const collect = (target: Record<string, string | null>, entries: any) => {
    for (const category of Object.values(entries ?? {}) as any[]) {
      if (!Array.isArray(category)) continue;
      for (const item of category) {
        if (!item?.name || !item?.behaviorName) continue;
        if (target[item.name] === undefined) target[item.name] = item.behaviorName;
        else if (target[item.name] !== null && target[item.name] !== item.behaviorName) target[item.name] = null;
      }
    }
  };

  collect(triggerNameToBehavior, rulesData?.triggers);
  collect(responseNameToBehavior, rulesData?.responses);
  collect(responseNameToBehavior, rulesData?.conditions);
  return { triggerNameToBehavior, responseNameToBehavior };
}

function unflattenResponses(responses: any[]): any {
  if (!responses || responses.length === 0) return null;

  const unflattenValue = (value: any): any => {
    if (Array.isArray(value)) {
      if (value.length > 0 && value[0] && typeof value[0] === 'object' && 'name' in value[0] && 'params' in value[0]) {
        return unflattenResponses(value);
      }
      return value.map(unflattenValue);
    }
    if (value && typeof value === 'object') {
      const result: Record<string, any> = {};
      for (const [key, val] of Object.entries(value)) result[key] = unflattenValue(val);
      return result;
    }
    return value;
  };

  const result = { ...responses[0] };
  if (result.params) result.params = unflattenValue(result.params);
  if (responses.length > 1) {
    result.params ??= {};
    result.params.nextResponse = unflattenResponses(responses.slice(1));
  }
  return result;
}

function replaceEntryTitles(obj: any, titleToEntryId: Record<string, string>): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((value) => replaceEntryTitles(value, titleToEntryId));
  const result = { ...obj };
  if (typeof result.entryTitle === 'string') {
    const entryId = titleToEntryId[result.entryTitle];
    if (entryId) result.entryId = entryId;
    delete result.entryTitle;
  }
  for (const [key, value] of Object.entries(result)) result[key] = replaceEntryTitles(value, titleToEntryId);
  return result;
}

function fixLeaderboardVariableIds(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(fixLeaderboardVariableIds);
  const result = { ...obj };
  if (
    ['show leaderboard', 'show scoped leaderboard', 'save variable to leaderboard', 'save variable to scoped leaderboard'].includes(result.name) &&
    result.params?.variableId &&
    typeof result.params.variableId === 'object' &&
    result.params.variableId.id
  ) {
    result.params = { ...result.params, variableId: result.params.variableId.id };
  }
  for (const [key, value] of Object.entries(result)) result[key] = fixLeaderboardVariableIds(value);
  return result;
}

function nextActorId(actorMap: Map<string, any>): string {
  let id = 0;
  while (actorMap.has(String(id))) id++;
  return String(id);
}

function loadSlugMap(cardDir: string): Record<string, string> {
  return readJsonIfExists(path.join(cardDir, '.castle', 'slug-map.json')) ?? {};
}

function summarizeArgs(args: any): string {
  const summary: string[] = [];
  const blueprints = parseMap(args.blueprints, 'blueprints');
  const actors = parseMap(args.actors, 'actors');
  const variables = parseMap(args.variables, 'variables');

  const blueprintKeys = Object.keys(blueprints);
  const forks = blueprintKeys.filter((key) => blueprints[key]?.forkBlueprintId);
  const blueprintRemoves = blueprintKeys.filter((key) => blueprints[key]?.removeBlueprint);
  const blueprintEdits = blueprintKeys.filter((key) => !blueprints[key]?.forkBlueprintId && !blueprints[key]?.removeBlueprint);
  if (forks.length > 0) summary.push(`created ${forks.length} blueprint(s)`);
  if (blueprintEdits.length > 0) summary.push(`edited ${blueprintEdits.length} blueprint(s)`);
  if (blueprintRemoves.length > 0) summary.push(`removed ${blueprintRemoves.length} blueprint(s)`);

  const actorKeys = Object.keys(actors);
  const newActors = actorKeys.filter((key) => actors[key]?.title);
  const actorRemoves = actorKeys.filter((key) => actors[key]?.removeActor);
  const actorEdits = actorKeys.filter((key) => !actors[key]?.title && !actors[key]?.removeActor);
  if (newActors.length > 0) summary.push(`added ${newActors.length} actor(s)`);
  if (actorEdits.length > 0) summary.push(`edited ${actorEdits.length} actor(s)`);
  if (actorRemoves.length > 0) summary.push(`removed ${actorRemoves.length} actor(s)`);

  const variableKeys = Object.keys(variables);
  const variableRemoves = variableKeys.filter((key) => variables[key]?.removeVariable);
  const variableSets = variableKeys.length - variableRemoves.length;
  if (variableSets > 0) summary.push(`set ${variableSets} variable(s)`);
  if (variableRemoves.length > 0) summary.push(`removed ${variableRemoves.length} variable(s)`);
  return summary.join(', ') || 'validated scene data';
}

function createAgentEditPayload({
  args,
  library,
  actors,
  variables,
  allBehaviors,
  rulesData,
  currentCardId,
  currentDeckId,
  slugMap,
}: {
  args: any;
  library: Record<string, any>;
  actors: any[];
  variables: any[];
  allBehaviors: Record<string, any>;
  rulesData: any;
  currentCardId: string;
  currentDeckId: string;
  slugMap: Record<string, string>;
}): AgentEditPayload {
  const editArgs = clone(args);
  const modifiedVariables: any[] = [];
  const variableRemoves: string[] = [];
  const variableNameToId: Record<string, string> = {};
  for (const variable of variables ?? []) {
    if (variable?.name && variable?.variableId) variableNameToId[variable.name] = variable.variableId;
  }

  const convertVariableNamesToIds = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(convertVariableNamesToIds);
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'variableName' && typeof value === 'string') {
        if (!variableNameToId[value]) {
          const newVariable = {
            variableId: crypto.randomUUID(),
            name: value,
            initialValue: 0,
            lifetime: 'deck',
          };
          modifiedVariables.push(newVariable);
          variableNameToId[value] = newVariable.variableId;
        }
        result.variableId = { scope: 'global', id: variableNameToId[value] };
      } else if (key !== 'variableName') {
        result[key] = convertVariableNamesToIds(value);
      }
    }
    return result;
  };

  const variablesData = parseMap(editArgs.variables, 'variables');
  for (const [variableId, variableData] of Object.entries(variablesData) as [string, any][]) {
    const existingVariable = variables.find((variable) => variable.variableId === variableId);
    if (variableData.removeVariable === true) {
      variableRemoves.push(variableId);
      if (existingVariable) modifiedVariables.push({ ...existingVariable, removeVariable: true });
      continue;
    }

    const finalVariableId = existingVariable ? variableId : crypto.randomUUID();
    const variable = {
      variableId: finalVariableId,
      name: variableData.name || existingVariable?.name || 'unnamed',
      initialValue: variableData.initialValue !== undefined ? variableData.initialValue : existingVariable?.initialValue || 0,
      lifetime: variableData.lifetime || existingVariable?.lifetime || 'deck',
    };
    modifiedVariables.push(variable);
    variableNameToId[variable.name] = finalVariableId;
  }

  const { displayToInternal, internalToDisplay } = behaviorMaps(allBehaviors);
  const { triggerNameToBehavior, responseNameToBehavior } = buildRuleBehaviorLookups(rulesData);
  const modifiedBlueprints: any[] = [];
  const blueprintIdMapping: Record<string, string> = {};
  const actorMap = new Map((actors ?? []).map((actor) => [String(actor.actorId), actor]));

  const titleToEntryIdForLookup: Record<string, string> = {};
  for (const [id, entry] of Object.entries(library) as [string, any][]) {
    if (entry.title) titleToEntryIdForLookup[entry.title] = id;
  }
  for (const [slug, entryId] of Object.entries(slugMap)) {
    titleToEntryIdForLookup[slug] = entryId;
  }

  const resolveBlueprintKey = (key: string): string => {
    if (library[key]) return key;
    return titleToEntryIdForLookup[key] || slugMap[key] || key;
  };

  const blueprintsData = parseMap(editArgs.blueprints, 'blueprints');
  for (const [blueprintKey, edits] of Object.entries(blueprintsData) as [string, any][]) {
    if (!edits || typeof edits !== 'object') throw new Error(`Invalid blueprint edit: ${blueprintKey}`);
    const resolvedKey = resolveBlueprintKey(blueprintKey);

    if (edits.removeBlueprint === true) {
      const blueprint = library[resolvedKey];
      if (!blueprint) throw new Error(`Blueprint not found: ${blueprintKey}`);
      modifiedBlueprints.push({ ...clone(blueprint), removeBlueprint: true });
      for (const [actorId, actor] of actorMap) {
        if (actor.parentEntryId === resolvedKey) {
          editArgs.actors ??= {};
          editArgs.actors[`a${actorId}`] ??= { removeActor: true };
        }
      }
      continue;
    }

    let modifiedBlueprint: any;
    if (edits.forkBlueprintId) {
      const forkFromId = titleToEntryIdForLookup[edits.forkBlueprintId] || slugMap[edits.forkBlueprintId] || edits.forkBlueprintId;
      const defaults = getDefaultBlueprints();
      const defaultTitleToId = Object.fromEntries(
        Object.entries(defaults).map(([id, entry]: [string, any]) => [entry.title, id])
      ) as Record<string, string>;
      const defaultId = defaults[forkFromId] ? forkFromId : defaultTitleToId[edits.forkBlueprintId];
      const parentBlueprint = library[forkFromId] || (defaultId ? defaults[defaultId] : null);
      if (!parentBlueprint) throw new Error(`Parent blueprint not found for fork: ${edits.forkBlueprintId}`);

      const newEntryId = crypto.randomUUID();
      const newBlueprintAssetId = crypto.randomUUID();
      blueprintIdMapping[blueprintKey] = newEntryId;
      modifiedBlueprint = clone(parentBlueprint);
      modifiedBlueprint.entryId = newEntryId;
      modifiedBlueprint.entryType = 'actorBlueprint';
      modifiedBlueprint.library = {
        blueprintAssetId: newBlueprintAssetId,
        parentBlueprintAssetId: defaultId ? '' : parentBlueprint.library?.blueprintAssetId || forkFromId,
        originCardId: currentCardId || '',
        originDeckId: currentDeckId || '',
      };
    } else {
      const blueprint = library[resolvedKey];
      if (!blueprint) throw new Error(`Blueprint not found: ${blueprintKey}`);
      modifiedBlueprint = clone(blueprint);
    }

    if (edits.title) modifiedBlueprint.title = edits.title;
    if (edits.category !== undefined) modifiedBlueprint.category = edits.category;

    if (edits.components) {
      const parsedComponents = parseYamlOrObject(edits.components, 'components');
      const convertedComponents = convertVariableNamesToIds(parsedComponents);
      const updates: Record<string, any> = {};

      for (const [name, props] of Object.entries(convertedComponents)) {
        let internalName = displayToInternal[name];
        let displayName = name;
        if (!internalName && internalToDisplay[name]) {
          internalName = name;
          displayName = internalToDisplay[name];
        }
        if (internalName) updates[internalName] = fixComponentPropertyNames(displayName, props);
      }

      modifiedBlueprint.actorBlueprint ??= { components: {} };
      modifiedBlueprint.actorBlueprint.components ??= {};

      if (updates.Body && typeof updates.Body === 'object') {
        if (updates.Body.relativeToCamera === true && updates.Body.layerName !== 'camera') updates.Body.layerName = 'camera';
        if (updates.Body.widthScale !== undefined) updates.Body.widthScale = updates.Body.widthScale / 10;
        if (updates.Body.heightScale !== undefined) updates.Body.heightScale = updates.Body.heightScale / 10;
      }

      for (let [behaviorName, props] of Object.entries(updates) as [string, any][]) {
        props ??= {};
        if (props.removeBehavior === true) {
          delete modifiedBlueprint.actorBlueprint.components[behaviorName];
        } else if (behaviorName === 'Rules' && typeof props === 'object') {
          modifiedBlueprint.actorBlueprint.components.Rules ??= { disabled: false, rules: [] };
          const currentRules = modifiedBlueprint.actorBlueprint.components.Rules.rules || [];
          const rulesMap: Record<string, any> = {};
          currentRules.forEach((rule: any, index: number) => { rulesMap[`rule-${index}`] = rule; });
          const ruleEntries = props.rules && typeof props.rules === 'object' ? { ...props, ...props.rules } : props;

          for (const [ruleKey, ruleData] of Object.entries(ruleEntries) as [string, any][]) {
            if (!ruleKey.startsWith('rule-') || !ruleData) continue;
            if (ruleData.removeRule === true) {
              delete rulesMap[ruleKey];
              continue;
            }

            const processedRule = { ...ruleData };
            if (!processedRule.trigger && rulesMap[ruleKey]?.trigger) processedRule.trigger = rulesMap[ruleKey].trigger;
            if (!processedRule.responses && !processedRule.response && rulesMap[ruleKey]?.response) {
              processedRule.response = rulesMap[ruleKey].response;
            }

            if (processedRule.trigger) {
              if (triggerNameToBehavior[processedRule.trigger.name] === undefined) {
                throw new Error(`Invalid trigger: "${processedRule.trigger.name}" is not available. Check available rules for valid triggers.`);
              }
              const lookupBehavior = triggerNameToBehavior[processedRule.trigger.name];
              const internalName = lookupBehavior || displayToInternal[processedRule.trigger.behaviorName];
              if (internalName && allBehaviors[internalName]) processedRule.trigger.behaviorId = allBehaviors[internalName].behaviorId;
              delete processedRule.trigger.behaviorName;
            }

            if (processedRule.responses && Array.isArray(processedRule.responses)) {
              processedRule.response = unflattenResponses(processedRule.responses);
              delete processedRule.responses;

              const convertBehaviorNames = (obj: any): any => {
                if (!obj || typeof obj !== 'object') return obj;
                if (Array.isArray(obj)) return obj.map(convertBehaviorNames);
                const result = { ...obj };

                if (result.name) {
                  if (responseNameToBehavior[result.name] === undefined) {
                    throw new Error(`Invalid response: "${result.name}" is not available. Check available rules for valid responses.`);
                  }
                  const lookupBehavior = responseNameToBehavior[result.name];
                  const internalName = lookupBehavior || displayToInternal[result.behaviorName];
                  if (internalName && allBehaviors[internalName]) result.behaviorId = allBehaviors[internalName].behaviorId;
                  delete result.behaviorName;
                } else if (result.behaviorName) {
                  const internalBehavior = displayToInternal[result.behaviorName];
                  if (internalBehavior && allBehaviors[internalBehavior]) result.behaviorId = allBehaviors[internalBehavior].behaviorId;
                  delete result.behaviorName;
                }

                if (
                  (result.name === 'set behavior property' || result.name === 'get behavior property') &&
                  result.params?.behaviorName &&
                  result.params?.propertyName
                ) {
                  result.params.propertyName = fixRulePropertyName(result.params.behaviorName, result.params.propertyName);
                }

                for (const [key, value] of Object.entries(result)) result[key] = convertBehaviorNames(value);
                return result;
              };

              processedRule.response = convertBehaviorNames(processedRule.response);
            }

            rulesMap[ruleKey] = processedRule;
          }

          modifiedBlueprint.actorBlueprint.components.Rules.rules = Object.keys(rulesMap)
            .sort((a, b) => Number(a.replace('rule-', '')) - Number(b.replace('rule-', '')))
            .map((key) => rulesMap[key])
            .filter(Boolean);
        } else if (!modifiedBlueprint.actorBlueprint.components[behaviorName]) {
          modifiedBlueprint.actorBlueprint.components[behaviorName] = { disabled: false, ...props };
        } else {
          Object.assign(modifiedBlueprint.actorBlueprint.components[behaviorName], props);
        }
      }
    }

    if (Array.isArray(edits.script)) {
      modifiedBlueprint.actorBlueprint ??= { components: {} };
      modifiedBlueprint.actorBlueprint.components ??= {};
      const originalCode = modifiedBlueprint.actorBlueprint.components.Script?.code || '';
      const { result, error } = applyScriptEdits(originalCode, edits.script);
      if (error) throw new Error(`Script replace failed: ${error} in blueprint "${modifiedBlueprint.title || blueprintKey}"`);
      modifiedBlueprint.actorBlueprint.components.Script ??= { disabled: false };
      modifiedBlueprint.actorBlueprint.components.Script.code = result;
    }

    let drawingColor = edits.replaceDrawing;
    if (!drawingColor && edits.forkBlueprintId === 'default-blueprint-0') {
      const colors = getAvailableDrawingColors();
      drawingColor = colors[Math.floor(Math.random() * colors.length)];
    }
    if (drawingColor) {
      const drawingBlueprint = findDrawingBlueprint(drawingColor);
      if (!drawingBlueprint) throw new Error(`Drawing color not found: ${drawingColor}`);
      modifiedBlueprint.actorBlueprint ??= { components: {} };
      modifiedBlueprint.actorBlueprint.components ??= {};
      if (drawingBlueprint.actorBlueprint?.components?.Drawing2) {
        modifiedBlueprint.actorBlueprint.components.Drawing2 = clone(drawingBlueprint.actorBlueprint.components.Drawing2);
      }
      if (drawingBlueprint.actorBlueprint?.components?.Body?.fixtures) {
        modifiedBlueprint.actorBlueprint.components.Body ??= { disabled: false };
        modifiedBlueprint.actorBlueprint.components.Body.fixtures = clone(drawingBlueprint.actorBlueprint.components.Body.fixtures);
      }
    }

    modifiedBlueprints.push(modifiedBlueprint);
  }

  const titleToEntryId: Record<string, string> = { ...titleToEntryIdForLookup };
  for (const blueprint of modifiedBlueprints) {
    if (blueprint.title && blueprint.entryId) titleToEntryId[blueprint.title] = blueprint.entryId;
  }

  for (const blueprint of modifiedBlueprints) {
    const rules = blueprint.actorBlueprint?.components?.Rules?.rules;
    if (!rules) continue;
    blueprint.actorBlueprint.components.Rules.rules = replaceEntryTitles(rules, titleToEntryId);
    for (const rule of blueprint.actorBlueprint.components.Rules.rules) {
      if (rule.response) rule.response = fixLeaderboardVariableIds(rule.response);
      if (rule.trigger?.name === 'tap' && allBehaviors.Body?.behaviorId) rule.trigger.behaviorId = allBehaviors.Body.behaviorId;
    }
  }

  const modifiedActors: any[] = [];
  const actorEdits = parseMap(editArgs.actors, 'actors');
  for (const [actorIdKey, actorData] of Object.entries(actorEdits) as [string, any][]) {
    if (!actorData || typeof actorData !== 'object') throw new Error(`Invalid actor edit: ${actorIdKey}`);
    const numericId = actorIdKey.startsWith('a') ? actorIdKey.substring(1) : actorIdKey;
    const modifiedActor: any = { actorId: numericId };

    if (actorData.removeActor) {
      modifiedActor.removeActor = true;
      modifiedActors.push(modifiedActor);
      continue;
    }

    const isNewActor = !actorMap.has(numericId) || actorData.title;
    if (isNewActor) {
      modifiedActor.new = true;
      if (actorData.entryId) {
        modifiedActor.parentEntryId = actorData.entryId;
      } else if (actorData.title) {
        const newBlueprint = modifiedBlueprints.find((blueprint) => blueprint.title === actorData.title);
        modifiedActor.parentEntryId = titleToEntryId[actorData.title] || newBlueprint?.entryId;
      }
      if (!modifiedActor.parentEntryId) throw new Error(`New actor "${actorIdKey}" requires a valid title or entryId`);
    }

    if (actorData.components) {
      const components = parseYamlOrObject(actorData.components, 'actor components');
      modifiedActor.components = {};
      for (const [behaviorName, props] of Object.entries(components) as [string, any][]) {
        const componentData: Record<string, any> = {};
        if (behaviorName === 'Layout' || behaviorName === 'Body') {
          const fixedProps = fixComponentPropertyNames('Layout', props);
          if (fixedProps.x !== undefined) componentData.x = fixedProps.x;
          if (fixedProps.y !== undefined) componentData.y = fixedProps.y;
          if (fixedProps.angle !== undefined) componentData.angle = fixedProps.angle;
          if (fixedProps.widthScale !== undefined) componentData.widthScale = fixedProps.widthScale / 10;
          if (fixedProps.heightScale !== undefined) componentData.heightScale = fixedProps.heightScale / 10;
          modifiedActor.components.Body = componentData;
        } else if (behaviorName === 'Drawing' || behaviorName === 'Drawing2') {
          if (props.initialFrame !== undefined) componentData.initialFrame = props.initialFrame;
          modifiedActor.components.Drawing2 = componentData;
        } else if (behaviorName === 'Text') {
          if (props.content !== undefined) componentData.content = props.content;
          if (props.fontSizeScale !== undefined) componentData.fontSizeScale = props.fontSizeScale;
          modifiedActor.components.Text = componentData;
        } else if (behaviorName === 'Link') {
          if (props.targetDeckId !== undefined) componentData.targetDeckId = props.targetDeckId;
          modifiedActor.components.Link = componentData;
        }
      }
    }

    modifiedActors.push(modifiedActor);
  }

  return {
    description: (editArgs.description || '').substring(0, 40),
    blueprints: modifiedBlueprints,
    variables: modifiedVariables,
    actors: modifiedActors,
    blueprintIdMapping,
  };
}

function applyEditPayload(sceneData: any, payload: AgentEditPayload): any {
  const snapshot = clone(sceneData.snapshot ?? {});
  const library: Record<string, any> = clone(snapshot.library ?? {});
  const variableMap = new Map<string, any>((snapshot.variables ?? []).map((variable: any) => [variable.variableId, variable]));
  const actorMap = new Map<string, any>((snapshot.actors ?? []).map((actor: any) => [String(actor.actorId), actor]));

  for (const variable of payload.variables) {
    if (!variable?.variableId) continue;
    if (variable.removeVariable) variableMap.delete(variable.variableId);
    else variableMap.set(variable.variableId, clone(variable));
  }

  for (const blueprint of payload.blueprints) {
    if (!blueprint?.entryId) continue;
    if (blueprint.removeBlueprint) library[blueprint.entryId] = undefined as any;
  }
  for (const blueprint of payload.blueprints) {
    if (!blueprint?.entryId || blueprint.removeBlueprint) continue;
    library[blueprint.entryId] = clone(blueprint);
  }
  for (const [entryId, value] of Object.entries(library)) {
    if (value === undefined) delete library[entryId];
  }

  for (const actor of payload.actors) {
    if (!actor?.actorId) continue;
    const actorId = String(actor.actorId).match(/^\d+$/) ? String(actor.actorId) : nextActorId(actorMap);
    if (actor.removeActor) {
      actorMap.delete(actorId);
      continue;
    }

    const current = actor.new
      ? {
          actorId,
          parentEntryId: actor.parentEntryId,
          bp: { components: { Body: { x: 0, y: 0 } } },
        }
      : clone(actorMap.get(actorId) ?? { actorId, parentEntryId: actor.parentEntryId, bp: { components: {} } });

    if (actor.parentEntryId) current.parentEntryId = actor.parentEntryId;
    current.bp ??= { components: {} };
    current.bp.components = mergeDeep(current.bp.components ?? {}, actor.components ?? {});
    actorMap.set(actorId, current);
  }

  snapshot.library = library;
  snapshot.variables = Array.from(variableMap.values());
  snapshot.actors = Array.from(actorMap.values()).sort((a, b) => Number(a.actorId) - Number(b.actorId));
  return { snapshot };
}

export async function applyLocalEdit({
  cardDir,
  args,
  deckId = '',
  cardId,
}: LocalEditOptions): Promise<{ summary: string; blueprintIdMapping: Record<string, string> }> {
  if (!args || typeof args !== 'object') throw new Error('edit payload must be a JSON object');

  const sceneData = await materializeProjectCard(cardDir);
  const metadata = await getCastleMetadata();
  const cardJson = readJsonIfExists(path.join(cardDir, 'card.json')) ?? {};
  const actualCardId = cardId || cardJson.cardId || path.basename(cardDir);
  const payload = createAgentEditPayload({
    args,
    library: sceneData.snapshot?.library ?? {},
    actors: sceneData.snapshot?.actors ?? [],
    variables: sceneData.snapshot?.variables ?? [],
    allBehaviors: metadata.behaviors,
    rulesData: metadata.rules,
    currentCardId: actualCardId,
    currentDeckId: deckId,
    slugMap: loadSlugMap(cardDir),
  });
  const editedSceneData = applyEditPayload(sceneData, payload);

  await writeProjectCardFromSceneData({
    deckId,
    card: {
      ...cardJson,
      cardId: actualCardId,
      title: cardJson.title,
      sceneDataUrl: cardJson.sceneDataUrl,
    },
    cardDir,
    sceneData: editedSceneData,
    replace: true,
  });

  await materializeProjectCard(cardDir);

  return {
    summary: summarizeArgs(args),
    blueprintIdMapping: payload.blueprintIdMapping,
  };
}
