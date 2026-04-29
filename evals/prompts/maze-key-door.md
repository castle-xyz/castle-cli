Make a small key-and-door maze game from scratch.

Requirements:
- Do not read or inspect existing decks under `decks/`.
- Create a new local deck project in the eval deck directory provided by the harness by running the `init` command first.
- Start local serve with `--detach` after `init` and before using `edit`.
- Make a compact maze or obstacle layout, a player marker, a key, a locked door, and a clear win state.
- Touching/clicking should move the player toward the tap or step the player through the maze.
- The key and door state should be visible. After one tap, the screenshot should show a changed player position, path marker, or other clear feedback.
- Use manual distance checks if you move actors by changing `layout.x` and `layout.y`; do not rely on physics collision callbacks.
- For custom drawing text, read `docs/scripts/drawing-reference.md` and use `castle.draw.text(...)`; do not use `castle.draw.print(...)`.
- Check status and logs after making changes.
- Do not open a browser yourself; the eval harness will verify the game visually with headless `agent-browser`.
