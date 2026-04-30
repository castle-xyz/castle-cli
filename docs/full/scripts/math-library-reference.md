# Math Library Reference

## Rounding Functions

#### `math.round(number)` {#round}

Rounds to the nearest integer.

```
-- returns 1
math.round(1.1)

-- returns 2
math.round(1.9)
```

#### `math.floor(number)` {#floor}

Rounds down to the nearest integer.

```
-- returns 1
math.round(1.1)

-- returns 1
math.round(1.9)
```

#### `math.ceil(number)` {#ceil}

Rounds up to the nearest integer.

```
-- returns 2
math.round(1.1)

-- returns 2
math.round(1.9)
```


## Trigonometry Functions

### Conversion

The Lua math library uses radians. Some parts of the Castle library use degrees. For example,
[layout.rotation](./actor-reference#layout.rotation) is in degrees. If you want to use [math.sin](#sin) on [layout.rotation](./actor-reference#layout.rotation), you'll need to convert it to radians first:
```
local myRotationDegrees = my.layout.rotation
local myRotationRadians = math.rad(myRotationDegrees)
math.sin(myRotationRadians)
```

#### `math.rad(angle in degrees)` {#rad}

Converts from degrees to radians

#### `math.deg(angle in radians)` {#deg}

Converts from radians to degrees

### Common

These are the trigonometry function most commonly used in games.

#### `math.cos(angle in radians)` {#cos}

`math.cos` is commonly used to get the X component of an angle.

Let's say you want to draw something 45 degrees up and 2 units away from the current actor. Here's how you'd get the X position for that:

```
local myXPosition = my.layout.x
local angleInRadians = math.rad(45)

-- math.cos(angle) will return the X position 1 unit away,
-- so we need to multiply by 2.0 to get the result 2 units away
local dx = math.cos(angleInRadians) * 2.0

local x = myXPosition + dx
```

#### `math.sin(angle in radians)` {#sin}

`math.sin` is commonly used to get the Y component of an angle.

Let's say you want to draw something 45 degrees up and 2 units away from the current actor. Here's how you'd get the Y position for that:

```
local myYPosition = my.layout.y
local angleInRadians = math.rad(45)

-- math.sin(angle) will return the Y position 1 unit away,
-- so we need to multiply by 2.0 to get the result 2 units away
local dy = math.sin(angleInRadians) * 2.0

local x = myYPosition + dy
```

#### `math.atan2(y, x)` {#atan2}

`math.atan2` is used to convert x and y coordinates to an angle. Here's an example of using it to get the angle between you and another actor:

```
local otherActor = castle.closestActorWithTag("wall")

// The distance in the X direction from my actor to otherActor
local dx = otherActor.layout.x - my.layout.x
// The distance in the Y direction from my actor to otherActor
local dy = otherActor.layout.y - my.layout.y

// This returns the angle from my actor to otherActor
math.atan2(dy, dx)

```

### Other

#### `math.tan(angle in radians)` {#tan}


#### `math.acos(number)` {#acos}

#### `math.asin(number)` {#asin}

#### `math.atan(number)` {#atan}

This is similar to [math.atan2](#atan2) but only takes a single number. It's usually better to just use [math.atan2](#atan2) instead of this.

#### `math.cosh(number)` {#cosh}

#### `math.sinh(number)` {#sinh}

#### `math.tanh(number)` {#tanh}


## Randomness Functions

#### `math.random(...)` {#random}

`math.random` has a few different formats:

- `math.random()` - Returns a random number between 0 and 1.

- `math.random(number)` - Returns a random number between 1 and the number you pass in. The number is converted to an integer, so if you pass in 3.5, you'll get a number between 1 and 3.

- `math.random(min number, max number)` - Returns a random number between min number and max number. Both numbers are converted to integers, so if you pass in (1.5, 6.2), you'll get a number between 1 and 6.

#### `math.randomseed(number)` {#randomseed}

Sets the random seed. When you call `math.random` normally, it will return a different number every time you run your deck. If you call `math.randomseed` with a fixed number, every `math.random` call after that will be the same every time you run your deck. Here's an example:

```
math.randomseed(0)

-- This will return 0.55145569... every time you run the deck
math.random()
```

This function is useful to help debug your code. It can also be useful if you want to record and replay some events without randomness. You don't need to use it if you want `math.random` to actually be random.

#### `math.choose(a, b)` {#choose}

Returns one of `a` or `b`, each with `0.5` probability.

#### `math.weightedChoose(a, b, aWeight, bWeight)` {#weightedChoose}

Returns one of `a` or `b`, weighted by their respective weights `aWeight` and `bWeight`. The probability of `a` being returned is `aWeight / (aWeight + bWeight)`.

#### `math.gauss(mean, sigma)` {#gauss}

Returns a random number with a Gaussian distribution.


## Misc Functions

#### `math.max(multiple numbers)` {#max}

Returns the largest number.

```
-- Returns 3

math.max(1, 2, 3)
```

#### `math.min(multiple numbers)` {#min}

Returns the smallest number.

```
-- Returns 1

math.max(1, 2, 3)
```

#### `math.abs(number)` {#abs}

Returns the absolute value.

```
-- Returns 9

math.abs(-9)
```

#### `math.clamp(number, min number, max number)` {#clamp}

Changes the number to be between the min and max numbers.

```
-- 2 is already between 1 and 3, so this returns 2
math.clamp(2, 1, 3)

-- 0 is below 1, so returns 1
math.clamp(0, 1, 3)

-- 4 is above 3, so returns 3
math.clamp(4, 1, 3)
```

#### `math.mix(a, b, mix)` {#mix}

Returns a value partway from `a` to `b`, depending on the `mix` parameter. A `mix` of `0` gives `a`, while a `mix` of `1` gives `b`. A `mix` of `0.5` gives a value exactly halfway between `a` and `b`. The result is computed as `(1 - mix) * a + mix * b`.

#### `math.sign(number)` {#sign}

Returns just the sign of the number.

- If the number is negative, it returns -1
- If the number is positive, it returns 1
- If the number is 0, it returns 0

#### `math.pow(number x, number y)` {#pow}

Returns x<sup>y</sup>.

#### `math.sqrt(number)` {#sqrt}

Returns the square root.

Be careful! If the number is negative this will return `NaN`, which stands for `Not a Number`.

#### `math.noise(number x, number y, number z)` {#noise}

Returns 3d perlin noise for the point (x, y, z). Returns a number between -1 and 1.

#### `math.perlin(number x, number y, number z)` {#perlin}

Same as `math.noise`.

#### `math.fmod` {#fmod}

#### `math.exp(number)` {#exp}

#### `math.log` {#log}

#### `math.log10` {#log10}

#### `math.modf` {#modf}

#### `math.frexp` {#frexp}

#### `math.ldexp` {#ldexp}
