# Editing Decks

This section will explain how to edit your decks in a text editor. You should leave `castle serve` running for this entire tutorial so that you can view your changes as you make them.

## Adding an Actor

To add an actor, first open up the layout.yaml file for you card in a text editor. Here's an example layout.yaml file:

```yaml title="layout.yaml"
- actorId: 1
  title: Wall
  entryId: 5e9cf6d3-e1cd-40e7-8f2c-a3f82640d110
  x: 0
  y: -1.5
  angle: 0
  width: 1
  height: 1
```

Let's add another wall next to this wall. Since this wall's width is 1 and it is at `x: 0`, let's put it at `x: 1` so that we can see it.

```yaml title="layout.yaml"
- actorId: 1
  title: Wall
  entryId: 5e9cf6d3-e1cd-40e7-8f2c-a3f82640d110
  x: 0
  y: -1.5
  angle: 0
  width: 1
  height: 1
- actorId: 2
  title: Wall
  entryId: 5e9cf6d3-e1cd-40e7-8f2c-a3f82640d110
  x: 1
  y: -1.5
  angle: 0
  width: 1
  height: 1
```

Try doing the same to your file and see if you can see the new actor in the web page opened by `castle serve`. Make sure to copy an actor that's already in layout.yaml so that the `entryId` is correct. When you add a new actor you can either choose a new `actorId` for it or just remove that field, and the Castle CLI will generate a new `actorId` for you.

## Updating a Blueprint

Here's an example of a blueprint file:

```yaml title="Wall.yaml"
title: Wall
entryId: 5e9cf6d3-e1cd-40e7-8f2c-a3f82640d110
components:
  Solid: {}
  Friction:
    amount: 0.2
  Rules:
    file: Wall_rules.yaml
  Tags: {}
  Camera:
    zoom: 1
    angle: 0
```

Let's say we want to make the wall move down. We can add a new component named `DynamicMotion` and set the Y velocity to 1:

```yaml title="Wall.yaml"
title: Wall
entryId: 5e9cf6d3-e1cd-40e7-8f2c-a3f82640d110
components:
  DynamicMotion:
    vy: 1
  Solid: {}
  Friction:
    amount: 0.2
  Rules:
    file: Wall_rules.yaml
  Tags: {}
  Camera:
    zoom: 1
    angle: 0
```

[You can find a list of options here](../scripts/actor-reference). Note that some of these components require dependencies on other components so might not work in isolation. If you get stuck, you can always add the component from the Castle App and then edit it after it's added using the Castle CLI.

## Updating a Script

Here's an example of a blueprint that contains a script:

```yaml title="Wall.yaml"
title: Wall
entryId: 5e9cf6d3-e1cd-40e7-8f2c-a3f82640d110
components:
  Solid: {}
  Friction:
    amount: 0.2
  Script:
    file: Wall_script.lua
  Tags: {}
  Camera:
    zoom: 1
    angle: 0
```

When you first clone a deck, the Castle CLI will write each of your blueprint scripts into separate files. In this case, if you wanted to edit the script for this blueprint you would open up Wall_script.lua in your text editor. Once you make changes to that script and save it, the web page served by `castle serve` will reload with those updates.

For more details about scripting, see the [scripting tutorial](../scripts/tutorials/1-getting-started.md).
