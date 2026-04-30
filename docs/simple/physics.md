# Physics

For first-shot games, prefer manual position math unless you specifically need physics collision. If actors move by setting `layout.x` and `layout.y`, use manual overlap or distance checks.

Physics collision helpers work when the actors have the needed collision/motion behaviors:

```lua
function onUpdate(dt)
  if my:isColliding("wall") then
    my.dynamicMotion.vx = -my.dynamicMotion.vx
  end

  for _, coin in ipairs(my:getCollidingActors("coin")) do
    castle.destroyActor(coin)
  end
end
```

There is no normal actor-script `onCollide` or `onSeparate` callback. Poll in `onUpdate(dt)`.

## Physics Queries

All query functions can take `{ tag = "tagName" }` as the last argument.

```lua
local actors = castle.physics.queryPoint(x, y)
local nearby = castle.physics.queryCircle(my.layout.x, my.layout.y, 2.5)
local inBox = castle.physics.queryBox(0, 0, 10, 5)
```

Raycasts:

```lua
local hit = castle.physics.raycast(x1, y1, x2, y2, { tag = "wall" })
if hit then
  print("hit at " .. hit.x .. ", " .. hit.y)
end

local hits = castle.physics.raycastAll(x1, y1, x2, y2)
```

Raycast hit fields:

- `actor`
- `x`, `y`
- `normalX`, `normalY`
- `fraction`

## Joints

Joints connect two physics actors:

```lua
local joint = castle.physics.newRevoluteJoint(actorA, actorB, {
  motorSpeed = 180,
  maxMotorTorque = 50,
})

joint:destroy()
```

Available joint constructors:

- `castle.physics.newRevoluteJoint(actorA, actorB, options)`
- `castle.physics.newDistanceJoint(actorA, actorB, options)`
- `castle.physics.newPrismaticJoint(actorA, actorB, options)`
- `castle.physics.newWeldJoint(actorA, actorB, options)`
- `castle.physics.newRopeJoint(actorA, actorB, options)`
