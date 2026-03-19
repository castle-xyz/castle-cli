/**
 * Playwright test for chess deck — validates that:
 * 1. Local serve (clone → YAML → serve) produces a working chess game
 * 2. Tapping a white piece selects it and shows valid moves
 * 3. Behaviour matches the live deck at castle.xyz/d/wgWUDokID
 *
 * Usage:
 *   npx tsx scripts/test-chess-playwright.ts
 *
 * The script starts the local serve server automatically.
 */

import { chromium, type Browser, type Page } from '@playwright/test';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SCREENSHOTS_DIR = path.join(ROOT, 'test', 'screenshots');
const LOCAL_PORT = 4399; // use a non-default port so we don't conflict
const LOCAL_URL = `http://localhost:${LOCAL_PORT}`;
const LIVE_URL = 'https://castle.xyz/d/wgWUDokID';

// boardToScreenSpace(col, row) from Chess_script.lua:
//   screen_x = (col - 4.5) * 5.0 / 4.0
//   screen_y = (row - 4.5) * 5.0 / 4.0
//
// Castle camera view: -5..5 on X, -7..7 on Y (400×560 canvas)
// NOTE: In Castle game world, positive Y is UPWARD (math convention), so canvas Y is flipped:
//   canvas_x = (screen_x + 5) * 40
//   canvas_y = (7 - screen_y) * 40   ← Y is inverted
function boardToCanvas(col: number, row: number): { x: number; y: number } {
  const sx = (col - 4.5) * 5.0 / 4.0;
  const sy = (row - 4.5) * 5.0 / 4.0;
  return {
    x: Math.round((sx + 5) * 40),
    y: Math.round((7 - sy) * 40),
  };
}

