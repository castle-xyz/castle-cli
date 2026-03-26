
For the full list of available behaviors, triggers, responses, and conditions, read **`.castle/BEHAVIORS.md`** — consult it when writing rules YAML or setting behavior properties.

---

## Working Style

Make changes quickly and iterate. Don't overthink or plan extensively — just make the edit, see the result, and adjust. Small fast changes are much better than one big carefully-planned change. The user can see the result on their device in real time, so bias toward action over analysis.

## Logs & Screenshots

`.castle/logs.txt` contains live logs from both the CLI and the deck. Lines prefixed `[CLI]` are from the bridge itself. Lines prefixed `[Deck]` are from Lua scripts running on the device (via `print()` in scripts). Use `.castle/logs.txt` to check for errors and debug issues — read it after making changes to see if scripts are working. When adding `print()` calls for debugging, clean them up once the issue is resolved to avoid log spam.

You can capture screenshots from Lua scripts by calling `castle.cliScreenshot("some-label")`. You can also request screenshots via the `screenshot` command in `.castle/commands.json`. Both methods save images to `.castle/screenshots/`.

**`.castle/screenshots/latest.png`** is always overwritten with the most recent screenshot from any source. Read this file whenever you want to see what the game currently looks like.

Timestamped files (e.g., `2026-02-22T20-58-47_some-label.png`) are kept as history — the last 100 are retained. Use the label/suffix in `castle.cliScreenshot("after-spawn")` to identify specific screenshots in the history. Rate limited to once per second.

## Commands

Write commands to `.castle/commands.json` to control the deck. The file uses JSONL format (one JSON object per line). The CLI polls this file, processes any lines that don't have a `response` field, and writes back the response on the same line.

Example — append commands:
```
{"type": "stopAndPlay"}
{"type": "screenshot"}
```

After the CLI processes them, the file becomes:
```
{"type": "stopAndPlay", "response": {"doneAt": "..."}}
{"type": "screenshot", "response": {"doneAt": "...", "file": ".castle/screenshots/003.png"}}
```

Check the `response` field to see if a command completed and get results (e.g., the screenshot file path).

Available commands:

- **`screenshot`**: Captures a screenshot of the running deck. Response includes `file` with the path to the saved image. Also saved to `.castle/screenshots/latest.png`.
- **`stopAndPlay`**: Stops the deck and plays it again. **Run this after every edit** so the user sees the change. File changes are always applied before this command runs.


Note: after `stopAndPlay`, the deck needs a moment to start and render. If you need the scene to settle (physics, animations), take the screenshot a bit later as a separate command write.

**Agentic workflow:** After every edit, run `stopAndPlay` so the user sees the change. Take a `screenshot` only when you need to verify something visual or debug an issue — not after every edit. Check `.castle/logs.txt` for errors when things aren't working.

### Command IDs

You can add an `id` field to any command to identify its response later:
```
{"type": "screenshot", "id": "after-fix"}
```
The CLI preserves the `id` in the response line. Use `grep` to find it:
```bash
grep '"after-fix"' .castle/commands.json
```

### Shell tips

Use `echo >>` to append commands and `tail` to read responses:

```bash
# Request a screenshot then check response
echo '{"type": "screenshot"}' >> .castle/commands.json
sleep 1 && tail -1 .castle/commands.json

# Restart then screenshot
echo '{"type": "stopAndPlay"}' >> .castle/commands.json
sleep 1
echo '{"type": "screenshot"}' >> .castle/commands.json
sleep 1 && tail -1 .castle/commands.json
```

The CLI writes back a `response` field on each line once processed. Commands typically complete within 1 second. **Never sleep more than 1 second** — if you need to wait, just check `tail -1` and retry if the response isn't there yet. Don't add unnecessary sleeps between steps; the system processes commands quickly.

---

## Testing

Two approaches for seeing game output:

**Web browser (fastest — use this by default):**
- `castle serve` starts a web player at `http://localhost:4321/` with automatic hot-reload.
- File changes → browser reloads within ~1 second. No device needed.
- Use Playwright to automate: launch headlessly, wait for render, screenshot.

```typescript
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: false, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 500, height: 650 } });
page.on('console', msg => console.log(msg.text()));
page.on('pageerror', e => console.error(e.message));
await page.goto('http://localhost:4321/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(10000);  // wait for game to render; adjust as needed
await page.screenshot({ path: 'test/screenshots/game.png' });
await browser.close();
```

