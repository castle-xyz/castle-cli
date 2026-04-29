import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as API from '../api.js';
import { UNLISTED_TEST_CONTENT_FLAGS } from '../utils/publish.js';
import { isProjectCardDir, materializeProjectCard } from '../utils/project.js';
import { setCardPreviewImageFromPng } from '../utils/preview.js';
import { sendToServe } from '../utils/serveClient.js';

interface PushOptions {
  directory?: string;
}

const SCREENSHOT_COMMAND_TIMEOUT_MS = 75_000;

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

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function trySetInitialPreviewFromServe(directory: string, cardId: string): Promise<{ path: string; fileId: string } | null> {
  const status = await sendToServe({ command: 'status' }, 5000);
  if (status.error) throw new Error(status.error);
  if (status.mode !== 'serve') throw new Error('active CLI server is not local serve');
  if (!status.directory || !samePath(status.directory, directory)) {
    return null;
  }
  if (status.initialCardId && status.initialCardId !== cardId) {
    throw new Error(`local serve initial card is ${status.initialCardId}, expected ${cardId}`);
  }
  if (typeof status.readyPreviewClients === 'number' && status.readyPreviewClients < 1) {
    return null;
  }

  const result = await sendToServe({ command: 'screenshot' }, SCREENSHOT_COMMAND_TIMEOUT_MS);
  if (result.error) throw new Error(result.error);
  if (!result.path) throw new Error('serve screenshot response did not include a path');

  const file = await setCardPreviewImageFromPng(cardId, result.path);
  return { path: result.path, fileId: file.fileId };
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
  for (const card of cards) card.cardId ||= makeId();

  if (wasNewDeck) {
    try {
      const preview = await trySetInitialPreviewFromServe(directory, cards[0].cardId);
      if (preview) {
        console.log(`Captured initial preview image: ${preview.path}`);
        console.log(`Prepared preview image for card ${cards[0].cardId}: ${preview.fileId}`);
      } else {
        console.warn('Initial preview image not set automatically: no matching ready local serve browser preview.');
        console.warn('Run `npx tsx src/index.ts save-preview-image` after opening this deck in local serve to set a cover.');
      }
    } catch (error) {
      console.warn(`Initial preview image not set automatically: ${errorMessage(error)}.`);
      console.warn('Run `npx tsx src/index.ts save-preview-image` after opening this deck in local serve to set a cover.');
    }
  }

  for (let index = 0; index < cards.length; index++) {
    const card = cards[index];

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
