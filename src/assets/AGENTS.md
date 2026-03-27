
## Working Style

Make changes quickly and iterate. Don't overthink or plan extensively — just make the edit, see the result, and adjust. Small fast changes are much better than one big carefully-planned change. The user can see the result on their device in real time, so bias toward action over analysis.

**Starting a task:** The card directory path is shown at the top of this file. Do NOT use Glob, ls, or any directory listing. Do NOT read any existing file unless you are specifically modifying it. Start writing files immediately.

**Writing files:** Use `Write` to create or fully replace a file (no prior read needed). Use `Edit` only for targeted line changes to an existing file (requires reading it first). Prefer `Write` for YAML and Lua files.

## Logs & Screenshots

Check `.castle/logs.txt` for errors after making changes — `[CLI]` lines are from the bridge, `[Deck]` lines are from Lua `print()` calls. Clean up debug `print()` calls once resolved.

Read **`.castle/screenshots/latest.png`** to see what the game currently looks like. Capture screenshots via `castle.cliScreenshot("label")` in Lua or via the `screenshot` command (see below).

For Playwright browser automation and other testing patterns, read **`.castle/TESTING.md`**.

## Commands

Use `castle` CLI commands to control the deck while `castle serve` is running:

- **`castle stop-and-play`**: Stops and restarts the deck. **Run this after every edit** — file changes are applied before it runs. After restart, the deck needs a moment to render.
- **`castle screenshot`**: Captures a screenshot. Also saved to `.castle/screenshots/latest.png`.

**Agentic workflow:** Run `castle stop-and-play` after every edit. Run `castle screenshot` only when you need to verify something visual. Check `.castle/logs.txt` for errors when things aren't working.

For shell syntax and debugging tips, read **`.castle/TESTING.md`**.

## Scripting vs. Rules

Prefer Lua scripts for game logic. Scripts are easier to read, edit, and debug as files. Use rules only when you need access to engine APIs that aren't available in scripts yet (e.g. create actor, show leaderboard, play sound). When in doubt, use a script.

<!-- ADMIN_ONLY_START -->
IMPORTANT: When creating blueprints that use the draw API (`onDraw`), you must set `visible: true` on the Layout behavior. New blueprints forked from the Empty default may have visibility off, which prevents `onDraw` from being called.

Read **`.castle/DRAW_API.md`** for the full `onDraw` and `castle.draw.*` API reference.
<!-- ADMIN_ONLY_END -->

## CLI File System

This project is synced from a Castle deck via a CLI bridge. The files on disk mirror the scene state. You can read and edit these files to make changes to the deck.

### File structure

```
deck-{deckId}/                   # Deck root
  AGENTS.md                      # This file — agent instructions (read-only)
  deck.yaml                      # Deck metadata
  .castle/                       # Deck-level runtime state
    logs.txt                     # CLI and deck logs
    screenshots/
      latest.png                 # Most recent screenshot
      001.png ...                # Rolling history (last 100 kept)
  card-{cardId}/                 # Card subdirectory (one per card in the deck)
    card.yaml                    # Card metadata
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

Each blueprint is a `.yaml` file in `blueprints/`. The filename is the title lowercased with non-alphanumeric characters replaced by underscores (e.g., "Player Ship" → `player_ship.yaml`).

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

`.draw.json` files are large vector data blobs (often hundreds of KB) — they are gitignored and excluded from the file index. **Do not read them directly.** Use `.preview.png` to see what a drawing looks like. If you need to edit drawing or physics data, read **`.castle/DRAW_JSON.md`** for the format reference first.

#### Editing blueprints

The blueprint YAML represents the **full current state** of the blueprint. Edit values in place — read the file, change what you need, write it back.

- To add a behavior: add it under `components`.
- To change a property: update its value in the file.
- **To remove a behavior**: set `removeBehavior: true` on it in the file. Deleting the behavior entry is not enough — you must leave the key with this flag so mobile knows to remove it.

#### Editing rules

Rules live under `components.Rules.rules`, keyed as `rule-0`, `rule-1`, etc. Edit or add rules by updating those entries in the file.

To remove a rule: delete the entry from the file. Rules are applied idempotently — the full set of rules is cleared and reloaded on each sync, so removing a rule key and saving is sufficient.

For the full list of available triggers, responses, and conditions with their params, read **`.castle/BEHAVIORS.md`**.

#### Editing scripts

Edit the `.lua` file directly. The `.yaml` file references it via `Script.file`. When the Lua file changes, the full new code is sent to the app.

#### Creating a new blueprint

Add a new `.yaml` file in `blueprints/`. Requirements:
- Include a `title`.
- Include `components` with the behaviors you want.
- Do NOT include an `entryId` — one will be generated automatically.
- Optionally set `drawing` to choose the shape and color. Format: `{color} {shape}` where color is one of `red`, `blue`, `green`, `yellow`, `orange`, `purple`, `pink`, `brown`, `gray`, `slate` and shape is `square` or `circle` (e.g. `red circle`, `blue square`). If omitted, a random color is assigned.
- You can also set `drawing` on an existing blueprint to change its appearance.
- Optionally set `forkBlueprintId` to fork from a specific existing blueprint (use its entry ID) instead of the Empty default.
- You can also create a matching `.lua` file for a script.

For a new blueprint example, consult `.castle/EXAMPLES.md`.

**To remove a blueprint, delete its YAML file.** The mobile app removes any blueprint absent from the CLI's file list. Do not rename existing blueprint files.

**IMPORTANT: When creating a new blueprint AND placing actors of it, you can do both at once (write the blueprint file and update `actors.yaml` in the same step). But if you do it in separate steps, you MUST create the blueprint file first. If you add the actor to `actors.yaml` before the blueprint file exists, the actor creation will fail.**

### Actors

`actors.yaml` is a **map** of actor instances placed in the scene. The map key is the actor's stable identifier (a short alphanumeric string like `a0`, `a1`, `b3`). This key is assigned by the CLI and persists across serve sessions.

```yaml
a0:
  title: Player Ship      # Blueprint title this actor is an instance of
  x: 0                    # Position
  y: -3.5
