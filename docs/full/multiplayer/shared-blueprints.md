---
sidebar_position: 2
---
# Shared blueprints

Multiplayer decks in Castle synchronize some of the actors between devices. To synchronize an actor, use the settings under the Multiplayer section of the Logic tab.

When a blueprint is Shared, it can be either Player-controlled or Session-controlled. Non-shared blueprints are referred to as Local blueprints.

## Local blueprints

When a blueprint isn't shared, it's local. This is the default for ordinary, non-synchronized blueprints.

![hi](./assets/multiplayer-local.jpg)

Actors from these blueprints are not synchronized with other devices. For example, if you create a local actor from a rule, that actor only appears on the device on which the rule ran. If you place a local actor from the belt, each device gets a separate unsynchronized instance of the actor.

## Shared, player-controlled blueprints

Blueprints that have Shared and Player Controlled selected in the Multiplayer section of the Logic tab.

![hi](./assets/multiplayer-player-controlled.jpg)

- [Synchronized](#synchronization) to other devices in the session.
- Tend to be used for actors that directly represent or respond to inputs from one player — eg. avatars, actors a player is dragging, temporary text messages, …
- Destroyed when the controlling user leaves.
- Actors placed initially in the scene (by dragging from the belt) are created when a user joins, controlled by the user that joined.
- Actors created from a rule are controlled by the user whose device the rule ran on.
- On the controlling user's device, responds to controls from behaviors like Analog Stick, Drag and Slingshot; and touch triggers are fired.
- Rule triggers are fired on the controlling user’s device only.
    - Exception: "When this loads" and "When this unloads"
- Responses that modify the actor will only run if they are initiated from the controlling user's device.
    - Exception: responses that add tags run on all devices.

## Shared, session-controlled blueprints

Blueprints that have Shared and Session Controlled selected in the Multiplayer section of the Logic tab.

![hi](./assets/multiplayer-session-controlled.jpg)

- [Synchronized](#synchronization) to other devices in the session.
- Tend to be used for actors that are independent of any particular player — eg. npcs, moving platforms, crates, …
- Not destroyed when any user leaves, they stick around.
    - Can still be destroyed by rules.
- Actors placed initially in the scene (by dragging from the belt) are created when the session starts, controlled by the [session-controlling-device](sessions#session-controlling-device).
- Actors created from a rule are controlled by the [session-controlling-device](sessions#session-controlling-device), regardless of which device ran the rule.
- Does not respond to controls from behaviors like Analog Stick, Drag and Slingshot. Touch triggers are not fired.
- Rule triggers are fired on the session-controlling-device only.
    - Exception: "When this loads" and "When this unloads"
- Responses that modify the actor will only run if they are initiated from the session-controlling device.
    - Exception: responses that add tags run on all devices.
        - Example: This allows adding an `#open` tag to a door on collision with an avatar to run on the avatar’s owner’s device. The session-controlling-device could then actually open the door in the “On add tag #open” trigger.
- [Persisted between plays](sessions) when the multiplayer deck was played from a Party.

## Synchronization

Actors from blueprints with Shared selected are synchronized to other devices in the session.

- All behavior properties, enable/disable, motion, tags, local variables are synchronized in real-time.
- Motion is still simulated locally on all devices to keep things looking smooth, but is overridden by motion updates received from the controlling device.

## Loading and unloading shared actors

`When this loads` and `When this unloads` are special [triggers](../reference/Trigger) which fire on all devices for shared actors.

Examples:
- A shared actor is created. `When this is created` only fires on the owning device. `When this is loaded` fires on both the owning device and on all the other synchronized devices.
- A shared actor is destroyed. `When this is destroyed` only fires on the owning device. `When this is unloaded` fires on both the owning device and on all the other synchronized devices.
- The player opens a shared session where session-owned actors were persisted from a previous play. "When this is created" does not fire, but "when this is loaded" does fire.
- A player exits the session by closing the app. No rules fire on the player's device (because the app is no longer running). On other devices, "when this is unloaded" runs on the synchronized actors that were controlled by that player.

In all of the above cases, the other restrictions still apply, e.g. responses that modify the actor will be ignored unless they are initiated from the owning device.

## Testing for ownership

Use the [condition](../reference/Condition) `If this shared actor is owned by the current device` to test whether the current rule is running on the device that owns the actor. Useful when combined with "When this is loaded" and "When this is unloaded".

For example, if an actor is Session-owned, this condition will be true on the Session-controlling device. If an actor is Player-owned, this condition will be true only on the device of the controlling player.

## Changing ownership

Use the response "Change who controls this actor" to switch control of a shared actor.

- From player-controlled to session-controlled: This can be useful to impart player-specific properties a newly created actor before handing it off to the session.
- From session-controlled to player-controlled: When called from a Tell where the telling actor is player-controlled, attemps to make the told actor player-controlled by the telling player.

## Collisions

Shared actors with [Dynamic motion](../behaviors/Motion) and [Solid](../behaviors/Solid) pass through each other, i.e., they behave as if Solid was turned off for [collisions](../reference/Collision) with other Shared Dynamic actors. They still do not pass through Static or Fixed actors.

Collision triggers and the “If colliding” response operate as usual for all collisions.

## Usernames

`$username` in a text actor displays the controlling user’s username.
