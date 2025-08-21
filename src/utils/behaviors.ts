import yaml from 'yaml';
import _ from 'lodash';

import BehaviorConfig from '../assets/behaviors.json' with { type: 'json' };
import * as Rules from './rules.js';
import { ActorBlueprint, YamlString } from './blueprints.js';

function formatDisplayName(name) {
  return name.replace(/\s/g, '');
}

export const BEHAVIOR_ID_TO_DISPLAY_NAME = {};
const BEHAVIOR_ID_TO_NAME = {};

for (const key in BehaviorConfig) {
  let behavior = BehaviorConfig[key];
  BEHAVIOR_ID_TO_DISPLAY_NAME[behavior.behaviorId] = formatDisplayName(behavior.displayName);
  BEHAVIOR_ID_TO_NAME[behavior.behaviorId] = behavior.name;
}
export const BEHAVIOR_DISPLAY_NAME_TO_ID = _.invert(BEHAVIOR_ID_TO_DISPLAY_NAME);

export const enum BehaviorKey {
  AnalogStick = 'AnalogStick',
  Body = 'Body',
  Bouncy = 'Bouncy',
  Camera = 'Camera',
  Counter = 'Counter',
  Drag = 'Drag',
  Drawing2 = 'Drawing2',
  Falling = 'Falling',
  Friction = 'Friction',
  Link = 'Link',
  LocalVariables = 'LocalVariables',
  Moving = 'Moving',
  Music = 'Music',
  RotatingMotion = 'RotatingMotion',
  Rules = 'Rules',
  Script = 'Script',
  Shared = 'Shared',
  Sliding = 'Sliding',
  Sling = 'Sling',
  Slowdown = 'Slowdown',
  Solid = 'Solid',
  SpeedLimit = 'SpeedLimit',
  Styles = 'Styles',
  Tags = 'Tags',
  Text = 'Text',
  Tilt = 'Tilt',
  VideoCamera = 'VideoCamera',
  VideoCameraFeature = 'VideoCameraFeature',
}

const COMPONENTS_TO_SKIP = ['Body', 'Drawing2'];

export function serializeComponents({ components, writeRulesFile, writeScriptFile }) {
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

/**
 * Serialize into an ActorBlueprint object, from a set of Blueprint components.
 * NOTE: this function is similar to serializeComponents, but it does not write rules or script files to disk.
 * @param components - Record<string, any>; from Blueprint.actorBlueprint.components
 * @returns ActorBlueprint
 */
export function serializePartialComponents({ components }): ActorBlueprint {
  let result:  Record<string, any> = {};
  let rulesFile: YamlString | undefined;
  let scriptFile: string | undefined;

  for (const key in components) {
    if (COMPONENTS_TO_SKIP.includes(key)) {
      continue;
    }

    let behavior = BehaviorConfig[key];

    if (behavior) {

      if (behavior.name === BehaviorKey.Rules) {
        rulesFile = serializeRulesComponent({ component: components[key] });
      } else if (behavior.name === BehaviorKey.Script) {
        scriptFile = serializeScriptComponent({ component: components[key] });
      } else {
        result[formatDisplayName(behavior.displayName)] = serializeComponentInternals({ behavior, component: components[key] });
      }
    }
  }

  return {
    rulesFile,
    scriptFile,
    components: result,
  };
}

export function deserializeComponents({ components, readFile }) {
  let result = {};
  for (const key in components) {
    let behaviorId = BEHAVIOR_DISPLAY_NAME_TO_ID[key];
    if (!behaviorId) {
      continue;
    }

    let behaviorName = BEHAVIOR_ID_TO_NAME[behaviorId];
    if (!behaviorName || COMPONENTS_TO_SKIP.includes(behaviorName)) {
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

  return serializeComponentInternals({ behavior, component });
}

export function serializeRulesComponent({ component }) {
  let rules: any = [];

  if (component.rules) {
    for (let rule of component.rules) {
      rules.push(Rules.serializeRule(rule));
    }
  }

  return yaml.stringify(rules)
}

export function serializeScriptComponent({ component }) {
  let code = component.code || '';
  return code
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

  if (behavior.name == 'Rules') {
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
  } else if (behavior.name == 'Script') {
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

      // TODO: check min / max / allowed values
    }
  }

  result.disabled = !!component.disabled;

  return result;
}
