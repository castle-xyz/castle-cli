Make a simple falling-stars score game from scratch.

Requirements:
- Do not read or inspect existing decks under `decks/`.
- Create a new local deck project in the eval deck directory provided by the harness by running the `init` command first.
- Start local serve with `--detach` after `init` and before using `edit`.
- Make a player catcher near the bottom, falling stars, at least one hazard type, a score, and a timer or lives counter.
- Touching/clicking should move the catcher or set its target position.
- The game should animate on its own without needing repeated input, so a screenshot shows multiple visible objects.
- The screenshot after one tap should show the catcher, falling objects, and HUD state clearly.
- For custom drawing text, read `docs/scripts/drawing-reference.md` and use `castle.draw.text(...)`; do not use `castle.draw.print(...)`.
- Check status and logs after making changes.
- Do not open a browser yourself; the eval harness will verify the game visually with headless `agent-browser`.
