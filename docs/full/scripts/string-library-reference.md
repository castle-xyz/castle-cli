# String Library Reference

### Operators

#### `..` {#..}

Combines two strings.

```
local s = "hello" .. " castle"

-- now s is the string "hello castle"
```

#### `#` {##}

Returns the length of the string. Same as [`string.len`](#len).

```
local s = "hello"
local n = #s

-- n is the number 5
```

### Functions

#### `string.len(string)` {#len}

Returns the length of the string. Same as [`#`](##).

#### `string.split(string, separator)` {#split}

Splits the first string using the second string and returns each

#### `string.sub(string, number from, number to)` {#sub}

Returns a substring of the string. Use this to get only a part of the string.

```
-- returns the string "st"
string.sub("castle", 3, 4)
```

If you only use 2 arguments, it will return the entire end of the string.

```
-- returns the string "stle"
string.sub("castle", 3)
```

#### `string.lower(string)` {#lower}

Returns the string with every character converted to lower case.

#### `string.upper(string)` {#upper}

Returns the string with every character converted to upper case.

#### `string.reverse(string)` {#reverse}

Returns the reversed string.

```
-- returns "cba"
string.reverse("abc")
```

#### `string.rep(string, number of repeats)` {#rep}

Returns the string repeated a number of times.

```
-- returns the string "hihihi"
string.rep("hi", 3)
```

#### `string.find(string to search, string to search for)` {#find}

Searches the first string for the second string. If it finds the second string, it returns the position of the second string in the first string. If it doesn't find the second string, it returns `nil`.

```
-- This will return 17 since there are 17 characters before "string"
string.find("hello this is a string", "string")

-- This will return nil
string.find("hello this is a string", "castle")
```

Note: The second argument is actually a [string pattern](https://www.lua.org/manual/5.3/manual.html#6.4.1).

#### `string.format(format string, arguments...)` {#format}

Formats the first argument using the remaining arguments and returns that string.

You can do something similar by using `..` to combine strings. This function just makes it easier in some cases.

You can use a few special character in the format string:

- `%i` - This will print an integer.
- `%f` - This will print a float.
- `%s` - This will print a string.

```
-- This will return the string "hello! 1 1.000000 castle"
string.format("hello! %i %f %s", 1, 1, "castle")
```

You can also specify the precision by adding a `.` and then a number

```
-- This returns 1.234000
string.format("%f", 1.234)

-- This returns 1.23
string.format("%.2f", 1.234)
```

#### `string.gsub(string, string to search for, string to replace with)` {#gsub}

Runs a find and replace on the first string and returns the result.

```
-- This returns the string "test string: castle castle castle"
string.gsub("test string: hi hi hi", "hi", "castle")
```

Note: The second argument is actually a [string pattern](https://www.lua.org/manual/5.3/manual.html#6.4.1).

#### `string.match(string, pattern)` {#match}

Looks for the [pattern](https://www.lua.org/manual/5.3/manual.html#6.4.1) in the string. If it finds the pattern, it returns matches from the pattern. If it doesn't find the pattern, it returns `nil`.

```
-- Returns the string "123"
string.match("hello 123 hello", "%d%d%d")
```

#### `string.gmatch(string, pattern)` {#gmatch}

Returns an [iterator](https://www.lua.org/pil/7.1.html) function that returns the next capture from the [pattern](https://www.lua.org/manual/5.3/manual.html#6.4.1) each time it is called.

```
-- This will print "hi" "this" "is" "castle" each on a separate line
local s = "hi this is castle"
for w in string.gmatch(s, "%a+") do
  print(w)
end
```

#### `string.byte(string)` {#byte}

Returns a number representing the first character of the string.

The opposite of [`string.char`](#char).

```
-- Returns 97
string.byte("abc")
```

You can also use a second argument to choose which character of the string is used.

```
-- Returns 98
string.byte("abc", 2)
```


#### `string.char(one or more numbers)` {#char}

Converts each of the numbers into a character and then combines them and returns that string.

The opposite of [`string.byte`](#byte).

```
-- Returns the string "abc"
string.char(97, 98, 99)
```
