import { chromium } from '@playwright/test';
import * as path from 'path';
import * as url from 'url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

async function testUrl(urlStr: string, label: string, waitMs = 15000) {
  const browser = await chromium.launch({
    headless: false,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 500, height: 650 } });
  const logs: string[] = [];
  page.on('console', msg => {
    const t = msg.text();
    if (!t.includes('ReadPixels') && !t.includes('GroupMarker') && !t.includes('deprecated')) {
      logs.push(`[${msg.type()}] ${t.slice(0, 200)}`);
    }
  });
  page.on('pageerror', e => logs.push(`[error] ${e.message}`));

  await page.goto(urlStr, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: path.join(__dirname, `../test/screenshots/${label}.png`) });
  console.log(`\n=== ${label} (${urlStr}) ===`);
  console.log('Logs:', logs.join('\n') || 'none');
  await browser.close();
}

async function main() {
  await testUrl('http://localhost:4321/', 'local-mario');
  await testUrl('https://castle.xyz/d/wgWUDokID', 'live-chess', 20000);
}

main().catch(console.error);
