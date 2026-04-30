# Variables

For simple first shots, ordinary Lua locals are usually enough:

```lua
local score = 0
local lives = 3
```

Use Castle variables when rules, other actors, counters, or persistence need to share state.

## Deck Variables

```lua
castle.setVariable("score", 100)
local score = castle.getVariable("score")
```

Deck variables store numbers. For string or boolean state shared across actors, use numeric codes, actor local variables, Lua locals, or messages.

The `deck.variables` helper is equivalent:

```lua
deck.variables.score = deck.variables.score + 1
```

Define variables structurally with `npx tsx src/index.ts edit` when they need initial values or lifetimes.

## Local Variables

Local variables live on an actor:

```lua
my.variables.hp = 3
local hp = my.variables.hp
```

Other actors' local variables:

```lua
local enemy = castle.closestActorWithTag("enemy")
if enemy then
  enemy.variables.hp = enemy.variables.hp - 1
end
```

## Tickers

Tickers should be updated by diff:

```lua
castle.updateTicker("topScore", 1)
```

Do not reset tickers by setting them directly.
