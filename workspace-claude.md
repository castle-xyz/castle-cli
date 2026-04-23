# Castle CLI Workspace

This workspace is synced with a Castle deck. The CLI runs in the background syncing scene state from the app. Use commands to restart, screenshot, and edit the scene.

## IMPORTANT — Read Before Doing Anything

- IMPORTANT: You MUST verify every Castle API function exists in the docs before using it. Grep `workspace/scene/scripting-reference.md` and read `workspace/scene/docs/`. Do NOT guess function names.
- IMPORTANT: Before adding behaviors to blueprints, check `workspace/scene/behaviors.yaml` for available behavior names and their properties.
- IMPORTANT: Before adding rules, check `workspace/scene/rules.yaml` for available triggers, responses, conditions, and expressions.
- IMPORTANT: `onUpdate(dt)` receives delta time as a parameter. There is NO `castle.dt()` function.
- IMPORTANT: `onDraw()` does NOT receive dt. Use `castle.getTime()` for elapsed time in draw handlers.
- IMPORTANT: `castle.draw.*` functions ONLY work inside `onDraw()`. They do nothing elsewhere.
- IMPORTANT: Check `workspace/scene/script-property-names.md` for property name differences between scripts and YAML.
- IMPORTANT: Always check `workspace/.castle/logs.txt` after restarting to see script errors. Logs have timestamps and `--- restart ---` markers. Always look at logs AFTER the most recent restart marker — older entries are stale.
- IMPORTANT: After ANY script change, restart and immediately check logs for errors before doing anything else.
- IMPORTANT: Position is accessed via `my.layout.x` / `my.layout.y` in scripts, NOT `my.layout.x`. There is no `body` accessor.
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
- IMPORTANT: When editing scripts via the edit command (not file edits), the local `.lua` files won't be updated automatically. The app gets the new script but the workspace file keeps the old version. Prefer editing the `.lua` files directly for scripts.
- IMPORTANT: Script edits NEED TO HAPPEN by editing the actual files in `workspace/scripts/*.lua`. Do NOT send script code through `npx tsx src/index.ts edit`; that desynchronizes the local script file from the app and can later revert or confuse changes. Use `edit` for scene/actor/blueprint structure, then edit the script file and run `restart`.

## Structure

- `workspace/scripts/*.lua` — Editable Lua scripts, one per blueprint. Changes auto-sync to the app.
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

IMPORTANT: Blueprint files and script files use the same slug naming (based on blueprint title). For example, a blueprint titled "Obstacle Bumper" has `blueprints/obstacle-bumper.yaml` and `scripts/obstacle-bumper.lua`. Always read both the blueprint YAML and the script when working on a blueprint — bias toward reading more files than you think you need to understand how things fit together and whether changes could break something else.

## Commands

Run the main connection in the background first, then use commands separately:

```bash
# Background: keep running for scene state sync
npx tsx src/index.ts &

# Commands (run from castle-cli-4 directory):
npx tsx src/index.ts restart                    # stop and restart the scene
npx tsx src/index.ts screenshot [filename]      # capture screenshot
npx tsx src/index.ts edit < edit.json           # apply scene edits (blueprints, actors, variables)
```

## Workflow

1. Edit `workspace/scripts/*.lua` — changes auto-sync to the app
2. Use `npx tsx src/index.ts edit` to add/edit/remove blueprints, actors, and variables
3. `npx tsx src/index.ts restart` — restart to see changes running. Scripts only take effect after restart.
4. Check `workspace/.castle/logs.txt` for errors — look AFTER the latest `--- restart ---` marker
5. `npx tsx src/index.ts screenshot` — capture the result. NOTE: screenshots show whatever state the app is in. If you want to see the running scene, restart first. If the user is in the editor, the screenshot will show the editor view.
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
- A blueprint ID from the current deck (see `workspace/scene/blueprints/*.yaml`)
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
      "script": [{ "code": "function onUpdate(dt)\n  local tx, ty = castle.getTouchPosition()\n  if tx then\n    my.dynamicMotion.vx = (tx - my.layout.x) * 5\n  end\nend" }]
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
- `onCollide(otherActor)` — called on collision

Access actor properties: `my.layout.x`, `my.layout.y`, `my.layout.rotation`, `my.dynamicMotion.vx`, etc. Other actors: `otherActor.layout.x`, etc.
Behavior names in scripts use camelCase without spaces: Layout→`layout`, Dynamic Motion→`dynamicMotion`, Slow Down→`slowDown`.

Key functions (verify in scripting-reference.md before using):
- `castle.getTime()` — elapsed time since card start
- `castle.getTouchPosition()` — returns x, y or nil
- `castle.createActor(title, x, y)` — create actor from blueprint title
- `castle.actorsWithTag(tag)` — get all actors with tag
- `castle.closestActorWithTag(tag)` — get nearest actor with tag
- `castle.getVariable(name)` / `castle.setVariable(name, value)` — deck variables
- `my:isColliding(tag)` — check collision with tagged actors
- `my:destroy()` — destroy this actor
- `castle.draw.*` — drawing functions (only in onDraw)
