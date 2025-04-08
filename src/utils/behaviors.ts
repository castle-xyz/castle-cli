import yaml from 'yaml';
import _ from 'lodash';

import BehaviorConfig from '../assets/behaviors.json' with { type: 'json' };
import * as Rules from './rules.js';

function formatDisplayName(name) {
  return name.replace(/\s/g, '');
}

export const BEHAVIOR_ID_TO_DISPLAY_NAME = {};
for (const key in BehaviorConfig) {
  let behavior = BehaviorConfig[key];
  BEHAVIOR_ID_TO_DISPLAY_NAME[behavior.behaviorId] = formatDisplayName(behavior.displayName);
}
const BEHAVIOR_DISPLAY_NAME_TO_ID = _.invert(BEHAVIOR_ID_TO_DISPLAY_NAME);

const COMPONENTS_TO_SKIP = ['Body', 'Drawing2'];

export function serializeComponents({ components, writeRulesFile, writeScriptFile }) {
  //console.log(BehaviorConfig);

  let result = {};
  for (const key in components) {
    if (COMPONENTS_TO_SKIP.includes(key)) {
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

function serializeComponent({ behavior, component, writeRulesFile, writeScriptFile }) {
  if (!component.disabled) {
    delete component.disabled;
  }

  if (behavior.name == 'Rules') {
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
  } else if (behavior.name == 'Script') {
    let code = component.code || '';

    let scriptFilename = writeScriptFile(code);
    return {
      file: scriptFilename,
    };
  }

  let keys = _.keys(component);
  let result = {};

  for (let key of keys) {
    let propertySpec = behavior.propertySpecs[key];

    if (!propertySpec) {
      continue;
    }

    let attribs = propertySpec.attribs;
    if (!attribs) {
      continue;
    }

    if (!attribs.rulesGet || !attribs.rulesSet) {
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
