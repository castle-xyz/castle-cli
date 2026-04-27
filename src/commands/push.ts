import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as API from '../api.js';
import { UNLISTED_TEST_CONTENT_FLAGS } from '../utils/publish.js';
import { isProjectCardDir, materializeProjectCard } from '../utils/project.js';

interface PushOptions {
  directory?: string;
}

function makeId(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
  return Array.from(crypto.randomBytes(12), (byte) => alphabet[byte & 63]).join('');
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function uploadSceneData(cardId: string, sceneData: any): Promise<string> {
  const configs = await API.createSceneDataUploadConfig([cardId]);
  if (!configs?.length) throw new Error('Failed to get scene data upload config.');

  const uploadConfig = configs[0];
  const formData = new FormData();
  formData.append('Content-Type', 'application/json');
  for (const [key, value] of Object.entries(uploadConfig.postFields)) {
    formData.append(key, `${value}`);
  }
  formData.append('file', new Blob([JSON.stringify(sceneData)]));

  const response = await fetch(uploadConfig.postUrl, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status >= 300) throw new Error(`Scene data upload failed: HTTP ${response.status}`);
  return uploadConfig.uploadId;
}

export async function push(options: PushOptions = {}): Promise<void> {
  const directory = path.resolve(options.directory || '.');
  const deckJsonPath = path.join(directory, 'deck.json');
  if (!fs.existsSync(deckJsonPath)) throw new Error(`No deck.json found in ${directory}.`);

  const deck = readJson(deckJsonPath);
  const wasNewDeck = !deck.deckId;
  deck.deckId ||= makeId();
  deck.title ||= path.basename(directory);
  deck.visibility = 'unlisted';
  deck.variables ??= [];

  const cards = deck.cards?.length ? deck.cards : deck.initialCard ? [deck.initialCard] : [];
  if (cards.length === 0) throw new Error(`No cards found in ${directory}.`);

  for (let index = 0; index < cards.length; index++) {
    const card = cards[index];
    card.cardId ||= makeId();

    const cardDir = path.join(directory, 'cards', card.cardId);
    if (!isProjectCardDir(cardDir)) {
      throw new Error(`Card ${card.cardId} is not a project-format card.`);
    }

    const cardJsonPath = path.join(cardDir, 'card.json');
    const cardJson = fs.existsSync(cardJsonPath) ? readJson(cardJsonPath) : {};
    cardJson.cardId = card.cardId;
    cardJson.title = card.title || cardJson.title || `Card ${index + 1}`;
    writeJson(cardJsonPath, cardJson);

    const sceneData = await materializeProjectCard(cardDir);
    const uploadId = await uploadSceneData(card.cardId, sceneData);

    const result = await API.updateCardAndDeckV2(
      {
        deckId: deck.deckId,
        title: deck.title,
        visibility: 'unlisted',
        contentFlags: UNLISTED_TEST_CONTENT_FLAGS,
        ...(index === 0 ? { initialCardId: card.cardId } : {}),
      },
      {
        cardId: card.cardId,
        title: card.title || `Card ${index + 1}`,
        blocks: [],
        uploadId,
        makeInitialCard: index === 0,
      }
    );

    if (result.deck.deckId !== deck.deckId) {
      throw new Error(`Server returned unexpected deck id ${result.deck.deckId}; expected ${deck.deckId}.`);
    }
    if (result.card.cardId !== card.cardId) {
      throw new Error(`Server returned unexpected card id ${result.card.cardId}; expected ${card.cardId}.`);
    }

    card.sceneDataUrl = undefined;
    if (index === 0) deck.initialCard = card;
    console.log(`Pushed card ${card.cardId}.`);
  }

  deck.cards = cards;
  writeJson(deckJsonPath, deck);
  console.log(`${wasNewDeck ? 'Created' : 'Updated'} unlisted deck: https://castle.xyz/d/${deck.deckId}`);
}
