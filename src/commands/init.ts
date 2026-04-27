import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
import { applyLocalEdit } from '../utils/edit.js';

interface InitOptions {
  directory?: string;
  title?: string;
  force?: boolean;
}

const STARTER_SCRIPT = `function onCreate()
  print("ready")
end

function onDraw()
  castle.draw.setColor(0.035, 0.055, 0.09, 1)
  castle.draw.rectangle("fill", -0.5, -0.5, 1, 1)

  castle.draw.setColor(0.25, 0.9, 0.62, 1)
  castle.draw.circle("fill", 0, 0, 0.08)
end
`;

function makeId(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
  return Array.from(crypto.randomBytes(12), (byte) => alphabet[byte & 63]).join('');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled-deck';
}

function uniqueDirectory(baseDir: string): string {
  if (!fs.existsSync(baseDir)) return baseDir;
  let index = 2;
  while (fs.existsSync(`${baseDir}-${index}`)) index++;
  return `${baseDir}-${index}`;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeYaml(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, YAML.stringify(value, { lineWidth: 120 }), 'utf8');
}

function assertDirectoryCanBeCreated(directory: string, force: boolean): void {
  if (!fs.existsSync(directory)) return;
  const entries = fs.readdirSync(directory).filter((entry) => entry !== '.DS_Store');
  if (entries.length === 0) return;
  if (!force) {
    throw new Error(`Directory is not empty: ${directory}. Pass --force to replace it.`);
  }
  fs.rmSync(directory, { recursive: true, force: true });
}

export async function init(options: InitOptions = {}): Promise<void> {
  const title = options.title || (options.directory ? path.basename(options.directory) : 'Untitled Deck');
  const directory = path.resolve(options.directory || uniqueDirectory(path.join('decks', slugify(title))));
  const cardId = makeId();
  const cardTitle = title;
  const cardDir = path.join(directory, 'cards', cardId);

  assertDirectoryCanBeCreated(directory, options.force === true);
  fs.mkdirSync(path.join(cardDir, 'scene', 'blueprints'), { recursive: true });
  fs.mkdirSync(path.join(cardDir, 'scripts'), { recursive: true });

  const card = {
    cardId,
    title: cardTitle,
    backgroundColor: '#09101a',
  };

  writeJson(path.join(directory, 'deck.json'), {
    title,
    visibility: 'unlisted',
    variables: [],
    initialCard: card,
    cards: [card],
  });

  writeJson(path.join(cardDir, 'card.json'), {
    ...card,
    sceneProperties: {
      backgroundColor: { r: 0.03529, g: 0.06275, b: 0.10196, a: 1 },
      coordinateSystemVersion: 2,
      clock: {
        tempo: 120,
        beatsPerBar: 4,
        stepsPerBeat: 4,
      },
    },
    actorBlueprintInherit: true,
    linkTargetDeckIds: [],
  });
  writeYaml(path.join(cardDir, 'scene', 'actors.yaml'), {});
  writeYaml(path.join(cardDir, 'scene', 'variables.yaml'), []);

  await applyLocalEdit({
    cardDir,
    cardId,
    args: {
      description: 'initialize starter deck',
      blueprints: {
        'new-main': {
          forkBlueprintId: 'default-blueprint-1',
          title: 'Main',
          replaceDrawing: 'blue square',
          components: `Layout:
  widthScale: 10
  heightScale: 14
Tags:
  tagsString: main starter
Script:
  scriptProperties: []`,
          script: [{ code: STARTER_SCRIPT }],
        },
      },
      actors: {
        a0: {
          title: 'Main',
          components: `Layout:
  x: 0
  y: 0
  widthScale: 10
  heightScale: 14`,
        },
      },
      variables: {},
    },
  });

  console.log(`Created ${path.relative(process.cwd(), directory) || directory}`);
}
