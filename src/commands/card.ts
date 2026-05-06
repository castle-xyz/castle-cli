import * as fs from 'fs';
import * as path from 'path';
import { createStarterCard, makeId, writeJson } from './init.js';

interface CardAddOptions {
  directory?: string;
  title?: string;
}

interface CardRemoveOptions {
  directory?: string;
  cardId?: string;
  force?: boolean;
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function projectDeckPath(directory?: string): string {
  const deckDir = path.resolve(directory || '.');
  const deckJsonPath = path.join(deckDir, 'deck.json');
  if (!fs.existsSync(deckJsonPath)) throw new Error(`No deck.json found in ${deckDir}.`);
  return deckJsonPath;
}

function nextCardTitle(deck: any): string {
  const index = Array.isArray(deck.cards) ? deck.cards.length + 1 : 1;
  return `Card ${index}`;
}

export async function cardAdd(options: CardAddOptions = {}): Promise<void> {
  const deckJsonPath = projectDeckPath(options.directory);
  const deckDir = path.dirname(deckJsonPath);
  const deck = readJson(deckJsonPath);

  deck.cards = Array.isArray(deck.cards) ? deck.cards : deck.initialCard ? [deck.initialCard] : [];
  const card = {
    cardId: makeId(),
    title: options.title || nextCardTitle(deck),
    backgroundColor: '#09101a',
  };

  deck.cards.push(card);
  deck.initialCard ??= card;
  writeJson(deckJsonPath, deck);
  await createStarterCard(deckDir, card);

  console.log(`Added card ${card.cardId}: ${card.title}`);
}

export async function cardRemove(options: CardRemoveOptions): Promise<void> {
  if (!options.cardId) throw new Error('Usage: castle remove-card <card-id> [deck-dir] --force');
  if (!options.force) {
    throw new Error(`Refusing to remove card ${options.cardId} without --force.`);
  }

  const deckJsonPath = projectDeckPath(options.directory);
  const deckDir = path.dirname(deckJsonPath);
  const deck = readJson(deckJsonPath);
  deck.cards = Array.isArray(deck.cards) ? deck.cards : deck.initialCard ? [deck.initialCard] : [];

  const index = deck.cards.findIndex((card: any) => card?.cardId === options.cardId);
  if (index < 0) throw new Error(`Card ${options.cardId} is not listed in deck.json.`);
  if (deck.cards.length <= 1) throw new Error('Cannot remove the only card in a deck.');

  const [removed] = deck.cards.splice(index, 1);
  if (deck.initialCard?.cardId === options.cardId) {
    deck.initialCard = deck.cards[0];
  }

  const cardDir = path.join(deckDir, 'cards', options.cardId);
  fs.rmSync(cardDir, { recursive: true, force: true });
  writeJson(deckJsonPath, deck);

  console.log(`Removed card ${options.cardId}: ${removed?.title || '(untitled)'}`);
}
