# Input And Time

Castle games are mobile-first. Use touch input, not keyboard or mouse APIs.

## Update Loop

```lua
function onUpdate(dt)
  -- dt is seconds since the previous update
end
```

There is no `castle.dt()`. Use the `dt` parameter passed to `onUpdate(dt)`.

`onDraw()` does not receive `dt`. For draw-only animation, use:

```lua
local t = castle.getTime()
```

## Touches

```lua
function onUpdate(dt)
  for _, touch in ipairs(castle.getTouches()) do
    if touch.pressed then
      print("tap at " .. touch.x .. ", " .. touch.y)
    end
  end
end
```

Touch fields:

- `id` - unique touch id
- `x`, `y` - current position in scene coordinates
- `deltaX`, `deltaY` - movement since last update
- `initialX`, `initialY` - start position
- `pressed` - true only on the first frame
- `released` - true only on the release frame
- `duration` - seconds since the touch began

Use `castle.getTouch()` for the oldest active touch:

```lua
local touch = castle.getTouch()
if touch then
  paddleX = math.max(-3.8, math.min(3.8, touch.x))
end
```

## Tilt

```lua
local tiltX, tiltY = castle.getDeviceTilt()
```

Use tilt only when the game is designed for it. Touch is the default.

## Timers

```lua
castle.runAfterDelay(1.5, function()
  ready = true
end)

local handle = castle.repeatAtInterval(0.25, function()
  blink = not blink
end)

castle.stopRepeat(handle)
```

Avoid `castle.sleep(seconds)` in normal gameplay. It blocks the script while sleeping.
