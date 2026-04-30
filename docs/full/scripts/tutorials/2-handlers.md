# Handlers

Castle calls a few different functions on the script while your [deck](../../reference/Deck) runs.


## onCreate()

The `onCreate` handler is called when the [actor](../../reference/Actor) is created. Adding code to `onCreate` will usually behave the same as if you put that code at the top level, but putting it in `onCreate` makes it easier for Castle to know which code is necessary to run when creating new actors.

This example is similar to the previous example, but we are using the `onCreate` handler instead of running the code at the top level.

<DeckScriptEditor deckType="SingleWall" blueprintTitle="Wall" code={`
function onCreate()
  my.layout.rotation = 45
end`} />

## onUpdate()

The `onUpdate()` handler is called every frame. You should use this handler when you want to continuously move an actor, or continuously check the value of something, such as your position or a variable.

`onUpdate()` gets called with one argument called `dt`. This represents the number of seconds that have passed since `onUpdate` was last called. This is usually a small number, such as `0.016`. You can use `dt` to make things move smoothly, even if your deck runs at different frames per second on different phones.

Here's an example of using `onUpdate()` to rotate the wall:

<DeckScriptEditor deckType="SingleWall" blueprintTitle="Wall" code={`
-- This is a Lua variable
-- It's different from Castle variables that you can access from rules
-- We'll show you how to access Castle variables from scripts later
local currentRotation = 0

function onUpdate(dt)
  -- This means that we'll add 10 to currentRotation every second
  currentRotation = currentRotation + dt * 10

  my.layout.rotation = currentRotation
end
`} />

## onMessage()

The `onMessage` handler is used to pass messages from Castle [rules](../../reference/Rule) into the script.

This time we added a rule to the Wall blueprint. The rule looks like this:

![Rules with script message](./assets/rules-with-script-message.png)

Now we can listen for this message in the script. Try tapping the wall in this example:

<DeckScriptEditor deckType="SingleWall" blueprintTitle="Wall" code={`
function onMessage(message, triggeringActor, data)
  my.layout.y = my.layout.y + 0.5
end
`} />

`onMessage` has three arguments: `message`, `triggeringActor`, and `data`

`message` is the string that you wrote in rules. So in this case, `message` will be set to "Hello". You can send [Castle variables](../../reference/Variable) in the message by doing "$variableName", just like with [Text blueprints](../../behaviors/Text).

`triggeringActor` is an Actor type. You can use this to get information about the actor that sent the message. In this case `triggeringActor` will just be the Wall, since we're sending the script message to ourselves, but you could also use "Tell other actor" to trigger `onMessage` on a different actor. We'll explain more about actor types in the next section.

`data` is an optional value (usually a table) that can be sent along with the message. When the message comes from rules, `data` is `nil`. When the message comes from another actor's script via [`actor:sendMessage`](../actor-reference#sendMessage), `data` is whatever value was passed by the sender.

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
