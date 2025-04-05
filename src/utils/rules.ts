import _ from 'lodash';
import RulesConfig from '../assets/rules.json' with { type: 'json' };

const TRIGGERS = {};
const RULES = {}; // responses and conditions

parseRules(RulesConfig.triggers, TRIGGERS);
parseRules(RulesConfig.responses, RULES);
parseRules(RulesConfig.conditions, RULES);

function parseRules(rules, behaviors) {
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
      let paramSpecs = {};

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

export function getTrigger(behaviorId, name) {
  try {
    return TRIGGERS[behaviorId][name];
  } catch (e) {
    console.warn(`Trigger not found: ${behaviorId}, ${name}`);
  }
}

export function getRule(behaviorId, name) {
  try {
    return RULES[behaviorId][name];
  } catch (e) {
    console.warn(`Rule not found: ${behaviorId}, ${name}`);
    return null;
  }
}
