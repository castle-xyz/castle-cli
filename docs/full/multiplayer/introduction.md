---
sidebar_position: 1
---

# Introduction to Multiplayer

You can use Castle to create multiplayer games with real-time shared state.

This section of the docs assumes you are familiar with the fundamentals of creating with Castle, such as [Blueprints](../reference/Blueprint), [Actors](../reference/Actor), [Behaviors](../behaviors/Behavior), [Rules](../reference/Rule), and [Tags](../reference/Tag).

Creating muliplayer games is more complicated than creating single-player games in a few ways:

- State needs to be synchronized across many devices.
- When modifying an actor, you need to be aware of which device controls the current actor.
- When running logic in general, you need to be aware of which device is the one running the logic.
- Groups of people will be grouped into Sessions, and different types of Session behave differently.

Castle provides a system for deciding who controls what. The system is described in [Shared blueprints](shared-blueprints) and [Sessions](sessions).

## Example multiplayer patterns

Many common patterns in Castle change when transitioning from single-player to multiplayer. To cover some common cases, check out our list of focused [Multiplayer examples](examples).
