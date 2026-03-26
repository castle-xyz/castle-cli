# draw.json Format Reference

`.draw.json` files store the vector drawing and physics shapes for a blueprint. You can edit them directly. Read `.preview.png` first to understand the current drawing, then make targeted edits.

Top-level structure:
```json
{
  "Drawing2": { "drawData": { ... } },
  "Body": { "fixtures": [...], "editorBounds": {...} },
  "LocalVariables": { "localVariables": [...] }
}
```

`Drawing2.drawData` fields:
- `version`: 3 (format version — do not change)
- `scale`: 10 (coordinate scale — do not change)
- `colors`: array of `{r, g, b, a}` palette entries (0–1 range)
- `layers`: array of layer objects
- `framesBounds`: array of `{minX, maxX, minY, maxY}` per animation frame

Layer object:
- `title`: layer name
- `id`: unique string (e.g. `"layer3"`)
- `isVisible`: bool
- `frames`: array of frame objects

Frame object:
- `pathDataList`: array of vector stroke objects
- `fillPng`: (optional) base64-encoded PNG of rasterized fill content — editable, but keep it small since it is loaded synchronously in the client

Path object (vector stroke):
- `p`: flat coordinate array `[x1, y1, x2, y2, ...]` in editor units
- `s`: style/brush type (1, 2, or 3)
- `c`: (optional) `[r, g, b, a]` color override, 0–1 range; if omitted, uses palette color
- `f`: bool, is freehand
- `isTransparent`: (optional) bool, marks path as eraser stroke

`Body.fixtures` (physics/collision shapes):
- `shapeType`: `"polygon"` or `"circle"`
- `points`: flat coordinate array for polygons
- `x`, `y`: center offset
- `radius`: circle radius (0 for polygons)

Coordinate system: positive Y is downward, same as `actors.yaml`. Units are editor units — same scale as `widthScale`/`heightScale` (divide by 10 for engine units).

Easiest edits:
- Colors: change the `c` field on paths, or entries in the top-level `colors` palette
- Physics shapes: modify `Body.fixtures`
- Layer visibility: toggle `isVisible`
