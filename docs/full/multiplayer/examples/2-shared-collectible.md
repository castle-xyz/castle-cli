# Shared collectibles

This example demonstrates a multiplayer game where each player controls a character, and there's a shared collectible gem which only one player can collect.

## Example deck

[Multiplayer example: Shared collectibles](https://s.castle.xyz/vpLYE2MtDTpA)

## Structure

- The character is a Shared, Player-controlled blueprint.
- The gem is a Shared, Session-controlled blueprint.
- The collision is checked by the gem, not by the player.
- When collected, the gem adds a tag `#add-gem` to the player. Once the player receives this tag, it self-applies whatever effect came from collecting the gem (in this case, changing the character to be bigger).

## Pitfalls

Why use the `#add-gem` tag at all? Another way to build this would be to have the Gem tell the player to change size during the collision. This won't always work, because the collision will be run from the gem's controlling device and not necessarily from the character's device. Since we want to modify the character, any modifications must happen from the player's device.

Why make the gem responsible for detecting collisions? Why not have the character detect them? Since the character is player-controlled, this could cause multiple players to claim the gem at the same time if they both detect a collision on their respective devices. Instead, we check for collision on the gem, which is session-controlled.