**Mobile app (use for touch, physics feel, or final validation):**
- Requires the Castle mobile app open and connected (state syncs via WebSocket).
- After every edit run `stopAndPlay` (see Commands section above), then use `screenshot` command or `castle.cliScreenshot("label")` in Lua.
- Screenshots saved to `.castle/screenshots/latest.png`.

**Which to use:**
- Default to the web browser approach — it is faster and requires no device.
- Switch to mobile only when testing touch interactions, physics feel, or doing final validation on a real device.

---

## Scripting vs. Rules

Prefer Lua scripts for game logic. Scripts are easier to read, edit, and debug as files. Use rules only when you need access to engine APIs that aren't available in scripts yet (e.g. create actor, show leaderboard, play sound). When in doubt, use a script.

<!-- ADMIN_ONLY_START -->
IMPORTANT: When creating blueprints that use the draw API (`onDraw`), you must set `visible: true` on the Layout behavior. New blueprints forked from the Empty default may have visibility off, which prevents `onDraw` from being called.
<!-- ADMIN_ONLY_END -->

---

## CLI File System

This project is synced from a Castle deck via a CLI bridge. The files on disk mirror the scene state. You can read and edit these files to make changes to the deck.

### File structure

```
deck-{deckId}/                   # Deck root
  AGENTS.md                      # This file — agent instructions (read-only)
  deck.yaml                      # Deck metadata
  .castle/                       # Deck-level runtime state
    logs.txt                     # CLI and deck logs
    commands.json                # Write commands here (screenshot, stopAndPlay, etc.)
    screenshots/
      latest.png                 # Most recent screenshot
      001.png ...                # Rolling screenshot history
  card-{cardId}/                 # Card subdirectory (one per card in the deck)
    card.yaml                    # Card metadata
    SCENE.md                     # Generated scene context (read-only)
    actors.yaml                  # All actor instances in the scene
    variables.yaml               # Variable definitions
    .castle/
      meta.json                  # Internal metadata (do not edit)
    blueprints/
      <name>.yaml                # Blueprint definition (components as YAML)
      <name>.lua                 # Blueprint script (Lua code, if blueprint has Script behavior)
      <name>.draw.json           # Drawing/physics data (vector strokes, fill colors, physics shapes)
      <name>.preview.png         # PNG preview of the drawing (auto-generated, do not edit)
```

### Blueprints

Each blueprint is a `.yaml` file in `blueprints/`. The filename preserves the title's casing with non-alphanumeric characters replaced by underscores (e.g., "Player Ship" → `Player_Ship.yaml`).

Blueprint YAML structure:
```yaml
title: Player Ship
entryId: <uuid>          # Do not change — used to match this file to the in-app blueprint
components:
  Layout:                # Size and visibility defaults (position is set per-actor in actors.yaml)
    widthScale: 1.5      # World units (camera is 10 units wide, -5 to 5)
    heightScale: 1.5
  Rules:
    rules:
      rule-0:
        trigger:
          name: tap
          behaviorName: Layout
        responses:
          - name: move toward
            behaviorName: Dynamic Motion
            params:
              speed: 5
      rule-1:
        ...
  # Other behaviors like Solid, Friction, Gravity, etc.
  Script:
    file: player-ship.lua   # Reference to the Lua script file
```

#### Drawing previews

Blueprints with a `.draw.json` companion file also have a `.preview.png` — a 256×256 PNG rendering of the drawing. These are auto-generated by the CLI on clone/serve/pull and can be regenerated on demand:

```bash
castle draw-preview blueprints/<name>.draw.json
```

Read `.preview.png` whenever you want to see what a blueprint's drawing looks like without running the game.

#### draw.json format

Read **`.castle/DRAW_JSON.md`** for the full `.draw.json` format reference. Consult it when editing vector drawings or physics shapes.

#### Editing blueprints

Edits are **sparse/incremental**. You only need to include the behaviors and properties you want to change. Any behavior or property you don't mention is left as-is. This means:
- To change a single property on a behavior, include just that behavior with just that property.
- To add a new behavior, include it with the properties you want.
- Behaviors you don't mention in your edit remain unchanged.
- Properties within a behavior that you don't mention remain unchanged.

Example — to just change the velocity on an existing Dynamic Motion behavior:
```yaml
components:
  Dynamic Motion:
    vx: 8
```
Everything else about the blueprint (Layout, Rules, other behaviors, etc.) stays the same.

