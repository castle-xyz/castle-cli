import * as API from '../api.js';

interface ListOptions {
  limit?: number;
  json?: boolean;
}

const DEFAULT_LIMIT = 20;

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('--limit must be a positive integer');
  }
  return limit;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatDate(value: string | undefined): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function oneLine(value: string | undefined, maxLength: number): string {
  const line = (value || '').replace(/\s+/g, ' ').trim();
  if (line.length <= maxLength) return line;
  return `${line.slice(0, Math.max(0, maxLength - 3))}...`;
}

function toListedDeck(deck: any) {
  const cards = Array.isArray(deck.cards) ? deck.cards : [];
  return {
    deckId: deck.deckId,
    title: deck.title || '(untitled)',
    visibility: deck.visibility,
    caption: deck.caption || '',
    lastModified: deck.lastModified,
    playCount: deck.playCount ?? 0,
    playTime: deck.playTime ?? 0,
    cardCount: cards.length,
    initialCardId: deck.initialCard?.cardId,
    initialCardTitle: deck.initialCard?.title || '',
    initialCardImageUrl: deck.initialCard?.backgroundImage?.url,
  };
}

function printText(decks: ReturnType<typeof toListedDeck>[]): void {
  if (decks.length === 0) {
    console.log('No decks found.');
    return;
  }

  for (let i = 0; i < decks.length; i++) {
    const deck = decks[i];
    console.log(`${i + 1}. ${deck.title}`);
    console.log(
      `   deck: ${deck.deckId} | ${deck.visibility} | ${pluralize(deck.cardCount, 'card')} | updated ${formatDate(deck.lastModified)} | ${pluralize(deck.playCount, 'play')}`
    );
    if (deck.caption) {
      console.log(`   ${oneLine(deck.caption, 120)}`);
    }
  }
}

export async function listDecks(userId: string, options: ListOptions = {}): Promise<void> {
  const limit = normalizeLimit(options.limit);
  const decks = (await API.decksForUser(userId, { limit })).map(toListedDeck);

  if (options.json) {
    console.log(JSON.stringify({ decks }, null, 2));
  } else {
    printText(decks);
  }
}
