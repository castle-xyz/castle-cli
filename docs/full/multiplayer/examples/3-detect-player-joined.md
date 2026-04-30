# Detect when players join or leave

In this example, we have a multiplayer game where every player controls a character. There's also a session-controlled manager actor which always maintains information about the number of players in the session. When a player joins the session or leaves the session, we want to run logic on the manager actor.

## Example deck

[Multiplayer example: Detect when players join or leave](https://s.castle.xyz/DFB_XrvTwy0U)

## Structure

- The character is a Shared, Player-controlled blueprint.
- The manager is a Shared, Session-controlled blueprint which is initially placed in the scene from the belt.
- The character uses the Load/Unload triggers to add `#player-joined` and `#player-left` tags to the manager actor.

## Pitfalls and other approaches

Why use load and unload instead of create and destroy? Load and unload are special triggers that run on all devices in the session, not just the controlling device. In this case, the player who joined/left may not be controlled by the same device as the manager actor.

Instead of using triggers at all, another approach would be for the manager actor to constantly check `The number of actors with tag #character` on an infinite repeat. This works if the only goal is to measure the number of players. The advantage of using load/unload triggers is that each instance of character could optionally pass player-specific information to the manager at the moment of joining or leaving.
