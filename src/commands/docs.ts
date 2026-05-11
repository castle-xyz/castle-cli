import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import { getConfigDir } from '../config.js';
import { getCleanedCastleMetadata } from '../utils/agent-metadata.js';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function getAgentDocsDir(): string {
  return path.join(getConfigDir(), 'docs');
}

export function getAgentSpecsDir(): string {
  return path.join(getAgentDocsDir(), 'specs');
}

function copyDirectory(source: string, target: string): void {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing packaged docs directory: ${source}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

export function syncAgentDocs(): string {
  const docsDir = getAgentDocsDir();
  fs.mkdirSync(docsDir, { recursive: true });

  const instructionsPath = path.join(CLI_ROOT, 'docs', 'agent', 'AGENTS.md');
  if (!fs.existsSync(instructionsPath)) {
    throw new Error(`Missing packaged agent instructions: ${instructionsPath}`);
  }
  fs.copyFileSync(instructionsPath, path.join(docsDir, 'AGENTS.md'));
  fs.copyFileSync(instructionsPath, path.join(docsDir, 'CLAUDE.md'));

  copyDirectory(path.join(CLI_ROOT, 'docs', 'simple'), path.join(docsDir, 'simple'));
  copyDirectory(path.join(CLI_ROOT, 'docs', 'full'), path.join(docsDir, 'full'));

  return docsDir;
}

export async function syncAgentSpecs(): Promise<string> {
  const specsDir = getAgentSpecsDir();
  fs.mkdirSync(specsDir, { recursive: true });
  const { behaviors, rules } = await getCleanedCastleMetadata();
  fs.writeFileSync(
    path.join(specsDir, 'behaviors.yaml'),
    YAML.stringify(behaviors ?? {}, { lineWidth: 120 }),
    'utf8'
  );
  fs.writeFileSync(
    path.join(specsDir, 'rules.yaml'),
    YAML.stringify(rules ?? {}, { lineWidth: 120 }),
    'utf8'
  );
  return specsDir;
}

export function writeSharedAgentSpecs(behaviorsYaml: string, rulesYaml: string): string {
  const specsDir = getAgentSpecsDir();
  fs.mkdirSync(specsDir, { recursive: true });
  fs.writeFileSync(path.join(specsDir, 'behaviors.yaml'), behaviorsYaml, 'utf8');
  fs.writeFileSync(path.join(specsDir, 'rules.yaml'), rulesYaml, 'utf8');
  return specsDir;
}

function deckInstructions(docsDir: string): string {
  const agentsPath = path.join(docsDir, 'AGENTS.md');
  const behaviorsPath = path.join(getAgentSpecsDir(), 'behaviors.yaml');
  const rulesPath = path.join(getAgentSpecsDir(), 'rules.yaml');
  return `# Castle CLI Deck

This is a Castle CLI deck project.

Read the shared Castle agent instructions first:

${agentsPath}

If that file is missing, run \`castle docs\`, then read it.

Then work in this deck. Start by reading \`deck.json\` and the current Lua script under \`cards/<card-id>/scripts/\`.

Use \`castle serve .\` for local preview, \`castle restart\` after a batch of edits, \`castle logs\` for script errors, and \`castle screenshot <path>\` when visual output matters.

Edit Lua scripts directly. Use \`castle edit\` for structural changes such as blueprints, actors, variables, layout, drawing assets, text settings, and rules. Generated scene YAML and blueprint JSON sidecars are for inspection.

When (and only when) you are about to run \`castle edit\` to add or modify a behavior, trigger, response, condition, or expression, read the relevant spec file at that moment:

- ${behaviorsPath}
- ${rulesPath}

Do not read these at the start of a task or for ordinary script work. Read them only at the moment you are constructing the \`edit\` payload that touches behaviors or rules.
`;
}

export function writeDeckInstructionFiles(deckDir: string, docsDir: string): void {
  const instructions = deckInstructions(docsDir);
  fs.writeFileSync(path.join(deckDir, 'CLAUDE.md'), instructions, 'utf8');
  fs.writeFileSync(path.join(deckDir, 'AGENTS.md'), instructions, 'utf8');
}

export async function docs(): Promise<void> {
  const docsDir = syncAgentDocs();
  const specsDir = await syncAgentSpecs();
  console.log(`Castle reference docs: ${docsDir}`);
  console.log(`Project instructions: ${path.join(docsDir, 'AGENTS.md')}`);
  console.log(`Simple API docs: ${path.join(docsDir, 'simple', 'README.md')}`);
  console.log(`Behavior / rule specs: ${specsDir}`);
}