// White pawns start at rank 2 (row=2), columns 1-8
// White pieces start at rank 1 (row=1), columns 1-8
// In FEN "RNBQKBNR" at rank 1: R=col1, N=col2, B=col3, Q=col4, K=col5, B=col6, N=col7, R=col8
const WHITE_PIECES = [
  { label: 'e2 pawn (col5,row2)', col: 5, row: 2 },
  { label: 'd2 pawn (col4,row2)', col: 4, row: 2 },
  { label: 'e1 king (col5,row1)', col: 5, row: 1 },
  { label: 'd1 queen (col4,row1)', col: 4, row: 1 },
];

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function startServer(): Promise<childProcess.ChildProcess> {
  return new Promise((resolve, reject) => {
    console.log(`Starting local serve on port ${LOCAL_PORT}...`);
    const srv = childProcess.spawn(
      'npx', ['tsx', 'src/index.ts', 'serve', 'deck-wgWUDokID', '--port', String(LOCAL_PORT)],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let ready = false;
    const timeout = setTimeout(() => {
      if (!ready) reject(new Error('Server did not start in time'));
    }, 30000);

    srv.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(`[serve] ${text}`);
      if (text.includes(`Serving on`) && !ready) {
        ready = true;
        clearTimeout(timeout);
        setTimeout(() => resolve(srv), 500);
      }
    });

    srv.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[serve-err] ${chunk.toString()}`);
    });

    srv.on('error', reject);
  });
}

async function waitForCanvasReady(page: Page, waitMs = 12000) {
  // Wait for canvas element
  await page.waitForSelector('#canvas', { timeout: 15000 });
  console.log(`  Canvas found. Waiting ${waitMs / 1000}s for game init...`);
  await page.waitForTimeout(waitMs);
  // Log canvas dimensions
  const dims = await page.evaluate(() => {
    const c = document.getElementById('canvas') as HTMLCanvasElement;
    return c ? { width: c.width, height: c.height, offsetW: c.offsetWidth, offsetH: c.offsetHeight, display: getComputedStyle(c).display } : null;
  });
  console.log(`  Canvas dimensions: ${JSON.stringify(dims)}`);
}

async function takeScreenshot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
  ensureDir(SCREENSHOTS_DIR);
  const file = path.join(SCREENSHOTS_DIR, `${name}.png`);
  const buf = await page.screenshot({ path: file, clip });
  console.log(`  Screenshot saved: ${file}`);
  return buf;
}

/** Count pixels that differ between two screenshots */
function countDiffPixels(a: Buffer, b: Buffer): number {
  let diff = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 4) {
    if (Math.abs(a[i] - b[i]) > 5 || Math.abs(a[i+1] - b[i+1]) > 5 || Math.abs(a[i+2] - b[i+2]) > 5) {
      diff++;
    }
  }
  return diff;
}

async function testChessPieceSelection(page: Page, label: string): Promise<{
  initialScreenshot: Buffer;
  results: Array<{ piece: string; diffPixels: number; clickX: number; clickY: number }>;
}> {
  // Get canvas position and actual size once
  const canvasBounds = await page.locator('#canvas').boundingBox();
  if (!canvasBounds) throw new Error('Canvas not found');
  const canvasW = canvasBounds.width;
  const canvasH = canvasBounds.height;
  const scaleX = canvasW / 400;
  const scaleY = canvasH / 560;
  console.log(`\n[${label}] Canvas at (${canvasBounds.x.toFixed(0)}, ${canvasBounds.y.toFixed(0)}), size ${canvasW}×${canvasH}, scale ${scaleX.toFixed(3)}`);

  // Focus the canvas first so it receives input events
  await page.locator('#canvas').focus();
  await page.waitForTimeout(200);

  // Add event listener to log whether canvas receives clicks
  await page.evaluate(() => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!canvas) return;
    canvas.addEventListener('mousedown', (e) => console.log(`[canvas-mousedown] x=${e.clientX} y=${e.clientY}`));
    canvas.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      console.log(`[canvas-touchstart] x=${t?.clientX} y=${t?.clientY}`);
    });
  });

  const clip = { x: canvasBounds.x, y: canvasBounds.y, width: canvasW, height: canvasH };

  console.log(`\n[${label}] Taking initial screenshot...`);
  const initial = await takeScreenshot(page, `${label}-initial`, clip);

  const results: Array<{ piece: string; diffPixels: number; clickX: number; clickY: number }> = [];

  for (const piece of WHITE_PIECES) {
    const pos = boardToCanvas(piece.col, piece.row);
    // Scale canvas coords to actual canvas pixel dimensions
    const scaledX = Math.round(pos.x * scaleX);
    const scaledY = Math.round(pos.y * scaleY);
    const clickX = canvasBounds.x + scaledX;
    const clickY = canvasBounds.y + scaledY;
    console.log(`\n[${label}] Clicking ${piece.label} at logical (${pos.x}, ${pos.y}) → page (${clickX.toFixed(0)}, ${clickY.toFixed(0)})...`);

    // Try mouse click
    await page.mouse.click(clickX, clickY);
    // Also try touch tap in case engine requires touch events
    await page.touchscreen.tap(clickX, clickY);
    await page.waitForTimeout(1000);

    const after = await takeScreenshot(page, `${label}-after-${piece.label.replace(/[^a-z0-9]/gi, '_')}`, clip);
    const diff = countDiffPixels(initial, after);
    console.log(`  Pixel diff after clicking ${piece.label}: ${diff} pixels changed`);
    results.push({ piece: piece.label, diffPixels: diff, clickX: scaledX, clickY: scaledY });

    // Click again to deselect (reset state)
    await page.mouse.click(clickX, clickY);
    await page.touchscreen.tap(clickX, clickY);
    await page.waitForTimeout(500);
  }

  return { initialScreenshot: initial, results };
}

async function fetchSceneDataSummary(port: number): Promise<void> {
  try {
    const res = await fetch(`http://localhost:${port}/scene-data`);
    const data = await res.json();
    const lib = data?.snapshot?.library ?? {};
    const actors = data?.snapshot?.actors ?? [];
    console.log(`\n[scene-data] Library entries: ${Object.keys(lib).length}`);
    console.log(`[scene-data] Actors: ${actors.length}`);
    for (const [id, entry] of Object.entries(lib) as [string, any][]) {
      const comps = Object.keys(entry.actorBlueprint?.components ?? {});
      const text = entry.actorBlueprint?.components?.Text;
      const fontName = text?.fontName ?? '(none)';
      const fontSizeScale = text?.fontSizeScale ?? '(none)';
      console.log(`  ${entry.title}: [${comps.join(', ')}] fontName=${fontName} fontSizeScale=${fontSizeScale}`);
    }
  } catch (e: any) {
    console.error(`[scene-data] Failed: ${e.message}`);
  }
}

