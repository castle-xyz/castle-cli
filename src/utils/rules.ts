import _ from 'lodash';
import { getCastleMetadata } from './castle-core-node.js';
import * as Behaviors from './behaviors.js';

const TRIGGERS: Record<string, any> = {};
const RULES: Record<string, any> = {}; // responses and conditions

let initialized = false;

export async function initRules() {
  if (initialized) return;
  initialized = true;
  const { rules } = await getCastleMetadata();
  parseRules(rules.triggers, TRIGGERS);
  parseRules(rules.responses, RULES);
  parseRules(rules.conditions, RULES);
}

function parseRules(rules: any[], behaviors: Record<string, any>) {
  for (const rule of rules) {
    let behaviorId = rule.behaviorId;
    let name = rule.name;

    if (!behaviors[behaviorId]) {
      behaviors[behaviorId] = {};
    }

    if (behaviors[behaviorId][name]) {
      console.warn(`Duplicate rule found: ${rule.behaviorId}, ${rule.name}`);
      continue;
    }

    if (rule.paramSpecs) {
      let paramSpecs: Record<string, any> = {};

      for (let param of rule.paramSpecs) {
        let paramName = param.name;

        if (paramSpecs[paramName]) {
          console.warn(`Duplicate param found: ${rule.behaviorId}, ${paramName}`);
          continue;
        }

        let type = param.type;

        if (type.toLowerCase().includes('response')) {
          type = 'response';
        }

        paramSpecs[paramName] = {
          name: paramName,
          type,
          attribs: param.attribs,
        };

        rule.paramSpecs = paramSpecs;
      }
    }

    behaviors[behaviorId][name] = rule;
  }
}

export function getTrigger(behaviorId: any, name: any) {
  try {
    return TRIGGERS[behaviorId][name];
  } catch (e) {
    console.warn(`Trigger not found: ${behaviorId}, ${name}`);
  }
}

export function getRule(behaviorId: any, name: any) {
  try {
    return RULES[behaviorId][name];
  } catch (e) {
    console.warn(`Rule not found: ${behaviorId}, ${name}`);
    return null;
  }
}

function replaceBehaviorIdWithName(component: any) {
  if (component.behaviorId) {
    let behaviorDisplayName = Behaviors.BEHAVIOR_ID_TO_DISPLAY_NAME[parseInt(component.behaviorId)];

    if (behaviorDisplayName) {
      component = {
        behaviorName: behaviorDisplayName,
        ...component,
      };

      delete component.behaviorId;
    }
  }

  return component;
}

function replaceBehaviorNameWithId(component: any) {
  if (component.behaviorName) {
    let behaviorId = Behaviors.BEHAVIOR_DISPLAY_NAME_TO_ID[component.behaviorName];
    component.behaviorId = parseInt(behaviorId);
    delete component.behaviorName;
  }

  return component;
}

export function serializeRule(rule: any) {
  rule = _.cloneDeep(rule);

  let topLevelResponses: any = [];

  let result: any = {
    trigger: serializeBaseRulerInner(rule.trigger),
    responses: [serializeRuleInner(rule.response, topLevelResponses)],
  };

  result.responses = [...result.responses, ..._.reverse(topLevelResponses)];

  return result;
}

function serializeBaseRulerInner(rule: any) {
  let result: any = {
    name: rule.name,
    params: rule.params,
    behaviorId: rule.behaviorId,
  };

  if (!result.behaviorId) {
    delete result.behaviorId;
  }

  if (result.params && _.isEmpty(result.params)) {
    delete result.params;
  }

  if (result.params) {
    result.params = replaceBehaviorIdWithName(result.params);
  }

  result = replaceBehaviorIdWithName(result);

  return result;
}

function serializeRuleInner(rule: any, topLevelResponses: any[] = []) {
  if (typeof rule != 'object') {
    return rule;
  }

  let ruleSchema = getRule(rule.behaviorId, rule.name);
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
              let responses: any = [];
              params[key] = [serializeRuleInner(response, responses)];
              params[key] = [...params[key], ..._.reverse(responses)];
            } else {
              params[key] = null;
            }
          }
        }
      }

      // reorder condition key
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

  if (_.isEmpty(result.params)) {
    delete result.params;
  }

  return result;
}

export function deserializeRule(rule: any) {
  rule = _.cloneDeep(rule);

  let responses = rule.responses.map((response: any) => deserializeRuleInner(response));
  let response = nestResponses(responses);

  let result = {
    trigger: deserializeBaseRulerInner(rule.trigger),
    response,
  };

  return result;
}

function nestResponses(responses: any[], index = 0) {
  let result: any = null;

  if (responses[index]) {
    let response = _.cloneDeep(responses[index]);

    if (index + 1 < responses.length) {
      let nextResponse = nestResponses(responses, index + 1);

      if (nextResponse) {
        response.params.nextResponse = nextResponse;
      }
    }

    result = response;
  }

  return result;
}

function deserializeBaseRulerInner(rule: any) {
  let result: any = {
    name: rule.name,
    params: {},
  };

  if (rule.params) {
    result.params = rule.params;
  }

  if (result.params) {
    result.params = replaceBehaviorNameWithId(result.params);
  }

  if (rule.behaviorName) {
    result.behaviorName = rule.behaviorName;
  }

  result = replaceBehaviorNameWithId(result);

  return result;
}

function deserializeRuleInner(rule: any) {
  if (typeof rule != 'object') {
    return rule;
  }

  let result = deserializeBaseRulerInner(rule);

  let rulesSchema = getRule(result.behaviorId, result.name);
  let paramSpecs = rulesSchema?.paramSpecs;

  if (result.params) {
    let params = result.params;

    if (paramSpecs) {
      let keys = _.keys(params);
      for (let key of keys) {
        let paramSpec = paramSpecs[key];

        if (paramSpec) {
          let type = paramSpec.type;

          if (type == 'response') {
            let responses = params[key].map((response: any) => deserializeRuleInner(response));
            let response = nestResponses(responses);
            params[key] = response;
          }
        }
      }
    }
  }

  return result;
}
