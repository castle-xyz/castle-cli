# Drawing Reference

Use `castle.draw.*` only inside `onDraw()`. When a script defines `onDraw()`, the actor's default drawing is skipped and only the custom draw code renders. Drawing uses actor-local coordinates: `(0, 0)` is the actor center.

Common draw functions:

```lua
castle.draw.setColor(r, g, b, a)              -- floats from 0 to 1; alpha is optional
castle.draw.setColorHex(0xffcc00, a)          -- alpha is optional
castle.draw.rectangle("fill", x, y, w, h)     -- mode is "fill" or "line"; x/y is top-left
castle.draw.roundedRectangle("fill", x, y, w, h, rx, ry)
castle.draw.circle("fill", x, y, radius)
castle.draw.ellipse("fill", x, y, radiusX, radiusY)
castle.draw.line(x1, y1, x2, y2)
castle.draw.polygon("fill", x1, y1, x2, y2, x3, y3, ...)
castle.draw.triangle(x1, y1, x2, y2, x3, y3)
castle.draw.setLineWidth(width)
castle.draw.push()
castle.draw.pop()
castle.draw.translate(x, y)
castle.draw.rotate(angleRadians)
castle.draw.scale(sx, sy)
castle.draw.origin()
castle.draw.text(text, x, y, size, halign, valign, font)
local w, h = castle.draw.measureText(text, size, font)
```

There is no `castle.draw.print()`. For labels, counters, menus, dialogue, and HUD text, use `castle.draw.text(...)` in `onDraw()` or a Text behavior actor.

`castle.draw.text(text, x, y, size [, halign, valign, font])` accepts:

- `size`: readable HUD/dialogue text is usually around `7` to `12`; values like `0.5` are almost invisible
- `halign`: `"left"`, `"center"`, or `"right"`; default is `"left"`
- `valign`: `"top"`, `"middle"`, or `"bottom"`; default is `"top"`
- `font`: defaults to `"DMSans"`

Known fonts include `DMSans`, `Glacier`, `HelicoCentrica`, `Piazzolla`, `YatraOne`, `Bore`, `Synco`, `Tektur`, and `CourierPrime`.

Example:

```lua
function onDraw()
  castle.draw.setColor(0.05, 0.06, 0.09, 1)
  castle.draw.rectangle("fill", -6, -8, 12, 16)

  castle.draw.setColor(1, 0.9, 0.25, 1)
  castle.draw.circle("fill", 0, 0, 0.5)

  castle.draw.setColor(1, 1, 1, 1)
  castle.draw.text("Score: 42", 0, -5.5, 10, "center", "middle")

  castle.draw.setLineWidth(0.06)
  castle.draw.setColor(0.4, 0.9, 1, 0.9)
  castle.draw.line(-1, 1, 1, 1)
end
```

Implementation source of truth:

- `../castle-client/core/src/behaviors/script.cpp` registers `castle.draw.line`, `castle.draw.text`, and other draw functions.
- `../castle-client/mobile/js/scenecreator/agent/AgentSystemPromptScripting.js` contains the in-app agent's draw API reference.
