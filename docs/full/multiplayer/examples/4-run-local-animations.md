# Run local animations

In this multiplayer example, we have a shared character that can collect a shared gem. When the gem is collected, we want to show a particle effect. The particle effect adds polish, but doesn't have any impact on the game. The particle effect should appear for all players and should animate smoothly.

For more context on building a collectible gem in a multiplayer game, see [Shared collectibles](shared-collectible).

## Example deck

[Multiplayer example: Run local animations](https://s.castle.xyz/DEsvJxMt3eOW)

## Structure

- The character and the gem are both shared.
- The particle blueprint is local (not shared).
- The gem uses the `unload` trigger to create the particle effect on each device.

## Analysis

Why not use the `destroy` trigger on the gem? The destroy trigger will only fire on the device that controls the gem (in this case, the session device). Therefore, only one player in the game would see the particle effect. The unload trigger solves this problem by firing on all devices.

Why not make the particle blueprint shared? Because it would suffer from lag when synced to non-controlling devices, and we want it to animate smoothly for everyone. The tradeoff we're making is that each player will see a separate, slightly different particle effect. It doesn't matter that the particle effect will look slightly different on each device, since it doesn't affect the gameplay at all.

If you wanted to make a particle effect occur when an object spawns, you could use this same pattern with the `load` trigger.
