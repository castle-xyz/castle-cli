# Castle CLI 4

Bridge between Castle and a local workspace for AI-assisted game development.

## First thing to do

Run `npm install` if `node_modules/` doesn't exist.

For app-backed editing, start the CLI connection in the background. The user should already have a deck open in the Castle editor.

```bash
npm install  # only if needed
npx tsx src/index.ts
```

Run this in the background — it needs to stay running for the duration of the session. Wait for it to log `[state]` — that means the app is connected and scene state has been synced to `workspace/`. Keep running agents from the `castle-cli-4` repo root and use this `CLAUDE.md` as the instruction source.

For app-independent project work, use `pull`, `serve`, `edit`, `screenshot`, and `push` against a project directory. Local project directories normally live under ignored `decks/`.

## Commands

```bash
npx tsx src/index.ts                            # connect to app (run in background)
npx tsx src/index.ts init [dir] --title "Game"  # create a new local project deck
npx tsx src/index.ts pull <deck-id> [dir]       # pull a deck into local project files
npx tsx src/index.ts serve [dir] --open         # serve local project files with bundled player
npx tsx src/index.ts restart                    # stop and restart the active scene
npx tsx src/index.ts screenshot [filename]      # capture through Castle bridge
npx tsx src/index.ts edit < edit.json           # apply scene edits (pipe JSON to stdin)
npx tsx src/index.ts logs                       # show script logs since last restart
npx tsx src/index.ts status                     # show connection/preview status
npx tsx src/index.ts push [dir]                 # push local project files as an unlisted deck
```

## App Workspace

The connection writes to `workspace/`:
- `scripts/*.lua` — editable Lua scripts, one per blueprint. Changes auto-sync to the app.
- `scene/blueprints/<slug>.yaml` — one file per blueprint (same slugs as scripts)
- `scene/` — read-only scene state (actors, variables, behaviors, rules, docs)
- `.castle/logs.txt` — script logs and errors
- `.castle/screenshots/` — captured screenshots (latest.png)

## Local Project Format

`pull` and app-independent editing use a local project directory:

- `deck.json` — local deck/card metadata
- `cards/<card-id>/card.json` — card metadata and scene properties
- `cards/<card-id>/scene/blueprints/<slug>.yaml` — human-editable blueprint data
- `cards/<card-id>/scene/blueprints/<slug>.json` — opaque engine/app data such as drawings, physics fixtures, and other non-YAML fields
- `cards/<card-id>/scripts/<slug>.lua` — script code, not duplicated in YAML
- `cards/<card-id>/scene/actors.yaml` — placed actors
- `cards/<card-id>/scene/variables.yaml` — deck variables

`init` creates this structure from scratch, forks a bundled default blueprint, applies bundled drawing data, and places one starter actor with a Lua script. Use `--title` for the deck title and `--force` only when replacing a throwaway local project directory.

`serve` materializes these files into scene data and runs them through the bundled web player in `bundles/player`. It does not fall back to published Castle bundles. Keep `bundles/player` current when testing new engine features.

`edit` on a served local project follows the app AgentSheet/toolEditScene semantics as closely as possible, then rewrites the project files. Default blueprint templates and drawing replacements are bundled in this repo under `data/agent/`, so local edits do not depend on a sibling `castle-client` checkout.

`push` uploads the materialized local project as an unlisted deck and applies the required content moderation flag payload. Use unlisted pushes while testing.

## Architecture

- `src/index.ts` — entry point, routes to connect/restart/screenshot/edit
- `src/server.ts` — persistent tunnel connection, file watching, IPC server, state management
- `src/command.ts` — IPC client for subcommands (restart, screenshot, edit)
- `src/commands/init.ts` — creates a new local project deck
- `src/commands/pull.ts` — downloads deck/card scene data into the local project format
- `src/commands/serve.ts` — local project preview through bundled browser player
- `src/commands/push.ts` — uploads local project scene data as an unlisted deck
- `src/api.ts` — Castle GraphQL API for authentication
- `src/config.ts` — token storage in ~/.castle/config.json
- `src/utils/project.ts` — local project read/write and materialization helpers
- `src/utils/edit.ts` — local AgentSheet-style scene edit implementation
- `src/utils/agent-data.ts` — bundled default blueprint and drawing replacement data

