# Slow down

**Slow down** is a [behavior](Behavior) that causes actors with [dynamic motion](Motion) to passively slow down.

Slow down has two properties, one to slow down its translation in x/y space, and one to slow down its rotation. The higher the value, the faster the actor will slow down.

Slow down depends on the mass of the actor, which is determined by the area of its [collision shapes](../reference/Collision) and its [density](Motion). An actor with larger collision shapes will have more inertia (tend to keep moving) compared to a smaller actor.

A common pattern is to combine slow down with [Analog stick](AnalogStick). When the player stops engaging the analog stick, enable slowdown; when the user starts engaging the analog stick, disable slowdown.
