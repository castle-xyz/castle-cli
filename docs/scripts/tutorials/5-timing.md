# Timing

You'll often want to wait for a bit before running more code. This section will show you a few ways of doing this. Waiting and repeating inside scripts works a bit differently from [how it works in Rules](../../reference/Repeat).

## castle.runAfterDelay()

`castle.runAfterDelay` lets you schedule a function to run after a certain amount of time. In this example, we want to run the function `moveDown()` 0.5 seconds after the box is tapped.

Try tapping on the box. You can also tap on the box a few times in a row to see what happens.

<DeckScriptEditor deckType="SingleWall" blueprintTitle="Wall" code={`
function moveDown()
  my.layout.y = my.layout.y + 1
end

function onMessage(message)
  castle.runAfterDelay(0.5, moveDown)
end
`} />

You can also do this without defining a separate function:

<DeckScriptEditor deckType="SingleWall" blueprintTitle="Wall" code={`
function onMessage(message)
  castle.runAfterDelay(0.5,
    function()
      my.layout.y = my.layout.y + 1
    end)
end
`} />

Or use a local variable to store the function:

<DeckScriptEditor deckType="SingleWall" blueprintTitle="Wall" code={`
function onMessage(message)
  local moveDown = function()
    my.layout.y = my.layout.y + 1
  end

  castle.runAfterDelay(0.5, moveDown)
end
`} />


## castle.repeatAtInterval()

This function is similar to `castle.runAfterDelay`, but it keeps running the function until you stop it.

Here's an example where we run `rotate()` every 0.5 seconds:

<DeckScriptEditor deckType="SingleWall" blueprintTitle="Wall" code={`
function rotate()
  my.layout.rotation = my.layout.rotation + 20
end

function onCreate()
  castle.repeatAtInterval(0.5, rotate)
end
`} />

If you want to stop repeating the function you, can use `castle.stopRepeat`. Here's an example where tapping the box will stop it from rotating:

<DeckScriptEditor deckType="SingleWall" blueprintTitle="Wall" code={`
local repeatHandle = nil

function rotate()
  my.layout.rotation = my.layout.rotation + 20
end

function onCreate()
  -- we have to save the result of repeatAtInterval and pass it to stopRepeat
  repeatHandle = castle.repeatAtInterval(0.2, rotate)
end

function onMessage()
  castle.stopRepeat(repeatHandle)
end
`} />

## Manually with onUpdate()

In some cases, keeping track of the total time yourself might be easier. This example behaves the same as the last example, but we manually keep track of the time in `onUpdate`.

<DeckScriptEditor deckType="SingleWall" blueprintTitle="Wall" code={`
local totalTime = 0

function onUpdate(dt)
  totalTime = totalTime + dt

  if totalTime > 0.5 then
    my.layout.rotation = my.layout.rotation + 20
    totalTime = 0.0
  end
end
`} />

Here's an example of using more complex logic in onUpdate. We could use `castle.repeatAtInterval` to replicate this logic, but it would probably be a lot more complicated.

<DeckScriptEditor deckType="SingleWall" blueprintTitle="Wall" code={`
local totalTime = 0

function onUpdate(dt)
  totalTime = totalTime + dt

  if totalTime < 1.0 then
    -- move right
    my.layout.x = my.layout.x + dt
  elseif totalTime < 2.0 then
    -- move down
    my.layout.y = my.layout.y + dt
  elseif totalTime < 3.0 then
    -- move left
    my.layout.x = my.layout.x - dt
  elseif totalTime < 4.0 then
    -- move up
    my.layout.y = my.layout.y - dt
  else
    -- reset
    totalTime = 0.0
  end
end
`} />

## castle.sleep()

:::warning

We recommend not using this. It will prevent the rest of your script (including onUpdate and onMessage) from running until it returns. You can almost always perform the same logic with a combination of the previous techniques.

:::

If you really just want to pause the code for a bit, you can use `castle.sleep`. As stated above, this will pause your entire script.

In this example, we call `castle.sleep` when the box is tapped. This partially works but has a couple of bugs:
- Since `castle.sleep` pauses the entire script, it also stops `onUpdate` from being called for 1 second. When `onUpdate` is eventually called, `dt` is set to 1 second, since that's the amount of time that has passed since the previous `onUpdate`, which causes the box to jump instead of continuing to rotate smoothly.
- If you tap the box multiple times, the sleeps will stack up and it will take a long time to start rotating again.

<DeckScriptEditor deckType="SingleWall" blueprintTitle="Wall" code={`
function onUpdate(dt)
  my.layout.rotation = my.layout.rotation + dt * 10.0
end

function onMessage()
  castle.sleep(1)
end
`} />

Here's an example using `castle.runAfterDelay` instead. This example does require a few more lines of code, but it doesn't have the same bugs as the previous example.

<DeckScriptEditor deckType="SingleWall" blueprintTitle="Wall" code={`
local isRotating = true

function onUpdate(dt)
  if isRotating then
    my.layout.rotation = my.layout.rotation + dt * 10.0
  end
end

function onMessage()
  isRotating = false
  castle.runAfterDelay(1.0, function()
    isRotating = true
  end)
end
`} />
