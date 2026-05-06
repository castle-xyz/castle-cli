Make a tiny dialogue RPG scene from scratch.

Requirements:
- Do not read or inspect existing decks under `decks/`.
- Create a new local deck project in the eval deck directory provided by the harness by running the `init` command first.
- Start local serve with `--detach` after `init` and before using `edit`.
- Make one room with a player, an NPC, and an obvious dialogue panel.
- The NPC should have interesting dialogue with at least three lines and one simple choice or branch.
- Tapping/clicking should advance or choose dialogue. The screenshot after one tap should show changed dialogue state or a highlighted choice.
- Use visible on-screen text. For custom drawing text, read `docs/simple/drawing.md` and use readable `castle.draw.text(...)` sizes, roughly `7` to `12`; do not use `castle.draw.print(...)`.
- Keep enough visual state on screen for at least 10 seconds so the headless screenshot can catch it.
- Check status and logs after making changes.
- Do not open a browser yourself; the eval harness will verify the game visually with headless `agent-browser`.
