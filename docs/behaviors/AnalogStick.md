# Analog stick

**Analog stick** is an interactive [Behavior](Behavior) that causes the blueprint's actors to [move](Motion) around the screen in response to a virtual analog stick.

Analog stick differs from [Drag](Drag) because individual actors don't need to be touched; the player can touch anywhere on the screen to use the virtual analog stick, and can cause any number of actors to move at once.

Castle's default **Character** blueprint uses a combination of Analog stick and [Slow down](Slowdown) to cause a little guy to walk around the screen.

## Properties

- **Speed**: Increasing speed causes the analog stick to drive the actors at a higher speed.
- **Turn friction**: Higher turn friction causes actors to turn corners more sharply, which can make certain types of games feel more responsive.
- **Axes**: Whether to apply the analog stick to the x axis (horizontal motion), y axis (vertical motion), or both.