Client-side bridge code lives in the castle-client repo; use current main or a TestFlight beta build:
- `mobile/js/scenecreator/cli/CLIBridge.js` — WebSocket bridge
- `mobile/js/scenecreator/agent/AgentUtils.js` — shared context-gathering functions
- `mobile/js/scenecreator/agent/AgentSheet.js` — toolEditScene (scene edit processing)

## Deck Authoring

The following rules apply when editing Castle deck YAML/Lua in either app-synced `workspace/` files or app-independent local projects under `decks/`.

## IMPORTANT — Read Before Doing Anything

- IMPORTANT: You MUST verify every Castle API function exists in the docs before using it. Grep `workspace/scene/scripting-reference.md` and read `workspace/scene/docs/` when available. Do NOT guess function names.
- IMPORTANT: Before adding behaviors to blueprints, check available behavior names and properties. In an app-synced workspace, use `workspace/scene/behaviors.yaml`; in a local project, inspect existing blueprint YAML and materialize/restart quickly to catch invalid behavior names.
- IMPORTANT: Before adding rules, check available triggers, responses, conditions, and expressions. In an app-synced workspace, use `workspace/scene/rules.yaml`.
- IMPORTANT: `onUpdate(dt)` receives delta time as a parameter. There is NO `castle.dt()` function.
- IMPORTANT: `onDraw()` does NOT receive dt. Use `castle.getTime()` for elapsed time in draw handlers.
- IMPORTANT: `castle.draw.*` functions ONLY work inside `onDraw()`. They do nothing elsewhere.
- IMPORTANT: Check `workspace/scene/script-property-names.md` for property name differences between scripts and YAML when it is available.
- IMPORTANT: Always check logs after restarting to see script errors. In app-connected mode, use `workspace/.castle/logs.txt`; in local serve mode, use `<deck-dir>/.castle/logs.txt` or `npx tsx src/index.ts logs`. Logs have timestamps and `--- restart ---` markers. Always look at logs AFTER the most recent restart marker — older entries are stale.
- IMPORTANT: After ANY script change, restart and immediately check logs for errors before doing anything else.
- IMPORTANT: Position is accessed via `my.layout.x` / `my.layout.y` in scripts, NOT `my.body.x` / `my.body.y`. There is no `body` accessor.
- IMPORTANT: There is NO `onCollide` callback handler for actor scripts. Detect collisions by polling `my:isColliding("tag")` or `my:getCollidingActors("tag")` inside `onUpdate(dt)`.
- IMPORTANT: To destroy an actor, use `castle.destroyActor(my)` or `castle.destroyActor(otherActor)`. There is no `my:destroy()` method.
- IMPORTANT: When you discover a misunderstanding about the Castle API or system (e.g. a function doesn't exist, a property name is wrong, a pattern doesn't work), add an IMPORTANT note to this CLAUDE.md file documenting the correct behavior so you remember it in future sessions.
- IMPORTANT: When explaining rules to the user, don't dump raw YAML. Translate rules into readable pseudocode that describes the logic clearly (e.g. "on create: repeat 10 times, pick random terrain type, place at offset...").
- IMPORTANT: `getCollidingActors` and `isColliding` only work with physics-based movement (Dynamic Motion / Moving behaviors). If actors move by setting `layout.x/y` directly, use manual distance checks instead: `local dx = a.layout.x - b.layout.x; local dy = a.layout.y - b.layout.y; if math.sqrt(dx*dx+dy*dy) < hitRadius then ...`
- IMPORTANT: Camera follow is `my:followWithCamera()`, not `setCameraTarget` or any other name.
- IMPORTANT: HUD actors that should stay on screen need `relativeToCamera: true` in their Layout. The camera follows the player so fixed-position actors will scroll off screen.
- IMPORTANT: `onDraw` draws in actor-local coordinates where (-0.5,-0.5) to (0.5,0.5) is the actor's bounds. 1 unit = actor's width/height. So a `widthScale: 2` actor has 2 world units but still draws in -0.5 to 0.5 local coords.
- IMPORTANT: Actors render in the order they were added (back to front). Use `layerName: back` or `layerName: front` to control layer, or `my:moveToFront()` / `my:moveToBack()` in scripts.
- IMPORTANT: For HUD/UI actors that should stay fixed on screen, you MUST use `layerName: camera` (not just `relativeToCamera: true`). The `camera` layer is what actually makes actors follow the camera. Setting `relativeToCamera: true` alone does NOT work.
- IMPORTANT: When using `node -e '...' | npx tsx src/index.ts edit` for edits, use single quotes for the outer shell string and escape carefully. For complex edits, build the JSON in JS and pipe with `process.stdout.write(JSON.stringify(edit))`.
- IMPORTANT: Screenshots show whatever state the app is in — the user may be in the editor or in play mode. Both are useful: edit mode shows onDraw previews on actors, play mode shows the running game.
- IMPORTANT: Physics collision shapes are 1x1 squares by default regardless of widthScale/heightScale. The visual size changes but the collision box stays 1x1. Work with this constraint.
- IMPORTANT: When forking from Empty blueprint (`default-blueprint-1`) or Drawing (`default-blueprint-0`), you MUST provide `replaceDrawing`. If you forget, a random color is chosen.
- IMPORTANT: Actors added in the same edit call are ordered back-to-front in the order they appear. Add background actors first, then game actors, then UI/HUD actors.
- IMPORTANT: The `onDraw` handler completely replaces the actor's default sprite/drawing. If you define `onDraw`, the colored shape from `replaceDrawing` won't render — only your draw code.
- IMPORTANT: Text behavior content renders independently from `onDraw`. If a blueprint has both Text and a Script with `onDraw`, the text will show on top of your custom drawing. Set `my.text.content = ""` in `onCreate()` to clear it.
- IMPORTANT: `castle.getTouches()` returns a table of touch objects. Each has `x`, `y`, `pressed` (true only the frame it began), `released`, `id`, `deltaX`, `deltaY`. Use `touch.pressed` for tap detection, not just presence in the table.
- IMPORTANT: `math.randomseed` with `os.clock()` alone may produce the same sequence across restarts. Combine with `castle.getTime()` and call `math.random()` a few times after seeding to get better randomness.
- IMPORTANT: Prefer editing the actual `.lua` files for script changes: `workspace/scripts/*.lua` for app-connected work, or `decks/<deck>/cards/<card-id>/scripts/*.lua` for local project work. Use `edit` mainly for scene, actor, blueprint, and variable structure.

