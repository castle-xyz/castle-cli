Make a simple tap-particles toy from scratch.

Requirements:
- Do not read or inspect existing decks under `decks/`.
- Create a new local deck project in the eval deck directory provided by the harness by running the `init` command first.
- Start local serve with `--detach` after `init` and before using `edit`.
- Tapping anywhere should spawn visible particles or sparkles at the tap location.
- Keep a visible tap marker, burst, or counter on screen for at least 10 seconds so the headless screenshot can catch it.
- Add enough on-screen feedback that the result is visually obvious in a screenshot.
- For custom drawing text, read `docs/simple/drawing.md` and use `castle.draw.text(...)`; do not use `castle.draw.print(...)`.
- Check status and logs after making changes.
- Do not open a browser yourself; the eval harness will verify the game visually with headless `agent-browser`.
