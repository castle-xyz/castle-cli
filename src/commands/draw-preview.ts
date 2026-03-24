import * as fs from 'fs';
import * as path from 'path';
import { renderDrawDataPng } from '../utils/castle-core-node.js';

export interface DrawPreviewOptions {
  output?: string;
  frame?: string;
  size?: string;
}

export async function drawPreview(drawJsonPath: string, options: DrawPreviewOptions = {}) {
  const resolvedDrawJson = path.resolve(drawJsonPath);
  if (!fs.existsSync(resolvedDrawJson)) {
    console.error(`File not found: ${resolvedDrawJson}`);
    process.exit(1);
  }

  let drawJsonContent: any;
  try {
    drawJsonContent = JSON.parse(fs.readFileSync(resolvedDrawJson, 'utf-8'));
  } catch (e: any) {
    console.error(`Failed to parse draw.json: ${e?.message ?? e}`);
    process.exit(1);
  }

  const drawing2 = drawJsonContent.Drawing2;
  if (!drawing2?.drawData) {
    console.error('draw.json does not contain a Drawing2.drawData field');
    process.exit(1);
  }

  const frameIdx = options.frame !== undefined ? parseInt(options.frame, 10) : 0;
  const size = options.size !== undefined ? parseInt(options.size, 10) : 256;

  let outputPath: string;
  if (options.output) {
    outputPath = path.resolve(options.output);
  } else {
    outputPath = resolvedDrawJson.replace(/\.draw\.json$/, '.preview.png');
  }

  try {
    const base64Png = await renderDrawDataPng(drawing2, frameIdx, size);
    fs.writeFileSync(outputPath, Buffer.from(base64Png, 'base64'));
    console.log(`Written: ${outputPath}`);
  } catch (e: any) {
    console.error(`Rendering failed: ${e?.message ?? e}`);
    process.exit(1);
  }
}
