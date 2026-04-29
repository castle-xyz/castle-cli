---
sidebar_position: 3
---
# Sessions

A session is a group of players who share the same state in a [multiplayer](introduction) game. The [shared actors are synchronized](shared-blueprints) between this group of players on the same deck. People can join different types of sessions, and the type of session affects how the deck runs.

## Public sessions

When someone plays a multiplayer deck from a public space like Home, Explore, or the web, by default they join a public session. Public sessions can contain anybody using Castle. When the public session has too many people, Castle automatically creates another public session and routes new users to the new session.

Public sessions are not persisted. When everybody leaves a public session, its state is permanently forgotten.

## Party sessions

When someone plays a multiplayer deck from a [Party](../reference/Party), they join a session which is private to only the people in that party.

When everybody leaves a party session, [Session-controlled actors](shared-blueprints) in the session are persisted. For example, if a multiplayer game had a mechanism where players placed blocks in the scene, and the block actors were Session-controlled, then the arrangement of blocks would remain after all players depart, and would reload in the same state next time somebody joins the same session.

Players in the party can press a `Start new session` button at any time, which creates a new Session and sends it to the containing party chat.

## Session-controlling device

In all sessions, exactly one device is the “session-controlling-device”. This device runs on Castle's servers, and runs logic for the session-controlled actors for the session. Player-controlled actors are managed by the controlling player’s device.

To debug logic running on other devices, either use the `Print a log` rule response, or use the `print()` function in a lua script. In both cases, logs from all devices in the session are streamed to the creator's device when editing the game.
