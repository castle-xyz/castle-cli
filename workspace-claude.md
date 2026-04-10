# Castle CLI Workspace

This workspace is synced with a Castle deck. The CLI runs in the background syncing scene state from the app. Use commands to restart, screenshot, and edit the scene.

## IMPORTANT — Read Before Doing Anything

- IMPORTANT: You MUST verify every Castle API function exists in the docs before using it. Read `workspace/scene/scripting-reference.md` and `workspace/scene/docs/`. Do NOT guess function names.
- IMPORTANT: `onUpdate(dt)` receives delta time as a parameter. There is NO `castle.dt()` function.
- IMPORTANT: `onDraw()` does NOT receive dt. Use `castle.getTime()` for elapsed time in draw handlers.
- IMPORTANT: `castle.draw.*` functions ONLY work inside `onDraw()`. They do nothing elsewhere.
- IMPORTANT: Check `workspace/scene/script-property-names.md` for property name differences between scripts and YAML.
- IMPORTANT: Always check `workspace/.castle/logs.txt` after restarting to see script errors. Logs have timestamps and `--- restart ---` markers. Always look at logs AFTER the most recent restart marker — older entries are stale.
- IMPORTANT: After ANY script change, restart and immediately check logs for errors before doing anything else.
- IMPORTANT: Position is accessed via `my.layout.x` / `my.layout.y` in scripts, NOT `my.body.x`. There is no `body` accessor.
- IMPORTANT: There is NO `onCollide` callback handler for actor scripts. Detect collisions by polling `my:isColliding("tag")` or `my:getCollidingActors("tag")` inside `onUpdate(dt)`.
- IMPORTANT: To destroy an actor, use `castle.destroyActor(my)` or `castle.destroyActor(otherActor)`. There is no `my:destroy()` method.
- IMPORTANT: When you discover a misunderstanding about the Castle API or system (e.g. a function doesn't exist, a property name is wrong, a pattern doesn't work), add an IMPORTANT note to this CLAUDE.md file documenting the correct behavior so you remember it in future sessions.

## Structure

- `workspace/scripts/*.lua` — Editable Lua scripts, one per blueprint. Changes auto-sync to the app.
- `workspace/scene/` — Read-only scene state, auto-updated by the app:
  - `blueprints.yaml` — All blueprints with behaviors, components, and properties
  - `actors.yaml` — Actor instances with positions
  - `variables.yaml` — Deck variables
  - `behaviors.yaml` — Available behavior types and properties
  - `rules.yaml` — Available rule triggers, responses, conditions
  - `scripting-reference.md` — Full Lua scripting API reference
  - `script-property-names.md` — Property name mappings (script vs YAML names)
  - `docs/` — Castle documentation and tutorials
- `workspace/.castle/logs.txt` — Script logs and errors from the running scene
- `workspace/.castle/screenshots/` — Captured screenshots (latest.png is most recent)

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

Pipe JSON to `npx tsx src/index.ts edit`. The JSON has three optional top-level keys: `blueprints`, `actors`, `variables`.

### Blueprints

All new blueprints must be created by **forking** an existing one. You cannot create from scratch. Use `forkBlueprintId` with either:
- A blueprint ID from the current deck (see `workspace/scene/blueprints.yaml`)
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

#### Edit existing blueprint (use actual entryId from blueprints.yaml):
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
      "script": [{ "code": "function onUpdate(dt)\n  local tx, ty = castle.getTouchPosition()\n  if tx then\n    my.dynamicMotion.vx = (tx - my.body.x) * 5\n  end\nend" }]
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

Access actor properties: `my.body.x`, `my.body.y`, `my.layout.rotation`, `my.dynamicMotion.vx`, etc.
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