a1:
  title: Wall
  x: 5
  y: 0
  widthScale: 3           # 3 world units wide
  angle: 45               # Degrees
```

Only these per-actor properties can be set: `x`, `y`, `angle`, `widthScale`, `heightScale`, `initialFrame`, `content`, `fontSizeScale`, `targetDeckId`. All other properties must be set at the blueprint level.

`actors.yaml` uses **full-map semantics**: the file represents the complete desired set of actors. If you remove a key from the map, that actor will be removed from the scene. If you add a new key, a new actor will be created.

**Adding a new actor:** Add a new entry with a unique key and include `title` to specify which blueprint to instantiate. Use the next available key in sequence (if the map has `a0`, `a1`, use `a2`):
```yaml
a2:
  title: Bullet
  x: 0
  y: -5
```

**Removing an actor:** Simply delete the key-value entry from `actors.yaml`. Because the file is the full map, any actor missing from it will be removed from the scene.

**Moving/editing an actor:** Change its `x`, `y`, `angle`, etc. properties under its key.

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

The most common rule patterns are shown here. Consult `.castle/EXAMPLES.md` for more (spawning, repeating actions, etc.).

**Collision → destroy + score** (brick-hit, coin-collect):
```yaml
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

**Display a variable as text** (score label):
```yaml
components:
  Text:
    content: "Score: 0"
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

For trigger/response/condition params not shown here, read **`.castle/BEHAVIORS.md`**.

### Physics

Castle uses **direct velocity control**, not force-based physics:

- Set `Dynamic Motion.vx` / `Dynamic Motion.vy` in rules or Lua (`self.vx`, `self.vy`). There is no `applyForce` or `addImpulse`.
- **`Dynamic Motion`** makes an actor physically simulated — responds to gravity, friction, and collisions; can push and be pushed by other dynamic actors. Add `Solid` to enable collision detection.
- **`Fixed Motion`** moves at constant velocity (`vx`, `vy` props). Its velocity cannot be changed by collisions or gravity — it blocks dynamic actors and triggers collision rules normally, but cannot be pushed. Useful for moving platforms, enemy patrols, or projectiles that should never be deflected.
- **`Gravity`** pulls actors with `Dynamic Motion` downward (positive Y). Strength is scaled by 10 (e.g. a value of 4 = 40 units/s²).
- **`Axis Lock`** with `rotates: false` prevents an actor from spinning. Actors won't rotate from physics unless you remove this behavior or set `rotates: true`.
- **`Friction`** is placed on static actors (e.g. ground blocks) and slows down dynamic actors that touch them — not on the moving actor itself.
- **`Bounce`** on a `Solid` + `Dynamic Motion` actor: `rebound: 1.0` (0–2; 1 = perfectly elastic, <1 = damped, >1 = hyperelastic).
- **`Speed Limit`**: `maxSpeed: 8` — caps speed of a `Dynamic Motion` actor.
- **`Tags`**: `tagsString: mytag` — tag this actor. Use `tag: mytag` in collide trigger `params` to filter by tag.

### Important notes

- Positive Y is downward. Angles in `actors.yaml` are in **degrees**. In Lua scripts, angles use **radians** (`self.rotation` is in radians — multiply degrees by `math.pi/180` to convert).
- `widthScale` and `heightScale` are in **world units**. The camera is **10 units wide** (-5 to 5) and **14 units tall** (-7 to 7). Typical sizes: small objects (bullets, coins) 0.3–0.8, normal characters/enemies 0.8–2, large enemies/bosses 2–5, platforms/walls 1–5 per tile, full-screen overlays 10.
- Use `variableName` (not `variableId`) when referencing variables in rules. The system resolves names to IDs automatically.
- Use `entryTitle` (not `entryId`) when referencing blueprints in create responses.
- Use `behaviorName` (not `behaviorId`) for trigger and response behavior references.
- Changes are detected automatically when you save files. The CLI sends them to the app.
- **The mobile client does not hot-reload.** After editing any file, you must run `castle stop-and-play` for the mobile user to see the change. (The web player hot-reloads automatically.) Always do this after edits — don't skip it — unless the user says not to restart the card/deck when you make edits.
- After the app applies changes, it sends updated state back and the files are rewritten with the latest data (including any generated IDs).
- The `.castle/meta.json` file tracks content hashes to detect changes. Do not edit it.
