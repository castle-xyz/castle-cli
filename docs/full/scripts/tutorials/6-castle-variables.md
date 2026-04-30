# Castle Variables

Castle scripts are able to interact with the same Castle [variables](../../reference/Variable) used in [Rules](../../reference/Rule).

## Deck Variables

You can access any deck play or persistent variables using `deck.variables.`. Here's an example where we add 1 to the variable "var1" every frame:

<DeckScriptEditor deckType="SimpleVariable" blueprintTitle="Wall" code={`
function onUpdate(dt)
  deck.variables.var1 = deck.variables.var1 + 1
end
`} />

As you can see in the example above, we can both read and write the variable.

## Local Variables

Scripts can also access local variables. Here's an example of setting a deck variable from a local variable:

<DeckScriptEditor deckType="SimpleVariable" blueprintTitle="Wall" code={`
function onCreate()
  -- The Wall blueprint has a local variable set to 15
  deck.variables.var1 = my.variables.localvar
end
`} />

## Tickers

Tickers can be read the same way as deck variables, but you can't update a ticker by setting it directly. You can use [`castle.updateTicker`](../castle-library-reference#updateTicker) to update a ticker.

<DeckScriptEditor deckType="SimpleTicker" blueprintTitle="Wall" code={`
function onCreate()
  -- Add one to the ticker when the actor is created
  castle.updateTicker("ticker1", 1)
end

function onMessage(message, triggeringActor)
  -- Add one to the ticker when you tap the Wall
  castle.updateTicker("ticker1", 1)
end
`} />