#### Removing a behavior

To remove a behavior from a blueprint, set `removeBehavior: true` on it. You MUST use this explicit flag — simply omitting a behavior does NOT remove it (because edits are sparse).

```yaml
components:
  Gravity:
    removeBehavior: true
  Friction:
    removeBehavior: true
```

#### Editing rules

Rules are edited within the `Rules` behavior in components. Each rule is keyed as `rule-0`, `rule-1`, etc. Like other behaviors, rules are sparse — include only the rules you want to add or change. Existing rules you don't mention are kept.

To remove a specific rule, set `removeRule: true`:
```yaml
components:
  Rules:
    rules:
      rule-2:
        removeRule: true
```

#### Editing scripts

Edit the `.lua` file directly. The `.yaml` file references it via `Script.file`. When the Lua file changes, the full new code is sent to the app.

#### Creating a new blueprint

Add a new `.yaml` file in `blueprints/`. Requirements:
- Include a `title`.
- Include `components` with the behaviors you want.
- Do NOT include an `entryId` — one will be generated automatically.
- Optionally set `drawing` to choose the shape and color. Available values: `red square`, `blue square`, `green square`, `yellow square`, `orange square`, `purple square`, `pink square`, `brown square`, `gray square`, `slate square`, `red circle`, `blue circle`, `green circle`, `yellow circle`, `orange circle`, `purple circle`, `pink circle`, `brown circle`, `gray circle`, `slate circle`. If omitted, a random color is assigned.
- You can also set `drawing` on an existing blueprint to change its appearance.
- Optionally set `forkBlueprintId` to fork from a specific existing blueprint (use its entry ID) instead of the Empty default.
- You can also create a matching `.lua` file for a script.

Example new file `blueprints/bullet.yaml`:
```yaml
title: Bullet
drawing: red circle
components:
  Layout:
    widthScale: 0.4
    heightScale: 0.4
  Dynamic Motion:
    vy: -10
  Solid:
    disabled: false
```

**Do NOT delete or rename existing blueprint files.** To remove a blueprint, set `removeBlueprint: true` at the top level of its YAML file. This also removes all actors of that blueprint.

**IMPORTANT: When creating a new blueprint AND placing actors of it, you can do both at once (write the blueprint file and update `actors.yaml` in the same step). But if you do it in separate steps, you MUST create the blueprint file first. If you add the actor to `actors.yaml` before the blueprint file exists, the actor creation will fail.**

### Actors

`actors.yaml` contains all actor instances placed in the scene. Each actor is keyed by its ID (prefixed with `a`).

```yaml
a123:
  title: Player Ship      # Blueprint title this actor is an instance of
  x: 0                    # Position
  y: -3.5
a456:
  title: Wall
  x: 5
  y: 0
  widthScale: 3           # 3 world units wide
  angle: 45               # Degrees
```

Only these per-actor properties can be set: `x`, `y`, `angle`, `widthScale`, `heightScale`, `initialFrame`, `content`, `fontSizeScale`, `targetDeckId`. All other properties must be set at the blueprint level.

Unlike blueprints, `actors.yaml` uses **full-list semantics**: the file represents the complete desired set of actors. If you remove an entry from the file, that actor will be removed from the scene. If you add a new entry, a new actor will be created.

**Adding a new actor:** Add a new entry with a unique key (e.g., `aNew1`) and include `title` to specify which blueprint to instantiate:
```yaml
aNew1:
  title: Bullet
  x: 0
  y: -5
```

**Removing an actor:** Simply delete the entry from `actors.yaml`. Because the file is the full list, any actor missing from it will be removed from the scene.

**Moving/editing an actor:** Change its `x`, `y`, `angle`, etc. properties.

### Variables

`variables.yaml` is a list of deck variables:

```yaml
- variableId: <uuid>
  name: score
  initialValue: 0
  lifetime: deck
- variableId: <uuid>
  name: health
  initialValue: 100
  lifetime: deck
```

Like actors, `variables.yaml` uses **full-list semantics**: the file represents the complete desired set of variables.

**Adding a variable:** Add a new entry with a `name`, `initialValue`, and `lifetime`. You can use any placeholder for `variableId` — a real one will be generated.

Valid `lifetime` values:
- `deck` — persists for the lifetime of the deck session (most common)
- `card` — resets when the card restarts
- `play` — resets each game session (play-through)
- `user` — persists per player across sessions

