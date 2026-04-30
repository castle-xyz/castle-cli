# Actors And Blueprints

Each script runs on an actor. The current actor is `my`.

Common properties:

```lua
my.layout.x = 0
my.layout.y = 1
my.layout.rotation = 45      -- degrees
my.layout.widthScale = 2
my.layout.heightScale = 2
my.layout.visible = true

my.text.content = "Hello"
my.text.fontSize = 10

my.dynamicMotion.vx = 2
my.dynamicMotion.vy = 0
```

Only use a behavior property if that behavior exists on the blueprint. Check the blueprint YAML or add the behavior first.

## Actor Methods

Call actor methods with `:`.

```lua
my:moveToFront()
my:moveToBack()
my:followWithCamera()

if my:hasTag("player") then
  my:addTag("powered")
  my:removeTag("hurt")
end

local tags = my:getTags()
local speed = my:speed()
local angle = my:angleOfMotion()
local distance = my:distanceTo(otherActor)
local angleToOther = my:angleTo(otherActor)
```

Collision polling:

```lua
function onUpdate(dt)
  if my:isColliding("enemy") then
    lives = lives - 1
  end

  for _, coin in ipairs(my:getCollidingActors("coin")) do
    castle.destroyActor(coin)
  end
end
```

`getCollidingActors` and `isColliding` require physics-based movement/collision behaviors. If you move objects by setting `layout.x` and `layout.y` directly, use manual distance or rectangle overlap checks instead.

## Finding Actors

```lua
local enemy = castle.closestActorWithTag("enemy")
local coins = castle.actorsWithTag("coin")
local count = castle.numActorsWithTag("coin")
```

Check actor existence before using an actor saved from an earlier frame:

```lua
if castle.actorExists(enemy) then
  enemy.layout.x = enemy.layout.x + 1
end
```

## Creating And Destroying Actors

In CLI 4 actor scripts, create actors from existing blueprints:

```lua
local bullet = castle.createActor("Bullet", my.layout.x, my.layout.y)
if bullet then
  bullet.dynamicMotion.vx = 5
end

castle.destroyActor(bullet)
```

Before calling `castle.createActor("Bullet", x, y)`, the project needs a blueprint titled `Bullet`.

Do not use table-style actor creation:

```lua
-- Do not use this in CLI 4 actor scripts.
castle.createActor({ body = { x = 0, y = 0 } })
```

That overload returns `nil` from normal actor scripts.

Do not use `actor:destroy()` or `actor:isAlive()` in normal actor scripts. Use `castle.destroyActor(actor)` and `castle.actorExists(actor)`.

## Messaging

```lua
otherActor:sendMessage("pickedUpKey", { color = "red" })

function onMessage(message, triggeringActor, data)
  if message == "pickedUpKey" and data then
    print("got key " .. data.color)
  end
end
```
