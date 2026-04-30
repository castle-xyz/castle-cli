# Castle Library Reference

### Actor Functions

#### `castle.createActor("Blueprint name", x, y)` {#createActor}

Creates a new [actor](../reference/Actor) using a name of a [blueprint](../reference/Blueprint) and the initial x and y position. This returns an actor variable that you can use to access actor properties or pass into other functions.

```
-- There must be a blueprint named Wall for this to work
local newActor = castle.createActor("Wall", 0, 0)
newActor.layout.rotation = 45
```

#### `castle.destroyActor(Actor)` {#destroyActor}

Destroys an actor.

```
-- destroy the current actor
castle.destroyActor(my)
```

```
-- create an actor and then destroy it
local newActor = castle.createActor("Wall", 0, 0)

...

castle.destroyActor(newActor)
```

#### `castle.actorExists(Actor)` {#actorExists}

Returns `true` if the actor still exists in the scene, `false` if it has been destroyed or is invalid.

```
local enemy = castle.closestActorWithTag("enemy")
if castle.actorExists(enemy) then
  enemy.layout.x = 0
end
```

#### `castle.closestActorWithTag("tag")` {#closestActorWithTag}

Returns the closest actor with the tag, or `nil`.

```
local otherActor = castle.closestActorWithTag("wall")
otherActor.layout.rotation = 45
```

#### `castle.actorsWithTag("tag")` {#actorsWithTag}

Returns a table of all actors with the tag.

```
local otherActors = castle.actorsWithTag("wall")
for _, otherActor in ipairs(otherActors) do
    otherActor.layout.rotation = 45
end
```

#### `castle.numActorsWithTag("tag")` {#numActorsWithTag}

Returns the number of actors with the tag.

#### `castle.createTextBox("Message", action)` {#createTextBox}

