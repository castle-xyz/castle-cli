# Castle CLI 4

Castle CLI 4 edits local Castle deck projects for AI-assisted game work. Treat deck/game tasks as focused actor-script work, not repo exploration.

## Start Here

For a new local game, create and serve the project first:

```bash
castle-4 init <deck-dir> --title "Game"
castle-4 serve <deck-dir> --open
```

For app-connected editing, start a long-running bridge session:

```bash
castle-4 connect
```

Wait for `[project] active deck ...` and `[state]`, then work in the synced project under `decks/<deck>/cards/<card-id>/`.

After the project exists, your first action is always to read the current Lua script under `cards/<card-id>/scripts/`. If the task is already scoped to one blueprint, read that script and its matching `scene/blueprints/<slug>.yaml`. Do not spend time planning before reading the script.

Do not run broad `ls`, repo-wide globs, repo-wide `rg`, or browse directories before reading the current script. If you need the card id or script path, use a targeted command limited to the deck directory. Do not read `src/`, `bundles/`, `library/`, old `decks/`, or `full/` unless a specific missing API or CLI bug requires it.

## Read Only Needed Docs

This docs directory contains focused docs under `simple/` and fuller references under `full/`. In the CLI source checkout, those same docs live under `docs/simple/` and `docs/full/`.

Start with `simple/README.md` from installed shared docs, or `docs/simple/README.md` in the source checkout. Then read only the small file that matches the API you need:

- `simple/drawing.md` - `onDraw()` and `castle.draw.*`
- `simple/input-time.md` - touch input, tilt, `dt`, timers
- `simple/actors.md` - `my`, actor properties, actor methods, actor creation
- `simple/variables.md` - deck and local variables
- `simple/physics.md` - collision polling, physics queries, joints
- `simple/async-events.md` - `castle.co.*` and `castle.events.*`
- `simple/math.md` - math helpers

Use `full/` from installed shared docs, or `docs/full/` in the source checkout, only when the simple docs are missing something specific. Then return to editing immediately.

## Fast First Shot

For a new game from scratch, optimize for a visible playable slice:

1. Prefer one Stage/Controller blueprint with one Lua script for the first pass.
2. Put the core loop in `onUpdate(dt)` and render the game in `onDraw()`.
3. Keep the draw/controller actor visible. Use `visible: true` or omit `visible`; never set `visible: false` on an actor that owns `onDraw()`.
4. Use touch input, not keyboard or mouse APIs.
5. For taps, use `castle.getTouches()` and `touch.pressed`. Use `castle.getTouch()` for continuous drag/aiming while the touch is held.
6. Use readable `castle.draw.text` sizes, roughly `7` to `12` for HUD/dialogue and `12` to `20` for short titles.
7. Check logs, take a screenshot, then iterate on the game instead of broadening context.

Split into separate paddle/ball/enemy/HUD blueprints only when the task asks for it or when the first visible loop is already working.

## Commands

```bash
castle-4 init [dir] --title "Game"           # create local deck project
castle-4 serve [dir]                         # serve local project in foreground
castle-4 serve [dir] --open                  # serve in foreground and open browser
castle-4 docs                                # install/update shared agent docs
castle-4 edit                                # apply scene edits from JSON on stdin
castle-4 restart                             # reload active local serve or app scene
castle-4 logs                                # show recent script logs
castle-4 status                              # show connection/preview status
castle-4 screenshot [filename]               # capture screenshot
castle-4 card add [dir] --title "Card 2"     # add a card
castle-4 card remove <card-id> [dir] --force # remove a card
castle-4 push [dir]                          # push as unlisted deck
castle-4 pull <deck-id> [dir]                # pull existing deck
castle-4 list                                # recent decks
```

`serve` chooses an available port. Use `status` or `<deck-dir>/.castle/serve.json`; do not guess ports.

`edit`, `restart`, `logs`, `status`, and `screenshot` target the active serve/app socket. Pass no deck path or `--deck` to those commands. Local `serve` marks file changes dirty; run `castle-4 restart` when a batch of edits is complete.

## Project Files

Local projects use this shape:

- `deck.json` - local deck/card metadata
- `cards/<card-id>/scripts/<slug>.lua` - editable actor script
- `cards/<card-id>/scene/blueprints/<slug>.yaml` - generated blueprint data; read only for inspection
- `cards/<card-id>/scene/blueprints/<slug>.json` - opaque drawing/fixture sidecar; do not edit
- `cards/<card-id>/scene/actors.yaml` - generated placed actors; read only for inspection
- `cards/<card-id>/scene/variables.yaml` - generated deck variables; read only for inspection
- `<deck-dir>/.castle/logs.txt` - script logs and errors
- `<deck-dir>/.castle/screenshots/` - screenshots