## Project Structure

- `workspace/scripts/*.lua` — app-connected editable Lua scripts, one per blueprint. Changes auto-sync to the app.
- `workspace/scene/` — Read-only scene state, auto-updated by the app:
  - `blueprints/<slug>.yaml` — One file per blueprint (same slugs as scripts). Each contains behaviors, components, and properties for that blueprint. ALWAYS read the relevant blueprint YAML files before making changes — don't guess at structure or properties.
  - `actors.yaml` — Actor instances with positions
  - `variables.yaml` — Deck variables
  - `behaviors.yaml` — Available behavior types and properties
  - `rules.yaml` — Available rule triggers, responses, conditions
  - `scripting-reference.md` — Full Lua scripting API reference
  - `script-property-names.md` — Property name mappings (script vs YAML names)
  - `docs/` — Castle documentation and tutorials
- `workspace/.castle/logs.txt` — Script logs and errors from the running scene
- `workspace/.castle/screenshots/` — Captured screenshots (latest.png is most recent)
- `decks/<deck>/cards/<card-id>/scripts/*.lua` — local project Lua scripts
- `decks/<deck>/cards/<card-id>/scene/blueprints/*.yaml` — local project editable blueprint YAML
- `decks/<deck>/cards/<card-id>/scene/blueprints/*.json` — local project opaque blueprint sidecar data, including drawings and fixtures

