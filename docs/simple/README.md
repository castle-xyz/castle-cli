# Castle CLI Simple Docs

Start here for first-pass game work. These docs intentionally cover the small regular actor-script API that is usually enough to make a playable game.

Do not browse the full reference, old decks, or `library/` unless you have a specific missing API, behavior schema, multiplayer need, or rules task. Broad docs exploration is a common source of slow, worse first shots.

Read only the file you need:

- `drawing.md` - `onDraw()` and `castle.draw.*`
- `input-time.md` - touch input, tilt, `dt`, timers
- `actors.md` - `my`, actor properties, actor methods, blueprint-based actor creation
- `variables.md` - deck and local variables
- `physics.md` - collision checks and physics queries
- `async-events.md` - `castle.co.*` and `castle.events.*`
- `math.md` - Castle math helpers

For a new game from scratch, prefer one visible Stage or Controller actor with `onUpdate(dt)` and `onDraw()`. Split into separate blueprints after the core loop is visible.

## Critical Boundaries

These simple docs are for normal Castle CLI actor scripts in `cards/<card-id>/scripts/<slug>.lua`.

Do not use APIs from `castle-cli-script` that only work in scene scripts or single-file projects:

- Do not use `castle.createActor({ body = ... })`; in Castle actor scripts, use `castle.createActor("Blueprint name", x, y)` after defining that blueprint.
- Do not use `onCollide` or `onSeparate`; normal actor scripts do not receive those callbacks. Poll with `my:isColliding("tag")`, `my:getCollidingActors("tag")`, or manual distance checks in `onUpdate(dt)`.
- Do not use `actor:destroy()` or `actor:isAlive()`; use `castle.destroyActor(actor)` and `castle.actorExists(actor)`.
- Do not use Lua `goto` or labels like `::done::`; Castle actor scripts reject them. Use flags, helper functions, or loop conditions instead.

If a task truly requires a full reference, use `full/` from shared docs or `docs/full/` in the source checkout, then return to editing quickly.
