# Testing & Debugging Reference

## Shell tips for commands

Use `echo >>` to append commands and `tail -1` to check the response:

```bash
echo '{"type": "screenshot"}' >> .castle/commands.json
sleep 1 && tail -1 .castle/commands.json
```

Commands complete within 1 second. **Never sleep more than 1 second** — check `tail -1` and retry if the response isn't there yet.

## Command IDs

Add an `id` field to any command to identify its response later:
```
{"type": "screenshot", "id": "after-fix"}
```
The CLI preserves the `id` in the response line:
```bash
grep '"after-fix"' .castle/commands.json
```

## Screenshot history

Timestamped screenshots (e.g. `2026-02-22T20-58-47_some-label.png`) are kept in `.castle/screenshots/` — the last 100 are retained. Use a label in `castle.cliScreenshot("after-spawn")` to identify specific screenshots. Rate limited to once per second.

## Web browser — Playwright automation

`castle serve` starts a web player at `http://localhost:4321/` (default port; use whatever port was passed to `--port`) with automatic hot-reload (file changes → browser reloads within ~1 second, no device needed). Use Playwright to automate browser interactions.

Write a `.ts` script and run it with:
```bash
npx tsx ./test.ts
```

Example script:
```typescript
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: false, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 500, height: 650 } });
page.on('console', msg => console.log(msg.text()));
page.on('pageerror', e => console.error(e.message));
await page.goto('http://localhost:4321/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(10000);  // wait for game to render; adjust as needed
await page.screenshot({ path: '.castle/screenshots/playwright.png' });
await browser.close();
```

**Clicking at a world position:** The game canvas is `#canvas`. To click at actor coordinates (x, y) from `actors.yaml` (positive Y = downward, range -5..5 on X, -7..7 on Y):
```typescript
const bounds = await page.locator('#canvas').boundingBox();
const clickX = bounds.x + (worldX + 5) / 10 * bounds.width;
const clickY = bounds.y + (worldY + 7) / 14 * bounds.height;
await page.mouse.click(clickX, clickY);
```

## Mobile app

Requires the Castle mobile app open and connected. After edits, run `stopAndPlay`, then use the `screenshot` command or `castle.cliScreenshot("label")` in Lua. Screenshots saved to `.castle/screenshots/latest.png`.

## Which to use

- Default to the web browser — faster, no device needed.
- Switch to mobile for touch interactions, physics feel, or final validation on a real device.
