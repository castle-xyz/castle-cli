# Drawing

Use `castle.draw.*` only inside `onDraw()`. It does nothing elsewhere.

When a script defines `onDraw()`, the actor's normal Drawing sprite is replaced by your draw code. Keep that actor visible: use `visible: true` in Layout or omit `visible`.

For a first-shot game, place one Stage/Controller actor near `(0, 0)` and draw the whole screen from its script. The useful visible area is about `x = -5..5` and `y = -7..7`, with positive Y downward.

`onDraw()` does not receive `dt`. Store animated state in `onUpdate(dt)`, or use `castle.getTime()` for simple elapsed-time effects.

## Common Functions

```lua
castle.draw.setColor(r, g, b, a)              -- floats 0..1; alpha optional
castle.draw.setColorHex(0xffcc00, a)          -- alpha optional
castle.draw.rectangle("fill", x, y, w, h)     -- x/y is top-left
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

There is no `castle.draw.print()`. Use `castle.draw.text(...)`.

Readable text sizes:

- `7` to `12` for HUD, labels, choices, dialogue, and game-over text
- `12` to `20` for short titles
- Avoid tiny values like `0.5`; they are usually invisible

Text alignment:

```lua
castle.draw.text("Score: 42", -4.7, -6.6, 8, "left", "top")
castle.draw.text("GAME OVER", 0, 0, 14, "center", "middle", "Bore")
```

Known fonts include `DMSans`, `Glacier`, `HelicoCentrica`, `Piazzolla`, `YatraOne`, `Bore`, `Synco`, `Tektur`, and `CourierPrime`.

## Example

```lua
local ballX, ballY = 0, 1
local score = 0

function onUpdate(dt)
  ballX = ballX + dt * 1.5
  if ballX > 4.5 then ballX = -4.5 end
end

function onDraw()
  castle.draw.setColor(0.05, 0.06, 0.09, 1)
  castle.draw.rectangle("fill", -5, -7, 10, 14)

  castle.draw.setColor(1, 0.45, 0.12, 1)
  castle.draw.circle("fill", ballX, ballY, 0.35)

  castle.draw.setColor(1, 1, 1, 1)
  castle.draw.text("Score: " .. score, -4.7, -6.6, 8, "left", "top")
end
```
