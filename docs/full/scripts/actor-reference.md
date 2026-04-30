# Actor Reference

## Behaviors

### [Layout](../behaviors/Layout)

#### `layout.x` {#layout.x}

The X position.

#### `layout.y` {#layout.y}

The Y position.

#### `layout.rotation` {#layout.rotation}

The rotation in degrees.

#### `layout.widthScale` {#layout.widthScale}

The width scale. Can be set to negative to flip the actor horizontally.

#### `layout.heightScale` {#layout.heightScale}

The height scale. Can be set to negative to flip the actor vertically.

#### `layout.visible` {#layout.visible}

Is the actor is visible or not.

### [Drawing](../reference/Art)

#### `drawing.currentFrame` {#drawing.currentFrame}

The current frame of the actor. Setting this changes the frame.

#### `drawing.playMode` {#drawing.playMode}

Controls how the drawing animates. Must be one of: "still", "play once", "loop".

#### `drawing.framesPerSecond` {#drawing.framesPerSecond}

The speed of the animation if [`drawing.playMode`](#drawing.playMode) is set to "play once" or "loop".

#### `drawing.loopStartFrame` {#drawing.loopStartFrame}

The first frame of the loop if [`drawing.playMode`](#drawing.playMode) is set to "play once" or "loop".

#### `drawing.loopEndFrame` {#drawing.loopEndFrame}

The last frame of the loop if [`drawing.playMode`](#drawing.playMode) is set to "play once" or "loop".

#### `drawing.opacity` {#drawing.opacity}

The opacity represented as a number between 0 and 1.

#### `drawing.initialFrame` {#drawing.initialFrame}

The frame that the drawing starts at when the actor is created. This is only useful for reading the initial frame. For setting the current frame, use [`drawing.currentFrame`](#drawing.currentFrame).

### [Text](../behaviors/Text)

#### `text.content` {#text.content}

#### `text.fontSize` {#text.fontSize}

### [Fixed Motion](../behaviors/Motion)

These properties only apply to actors that have Motion set to Fixed in the Movement tab.

#### `fixedMotion.vx` {#fixedMotion.vx}

The X velocity.

#### `fixedMotion.vy` {#fixedMotion.vy}

The y velocity.

#### `fixedMotion.rotationsPerSecond` {#fixedMotion.rotationsPerSecond}

The rotational velocity.

#### `fixedMotion.enabled` {#fixedMotion.enabled}

Is fixed motion enabled. Only works if fixed motion has been added in the editor.

### [Dynamic Motion](../behaviors/Motion)

These properties only apply to actors that have Motion set to Dynamic in the Movement tab.

#### `dynamicMotion.vx` {#dynamicMotion.vx}

The x velocity.

#### `dynamicMotion.vy` {#dynamicMotion.vy}

The y velocity.

#### `dynamicMotion.rotationSpeed` {#dynamicMotion.rotationSpeed}

The rotational velocity.

#### `dynamicMotion.density` {#dynamicMotion.density}

#### `dynamicMotion.enabled` {#dynamicMotion.enabled}

Is dynamic motion enabled. Only works if dynamic motion has been added in the editor.

### [Gravity](../behaviors/Gravity)

#### `gravity.strength` {#gravity.strength}

#### `gravity.enabled` {#gravity.enabled}

Is gravity enabled. Only works if gravity has been added in the editor.

### [Bounce](../behaviors/Bounce)

#### `bounce.rebound` {#bounce.rebound}

#### `bounce.enabled` {#bounce.enabled}

Is bounce enabled. Only works if bounce has been added in the editor.

### Friction

#### `friction.amount` {#friction.amount}

#### `friction.enabled` {#friction.enabled}

Is friction enabled. Only works if friction has been added in the editor.

### [Slow Down](../behaviors/Slowdown)

#### `slowDown.translation` {#slowDown.translation}

#### `slowDown.rotation` {#slowDown.rotation}

#### `slowDown.enabled` {#slowDown.enabled}

Is slow down enabled. Only works if slow down has been added in the editor.

### Speed Limit

#### `speedLimit.maxSpeed` {#speedLimit.maxSpeed}

#### `speedLimit.enabled` {#speedLimit.enabled}

Is speed limit enabled. Only works if speed limit has been added in the editor.

### Axis Lock

#### `axisLock.rotates` {#axisLock.rotates}

A `boolean` representing whether the actor can rotate.

#### `axisLock.enabled` {#axisLock.enabled}

Is axis lock enabled. Only works if axis lock has been added in the editor.

### [Analog Stick](../behaviors/AnalogStick)

#### `analogStick.speed` {#analogStick.speed}

#### `analogStick.turnFriction` {#analogStick.turnFriction}

#### `analogStick.axes` {#analogStick.axes}

Must be one of: "x", "y", "x and y".

#### `analogStick.enabled` {#analogStick.enabled}

Is analog stick. Only works if analog stick has been added in the editor.

### [Slingshot](../behaviors/Slingshot)

#### `slingshot.speed` {#slingshot.speed}

#### `slingshot.enabled` {#slingshot.enabled}

Is slingshot enabled. Only works if slingshot has been added in the editor.

### Counter

#### `counter.value` {#counter.value}

#### `counter.enabled` {#counter.enabled}

Is counter enabled. Only works if counter has been added in the editor.

### [Camera](../reference/Camera)

#### `camera.zoom` {#camera.zoom}

#### `camera.angle` {#camera.angle}

#### `camera.enabled` {#camera.enabled}

Is camera enabled. Only works if camera has been added in the editor.

### [Tags](../reference/Tag)

#### `actor:hasTag("tag")` {#hasTag}

Returns whether the actor has the given tag.

This function only accepts one tag to check for. To check for multiple tags use `actor:hasTag("first") and actor:hasTag("second")` to check if all the tags are present, or `actor:hasTag("first") or actor:hasTag("second")` to check if just one of the tags is present.

#### `actor:addTag("tag")` {#addTag}

Adds the tag to the actor.

This function accepts multiple parameters, so you can add multiple tags with `actor:addTag("first", "second")`

#### `actor:removeTag("tag")` {#removeTag}

Removes the tag from the actor.

#### `actor:getTags()` {#getTags}

Returns the list of tags this actor has.

### [Tilt](../behaviors/Tilt)

#### `tilt.acceleration` {#tilt.acceleration}

#### `tilt.axes` {#tilt.axes}

Must be one of: "x", "y", "x and y".

#### `tilt.enabled` {#tilt.enabled}

Is tilt enabled. Only works if tilt has been added in the editor.

### Face Tracking

#### `faceTracking.featureType` {#faceTracking.featureType}

Must be one of: "left eye", "right eye", "nose", "mouth".

#### `faceTracking.offsetX` {#faceTracking.offsetX}

#### `faceTracking.offsetY` {#faceTracking.offsetY}

#### `faceTracking.enabled` {#faceTracking.enabled}

Is face tracking enabled. Only works if face tracking has been added in the editor.

## Functions

These functions are called on actors as `actor:function()`. Note that you need to use a `:` and not a `.`. For example: `my:speed()`.

#### `actor:speed()` {#speed}

The speed of an actor.

#### `actor:angleOfMotion()` {#angleOfMotion}

The angle that the actor is moving at. When the actor is moving horizontally to the right this returns `0`. When the actor is moving vertically upward this returns `-90`.

#### `actor:distanceTo(other)` {#distanceTo}

The distance between `actor` and `other` (where `other` is also an actor).

#### `actor:angleTo(other)` {#angleTo}

The angle between `actor` and `other` (where `other` is also an actor) in degrees. When `other` is to the right of `actor` with the same `y` value this returns `0`, and when `other` is above `actor` at the same `x` value this returns `-90`.

#### `actor:faceDirectionOfMotion(amount)` {#faceDirectionOfMotion}

Rotates the actor to face the direction in which it is moving.

The `amount` is optional -- it causes the actor to rotate partway to the target direction rather than fully. An `amount` of `0.5` rotates the actor halfway to the target. If this function is being called every update, a small `amount` like `0.01` causes the actor to rotate smoothly to the target. An amount of `1.0` rotates the actor fully to the target immediately (the default). And an amount of `0` doesn't rotate the actor at all.

#### `actor:moveToFront(amount)` {#moveToFront}

Puts the actor in front of all other actors.

#### `actor:moveToBack(amount)` {#moveToBack}

Puts the actor behind all other actors.

#### `actor:followWithCamera(amount)` {#followWithCamera}

Sets this actor as the target of the camera. The camera is the viewport into the scene. This can be used to follow the actor as it goes off-screen.

#### `actor:isColliding("tag")` {#isColliding}

Returns whether the actor is colliding another actor with the given tag.

The tag parameter is optional -- if it's not given, the function returns whether the actor is colliding with any other actor regardless of tag.

#### `actor:getCollidingActors("tag")` {#getCollidingActors}

Returns a table of all actors that are colliding this actor that have the given tag.

The tag parameter is optional -- if it's not given, the function returns all of the actors that are colliding with this actor, regardless of tag.

#### `actor:getBlueprintName()` {#getBlueprintName}

The blueprint name of this actor.

#### `actor:getCreatorActor()` {#getCreatorActor}

Returns the actor that created this actor (via `castle.createActor`), or `nil` if there is no creator.

```
-- move toward the actor that created me
local creator = my:getCreatorActor()
if creator then
  local angle = my:angleTo(creator)
  my.dynamicMotion.vx = math.cos(math.rad(angle)) * 5
  my.dynamicMotion.vy = math.sin(math.rad(angle)) * 5
end
```

#### `actor:isInCameraViewport()` {#isInCameraViewport}

Returns whether the actor is currently within the camera viewport.

### Messaging

#### `actor:sendMessage(message, data)` {#sendMessage}

Sends a message to this actor's script. The actor's `onMessage` handler will be called with the given `message` string, the sending actor as `triggeringActor`, and `data` (which can be a table, string, number, or `nil`).

The `data` parameter is optional. If not provided, `data` will be `nil` in the receiving actor's `onMessage` handler. The data is passed by reference, not copied.

```
-- in the key's script: when colliding with the player, send it our color
function onUpdate(dt)
  local player = castle.closestActorWithTag("player")
  if player and my:isColliding("player") then
    player:sendMessage("pickedUpKey", { color = "red" })
    castle.destroyActor(my)
  end
end
```

```
-- in the player's script: receive the key color
function onMessage(message, triggeringActor, data)
  if message == "pickedUpKey" and data then
    print("Got the " .. data.color .. " key!")
  end
end
```

## Multiplayer functions

The following functions only work for multiplayer [shared actors](../multiplayer/shared-blueprints).

#### `actor:getSharedOwnerUser()` {#getSharedOwnerUser}

Gets the user whose device owns this actor. The user is in the format `{ username, userId, isActive }`. For more information, see [`castle.getUsersInParty()`](castle-library-reference#getUsersInParty).

The username value can also be accessed by writing `$username` in the content of a shared [Text](../behaviors/Text) actor.

#### `actor:isSharedOwnedByPlayer()` {#isSharedOwnedByPlayer}

Returns whether this shared actor is owned by the current player.
