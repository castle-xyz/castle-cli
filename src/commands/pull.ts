import * as fs from 'fs';
import * as path from 'path';
import * as API from '../api.js';
import { writeProjectCardFromSceneData } from '../utils/project.js';

interface PullOptions {
  output?: string;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function pull(deckId: string, options: PullOptions = {}): Promise<void> {
  if (!deckId) {
    throw new Error('Usage: castle pull <deck-id> [dir]');
  }

  const deck = await API.deck(deckId);
  if (!deck) {
    throw new Error(`Deck not found: ${deckId}`);
  }

  const deckDir = path.resolve(options.output || path.join('decks', deck.deckId));
  fs.mkdirSync(deckDir, { recursive: true });

  const cards = deck.cards?.length ? deck.cards : deck.initialCard ? [deck.initialCard] : [];
  writeJson(path.join(deckDir, 'deck.json'), {
    deckId: deck.deckId,
    title: deck.title ?? '',
    visibility: deck.visibility,
    variables: deck.variables ?? [],
    initialCard: deck.initialCard,
    cards,
  });

  for (const card of cards) {
    if (!card.cardId || !card.sceneDataUrl) continue;
    console.log(`pulling ${card.cardId}...`);
    const sceneData = await API.downloadSceneData(card.sceneDataUrl);
    await writeProjectCardFromSceneData({
      deckId: deck.deckId,
      card,
      cardDir: path.join(deckDir, 'cards', card.cardId),
      sceneData,
    });
  }

  console.log(`Pulled ${deck.deckId} to ${path.relative(process.cwd(), deckDir) || deckDir}`);
}

