import * as fs from 'fs';
import * as path from 'path';
import * as API from '../api.js';

export async function setCardPreviewImageFromPng(cardId: string, pngPath: string): Promise<{ fileId: string; url?: string }> {
  const base64 = fs.readFileSync(pngPath).toString('base64');
  const file = await API.uploadBase64(base64, path.basename(pngPath) || 'preview.png');
  await API.updateCardCustomBackgroundImage(cardId, file.fileId);
  return file;
}
