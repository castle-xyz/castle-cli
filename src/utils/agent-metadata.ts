import { getCastleMetadata } from './castle-core-node.js';

const TYPE_MAP: Record<string, string> = {
  f: 'number',
  b: 'boolean',
  i: 'integer',
  d: 'number',
  variableRef: 'variable',
  actorRef: 'actor',
};

function cleanType(type: string): string {
  if (/.*BaseResponse$/.test(type)) return 'response';
  if (/^\d+Card$/.test(type)) return 'card';
  if (/^\d+Song$/.test(type)) return 'song';
  return TYPE_MAP[type] ?? type;
}

export function cleanBehaviorsData(behaviors: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!behaviors) return null;

  const cleaned: Record<string, any> = {};
  for (const behavior of Object.values(behaviors) as any[]) {
    const behaviorData: any = { properties: {} };

    if (behavior.propertySpecs) {
      for (const [propName, spec] of Object.entries(behavior.propertySpecs) as [string, any][]) {
        if (!spec.attribs?.rulesGet && !spec.attribs?.rulesSet) continue;

        const propData: any = { type: cleanType(spec.type) };
        if (spec.attribs?.label && spec.attribs.label !== propName) propData.label = spec.attribs.label;
        if (spec.attribs?.scriptName) propData.scriptName = spec.attribs.scriptName;
        if (spec.attribs?.min !== undefined && spec.attribs.min !== null) propData.min = spec.attribs.min;
        if (spec.attribs?.max !== undefined && spec.attribs.max !== null) propData.max = spec.attribs.max;
        if (spec.attribs?.allowedValues?.length > 0) propData.allowedValues = spec.attribs.allowedValues;

        behaviorData.properties[propName] = propData;
      }
    }

    cleaned[behavior.displayName] = behaviorData;
  }

  return cleaned;
}

export function cleanRulesData(rulesData: any, behaviors: Record<string, any> | null | undefined): any | null {
  if (!rulesData) return null;

  const behaviorNameToDisplay: Record<string, string> = {};
  if (behaviors) {
    for (const b of Object.values(behaviors) as any[]) {
      behaviorNameToDisplay[b.name] = b.displayName;
    }
  }

  const cleanRuleEntry = (entry: any): any | null => {
    const behaviorDisplayName = behaviorNameToDisplay[entry.behaviorName] || entry.behaviorName;
    if (behaviorDisplayName === 'Counter') return null;

    const cleaned: any = {
      name: entry.name,
      behavior: behaviorDisplayName,
      behaviorName: behaviorDisplayName,
      description: entry.description,
    };

    if (entry.paramSpecs?.length > 0) {
      cleaned.parameters = entry.paramSpecs.map((param: any) => {
        const paramData: any = {
          name: param.name,
          description: param.attribs?.label,
          type: cleanType(param.type),
        };
        if (param.attribs?.min !== undefined && param.attribs.min !== null) paramData.min = param.attribs.min;
        if (param.attribs?.max !== undefined && param.attribs.max !== null) paramData.max = param.attribs.max;
        if (param.attribs?.allowedValues?.length > 0) paramData.allowedValues = param.attribs.allowedValues;
        return paramData;
      });
    }

    return cleaned;
  };

  const cleaned: any = {};

  for (const ruleType of ['triggers', 'responses', 'conditions']) {
    const entries = rulesData[ruleType];
    if (!Array.isArray(entries)) continue;
    cleaned[ruleType] = entries.map(cleanRuleEntry).filter(Boolean);
  }

  if (Array.isArray(rulesData.expressions)) {
    cleaned.expressions = rulesData.expressions.map(cleanRuleEntry).filter(Boolean);
  }

  return cleaned;
}

export async function getCleanedCastleMetadata(): Promise<{ behaviors: Record<string, any> | null; rules: any | null }> {
  const metadata = await getCastleMetadata();
  return {
    behaviors: cleanBehaviorsData(metadata.behaviors),
    rules: cleanRulesData(metadata.rules, metadata.behaviors),
  };
}
