import * as fs from 'fs';
import * as path from 'path';
import * as API from '../api.js';
import { writeProjectCardFromSceneData } from '../utils/project.js';

interface GetDeckOptions {
  output?: string;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function getDeck(deckId: string, options: GetDeckOptions = {}): Promise<void> {
  if (!deckId) {
    throw new Error('Usage: castle get-deck <deck-id> [dir]');
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
    console.log(`getting ${card.cardId}...`);
    const sceneData = await API.downloadSceneData(card.sceneDataUrl);
    await writeProjectCardFromSceneData({
      deckId: deck.deckId,
      card,
      cardDir: path.join(deckDir, 'cards', card.cardId),
      sceneData,
    });
  }

  console.log(`Got ${deck.deckId} into ${path.relative(process.cwd(), deckDir) || deckDir}`);
}
