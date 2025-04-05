import * as fs from 'fs';
import * as path from 'path';
import yaml from 'yaml';
import _ from 'lodash';

import BehaviorConfig from '../assets/behaviors.json' with { type: 'json' };
import * as Rules from './rules.js';

function formatDisplayName(name) {
  return name.replace(/\s/g, '');
}

const BEHAVIOR_ID_TO_DISPLAY_NAME = {};
for (const key in BehaviorConfig) {
  let behavior = BehaviorConfig[key];
  BEHAVIOR_ID_TO_DISPLAY_NAME[behavior.behaviorId] = formatDisplayName(behavior.displayName);
}
const BEHAVIOR_DISPLAY_NAME_TO_ID = _.invert(BEHAVIOR_ID_TO_DISPLAY_NAME);

const COMPONENTS_TO_SKIP = ['Body', 'Drawing2'];

export function serializeComponents({ components, rulesFilename, scriptFilename, blueprintsDir }) {
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
        rulesFilename,
        scriptFilename,
        blueprintsDir,
      });
    }
  }
  return result;
}

function serializeRule(rule) {
  let topLevelResponses = [];

  let result = {
    trigger: serializeBaseRulerInner(rule.trigger),
    responses: [serializeRuleInner(rule.response, topLevelResponses)],
  };

  result.responses = [...result.responses, ...topLevelResponses];

  return result;
}

function replaceBehaviorIdWithName(component) {
  if (component.behaviorId) {
    let behaviorDisplayName = BEHAVIOR_ID_TO_DISPLAY_NAME[parseInt(component.behaviorId)];

    if (behaviorDisplayName) {
      if (behaviorDisplayName != 'Rules') {
        component = {
          behavior: behaviorDisplayName,
          ...component,
        };
      }

      delete component.behaviorId;
    }
  }

  return component;
}

function serializeBaseRulerInner(rule) {
  let result: any = {
    type: rule.name,
    params: rule.params,
    behaviorId: rule.behaviorId,
  };

  if (result.params && _.isEmpty(result.params)) {
    delete result.params;
  }

  if (result.params) {
    result.params = replaceBehaviorIdWithName(result.params);
  }

  result = replaceBehaviorIdWithName(result);

  return result;
}

function serializeRuleInner(rule, topLevelResponses: any = []) {
  if (typeof rule != 'object') {
    return rule;
  }

  let ruleSchema = Rules.getRule(rule.behaviorId, rule.name);
  let paramSpecs = ruleSchema?.paramSpecs;

  let result = serializeBaseRulerInner(rule);

  if (result.params) {
    let params = result.params;

    if (params.nextResponse) {
      let nextResponse = params.nextResponse;
      topLevelResponses.push(serializeRuleInner(nextResponse, topLevelResponses));
      delete params.nextResponse;
    }

    if (paramSpecs) {
      let keys = _.keys(params);
      for (let key of keys) {
        let paramSpec = paramSpecs[key];

        if (paramSpec) {
          let type = paramSpec.type;

          if (type == 'response') {
            let response = params[key];

            if (response) {
              let responses = [];
              params[key] = [serializeRuleInner(response, responses)];
              params[key] = [...params[key], ...responses];
            } else {
              params[key] = null;
            }
          }
        }
      }

      if (params.condition) {
        let condition = params.condition;
        delete params.condition;

        result.params = {
          condition,
          ...params,
        };
      }
    }
  }

  return result;
}

function serializeComponent({ behavior, component, rulesFilename, scriptFilename, blueprintsDir }) {
  if (!component.disabled) {
    delete component.disabled;
  }

  if (behavior.name == 'Rules') {
    let rules: any = [];

    if (component.rules) {
      for (let rule of component.rules) {
        rules.push(serializeRule(rule));
      }
    }

    fs.writeFileSync(path.join(blueprintsDir, rulesFilename), yaml.stringify(rules));

    return {
      file: rulesFilename,
    };
  } else if (behavior.name == 'Script') {
    let code = component.code || '';

    fs.writeFileSync(path.join(blueprintsDir, scriptFilename), code);

    return {
      file: scriptFilename
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
