import yaml from 'yaml';
import _ from 'lodash';

import { getCastleMetadata } from './castle-core-node.js';
import * as Rules from './rules.js';

function formatDisplayName(name: string) {
  return name.replace(/\s/g, '');
}

export let BEHAVIOR_ID_TO_DISPLAY_NAME: Record<string, string> = {};
let BEHAVIOR_ID_TO_NAME: Record<string, string> = {};
export let BEHAVIOR_DISPLAY_NAME_TO_ID: Record<string, string> = {};

let initialized = false;
let BehaviorConfig: any = {};

export async function initBehaviors() {
  if (initialized) return;
  initialized = true;
  const { behaviors } = await getCastleMetadata();
  BehaviorConfig = behaviors;
  for (const key in BehaviorConfig) {
    let behavior = BehaviorConfig[key];
    BEHAVIOR_ID_TO_DISPLAY_NAME[behavior.behaviorId] = formatDisplayName(behavior.displayName);
    BEHAVIOR_ID_TO_NAME[behavior.behaviorId] = behavior.name;
  }
  BEHAVIOR_DISPLAY_NAME_TO_ID = _.invert(BEHAVIOR_ID_TO_DISPLAY_NAME);
}

export const enum BehaviorKey {
  Rules = 'Rules',
  Script = 'Script',
}

// Body and Drawing2 use internal names — pass through without display name mapping
const COMPONENTS_NO_RENAME = ['Body', 'Drawing2'];

export function serializeComponents({ components, writeScriptFile }: { components: any; writeScriptFile: (code: string) => string }) {
  let result: Record<string, any> = {};
  for (const key in components) {
    // Body and Drawing2 pass through without display name lookup
    if (COMPONENTS_NO_RENAME.includes(key)) {
      let comp = { ...components[key] };
      if (!comp.disabled) {
        delete comp.disabled;
      }
      result[key] = comp;
      continue;
    }

    let behavior = BehaviorConfig[key];

    if (behavior) {
      result[formatDisplayName(behavior.displayName)] = serializeComponent({
        behavior,
        component: components[key],
        writeScriptFile,
      });
    }
  }
  return result;
}

export function deserializeComponents({ components, readFile }: { components: any; readFile: (path: string) => string }) {
  let result: Record<string, any> = {};
  for (const key in components) {
    // Body and Drawing2 pass through directly
    if (COMPONENTS_NO_RENAME.includes(key)) {
      result[key] = { ...components[key] };
      continue;
    }

    let behaviorId = BEHAVIOR_DISPLAY_NAME_TO_ID[key];
    if (!behaviorId) {
      continue;
    }

    let behaviorName = BEHAVIOR_ID_TO_NAME[behaviorId];
    if (!behaviorName) {
      continue;
    }

    let behavior = BehaviorConfig[behaviorName];

    if (behavior) {
      result[behaviorName] = deserializeComponent({
        behavior,
        component: components[key],
        readFile,
      });
    }
  }

  return result;
}

function serializeComponent({ behavior, component, writeScriptFile }: { behavior: any; component: any; writeScriptFile: (code: string) => string }) {
  if (!component.disabled) {
    delete component.disabled;
  }

  if (behavior.name == BehaviorKey.Rules) {
    if (component.rules && !Array.isArray(component.rules) && typeof component.rules === 'object') {
      // Already in serialized inline object format (rule-0, rule-1, ...) — pass through
      return { rules: component.rules };
    }
    const rulesObj: any = {};
    if (component.rules) {
      component.rules.forEach((rule: any, i: number) => {
        rulesObj[`rule-${i}`] = Rules.serializeRule(rule);
      });
    }
    return { rules: rulesObj };
  } else if (behavior.name == BehaviorKey.Script) {
    let code = component.code || '';

    let scriptFilename = writeScriptFile(code);
    return {
      file: scriptFilename,
    };
  } else if (behavior.name === 'Tags') {
    const result: any = {};
    if (component.tagsString) result.tagsString = component.tagsString;
    if (component.disabled) result.disabled = component.disabled;
    return result;
  }

  return serializeComponentInternals({ behavior, component });
}

export function serializeRulesComponent({ component }: { component: any }) {
  let rules: any = [];

  if (component.rules) {
    for (let rule of component.rules) {
      rules.push(Rules.serializeRule(rule));
    }
  }

  return yaml.stringify(rules);
}

export function serializeScriptComponent({ component }: { component: any }) {
  let code = component.code || '';
  return code;
}

export function serializeComponentInternals({ behavior, component }: { behavior: any; component: any }): Record<string, any> {
  if (!component.disabled) {
    delete component.disabled;
  }

  let keys = _.keys(component);
  let result: Record<string, any> = {};

  for (let key of keys) {
    if (key == 'disabled') {
      result[key] = component[key];
      continue;
    }

    let propertySpec = behavior.propertySpecs[key];

    if (!propertySpec) {
      continue;
    }

    let attribs = propertySpec.attribs;
    if (!attribs) {
      continue;
    }

    let property = component[key];

    if (attribs.scriptName.length > 0) {
      key = attribs.scriptName;
    }

    result[key] = property;
  }

  return result;
}

function deserializeComponent({ behavior, component, readFile }: { behavior: any; component: any; readFile: (path: string) => string }) {
  let result: any = {};

  if (behavior.name == BehaviorKey.Rules) {
    result.rules = [];

    if (component.rules && typeof component.rules === 'object' && !Array.isArray(component.rules)) {
      // Inline format: { rule-0: {...}, rule-1: {...} }
      const keys = Object.keys(component.rules).sort((a, b) => {
        const ai = parseInt(a.replace('rule-', ''));
        const bi = parseInt(b.replace('rule-', ''));
        return ai - bi;
      });
      for (const key of keys) {
        result.rules.push(Rules.deserializeRule(component.rules[key]));
      }
    }
  } else if (behavior.name == BehaviorKey.Script) {
    result.code = '';

    try {
      let code = readFile(component.file);
      result.code = code;
    } catch (e) {
      console.warn(`Error reading script file: ${component.file}`);
    }
  } else {
    let displayNameToPropertySpec: Record<string, any> = {};
    for (const key in behavior.propertySpecs) {
      let propertySpec = behavior.propertySpecs[key];
      let name = propertySpec.name;
      if (propertySpec.attribs.scriptName.length > 0) {
        name = propertySpec.attribs.scriptName;
      }

      displayNameToPropertySpec[name] = propertySpec;
    }

    let keys = _.keys(component);

    for (let key of keys) {
      let propertySpec = displayNameToPropertySpec[key];

      if (!propertySpec) {
        continue;
      }

      let attribs = propertySpec.attribs;
      if (!attribs) {
        continue;
      }

      result[propertySpec.name] = component[key];
    }
  }

  // Only include disabled if explicitly set in the YAML.
  // Setting disabled: false when not in YAML would override cached disabled: true via merge.
  if ('disabled' in component) {
    result.disabled = !!component.disabled;
  }

  return result;
}
