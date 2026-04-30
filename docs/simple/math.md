# Math

Standard Lua `math` is available.

Castle adds:

```lua
local n = castle.math.gauss(mean, sigma)
```

The script environment also exposes helpers on `math`:

```lua
local x = math.mix(a, b, 0.5)
local choice = math.choose("left", "right")
local weighted = math.weightedChoose("common", "rare", 9, 1)
```

Angles in actor properties are degrees. `castle.draw.rotate(angle)` takes radians.

```lua
castle.draw.rotate(math.rad(my.layout.rotation))
```
