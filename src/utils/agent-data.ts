import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AGENT_DATA_DIR = path.join(CLI_ROOT, 'data', 'agent');

let cachedDefaultBlueprints: Record<string, any> | null = null;
let cachedDrawingBlueprintData: any | null = null;

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function getDefaultBlueprints(): Record<string, any> {
  if (cachedDefaultBlueprints) return cachedDefaultBlueprints;
  const data = readJson(path.join(AGENT_DATA_DIR, 'LibraryDefaultBlueprintData.json'));
  const result: Record<string, any> = {};

  for (let index = 0; index < (data.templates ?? []).length; index++) {
    const template = data.templates[index];
    if (!template?.title) continue;
    const entryId = `default-blueprint-${index}`;
    result[entryId] = {
      entryId,
      entryType: 'actorBlueprint',
      title: template.title,
      actorBlueprint: template.actorBlueprint,
      base64Png: template.base64Png,
      library: { blueprintAssetId: entryId },
    };
  }

  cachedDefaultBlueprints = result;
  return result;
}

export function getDrawingBlueprintData(): any {
  cachedDrawingBlueprintData ??= readJson(path.join(AGENT_DATA_DIR, 'AgentDrawingBlueprintData.json'));
  return cachedDrawingBlueprintData;
}

export function getAvailableDrawingColors(): string[] {
  const data = getDrawingBlueprintData();
  return Object.values(data.snapshot?.library ?? {})
    .map((entry: any) => entry.title)
    .filter(Boolean)
    .sort() as string[];
}

export function findDrawingBlueprint(color: string): any | null {
  const data = getDrawingBlueprintData();
  return Object.values(data.snapshot?.library ?? {}).find((entry: any) => entry.title === color) ?? null;
}
