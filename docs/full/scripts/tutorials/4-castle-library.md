# Castle Library

In the last section, you already saw an example of the Castle library: `castle.closestActorWithTag("ground")`

There are a few other useful functions in the Castle library. Here's an example of using `castle.createActor`. Try tapping on the Wall to trigger `onMessage`.

Note that this script uses `math.random`, which is part of the [Lua math library](../math-library-reference.md).

<DeckScriptEditor deckType="SingleWall" blueprintTitle="Wall" code={`
function onMessage(message, triggeringActor)
  castle.createActor("Wall", math.random(8) - 4.5, math.random(12) - 6.5)
end
`} />


Another useful function in the Castle library is `castle.actorsWithTag`. This example uses `castle.actorsWithTag` to move all of the Balls into a row when you tap the Wall:

<DeckScriptEditor deckType="WallAndBall" blueprintTitle="Wall" code={`
function onCreate()
  for i=1,10 do
    castle.createActor("Ball", math.random(8) - 4.5, math.random(12) - 6.5)
  end
end

function onMessage(message, triggeringActor)
  local otherActors = castle.actorsWithTag("ball")

  -- this is how you loop through a list in Lua
  for _, otherActor in ipairs(otherActors) do
    otherActor.layout.y = -2
  end
end
`} />

[You can find a list of all the Castle library functions here](../castle-library-reference)
