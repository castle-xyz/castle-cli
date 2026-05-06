import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getConfigDir } from '../config.js';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function getAgentDocsDir(): string {
  return path.join(getConfigDir(), 'docs');
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

function deckInstructions(docsDir: string): string {
  const agentsPath = path.join(docsDir, 'AGENTS.md');
  return `# Castle CLI Deck

This is a Castle CLI deck project.

Read the shared Castle agent instructions first:

${agentsPath}

If that file is missing, run \`castle docs\`, then read it.

Then work in this deck. Start by reading \`deck.json\` and the current Lua script under \`cards/<card-id>/scripts/\`.

Use \`castle serve .\` for local preview, \`castle restart\` after a batch of edits, \`castle logs\` for script errors, and \`castle screenshot <path>\` when visual output matters.

Edit Lua scripts directly. Use \`castle edit\` for structural changes such as blueprints, actors, variables, layout, drawing assets, text settings, and rules. Generated scene YAML and blueprint JSON sidecars are for inspection.
`;
}

export function writeDeckInstructionFiles(deckDir: string, docsDir: string): void {
  const instructions = deckInstructions(docsDir);
  fs.writeFileSync(path.join(deckDir, 'CLAUDE.md'), instructions, 'utf8');
  fs.writeFileSync(path.join(deckDir, 'AGENTS.md'), instructions, 'utf8');
}

export async function docs(): Promise<void> {
  const docsDir = syncAgentDocs();
  console.log(`Castle agent docs: ${docsDir}`);
  console.log(`Ask your agent to read: ${path.join(docsDir, 'AGENTS.md')}`);
}