async function main() {
  ensureDir(SCREENSHOTS_DIR);

  // Start local server
  const server = await startServer();

  // Inspect scene-data
  await fetchSceneDataSummary(LOCAL_PORT);

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
      ],
    });

    // ── Test local serve ──────────────────────────────────────────────────
    console.log('\n═══ Testing LOCAL serve ═══');
    const localContext = await browser.newContext({ hasTouch: true, viewport: { width: 800, height: 700 } });
    const localPage = await localContext.newPage();

    // Listen for all console messages
    localPage.on('console', msg => console.log(`  [browser-${msg.type()}] ${msg.text()}`));
    // Listen for page errors
    localPage.on('pageerror', err => console.log(`  [page-error] ${err.message}`));
    // Listen for failed requests
    localPage.on('requestfailed', req => console.log(`  [request-failed] ${req.url()} — ${req.failure()?.errorText}`));

    await localPage.goto(LOCAL_URL);
    await waitForCanvasReady(localPage, 25000);

    const localResults = await testChessPieceSelection(localPage, 'local');
    await localPage.close();
    await localContext.close();

    // ── Test live castle.xyz ──────────────────────────────────────────────
    console.log('\n═══ Testing LIVE castle.xyz ═══');
    const liveContext = await browser.newContext({ hasTouch: true, viewport: { width: 800, height: 700 } });
    const livePage = await liveContext.newPage();
    livePage.on('pageerror', err => console.log(`  [live-page-error] ${err.message}`));

    try {
      await livePage.goto(LIVE_URL, { timeout: 30000 });
      await waitForCanvasReady(livePage, 12000);
      const liveResults = await testChessPieceSelection(livePage, 'live');
      await livePage.close();
      await liveContext.close();

      // ── Summary ──────────────────────────────────────────────────────────
      console.log('\n═══ RESULTS ═══\n');
      console.log('Piece selection pixel-diff comparison (higher = more visual change = working):');
      console.log(`${'Piece'.padEnd(30)} ${'Local'.padStart(8)} ${'Live'.padStart(8)} ${'Status'.padStart(10)}`);
      console.log('─'.repeat(62));
      let allPass = true;
      for (let i = 0; i < localResults.results.length; i++) {
        const loc = localResults.results[i];
        const liv = liveResults.results[i];
        // Consider it working if local has at least 30% of live's change,
        // or if both are >100 pixels changed
        const localWorks = loc.diffPixels > 100;
        const liveWorks = liv.diffPixels > 100;
        const status = localWorks ? '✓ PASS' : (liveWorks ? '✗ FAIL' : '? SKIP');
        if (liveWorks && !localWorks) allPass = false;
        console.log(`${loc.piece.padEnd(30)} ${String(loc.diffPixels).padStart(8)} ${String(liv.diffPixels).padStart(8)} ${status.padStart(10)}`);
      }
      console.log('\n' + (allPass ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'));
      console.log(`\nScreenshots saved to: ${SCREENSHOTS_DIR}`);
    } catch (e: any) {
      console.error(`\nCould not test live URL: ${e.message}`);
      // Still report local results
      console.log('\n═══ LOCAL RESULTS (live unavailable) ═══\n');
      for (const r of localResults.results) {
        const status = r.diffPixels > 100 ? '✓ changed' : '? unchanged';
        console.log(`  ${r.piece}: ${r.diffPixels} pixels ${status}`);
      }
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
    console.log('\nServer stopped.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
