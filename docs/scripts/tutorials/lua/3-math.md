# Math

In the last section, we saw the Lua string library. Lua also has a math library with a lot of useful functions.

You can see a list of all of the math library functions [here](../../math-library-reference.md).

Here's an example using `math.round`. Try moving the Character, and you can see that the number is rounded instead of showing a lot of decimal places.

<DeckScriptEditor deckType="CharacterAndText" blueprintTitle="Character" code={`
function onUpdate(dt)
  local roundedX = math.round(my.layout.x)
  local myText = "x: " .. roundedX
  castle.closestActorWithTag("text").text.content = myText
end
`} />

Here's an example using `math.cos` and `math.sin` to move the Character in a circle.

<DeckScriptEditor deckType="CharacterAndText" blueprintTitle="Character" code={`
local currentAngle = 0

function onUpdate(dt)
  currentAngle = currentAngle + dt

  my.layout.x = math.cos(currentAngle) * 4.0
  my.layout.y = math.sin(currentAngle) * 4.0
end
`} />