Blueprint YAML and script files share the same slug. Read YAML when you need to inspect existing structure, but do not edit scene YAML files directly.

## Edit Workflow

Edit Lua files directly for script changes. Use `edit` for structural changes: blueprints, actors, variables, behaviors, layout, tags, drawing/text settings, script wiring, and rules.

Do not edit generated scene files directly: `scene/blueprints/*.yaml`, `scene/actors.yaml`, `scene/variables.yaml`, or blueprint `.json` sidecars. Treat them as read-only inspection output.

`push` uploads the materialized local project and applies the required content moderation flag payload. It preserves the `visibility` and `initialCard` from `deck.json`. New decks default to unlisted and try to capture a cover from local serve when a ready browser preview is open.

After each significant script or scene change:

1. Run `castle-4 restart` after the whole change is written.
2. Read logs with `castle-4 logs` or `<deck-dir>/.castle/logs.txt`.
3. Fix script errors immediately.
4. Run `castle-4 screenshot <path>` when visual output matters.

## Mobile First

Castle games run on mobile devices. Design for touch:

- For taps/clicks, use `castle.getTouches()` and handle `touch.pressed`.
- Use `castle.getTouch()` for continuous drag/aiming while a touch is held.
- Do not use keyboard events or mouse APIs.
- Touch targets should be at least `0.5` world units wide/tall.
- For tilt games, use `castle.getDeviceTilt()`.
- The canvas is portrait, 5:7.

## Coordinate System

In `onDraw()`, the visible world is:

- `x = -5` at the left edge and `x = 5` at the right edge.
- `y = -7` at the top edge and `y = 7` at the bottom edge.
- `(0, 0)` is the center.
- Positive Y points downward. Top of screen is negative Y.

Leave about `0.3` units of margin from the edges. `castle.draw.rectangle("fill", x, y, w, h)` uses top-left `x, y`.

Actor layout rotation is in degrees. `castle.draw.rotate(angle)` uses radians inside `onDraw()`.

## Actor Script Basics

Scripts use Luau actor callbacks:

```lua
function onCreate()
  -- called once when actor is created
end

function onUpdate(dt)
  -- called every frame; dt is seconds
end

function onDraw()
  -- called every frame for custom drawing
end

function onMessage(message, triggeringActor)
  -- called when actor receives a message
end
```

Important boundaries:

- `onUpdate(dt)` receives `dt`; there is no `castle.dt()`.
- `onDraw()` does not receive `dt`; use state from `onUpdate(dt)` or `castle.getTime()`.
- `castle.draw.*` only works inside `onDraw()`.
- `onDraw()` replaces the actor's default drawing.
- Keep `onDraw()` actors visible with `visible: true` or omitted `visible`.
- Use `my.layout.x` and `my.layout.y` for position. There is no `my.body`.
- There is no `onCollide` callback in normal actor scripts.
- Use `castle.destroyActor(actor)`, not `actor:destroy()` or `my:destroy()`.
- Use `castle.actorExists(actor)`, not `actor:isAlive()`.
- Use `print(...)` for Lua logs. There is no `castle.log(...)`.
- Do not use Lua `goto` or labels like `::done::`; Castle actor scripts reject them. Use flags, helper functions, or loop conditions instead.

Common script APIs:

```lua
castle.getTime()
castle.getTouch()
castle.getTouches()
castle.getDeviceTilt()
castle.createActor("Blueprint Title", x, y)
castle.destroyActor(actor)
castle.actorExists(actor)
castle.actorsWithTag("tag")
castle.closestActorWithTag("tag")
castle.getVariable("name")
castle.setVariable("name", value)
my:isColliding("tag")
my:getCollidingActors("tag")
otherActor:sendMessage("message", data)
```

`castle.createActor({ body = ... })`, `castle.image.load`, and `castle.draw.image` are not available in normal CLI 4 actor scripts. Use blueprint actors, Text actors, default drawings, and `castle.draw.*` shapes.

`my:isColliding` and `my:getCollidingActors` only work with physics-based movement. If actors move by directly setting `layout.x/y`, use manual distance or AABB checks.

There is no `my:broadcastMessage(...)`. To notify multiple actors, loop over `castle.actorsWithTag("tag")` and call `actor:sendMessage("message", data)` on each actor.