Creates a [text box](../behaviors/Text#text-boxes) at the bottom of the screen. When the user taps the text box it disappears. `action` is optional and can be used to change the tap action -- currently the only supported value for `action` is `"none"` which causes the text box to not disappear on tap.

#### `castle.getTouches()` {#getTouches}

Returns a table of currently active touches. Each element of the table is a table with the following fields:

- `id`: A number that is unique to this touch and is never used again, even after this touch ends.
- `x`: The x coordinate of the touch position in the scene.
- `y`: The x coordinate of the touch position in the scene.
- `deltaX`: The change in the x coordinate of the touch position in the last update.
- `deltaY`: The change in the x coordinate of the touch position in the last update.
- `initialX`: The x coordinate of the position of the touch when it began.
- `initialY`: The x coordinate of the position of the touch when it began.
- `pressed`: A `boolean` -- whether the touch began this update. This is `true` only for one update.
- `released`: A `boolean` -- whether the touch was released this update. This is `true` only for one update. After that update, the touch is no longer returned by `castle.getTouches()`.
- `duration`: Time since the touch began in seconds.

The results are in order of oldest to latest touch.

For example, the following code prints to the log when a touch begins. This also works for all the touches in a multi-touch interaction.

```
local touches = castle.getTouches()
for _, touch in ipairs(touches) do
    if touch.pressed then
        print('touch: ' .. touch.x .. ', ' .. touch.y)
    end
end
```

#### `castle.getTouch(touchId)` {#getTouch}

Returns a table with the same fields as each element of `castle.getTouches()`. The `touchId` parameter is optional -- if it is given, it returns the currently active touch with that `id`, or `nil` if no such touch is active. If `touchId` is not given the oldest active touch is returned.

For example, the following code prints to the log when a touch begins. This only handles the first touch in a multi-touch interaction.

```
local touch = castle.getTouch()
if touch.pressed then
    print('touch: ' .. touch.x .. ', ' .. touch.y)
end
```

#### `castle.getActorsAtTouch(touchId)` {#getActorsAtTouch}

Returns a table of all the actors overlap with the given touch.

#### `castle.getDeviceTilt` {#getDeviceTilt}

Returns two values -- the `x` and `y` tilt of the device. These values change with the angle at which the user is holding the device.

For example, the following code lets the user control the actor by tilting the device. The actor is assumed to have dynamic motion.

```
function onUpdate(dt)
    local tiltX, tiltY = castle.getDeviceTilt()
    my.dynamicMotion.vx = tiltX
    my.dynamicMotion.vy = tiltY
end
```

#### `castle.getDeviceTiltX` {#getDeviceTiltX}

Returns the `x` tilt of the device.

#### `castle.getDeviceTiltY` {#getDeviceTiltY}

Returns the `y` tilt of the device.

### Text Functions

#### `castle.getTextInput(function(text, canceled) ... end)` {#getTextInput}

Prompts the player to input text with the device keyboard. If the player dismissed the keyboard, `canceled` is true. Otherwise, `text` contains the string they provided.

The user must be logged in, and the user must be playing in the app (not on web). The user must interact with the deck (i.e. touch it) at least once before the keyboard will show. If the user can't provide text for any reason, `canceled` is true.

```
-- pair this with e.g. "When this is tapped, send script message "askForText"

function onMessage(message, triggeringActor)
  if message == "askForText" then
    castle.getTextInput(function(text, canceled)
      if canceled then
        print("canceled")
      else
        local label = castle.actorsWithTag("label")[1]
        label.text.content = text
      end
    end)
  end
end
```

### Rule Functions

#### `castle.sendTriggerMessage("Message string")` {#sendTriggerMessage}

[Triggers](../reference/Trigger) a [rule](../reference/Rule) that is listening for the script message event.

Select this in the triggers list:
![Script message trigger](./assets/script-message-trigger-list.png)

Listen for a specific message
![Script message trigger summary](./assets/script-message-trigger-summary.png)

```
-- This will trigger the rule
castle.sendTriggerMessage("TestMessage")
```

#### `castle.setRandomSeed(seed)` {#setRandomSeed}

Sets the seed used by random expressions in [rules](../reference/Rule). (This does not affect Lua `math.random()` calls; you can use `math.randomseed()` for those.) See [daily challenge pattern](../expressions/CurrentDate#daily-challenge-pattern) for a common use case combining this with `castle.getServerDate()`.

```
castle.setRandomSeed(12345)
```

### Variable Functions

#### `castle.updateTicker("ticker name", diff)` {#updateTicker}

Update a ticker with a diff. Tickers might behave inconsistently if you set them with absolute values. If you try to reset the ticker to 1 like this:

```
castle.updateTicker("ticker", 1 - castle.getVariable("ticker"))
```

it might work in some cases but will probably fail if a lot of people join your deck at the same time.

#### `castle.writeToLeaderboard(variableName, scope?, scopeParam?)` {#writeToLeaderboard}

Writes a variable's value to a [leaderboard](../reference/Leaderboard). By default this writes to a deck-global leaderboard for the variable, but you can optionally pass a scope (`"global"`, `"daily"`, `"card"`, or `"custom"`). See [Leaderboard scopes](../reference/Leaderboard#scopes) for details.

If the scope is `"daily"`, `scopeParam` is the timezone (`"player"` or `"Castle"`) for when the leaderboard should reset. If the scope is `"custom"`, `scopeParam` is an identifier for the custom scope (can include alphanumeric characters, `-`, and `_`).

```
castle.writeToLeaderboard("score")
castle.writeToLeaderboard("score", "daily", "player")
castle.writeToLeaderboard("score", "custom", "week-1")
```

#### `castle.showLeaderboard(variableName, type, label, scope?, scopeParam?)` {#showLeaderboard}

Shows a [leaderboard](../reference/Leaderboard) to the player. `type` is `"high"` or `"low"` to sort highest-first or lowest-first, and `label` is what to show on the leaderboard. The optional `scope` and `scopeParam` work the same as [writeToLeaderboard](#writeToLeaderboard).

A dynamic `label` must always evaluate to the same value per combination of variable and scope.

```
castle.showLeaderboard("score", "high", "High Scores")
castle.showLeaderboard("score", "high", "Today's Best", "daily", "player")
castle.showLeaderboard("score", "low", "Fastest Times", "custom", "week-1")
```

#### `castle.fetchLeaderboardData(config, callback)` {#fetchLeaderboardData}

Fetches [leaderboard](../reference/Leaderboard) entries and passes them to `callback`. Useful for displaying the top players and their scores from script, or for feeding into [`castle.avatar.setToLeaderboardEntry`](#setToLeaderboardEntry).

`config` is a table with:

- `variable` (required): the variable whose leaderboard to fetch.
- `type` (required): `"high"` or `"low"` to sort highest-first or lowest-first.
- `scope` (optional, default `"global"`): `"global"`, `"daily"`, `"card"`, or `"custom"`. See [Leaderboard scopes](../reference/Leaderboard#scopes).
- `timezone` (optional, for `"daily"`): `"player"` or `"server"` (defaults to `"server"`).
- `customScope` (optional, for `"custom"`): the custom scope identifier.
- `cardId` (optional, for `"card"`): override the card id.
- `day` (optional, for `"daily"`): override the day.

The `callback` receives a data table:

```
{
  list = {
    { place = 1, value = 1000, username = "alice" },
    { place = 2, value = 900, username = "bob" },
    ...
  }
}
```

Results are cached per scope and reused by [`castle.avatar.setToLeaderboardEntry`](#setToLeaderboardEntry). Calls are rate-limited per scene — repeated calls may return cached data instead of re-fetching.

```
-- fetch top high scores and show the top 3 usernames
castle.fetchLeaderboardData({ variable = "score", type = "high" }, function(data)
  for i = 1, math.min(3, #data.list) do
    local entry = data.list[i]
    print(entry.place .. ". " .. entry.username .. " — " .. entry.value)
  end
end)
```

### Time & Date Functions

#### `castle.getTime()` {#getTime}

Returns the time elapsed since the card started, in seconds.

#### `castle.runAfterDelay(delay in seconds, function)` {#runAfterDelay}

Runs the function after a delay.

```
castle.runAfterDelay(3.0, function()
  -- this will run after 3 seconds
  my.layout.x = 1
end)
```

See [this tutorial](./tutorials/5-timing.md#castlerunafterdelay) for more examples.

#### `castle.repeatAtInterval(interval in seconds, function)` {#repeatAtInterval}

Runs the function after a delay repeatedly.

```
castle.repeatAtInterval(3.0, function()
  -- this will run after 3 seconds, after 6 seconds, after 9 seconds, etc...
  my.layout.rotation = my.layout.rotation + 10
end)
```

See [this tutorial](./tutorials/5-timing.md#castlerepeatatinterval) for more examples.

#### `castle.stopRepeat(handle from repeatAtInterval)` {#stopRepeat}

Stops a repeat created by [castle.repeatAtInterval](#repeatAtInterval).

```
local repeatHandle = castle.repeatAtInterval(3.0, function()
  my.layout.rotation = my.layout.rotation + 10
end)

...

-- my.layout.rotation will stop updating once this is called
castle.stopRepeat(repeatHandle)
```

See [this tutorial](./tutorials/5-timing.md#castlerepeatatinterval) for more examples.

#### `castle.sleep(seconds)` {#sleep}

:::warning

We recommend not using this. It will prevent the rest of your script (including onUpdate and onMessage) from running until it returns. You can almost always perform the same logic with a combination of the other time functions.

:::

Pauses the entire script for the number of seconds.

#### `castle.getServerTime()` {#getServerTime}

Returns the current synced server time as a Unix timestamp (seconds).

#### `castle.getServerDate(format?, timezone?)` {#getServerDate}

Similar to Lua's `os.date()` but uses synced server time instead of local device time. See also: [Dates and daily games](../expressions/CurrentDate). The first parameter is a format string (same as `os.date` -- use `"*t"` to get a table). The second parameter is the timezone to use (`"player"` or `"Castle"`).

When returning a table, all standard `os.date` fields are included plus `daysSinceCastleEpoch`. Think of this as a "day number" that increments each day, useful for daily games or calculating diffs.

```
local date = castle.getServerDate("*t", "player")
print("Day number: " .. date.daysSinceCastleEpoch)

-- use the day number for daily content
local dailyLevel = (date.daysSinceCastleEpoch % 10) + 1
```

### Card functions

#### `castle.restartCard()` {#restartCard}

Restart the card.

#### `castle.isInScreen(screen)` {#isInScreen}

Checks whether the deck is being played in a certain screen. `screen` is one of `feed`, `party`, or `editor`.

### Multiplayer functions

The following functions only work for [multiplayer](../multiplayer/introduction) decks.

#### `castle.getUsersInParty()` {#getUsersInParty}

When the deck is being played in a [party](../reference/Party), returns the list of users in the containing party. Each user is a table containing `{ username, userId, isActive }`. `isActive` indicates whether the player is currently present in the session.

You can use [`castle.isInScreen("party")`](#isInScreen) to check whether the deck is being played in a party.

#### `castle.getCurrentUser()` {#getCurrentUser}

Returns a user in the same format as `getUsersInParty()`, but for the current player only.

#### `castle.numberOfPlayersInSession()` {#numberOfPlayersInSession}

Returns the number of players in the current multiplayer session. Returns `0` if the deck is not multiplayer.

#### `castle.getSessionId()` {#getSessionId}

Returns the current multiplayer session ID as a string. Returns an empty string `""` if the deck is not in a multiplayer session.

#### `castle.sendPartyMessage(message, useScreenshot)` {#sendPartyMessage}

Sends a message string to the party. If `useScreenshot` is `true`, a screenshot of the current scene is included with the message. The `useScreenshot` parameter is optional and defaults to `false`.

### Storage functions

Storage lets you save data that persists across plays of your deck. Each user gets their own storage for each deck, so different players won't overwrite each other's data.

In [multiplayer](../multiplayer/introduction) decks, storage is scoped per-[session](../multiplayer/sessions) and per-user. Each player has their own storage within the session. The [session-controlling device](../multiplayer/sessions#session-controlling-device) has its own scope (also per-session) separate from the players. A new session starts with fresh storage for all players and the session-controlling device.

Storage works the same when playing from the editor — you can save, load, and remove data just like normal play.

You can store strings, numbers, booleans, nil, and tables. Tables can't contain functions, and can't refer back to themselves:

```
local t = { score = 10 }
t.self = t
castle.saveStorage("data", t)  -- error: table refers back to itself
```

#### `castle.saveStorage(key, value)` {#saveStorage}

Saves a value to storage under the given key.

```
castle.saveStorage("highScore", 42)
castle.saveStorage("playerName", "alice")
castle.saveStorage("settings", { volume = 0.8, difficulty = "hard" })
```

#### `castle.loadStorage(key)` {#loadStorage}

Returns the stored value for the given key, or `nil` if no value has been saved for that key.

```
local score = castle.loadStorage("highScore")    -- 42 (number)
local name = castle.loadStorage("playerName")    -- "alice" (string)
local settings = castle.loadStorage("settings")  -- {volume = 0.8, difficulty = "hard"} (table)
```

#### `castle.removeStorage(key)` {#removeStorage}

Removes a key from storage.

```
castle.removeStorage("highScore")
```

### Physics Functions

These functions let you query the physics world for actors by position, shape, or ray.

All query functions accept an optional last argument `{ tag = "tagName" }` to filter results to only actors with that tag.

#### `castle.physics.queryPoint(x, y, options?)` {#queryPoint}

Returns a table of all actors whose physics shape overlaps the point `(x, y)`.

```
local actors = castle.physics.queryPoint(0, 0)
for _, actor in ipairs(actors) do
  castle.destroyActor(actor)
end

-- only actors tagged "enemy"
local enemies = castle.physics.queryPoint(0, 0, { tag = "enemy" })
```

#### `castle.physics.queryCircle(x, y, radius, options?)` {#queryCircle}

Returns a table of all actors whose physics shape overlaps a circle centered at `(x, y)` with the given `radius`.

```
local nearby = castle.physics.queryCircle(my.layout.x, my.layout.y, 3)

-- only walls within range
local walls = castle.physics.queryCircle(my.layout.x, my.layout.y, 5, { tag = "wall" })
```

#### `castle.physics.queryBox(x, y, w, h, options?)` {#queryBox}

Returns a table of all actors whose physics shape overlaps an axis-aligned box centered at `(x, y)` with width `w` and height `h`.

```
local actors = castle.physics.queryBox(0, 0, 10, 5)
```

#### `castle.physics.raycast(x1, y1, x2, y2, options?)` {#raycast}

Casts a ray from `(x1, y1)` to `(x2, y2)` and returns the first actor hit, or `nil` if nothing was hit. The result is a table with these fields:

- `actor` — the actor that was hit
- `x`, `y` — the hit point in world coordinates
- `normalX`, `normalY` — the surface normal at the hit point
- `fraction` — how far along the ray the hit occurred (0–1)

```
local hit = castle.physics.raycast(my.layout.x, my.layout.y, target.x, target.y)
if hit then
  print("hit actor at " .. hit.x .. ", " .. hit.y)
  print("normal: " .. hit.normalX .. ", " .. hit.normalY)
end

-- only hit walls
local hit = castle.physics.raycast(0, 0, 10, 0, { tag = "wall" })
```

#### `castle.physics.raycastAll(x1, y1, x2, y2, options?)` {#raycastAll}

Like `raycast`, but returns a table of all actors hit along the ray (sorted by distance). Each entry has the same fields as `raycast`.

```
local hits = castle.physics.raycastAll(0, 0, 10, 0)
for _, hit in ipairs(hits) do
  print("hit " .. tostring(hit.actor) .. " at fraction " .. hit.fraction)
end
```

### Physics Joint Functions

Joints connect two actors together with a physical constraint. All joint functions take two actor arguments and an optional options table. They return a joint object with a `joint:destroy()` method. Destroying the joint removes the constraint; it is safe to call `destroy()` more than once.

#### `castle.physics.newRevoluteJoint(actorA, actorB, options?)` {#newRevoluteJoint}

Creates a revolute (pivot/hinge) joint. The two actors are pinned to a shared anchor point and can rotate freely around it. Options:

- `anchorX`, `anchorY` — world-space anchor position (defaults to the midpoint between the two actors)
- `motorSpeed` — target rotation speed in degrees per second
- `maxMotorTorque` — maximum torque the motor can apply
- `limits` — `{lowerAngle, upperAngle}` in degrees to cap the rotation range

```
-- spin actorB around actorA like a wheel
local joint = castle.physics.newRevoluteJoint(actorA, actorB, {
  motorSpeed = 180,
  maxMotorTorque = 50,
})

-- door hinge that can only open 90 degrees
local hinge = castle.physics.newRevoluteJoint(frame, door, {
  anchorX = 0, anchorY = 0,
  limits = {0, 90},
})
```

#### `castle.physics.newDistanceJoint(actorA, actorB, options?)` {#newDistanceJoint}

Creates a distance joint that keeps two actors at a fixed distance from each other (like a rigid rod or a spring). Options:

- `length` — target distance in world units (defaults to the current distance between the actors)
- `frequency` — spring oscillation frequency in Hz; `0` means rigid (default)
- `damping` — damping ratio for the spring (`0` = no damping, `1` = critically damped)

```
-- rigid rod holding two actors apart
local rod = castle.physics.newDistanceJoint(actorA, actorB, { length = 3 })

-- springy connection
local spring = castle.physics.newDistanceJoint(actorA, actorB, {
  length = 2,
  frequency = 1.5,
  damping = 0.05,
})
```

#### `castle.physics.newPrismaticJoint(actorA, actorB, options?)` {#newPrismaticJoint}

Creates a prismatic (slider) joint. The two actors are constrained to move along a single axis relative to each other, like a piston or rail. Options:

- `axis` — `{x, y}` direction vector for the slide axis (defaults to `{1, 0}`, i.e. horizontal)
- `motorSpeed` — target sliding speed in world units per second
- `maxMotorForce` — maximum force the motor can apply
- `limits` — `{lowerTranslation, upperTranslation}` in world units to cap the slide range

```
-- vertical sliding platform
local slider = castle.physics.newPrismaticJoint(anchor, platform, {
  axis = {0, 1},
  motorSpeed = 2,
  maxMotorForce = 500,
  limits = {-3, 3},
})
```

#### `castle.physics.newWeldJoint(actorA, actorB, options?)` {#newWeldJoint}

Creates a weld joint that rigidly locks two actors together. Options:

- `anchorX`, `anchorY` — world-space anchor position (defaults to the midpoint)
- `frequency` — softness frequency in Hz; `0` means perfectly rigid (default)
- `damping` — damping ratio for soft welds

```
-- glue two actors together permanently
local weld = castle.physics.newWeldJoint(bodyA, bodyB)

-- soft weld (acts like a stiff spring)
local soft = castle.physics.newWeldJoint(bodyA, bodyB, {
  frequency = 8,
  damping = 0.7,
})
```

#### `castle.physics.newRopeJoint(actorA, actorB, options?)` {#newRopeJoint}

Creates a rope joint that enforces a maximum distance between two actors. Unlike a distance joint, the actors can be closer than `length` — only pulling apart beyond `length` is constrained. Options:

- `length` — maximum allowed distance (defaults to the current distance between the actors)

```
-- actors can swing together but can't drift further than 5 units apart
local rope = castle.physics.newRopeJoint(anchor, bob, { length = 5 })
```

#### `joint:destroy()` {#joint-destroy}

Removes the joint constraint. The actors are no longer connected. Safe to call multiple times.

```
local joint = castle.physics.newRevoluteJoint(actorA, actorB)
-- ... later ...
joint:destroy()
```

### Coroutine Functions

Coroutines let you write sequential, time-based logic without splitting code across multiple callbacks. A coroutine runs alongside other code — when it pauses (via `wait`, `waitUntil`, etc.), the rest of the game keeps running.

#### `castle.co.start(function)` {#co-start}

Starts a coroutine that runs the given function. Multiple coroutines can run at the same time.

```
castle.co.start(function()
  print("step 1")
  castle.co.wait(1.0)
  print("step 2, one second later")
end)
```

#### `castle.co.wait(seconds)` {#co-wait}

Pauses the current coroutine for the given number of seconds. Other coroutines and the rest of the game continue running while waiting.

```
castle.co.start(function()
  my.layout.x = 0
  castle.co.wait(2.0)
  my.layout.x = 5
end)
```

#### `castle.co.waitUntil(function)` {#co-waitUntil}

Pauses the current coroutine until the given function returns `true`.

```
local playerReady = false

castle.co.start(function()
  castle.co.waitUntil(function() return playerReady end)
  print("player is ready!")
end)
```

#### `castle.co.waitFor(eventName)` {#co-waitFor}

Pauses the current coroutine until another coroutine calls `castle.co.fireEvent` with the same event name. Returns the data passed to `fireEvent`.

```
castle.co.start(function()
  -- wait for a "hit" event from another coroutine
  local data = castle.co.waitFor("hit")
  print("hit by: " .. tostring(data.source))
end)
```

#### `castle.co.fireEvent(eventName, data)` {#co-fireEvent}

Fires a named event, waking any coroutine that is waiting on it with `waitFor`. `data` is passed back as the return value of `waitFor`.

```
castle.co.start(function()
  castle.co.wait(0.5)
  castle.co.fireEvent("hit", { source = "enemy" })
end)
```

#### `castle.co.parallel(...)` {#co-parallel}

Runs multiple functions as concurrent coroutines and waits until all of them finish.

```
castle.co.start(function()
  castle.co.parallel(
    function()
      castle.co.wait(1.0)
      print("branch A done")
    end,
    function()
      castle.co.wait(2.0)
      print("branch B done")
    end
  )
  print("both branches done")  -- runs after 2 seconds
end)
```

### Events Functions

The events system lets actors communicate with each other using named events. Any actor can emit an event and any actor can listen for it.

#### `castle.events.emit(name, data)` {#events-emit}

Emits a named event with the given data table. All listeners registered with `on` or `once` for this event name are called.

```
castle.events.emit("coinCollected", { value = 10 })
castle.events.emit("playerDied", {})
```

#### `castle.events.on(name, function)` {#events-on}

Registers a listener function for the named event. Returns an unsubscribe function — call it to stop receiving the event.

```
-- listen for score events
castle.events.on("scoreUp", function(data)
  print("score increased by " .. data.amount)
end)

-- store the unsubscribe function to remove the listener later
local unsub = castle.events.on("tick", function(data)
  print("tick")
end)

-- stop listening
unsub()
```

#### `castle.events.once(name, function)` {#events-once}

Like `on`, but the listener is automatically removed after the first time it fires.

```
castle.events.once("gameStart", function(data)
  print("game started!")
end)
```

### Analytics Functions

#### `castle.logAnalyticsRecord(id, intProperty1?, ..., intProperty5?)` {#logAnalyticsRecord}

Logs a **Record**-type [analytics](../reference/Analytics) event. `id` is the numeric ID of an event — this is autogenerated when you define the event and is listed in the **Analytics** tab when you select a deck under **Create**. You can copy it by tapping into the event definition. The integer property arguments are optional and correspond to the named properties defined on the event, in order. At most 10 records can be logged per deck play.

```
local LEVEL_FINISHED = 1482  -- copy this ID from the Analytics tab
castle.logAnalyticsRecord(LEVEL_FINISHED, currentLevel, score, elapsedTime)
```

```
-- event with no properties
local TUTORIAL_COMPLETE = 1097
castle.logAnalyticsRecord(TUTORIAL_COMPLETE)
```

#### `castle.logAnalyticsCounter(id)` {#logAnalyticsCounter}

Increments a **Counter**-type [analytics](../reference/Analytics) event. `id` is the numeric ID of an event — see [`castle.logAnalyticsRecord`](#logAnalyticsRecord) for how to find it. The counter is incremented by one each time this is called, and the total is logged automatically when the deck play ends. Counters have no per-play limit on increments.

```
local COINS_COLLECTED = 1521
castle.logAnalyticsCounter(COINS_COLLECTED)
```

### Avatar Functions

[Avatars](../reference/Avatar) are drawing layers on an actor that show a user's profile photo. These functions set which user an avatar shows.

#### `castle.avatar.setToCurrentUser(actor)` {#setToCurrentUser}

Sets the avatar to show the local player (the user running this device).

```
-- when created, show the local player's photo
function onCreate()
  castle.avatar.setToCurrentUser(self)
end
```

#### `castle.avatar.setToOwner(actor)` {#setToOwner}

Sets the avatar to show the player whose device owns this actor in [multiplayer](../multiplayer/introduction).

```
-- show whichever player controls this token
function onCreate()
  castle.avatar.setToOwner(self)
end
```

#### `castle.avatar.setToUser(actor, userId)` {#setToUser}

Sets the avatar to show a specific user in the current session, by `userId` (as returned from [`castle.getUsersInParty`](#getUsersInParty)).

#### `castle.avatar.setToLeaderboardEntry(actor, config, rank)` {#setToLeaderboardEntry}

Sets the avatar to show the user at `rank` (1-based) in a cached leaderboard. `config` is the same table shape as [`castle.fetchLeaderboardData`](#fetchLeaderboardData), which you must call first to populate the cache. If the cache is missing or `rank` is out of range, the avatar is left unchanged.

```
-- show the avatars of the top 3 high-score players on three avatar actors tagged
-- "podium-1", "podium-2", "podium-3"
castle.fetchLeaderboardData({ variable = "score", type = "high" }, function(data)
  for i = 1, 3 do
    local a = castle.actorsWithTag("podium-" .. i)[1]
    if a then
      castle.avatar.setToLeaderboardEntry(a, { variable = "score", type = "high" }, i)
    end
  end
end)
```

#### `castle.avatar.getUser(actor)` {#getUser}

Returns a table `{ username, userId, isActive }` for the user this avatar currently shows, or `nil` if no user is set (or the user is no longer in the session).

```
-- print the username of whoever this avatar shows
local user = castle.avatar.getUser(self)
if user then
  print("Avatar shows: " .. user.username)
end
```
