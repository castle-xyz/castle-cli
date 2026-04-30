# Strings

Lua strings can be used to store and modify text. Strings can be created in a few ways:

```"this is a string"```

```'this is also a string'```

```
[[
  this is a multiline string
  this is still a string
]]
```

## Combining Strings

There are a lot of cases where you want to combine multiple strings. You can do this by adding `..` between the two strings.

In this example, we use `..` to combine `"x: "` and `my.layout.x`. `my.layout.x` is a number, but it gets automatically converted to a string when combined with another string.

Try dragging to move the Character, and you can see how the text updates:

<DeckScriptEditor deckType="CharacterAndText" blueprintTitle="Character" code={`
function onUpdate(dt)
  local myText = "x: " .. my.layout.x
  castle.closestActorWithTag("text").text.content = myText
end
`} />

## Library Functions

Lua has a library with functions that work with strings. For example, we can use `string.reverse("hello")` to get back the string "olleh". You can see a list of all of the library functions [here](../../string-library-reference.md).

<DeckScriptEditor deckType="CharacterAndText" blueprintTitle="Character" code={`
function onUpdate(dt)
  local myText = "x: " .. my.layout.x
  myText = string.reverse(myText)
  castle.closestActorWithTag("text").text.content = myText
end
`} />