**Removing a variable:** Delete the entry from the list. Any variable missing from the file will be removed from the deck.

### Examples

These are excerpts showing relevant parts of blueprint YAML files.

**Variable with rule — scoring system:**

In `variables.yaml`, add the variable:
```yaml
- name: score
  initialValue: 0
  lifetime: play
```

In a blueprint's components, reference by name (not ID):
```yaml
components:
  Rules:
    rules:
      rule-0:
        trigger:
          name: collide
          behaviorName: Layout
          params:
            tag: player
        responses:
          - name: set variable
            behaviorName: Rules
            params:
              variableName: score
              setToValue:
                expression: variable + 1
                variableName: score
          - name: destroy
            behaviorName: Rules
            params: {}
```

**Display a variable as text:**

```yaml
components:
  Text:
    content: "Score: $score"
  Rules:
    rules:
      rule-0:
        trigger:
          name: variable changes
          behaviorName: Rules
          params:
            variableName: score
        responses:
          - name: set behavior property
            behaviorName: Rules
            params:
              behaviorName: Text
              propertyName: content
              value: "Score: $score"
```

**Create actor from another blueprint (use entryTitle not entryId):**

```yaml
components:
  Rules:
    rules:
      rule-0:
        trigger:
          name: tap
          behaviorName: Layout
          params: {}
        responses:
          - name: create
            behaviorName: Rules
            params:
              entryTitle: Bullet
              coordinateSystem: relative position
              xOffset: 0
              yOffset: -1
```

**Collision with tag:**

```yaml
components:
  Tags:
    tagsString: enemy
  Rules:
    rules:
      rule-0:
        trigger:
          name: collide
          behaviorName: Layout
          params:
            tag: player
        responses:
          - name: destroy
            behaviorName: Rules
            params: {}
```

**Set behavior property on create (e.g. launch velocity):**

```yaml
components:
  Rules:
    rules:
      rule-0:
        trigger:
          name: create
          behaviorName: Rules
          params: {}
        responses:
          - name: set behavior property
            behaviorName: Rules
            params:
              behaviorName: Dynamic Motion
              propertyName: vx
              value: 0
          - name: set behavior property
            behaviorName: Rules
            params:
              behaviorName: Dynamic Motion
              propertyName: vy
              value: -5
```

**Repeating action (e.g. spawn enemies every 2 seconds):**

```yaml
components:
  Rules:
    rules:
      rule-0:
        trigger:
          name: create
          behaviorName: Rules
          params: {}
        responses:
          - name: infinite repeat
            behaviorName: Rules
            params:
              intervalType: time
              interval: 2
              responses:
                - name: create
                  behaviorName: Rules
                  params:
                    entryTitle: Enemy
                    coordinateSystem: absolute position
                    xOffset: 0
                    yOffset: -6
```

### Important notes

- Positive Y is downward. Angles in YAML files (`actors.yaml`, `actors.yaml` overrides) are in **degrees**. In Lua scripts, angles use **radians** (`self.rotation` is in radians — multiply degrees by `math.pi/180` to convert).
- `widthScale` and `heightScale` are in **world units**. The camera is **10 units wide** (-5 to 5) and **14 units tall** (-7 to 7). Typical sizes: small objects (bullets, coins) 0.3–0.8, normal characters/enemies 0.8–2, large enemies/bosses 2–5, platforms/walls 1–5 per tile, full-screen overlays 10. A `widthScale` of 10 fills the entire camera width.
- The default camera view extends from -5 to 5 on X and -7 to 7 on Y.
- Gravity strength is scaled by 10 (1 unit = 10 units/s²).
- Use `variableName` (not `variableId`) when referencing variables in rules. The system resolves names to IDs automatically.
- Use `entryTitle` (not `entryId`) when referencing blueprints in create responses.
- Use `behaviorName` (not `behaviorId`) for trigger and response behavior references.
- Changes are detected automatically when you save files. The CLI sends them to the app.
- **The mobile client does not hot-reload.** After editing any file, you must run `stopAndPlay` for the mobile user to see the change. (The web player hot-reloads automatically.) Always do this after edits — don't skip it — unless the user says not to restart the card/deck when you make edits.
- After the app applies changes, it sends updated state back and the files are rewritten with the latest data (including any generated IDs).
- The `.castle/meta.json` file tracks content hashes to detect changes. Do not edit it.
