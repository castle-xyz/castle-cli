# Async And Events

Use these only when they make the game simpler. For many first-shot games, a few local variables in `onUpdate(dt)` are faster and clearer.

## Coroutines

```lua
castle.co.start(function()
  castle.co.wait(1.0)
  print("one second later")

  castle.co.waitUntil(function()
    return playerReady
  end)
  print("ready")
end)
```

Available coroutine helpers:

```lua
castle.co.start(fn)
castle.co.wait(seconds)
castle.co.waitUntil(conditionFn)
castle.co.waitFor(eventName)
castle.co.fireEvent(eventName, data)
castle.co.parallel(fnA, fnB, ...)
castle.co.race(fnA, fnB, ...)
```

`castle.co.waitFor` listens to the coroutine event bus. It is also woken by script messages delivered to the actor.

## Events

```lua
local unsubscribe = castle.events.on("scoreUp", function(data)
  score = score + data.amount
end)

castle.events.emit("scoreUp", { amount = 10 })
unsubscribe()
```

```lua
castle.events.once("gameStart", function(data)
  started = true
end)
```

`castle.events.*` is separate from `castle.co.fireEvent` / `castle.co.waitFor`.
