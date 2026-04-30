---
sidebar_position: 1
---
# Intro to Scripts

Many decks in Castle need to maintain complex state and run logic in order to work. Castle includes more than one way to do this. If you're new to Castle, the simpler way to get started is to learn about [Rules](../reference/Rule) and [Castle variables](../reference/Variable). Scripts are another way to maintain state and run logic.

To get started writing scripts in Castle, head over to the [scripting tutorials](tutorials/getting-started).

## Why (not) use scripts?

Scripting is not required to use Castle. Many of the most complex and polished decks on Castle do not use scripting at all. However, some decks have more specific requirements that go beyond the capability of Rules; and some people just prefer to write code instead of visual logic.

Some of the most common cases are:

- Your deck needs to manipulate text (strings) beyond the capability of [Text actors](../behaviors/Text).
- Your deck needs to manipulate data structures (lists, grids, sorting).
- You just don't like tapping on your phone screen to arrange logic, and you want to type on a keyboard.

For cases like these, you might want to write scripts.

On the other hand, if you don't particularly care about advanced string or data structure manipulation, or you don't want to write code on a phone, you're better off avoiding scripts.

## How do scripts work in Castle?

Scripts in Castle are written in lua. Script is actually a [Behavior](../behaviors/Behavior) that can be added to a [Blueprint](../reference/Blueprint). It causes that blueprint's actors to run a lua script that receives certain [handlers](tutorials/handlers). Unlike Castle rules, lua scripts have access to standard lua features like [strings](tutorials/lua/strings) and tables. They can also access Castle [actors](tutorials/actors), [behaviors](actor-reference), and [variables](tutorials/castle-variables).

Ready to learn how to write Castle scripts? Check out the [scripting tutorials](tutorials/getting-started).
