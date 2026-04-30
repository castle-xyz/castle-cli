# Lua Basics

You've already seen how to write Lua in Castle script. This tutorial will show you more features of Lua.

## Logs

When you add a script and then run your deck in the editor, you will see logs at the bottom of the screen. Logs are useful for figuring out what's happening when your code runs. You can call `print` on any type of Lua object.

```
print("Hello!")
```

```
print(3.14)
```

```
local x = 123
print(x)
```

```
local actor = castle.createActor("Wall", 0, 0)
print(actor)
```

## Comments

Comments are used to help other people (or you in the future) understand your code. It's a good idea to leave a comment any time you write complicated code or when you're writing code that you expect to be used by other people.

```
-- This is a comment. It doesn't change how the code works.
```

```
--[[
  This is a multiline comment.
  Anything between these two lines is a comment.
]]--
```