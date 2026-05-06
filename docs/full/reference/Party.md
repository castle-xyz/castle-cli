A **Party** is a space on Castle for a small group to chat and play decks together.

## Integrating decks with parties

Some decks may be well-suited to playing in a small group; for example, [multiplayer](../multiplayer/introduction) games, or single player games with [leaderboards](Leaderboard).

- You can check whether the deck is being played from a party using the `If this deck is being played in a screen` rule condition, or with the [`castle.isInScreen()`](../scripts/castle-library-reference#isInScreen) function.
- You can send a message to the current party using the **Send a message to the party** rule response. For example, you could let the party know when someone has taken a turn.

## Parties and multiplayer

When someone plays a [multiplayer](../multiplayer/introduction) deck from a Party, they join a [session](../multiplayer/sessions) which is private to only the people in that party.

You can get a list of all the players in the current party with the [`castle.getUsersInParty()`](../scripts/castle-library-reference#getUsersInParty) function.
