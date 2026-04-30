# Player nametags

In multiplayer games, you often want to know who else is playing the game with you.

In this example, we have a multiplayer game where every player controls a character. Each character also has a nametag&mdash; a piece of text that follows them around the game, displaying the username of the player controlling that character.

## Example deck

[Multiplayer example: Nametags](https://s.castle.xyz/v-lDX0-fMzy2)

## Structure

- The character is a Shared, Player-controlled blueprint.
- The nametag is a Shared, Player-controlled [Text](../../behaviors/Text) blueprint with the content `$username`.
- When created, the character also creates a nametag next to itself.
- The nametag continually sets its position to its creator's position.

## Notes

- Outside of Text actors, you can also access the owning player's Castle username with the script method [getSharedOwnerUsername()](../../scripts/actor-reference#getSharedOwnerUsername).