IMPORTANT: Blueprint files and script files use the same slug naming (based on blueprint title). For example, a blueprint titled "Obstacle Bumper" has `blueprints/obstacle-bumper.yaml` and `scripts/obstacle-bumper.lua`. Always read both the blueprint YAML and the script when working on a blueprint — bias toward reading more files than you think you need to understand how things fit together and whether changes could break something else.

## Workflow

1. Edit script files directly.
2. Use `npx tsx src/index.ts edit` to add/edit/remove blueprints, actors, and variables when structural edits are easier through the agent edit format.
3. `npx tsx src/index.ts restart` — restart to see changes running. Scripts only take effect after restart.
4. Check logs for errors — look AFTER the latest `--- restart ---` marker.
5. `npx tsx src/index.ts screenshot` — capture the result. NOTE: app-connected screenshots show whatever state the app is in. Local serve screenshots capture the browser player runtime.
6. Only use screenshots when you need to verify visual results — not every change needs one

## Coordinate System & Scale

- Positive Y is **downward**. Positive X is rightward.
- Angles are in **degrees**.
- The default camera view extends from **-5 to 5** on X and **-7 to 7** on Y.
- `widthScale` and `heightScale` are provided as normal values (e.g., 1.5 = 150%). The system handles internal conversion.
- Gravity strength is scaled by 10 — 1 unit of gravity = 10 units/s².

IMPORTANT: Before ANY coordinate-based positioning or logic, explicitly reason about the Castle coordinate system: positive Y is DOWN, X range is -5 to 5, Y range is -7 to 7. Top of screen is negative Y, bottom is positive Y.

IMPORTANT: When placing many actors with calculated positions (grids, patterns, etc.) where the positions aren't obvious, prefer writing a small JS/Node script to generate the edit JSON rather than hand-computing coordinates. This avoids math errors. Example: `node -e "..." | npx tsx src/index.ts edit`

## Scene Edit Format (`castle edit`)

Pipe JSON to `npx tsx src/index.ts edit`. Do NOT save edit JSON to persistent files — use one-off approaches:

```bash
# Option 1: here doc
npx tsx src/index.ts edit <<'EDIT'
{"description": "add enemy", "blueprints": {"new-enemy": {"forkBlueprintId": "default-blueprint-1", "title": "Enemy", "replaceDrawing": "red circle"}}}
EDIT

# Option 2: echo pipe
echo '{"description": "remove actor", "actors": {"5": {"removeActor": true}}}' | npx tsx src/index.ts edit

# Option 3: node script for complex/calculated edits
node -e 'const e = {description:"add grid", actors:{}}; for(let i=0;i<5;i++) e.actors["a"+i]={title:"Block",components:"Layout:\n  x: "+(i*2-4)+"\n  y: 0"}; process.stdout.write(JSON.stringify(e))' | npx tsx src/index.ts edit
```

The JSON has three optional top-level keys: `blueprints`, `actors`, `variables`.

### Blueprints

All new blueprints must be created by **forking** an existing one. You cannot create from scratch. Use `forkBlueprintId` with either:
- A blueprint ID from the current deck (see the `id` field in `scene/blueprints/*.yaml`)
- A default template ID: `default-blueprint-0` (Drawing), `default-blueprint-1` (Empty blueprint), `default-blueprint-2` (Text), `default-blueprint-3` (Portal), `default-blueprint-4` (Mirror), `default-blueprint-5` (Wall), `default-blueprint-6` (Ball), `default-blueprint-7` (Character), `default-blueprint-8` (Tracking Camera), `default-blueprint-9` (Creature), `default-blueprint-10` (Border), `default-blueprint-11` (Background), `default-blueprint-12` (Collectible), `default-blueprint-13` (Score Counter)

