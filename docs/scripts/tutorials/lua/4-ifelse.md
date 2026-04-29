# If / Else / Elseif

In Castle rules, there is a response called "If a condition is met, run a response". Lua has `if` statements that work in the same way.

In this example, we check the Character's position and then update the text based on that. Try moving the Character to the left and right and see how the text changes.

<DeckScriptEditor deckType="CharacterAndText" blueprintTitle="Character" code={`
function onUpdate(dt)
  local roundedX = math.round(my.layout.x)
  local myText

  if roundedX == 0 then
    myText = "In the center"
  elseif roundedX > 0 then
    myText = "Right side"
  else
    myText = "Left side"
  end

  castle.closestActorWithTag("text").text.content = myText
end
`} />

As you can see, we check the position of the Character in two different ways.

We check `roundedX == 0` first. `==` means that the values are equal. Notice that we have to call `math.round` on the number first, otherwise it'd be very hard to get the Character exactly at 0.

Next, we check `roundedX > 0`. This will trigger if `roundedX` is greater than 0. It will be true even if `roundedX` is 0.001.

Last, we just have `else`. That means that if the first two checks don't pass, we'll run this block. So this only happens when `roundedX` doesn't equal 0 and is not greater than 0. Which means that `roundedX` must be less than 0.

## Other Operators

Lua has a few more similar operators:

- `~=` checks if a value is not equal to another value. A lot of other programming languages use `!=` for this operator, so remember to use `~=` in Lua.
- `<` checks if a value is less than another value.
- `>=` checks if a value is greater than or equal to another value.
- `<=` checks if a value is less than or equal to another value.

Here is an example using `~=`. When the actor moves too far horizontally, it destroys itself.

<DeckScriptEditor deckType="CharacterAndText" blueprintTitle="Character" code={`
function onUpdate(dt)
  local roundedX = math.round(my.layout.x)

  if roundedX ~= 0 then
    castle.destroyActor(my)
  end
end
`} />