# Draw API Reference

## `onDraw()`

Called every frame to draw custom graphics for this actor. When `onDraw` is defined, the actor's default drawing/sprite is skipped. Use `castle.draw.*` functions inside this handler — they only work here.

```lua
function onDraw()
  castle.draw.setColor(1, 0, 0)
  castle.draw.circle("fill", 0, 0, 0.5)
end
```

Drawing happens in the actor's local coordinate space — (0, 0) is the actor's center, and 1 unit = the actor's width/height. The graphics state (color, line width, transforms) is automatically saved before `onDraw()` and restored after, so changes don't leak to other actors.

## `castle.draw.*` functions

### `castle.draw.setColor(r, g, b, a)`

Sets the drawing color. `r`, `g`, `b` are floats from 0 to 1. `a` (alpha/opacity) is optional and defaults to 1.

```lua
castle.draw.setColor(1, 0, 0)        -- red, fully opaque
castle.draw.setColor(0, 0.5, 1, 0.5) -- light blue, half transparent
```

### `castle.draw.setColorHex(hex, a)`

Sets the drawing color from a hex integer. `a` (alpha/opacity) is optional and defaults to 1.

```lua
castle.draw.setColorHex(0xFF0000)      -- red
castle.draw.setColorHex(0x0000FF, 0.5) -- blue, half transparent
```

### `castle.draw.rectangle(mode, x, y, width, height)`

Draws a rectangle. `mode` is `"fill"` or `"line"`. `x`, `y` is the top-left corner.

```lua
castle.draw.setColor(1, 0, 0)
castle.draw.rectangle("fill", -0.5, -0.5, 1, 1) -- filled red unit square centered on actor
```

### `castle.draw.roundedRectangle(mode, x, y, width, height, rx, ry)`

Draws a rectangle with rounded corners. `rx` and `ry` are the corner radius in x and y.

```lua
castle.draw.roundedRectangle("fill", -0.5, -0.5, 1, 1, 0.1, 0.1)
```

### `castle.draw.circle(mode, x, y, radius)`

Draws a circle. `mode` is `"fill"` or `"line"`.

```lua
castle.draw.setColor(0, 1, 0)
castle.draw.circle("fill", 0, 0, 0.5) -- green circle at actor center
```

### `castle.draw.ellipse(mode, x, y, radiusX, radiusY)`

Draws an ellipse. `radiusX` and `radiusY` are the horizontal and vertical radii.

```lua
castle.draw.ellipse("fill", 0, 0, 0.5, 0.3)
```

### `castle.draw.line(x1, y1, x2, y2)`

Draws a line between two points.

```lua
castle.draw.setColor(1, 1, 1)
castle.draw.line(-0.5, 0, 0.5, 0) -- horizontal line through actor center
```

### `castle.draw.polygon(mode, x1, y1, x2, y2, x3, y3, ...)`

Draws a polygon with an arbitrary number of vertices. `mode` is `"fill"` or `"line"`. Requires at least 3 points (6 coordinates). You can also use `table.unpack` to pass vertices from a table.

```lua
castle.draw.polygon("fill", -0.5, -0.5, 0.5, -0.5, 0, 0.5)

local verts = {-0.3, -0.3, 0.3, -0.3, 0.3, 0.3, -0.3, 0.3}
castle.draw.polygon("line", table.unpack(verts))
```

### `castle.draw.setLineWidth(width)`

Sets the line width used by `"line"` mode shapes and `castle.draw.line`.

```lua
castle.draw.setLineWidth(0.05)
castle.draw.circle("line", 0, 0, 0.5) -- circle outline with custom width
```

### `castle.draw.push()` / `castle.draw.pop()`

Saves/restores the graphics state (color, line width, transform) onto a stack.

```lua
castle.draw.setColor(1, 0, 0)
castle.draw.push()
  castle.draw.setColor(0, 0, 1)
  castle.draw.circle("fill", 0, 0, 0.3) -- blue
castle.draw.pop()
castle.draw.circle("fill", 0.5, 0, 0.3) -- red (restored)
```

### `castle.draw.translate(x, y)` / `castle.draw.rotate(angle)` / `castle.draw.scale(sx, sy)`

Transform the coordinate system. `rotate` angle is in radians.

### `castle.draw.origin()`

Resets the coordinate transform to the default (actor-local origin).

### `castle.draw.text(text, x, y, size [, halign, valign, font])`

Draws text at position `(x, y)`. `size` uses the same units as the Text behavior's fontSize property (default 10, range 1–30; size 10 = 1 world unit tall). Text is drawn in the current color.

Optional parameters:
- `halign`: `"left"` (default), `"center"`, `"right"`
- `valign`: `"top"` (default), `"middle"`, `"bottom"`
- `font`: defaults to `"DMSans"`. Available: `DMSans`, `Glacier`, `HelicoCentrica`, `Piazzolla`, `YatraOne`, `Bore`, `Synco`, `Tektur`, `CourierPrime`

```lua
function onDraw()
  castle.draw.setColor(1, 1, 1)
  castle.draw.text("Score: 42", -0.4, -0.4, 10)

  castle.draw.setColor(1, 0.5, 0)
  castle.draw.text("GAME OVER", 0, 0, 20, "center", "middle", "Bore")
end
```

### `castle.draw.measureText(text, size [, font])`

Returns the width and height of the given text in actor-local units. Useful for positioning and layout.

```lua
local w, h = castle.draw.measureText("Hello", 10)
castle.draw.setColor(0, 0, 0, 0.5)
castle.draw.rectangle("fill", -w/2, -h/2, w, h)
castle.draw.setColor(1, 1, 1)
castle.draw.text("Hello", 0, 0, 10, "center", "middle")
```