The `components` field is a **YAML string** using **display names** for behaviors (e.g., "Layout", "Dynamic Motion", "Solid", "Tags", "Drawing", "Friction", "Bounce", "Gravity", "Slow Down", "Speed Limit", "Axis Lock").

When forking from Empty blueprint (`default-blueprint-1`) or Drawing (`default-blueprint-0`), you MUST provide `replaceDrawing` with one of: blue circle, blue square, brown circle, brown square, gray circle, gray square, green circle, green square, orange circle, orange square, pink circle, pink square, purple circle, purple square, red circle, red square, slate circle, slate square, yellow circle, yellow square.

IMPORTANT: Define referenced blueprints before referencing blueprints. If a blueprint's rules create actors from another blueprint, define that other blueprint first in the JSON.

IMPORTANT: `components` values are YAML strings. Properties must be constants, not expressions.

#### Fork a new blueprint:
```json
{
  "description": "create player",
  "blueprints": {
    "new-player": {
      "forkBlueprintId": "default-blueprint-7",
      "title": "Player",
      "components": "Layout:\n  widthScale: 3\n  heightScale: 3\nTags:\n  tagsString: player"
    }
  },
  "actors": {
    "new-actor-1": {
      "title": "Player",
      "components": "Layout:\n  x: 0\n  y: 3"
    }
  }
}
```

#### Fork empty blueprint with colored drawing:
```json
{
  "description": "create blue block",
  "blueprints": {
    "new-block": {
      "forkBlueprintId": "default-blueprint-1",
      "title": "Block",
      "replaceDrawing": "blue square",
      "components": "Solid: {}\nTags:\n  tagsString: block"
    }
  }
}
```

#### Edit existing blueprint (use actual entryId from blueprints/*.yaml):
```json
{
  "description": "make wall bouncy",
  "blueprints": {
    "7b13dad6-aad8-4c2e-8e36-148e2bda4508": {
      "components": "Bounce:\n  bounciness: 0.8"
    }
  }
}
```

#### Add behaviors, remove behaviors:
```json
{
  "description": "add gravity, remove friction",
  "blueprints": {
    "some-blueprint-id": {
      "components": "Gravity:\n  gravity: 1\nFriction:\n  removeBehavior: true"
    }
  }
}
```

#### Remove a blueprint:
```json
{
  "description": "remove unused blueprint",
  "blueprints": {
    "some-blueprint-id": {
      "removeBlueprint": true
    }
  }
}
```

#### Assign a blueprint to a category:

Blueprints have a `category` string (shown as "Folder" in the app UI) used to group them in the belt. Set `category` to a name to assign, or `""` to clear. There is no separate category object — any blueprints sharing the same string are grouped together.

IMPORTANT: Don't add categories to simple decks. Only start using categories once a deck has enough blueprints that grouping genuinely helps (e.g. 16+ blueprints with clear sub-groups), or when the user explicitly asks to organize them. Don't impose structure on small decks.

```json
{
  "description": "group enemies",
  "blueprints": {
    "enemy-id-1": { "category": "Enemies" },
    "enemy-id-2": { "category": "Enemies" }
  }
}
```

To rename a category, update `category` on every blueprint currently using it. To delete a category, set `category: ""` on every blueprint in it. A category disappears when no blueprint has it.

#### Add a script to a blueprint:
```json
{
  "description": "add rotation script",
  "blueprints": {
    "some-blueprint-id": {
      "script": [{ "code": "local angle = 0\n\nfunction onUpdate(dt)\n  angle = angle + dt * 90\n  my.layout.rotation = angle\nend" }]
    }
  }
}
```

NOTE: When using the `script` field, do NOT add `Script:` to the `components` field. The script field automatically enables the Script behavior.

### Actors

New actors reference blueprints by **title** (not ID). The blueprint must already exist in the deck or be created in the same edit call (defined earlier in the blueprints object).

