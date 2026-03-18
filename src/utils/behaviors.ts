import yaml from 'yaml';
import _ from 'lodash';

import { getCastleMetadata } from './castle-core-node.js';
import * as Rules from './rules.js';

function formatDisplayName(name) {
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

export function serializeComponents({ components, writeRulesFile, writeScriptFile }) {
  let result = {};
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
        writeRulesFile,
        writeScriptFile,
      });
    }
  }
  return result;
}

export function deserializeComponents({ components, readFile }) {
  let result = {};
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

function serializeComponent({ behavior, component, writeRulesFile, writeScriptFile }) {
  if (!component.disabled) {
    delete component.disabled;
  }

  if (behavior.name == BehaviorKey.Rules) {
    let rules: any = [];

    if (component.rules) {
      for (let rule of component.rules) {
        rules.push(Rules.serializeRule(rule));
      }
    }

    let rulesFilename = writeRulesFile(yaml.stringify(rules));
    return {
      file: rulesFilename,
    };
  } else if (behavior.name == BehaviorKey.Script) {
    let code = component.code || '';

    let scriptFilename = writeScriptFile(code);
    return {
      file: scriptFilename,
    };
  }

  return serializeComponentInternals({ behavior, component });
}

export function serializeRulesComponent({ component }) {
  let rules: any = [];

  if (component.rules) {
    for (let rule of component.rules) {
      rules.push(Rules.serializeRule(rule));
    }
  }

  return yaml.stringify(rules);
}

export function serializeScriptComponent({ component }) {
  let code = component.code || '';
  return code;
}

export function serializeComponentInternals({ behavior, component }): Record<string, any> {
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

    if (!attribs.rulesGet && !attribs.rulesSet) {
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

function deserializeComponent({ behavior, component, readFile }) {
  let result: any = {};

  if (behavior.name == BehaviorKey.Rules) {
    result.rules = [];

    try {
      let rules = readFile(component.file);
      let parsedRules = yaml.parse(rules);
      for (let rule of parsedRules) {
        result.rules.push(Rules.deserializeRule(rule));
      }
    } catch (e) {
      console.warn(`Error reading rules file: ${component.file}`);
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
    let displayNameToPropertySpec = {};
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

  result.disabled = !!component.disabled;

  return result;
}
