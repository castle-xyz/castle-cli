# Change shared state from "Repeat every N seconds"

Suppose we want to do some shared, session-wide work every N seconds, forever. In this multiplayer example, we're going to spawn shared gems in the scene every 5 seconds.

This pattern is suitable for events which always happen on an endless timer and don't depend on any particular action from one of the players. In a golfing game, we might want to ambiently change the wind direction every few minutes. In a fighting game, we might want to raise the level of the lava below the platform, or spawn new powerups in the arena.

## Example deck

[Multiplayer example: Change shared state from Repeat](https://s.castle.xyz/gqKbwSyX1rMn)

## Structure

- We have a session manager blueprint which is shared and session-controlled. One session manager is placed in the scene from the belt.
- The session manager has a rule like this:

```
When this shared actor is loaded,
  Repeat every 5 seconds,
    If this shared actor is controlled by the current device,
      Create a gem
```

For comparison, here's the analogous logic from a non-multiplayer game:

```
When this is created,
  Repeat every 5 seconds,
    Create a gem
```

## Analysis

Because the session manager is placed in the initial scene from the belt, `When this is loaded` fires when the session starts. If the session is persisted from a Party, `When this is loaded` also fires again when the session is resumed. We can't use `When this is created` because it would only fire in the first case.

The `loaded` trigger fires on every device in the session, including both the session-controlling device and all player-controlling devices. Therefore, we need to check `If this shared actor is controlled by the current device` to make sure this rule is running on the session device before we attempt to spawn shared gems.
