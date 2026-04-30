# Actors and behaviors

You can read or modify [actors](../../reference/Actor) in various ways using a script. There are a few different ways to get a variable representing an actor in a script:

- `my` - a special variable that always represents the current actor
- `triggeringActor` in `onMessage`
- `castle.createActor("Wall", 0, 0)`
- `castle.closestActorWithTag("tag")`
- `castle.actorsWithTag("tag")`

Each of these returns an actor type. Here's an example of setting some [behavior properties](../../behaviors/Behavior) on different actors:

<DeckScriptEditor deckType="GolfKit" blueprintTitle="Ball" code={`
function onCreate()
  my.layout.rotation = 45

  castle.closestActorWithTag("ground").layout.rotation = -45
end`} />

As you can see, the Ball blueprint and the Ground closest to it are both rotated.

## Behavior properties

Any of the [behavior properties](../../behaviors/Behavior) that you can get or set from [rules](../../reference/Rule) can be written from scripts. Here's an example that changes the Slingshot speed and the [Gravity](../../behaviors/Gravity) of the golf ball. Try shooting the golf ball:

<DeckScriptEditor deckType="GolfKit" blueprintTitle="Ball" code={`
function onCreate()
  my.slingshot.speed = 1.0
  my.gravity.strength = 0.1
end
`} />

When you start typing in the editor, it will show you a list of properties that you can use. For example, if you start typing `my.layout.` it'll show you that you can use `x`, `y`, `widthScale`, `heightScale`, `rotation`, `visible`.

Try playing around with changing other properties!

## Behavior property reference

[You can find a list of all behavior properties available on actors here](../actor-reference).
