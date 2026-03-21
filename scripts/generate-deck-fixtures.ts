/**
 * Generate fixture files for clone-serve round-trip tests.
 *
 * Usage (requires auth token):
 *   npx tsx scripts/generate-deck-fixtures.ts
 *
 * Writes one JSON file per deck to test/fixtures/decks/{deckId}.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import Axios from 'axios';
import * as API from '../src/utils/api.js';
import { initMetadata } from '../src/utils/init.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const DECK_IDS = [
  'wgWUDokID',
  'gd3jXo47K',
  'xC9lPlw1Kb',
  'EOX6tnIp8',
  'w8fShMaeQ',
  'WY7uBXUg1',
  'muLTlZhzj',
  'S_JJjMxpt',
  'co9NPFpbS',
  '1J_AMd_oX',
  'FWpL3FAIQ',
  'XijCjhwKi',
  'hJAjFJJRoxjN',
  // @pirate
  '4wPooZTiuU-r',
  'BZwhTln7MU',
  'XBtz4pJ5IX',
  'voqIgsAKnI',
  'HXOzHd4nC',
  't6zro4RpR',
  'WRzgVsm_r',
  'dK7rO4Wpn',
  'tyg1BQ1tQ',
  'xFg_-wWKq',
  'JrRdVJFps',
  'pe9Vu1IiQ',
  'oyVfNUkIC',
  'KqlIzW6uQ',
  'scwoHXj9153b',
];

const FIXTURES_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'decks');

async function main() {
  await initMetadata();

  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  for (const deckId of DECK_IDS) {
    const fixturePath = path.join(FIXTURES_DIR, `${deckId}.json`);
    if (fs.existsSync(fixturePath)) {
      console.log(`Skipping deck ${deckId} (already downloaded)`);
      continue;
    }

    console.log(`Fetching deck ${deckId}...`);

    let deck: any;
    try {
      deck = await API.deck(deckId);
    } catch (e) {
      console.error(`  Failed to fetch deck ${deckId}: ${e}`);
      continue;
    }

    if (!deck) {
      console.error(`  Deck ${deckId} not found`);
      continue;
    }

    const cards: any[] = [];
    for (const card of deck.cards) {
      console.log(`  Fetching scene data for card ${card.cardId}...`);
      let sceneData: any;
      try {
        const response = await Axios.get(card.sceneDataUrl);
        sceneData = response.data;
      } catch (e) {
        console.error(`  Failed to fetch scene data for card ${card.cardId}: ${e}`);
        continue;
      }

      cards.push({
        cardId: card.cardId,
        sceneDataUrl: card.sceneDataUrl,
        snapshot: sceneData.snapshot,
      });
    }

    const fixture = {
      deckId,
      initialCard: deck.initialCard,
      cards,
    };

    fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));
    console.log(`  Saved ${fixturePath}`);
  }

  console.log('Done!');
}

main().catch(console.error);