Only these properties can be set per-actor (all others must be set at blueprint level):
- x, y, angle, widthScale, heightScale → Layout
- initialFrame → Drawing
- content, fontSizeScale → Text
- targetDeckId → Link

#### Add new actors:
```json
{
  "description": "place enemies",
  "actors": {
    "new-enemy-1": {
      "title": "Enemy",
      "components": "Layout:\n  x: -3\n  y: -2"
    },
    "new-enemy-2": {
      "title": "Enemy",
      "components": "Layout:\n  x: 3\n  y: -2"
    }
  }
}
```

#### Edit existing actors (use actor IDs from actors.yaml, without the "a" prefix):
```json
{
  "description": "reposition actor",
  "actors": {
    "0": {
      "components": "Layout:\n  x: 2.5\n  y: -3\n  widthScale: 2\n  heightScale: 2"
    }
  }
}
```

#### Remove actors:
```json
{
  "description": "remove actor",
  "actors": {
    "5": { "removeActor": true }
  }
}
```

### Variables

Variables persist across the scene. Lifetime options: `deck` (persists across cards), `card` (resets per card), `play` (resets each play).

#### Create variables:
```json
{
  "description": "add score",
  "variables": {
    "new-score": {
      "name": "score",
      "initialValue": 0,
      "lifetime": "play"
    }
  }
}
```

#### Remove variables:
```json
{
  "description": "remove old variable",
  "variables": {
    "existing-var-id": { "removeVariable": true }
  }
}
```

### Combined Example

Fork blueprints, add actors, create variables, all in one call:
```json
{
  "description": "setup dodge game",
  "variables": {
    "new-score": {
      "name": "score",
      "initialValue": 0,
      "lifetime": "play"
    }
  },
  "blueprints": {
    "new-player": {
      "forkBlueprintId": "default-blueprint-7",
      "title": "Player",
      "components": "Layout:\n  widthScale: 3\n  heightScale: 3\nTags:\n  tagsString: player",
      "script": [{ "code": "function onUpdate(dt)\n  local touch = castle.getTouch()\n  if touch then\n    my.dynamicMotion.vx = (touch.x - my.layout.x) * 5\n  end\nend" }]
    },
    "new-block": {
      "forkBlueprintId": "default-blueprint-1",
      "title": "Falling Block",
      "replaceDrawing": "red square",
      "components": "Tags:\n  tagsString: block"
    }
  },
  "actors": {
    "new-actor-1": {
      "title": "Player",
      "components": "Layout:\n  x: 0\n  y: 5"
    }
  }
}
```

## Scripting

Scripts use Luau (Lua 5.1 with types). Key handlers:
- `onCreate()` — called once when actor is created
- `onUpdate(dt)` — called every frame, dt is seconds since last frame
- `onDraw()` — called every frame for custom drawing (replaces default sprite)
- `onMessage(message, triggeringActor)` — called when actor receives a message
- There is no `onCollide` callback. Poll collision state inside `onUpdate(dt)`.

Access actor properties: `my.layout.x`, `my.layout.y`, `my.layout.rotation`, `my.dynamicMotion.vx`, etc. Other actors: `otherActor.layout.x`, etc.
Behavior names in scripts use camelCase without spaces: Layout→`layout`, Dynamic Motion→`dynamicMotion`, Slow Down→`slowDown`.

Key functions (verify in scripting-reference.md before using):
- `castle.getTime()` — elapsed time since card start
- `castle.getTouch()` / `castle.getTouches()` — current touch state
- `castle.createActor(title, x, y)` — create actor from blueprint title
- `castle.actorsWithTag(tag)` — get all actors with tag
- `castle.closestActorWithTag(tag)` — get nearest actor with tag
- `castle.getVariable(name)` / `castle.setVariable(name, value)` — deck variables
- `my:isColliding(tag)` — check collision with tagged actors
- `castle.destroyActor(actor)` — destroy an actor
- `castle.draw.*` — drawing functions (only in onDraw)

## Miscellaneous tips

- For Lua script logs, use `print(...)`. There is no `castle.log(...)` script API.
