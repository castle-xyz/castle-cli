# CLI 4 Agent Evals

Run a Claude Code or Codex task end-to-end, then verify the served deck with CLI commands and `npx agent-browser`.

```bash
npx tsx evals/run-agent-eval.ts --prompt breakout --model sonnet --timeout-min 20
npx tsx evals/run-agent-eval.ts --agent codex --model gpt-5.4 --effort low --prompt breakout --timeout-min 20
```

Agents changing or running evals should read this file first. `CLAUDE.md` points here, and the harness also injects the critical runtime instructions directly into each eval prompt.

Outputs are written under `eval-runs/<timestamp>-<prompt>-<agent>-<model>-<effort>/`:

- `transcript.jsonl` — agent output stream
- `claude.stderr.log` or `codex.stderr.log` — agent stderr
- `codex-last-message.txt` — final Codex response when running Codex
- `status.log` — `npx tsx src/index.ts status`
- `logs.txt` — `npx tsx src/index.ts logs`
- `browser-*.log` — `agent-browser` verification output
- `screenshots/browser.png` — `agent-browser` screenshot when a local serve URL is available
- `screenshots/cli.png` — CLI screenshot captured from the served preview
- `result.json` — timings, timeout status, exit codes, screenshot dimensions, PNG pixel stats, canvas-region pixel stats, and verification summary

Browser verification runs headless by default to avoid UI noise. It opens the served URL, measures the canvas, sends a coordinate mouse down/up at the canvas center, then captures the browser screenshot before collecting slower probes/logs so transient visual feedback is less likely to disappear. Use `--headed` only when you want to inspect the browser. Use `--no-browser` to skip browser verification, and `--timeout-ms` or `--timeout-min` to control the hard agent timeout.

The harness prints timestamped command start/finish lines and streams child stdout/stderr while also saving full artifacts. Live console output is capped per command stream; use `--console-output-limit-kb` to adjust it. Eval prompts should tell agents to start local preview with `serve --detach`; foreground `serve` intentionally stays alive and will block noninteractive eval agents.

For visual checks, inspect both `screenshots/browser.png` and `verification.screenshots.browserCanvas.pixelStats` in `result.json`. A very high `mostCommonRatio` and very low `uniqueColors` or `lumaStdDev` inside the canvas region usually means the served deck is blank or visually too subtle even when status/log checks pass.

The harness also records `verification.scriptWarnings` for known Castle API footguns such as `castle.draw.print`, `castle.dt()`, `my.body`, `my:destroy()`, and `onCollide`. These warnings do not replace visual inspection, but they make common model mistakes easy to compare across runs.

## Prompt Suite

Use a small set of prompts that exercise different skills instead of optimizing for one template:

- `tap-particles` — touch input, custom drawing, transient visual feedback, screenshot timing.
- `dialogue-rpg` — stateful dialogue, text layout, choice/progression UI, slower creative writing.
- `falling-stars` — autonomous animation, timers, score/lives HUD, touch-controlled movement.
- `maze-key-door` — spatial layout, manual distance checks, player movement, item/door state.

The first vertical is build-from-scratch only. Once that has repeatable timings and screenshots, add a second vertical for incremental edits to existing games, such as "make this dialogue more interesting", "add a new hazard", or "improve the win state".

## Timing Comparisons

Run models sequentially so local serve registries and ports do not overlap. Keep the same prompt, effort, and timeout when comparing agents:

```bash
npx tsx evals/run-agent-eval.ts --agent codex --model gpt-5.4-mini --effort low --prompt dialogue-rpg --timeout-min 8 --browser-timeout-ms 45000 --command-timeout-ms 15000 --console-output-limit-kb 24
npx tsx evals/run-agent-eval.ts --agent claude --model opus --effort low --prompt dialogue-rpg --timeout-min 8 --browser-timeout-ms 45000 --command-timeout-ms 15000 --console-output-limit-kb 24
npx tsx evals/run-agent-eval.ts --agent claude --model sonnet --effort low --prompt dialogue-rpg --timeout-min 8 --browser-timeout-ms 45000 --command-timeout-ms 15000 --console-output-limit-kb 24
```

Summarize results with:

```bash
npx tsx evals/summarize-results.ts
npx tsx evals/summarize-results.ts eval-runs/<run-id> eval-runs/<other-run-id>
```

## Evaluation Roadmap

Keep the first vertical deliberately small: agents build a new deck from scratch, serve it, and the harness collects timing, logs, browser input, screenshots, and basic quality warnings. Once this is repeatable, iterate in these directions:

- **Prompt compression:** compare broad docs, focused docs, and no explicit docs to see whether shorter context reduces time without increasing bad APIs or bland output.
- **Prompt variety:** keep at least three game types in rotation so agents do not overfit a single particle/template pattern.
- **Quality gates:** turn repeated visual failures into machine-readable warnings first, then only into hard failures once the warning is trustworthy.
- **Agent behavior:** track whether agents use `edit`, direct script edits, broad searches, foreground `serve`, old docs, invalid APIs, or unnecessary browser automation.
- **Incremental edits:** after the build-from-scratch vertical, add runs that start from an existing generated deck and ask for one small improvement, such as better dialogue, a new enemy, a new level, clearer HUD, or a win/lose polish pass.
- **Existing deck edits:** later, test `pull` or provided fixtures where the task is to understand and modify a nontrivial existing game without breaking it.
- **Human playtest fit:** preserve screenshots and short summaries that a person can scan quickly. A fast run is only useful if the resulting game is interesting enough to keep iterating on.

Suggested recurring questions after each batch:

- Which model/effort produced acceptable visuals fastest?
- Did it read too much context or the wrong docs?
- Did it use invalid Castle APIs?
- Did it produce gameplay state that changed after browser input?
- Was the result reusable for another iteration, or did it paint itself into a corner?
- What one CLI/docs/harness change would have prevented the failure?
