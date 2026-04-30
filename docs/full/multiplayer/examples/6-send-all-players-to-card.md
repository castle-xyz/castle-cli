# Send all players to a card

This multiplayer example demonstrates a situation where one player takes an action that causes all the players on the same card to be sent to another card in the deck.

## Example deck

[Multiplayer example: Send all players to card](https://s.castle.xyz/lfR2jZRRNENn)

## Structure

- Each player controls a shared character who can move around the card.
- There's a shared `Door` actor.
- When any character collides with the door, the door creates an invisible, shared `Next card sender` actor.
- The `Next card sender` uses the `Send player to card` response inside its `Loaded` trigger.

## Pitfalls and limitations

Why not run `Send player to card` inside the door's collision? Because the door is session-owned, and this response would only be run on the door's controlling device (the session device). That means whichever player happens to control the session would be sent to the next card, but everybody else would stay behind. Since `When this shared actor is loaded` runs on all devices, all players are sent to the next card.

Note that this structure only works for players who are already on the same card when somebody touches the door. If someone else joins the session later, or if they're already in the session but viewing a different card, this rule won't run for them.