## Drawing API

Use these only inside `onDraw()`:

```lua
castle.draw.setColor(r, g, b, a)              -- floats 0..1; alpha optional
castle.draw.setColorHex(0xffcc00, a)          -- alpha optional
castle.draw.rectangle("fill", x, y, w, h)
castle.draw.roundedRectangle("fill", x, y, w, h, rx, ry)
castle.draw.circle("fill", x, y, radius)
castle.draw.ellipse("fill", x, y, radiusX, radiusY)
castle.draw.line(x1, y1, x2, y2)
castle.draw.polygon("fill", x1, y1, x2, y2, x3, y3, ...)
castle.draw.triangle(x1, y1, x2, y2, x3, y3)
castle.draw.setLineWidth(width)
castle.draw.push()
castle.draw.pop()
castle.draw.translate(x, y)
castle.draw.rotate(angleRadians)
castle.draw.scale(sx, sy)
castle.draw.origin()
castle.draw.text(text, x, y, size, halign, valign, font)
local w, h = castle.draw.measureText(text, size, font)
```

There is no `castle.draw.print()`. Use `castle.draw.text(...)`.

Known fonts: `DMSans`, `Glacier`, `HelicoCentrica`, `Piazzolla`, `YatraOne`, `Bore`, `Synco`, `Tektur`, `CourierPrime`.

## Scene Edits

Pipe one-off JSON to `edit`. Do not create persistent edit JSON files.

```bash
castle-4 edit <<'EDIT'
{
  "description": "add brick blueprint and actor",
  "blueprints": {
    "new-brick": {
      "forkBlueprintId": "default-blueprint-1",
      "title": "Brick",
      "replaceDrawing": "red square",
      "components": "Layout:\n  widthScale: 1.2\n  heightScale: 0.4\n  visible: true\nTags:\n  tagsString: brick"
    }
  },
  "actors": {
    "new-brick-1": {
      "title": "Brick",
      "components": "Layout:\n  x: -3\n  y: -4"
    }
  }
}
EDIT
```

New blueprints must fork an existing blueprint id or a default:

- `default-blueprint-0` Drawing
- `default-blueprint-1` Empty blueprint
- `default-blueprint-2` Text
- `default-blueprint-3` Portal
- `default-blueprint-4` Mirror
- `default-blueprint-5` Wall
- `default-blueprint-6` Ball
- `default-blueprint-7` Character
- `default-blueprint-8` Tracking Camera
- `default-blueprint-9` Creature
- `default-blueprint-10` Border
- `default-blueprint-11` Background
- `default-blueprint-12` Collectible
- `default-blueprint-13` Score Counter

When forking from Empty or Drawing, provide `replaceDrawing`, for example `blue square`, `red circle`, `green square`, `yellow square`, `purple circle`, `orange square`, `gray square`, or `slate circle`.

`components` is a YAML string using behavior display names such as `Layout`, `Drawing`, `Text`, `Tags`, `Dynamic Motion`, `Solid`, `Bounce`, `Gravity`, `Friction`, `Slow Down`, `Speed Limit`, and `Axis Lock`.

When adding a Lua script through `edit`, `script` must be an array of edit operations:

```json
"script": [{ "code": "function onCreate()\n  print(\"ready\")\nend\n" }]
```

Do not use a plain string for `script`; it will be ignored. Do not put `Script:` in `components` as a substitute for script code; the array-form `script` field enables the Script behavior and writes the matching Lua file. Batch related blueprint/script changes in one `edit` call when possible.

Actor entries reference blueprints by title. Define new blueprints before actors that use them.

Only these per-actor properties should be set on actor entries:

- Layout: `x`, `y`, `angle`, `widthScale`, `heightScale`
- Drawing: `initialFrame`
- Text: `content`, `fontSizeScale`
- Link: `targetDeckId`

Set `visible` and `layerName` on the blueprint Layout, not on placed actor entries.

Placed actor Layout values override blueprint Layout values. When size matters for placed actors, set `widthScale` and `heightScale` on the actor entries or draw at the intended size in Lua.

`castle.setVariable(name, value)` stores numbers. In normal actor scripts, it only updates existing deck variables; define shared variables first through `edit`:

```json
"variables": {
  "score-var": { "name": "score", "initialValue": 0, "lifetime": "deck" }
}
```

Use Lua locals, actor variables, messages, or numeric codes for string/boolean game state.
