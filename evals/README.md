# CLI 4 Agent Evals

Run a Claude Code or Codex task end-to-end, then verify the served deck with CLI commands and `npx agent-browser`.

```bash
npx tsx evals/run-agent-eval.ts --prompt breakout --model sonnet --timeout-min 20
npx tsx evals/run-agent-eval.ts --agent codex --model gpt-5.4 --effort low --prompt breakout --timeout-min 20
```

Agents changing or running evals should read this file first. `CLAUDE.md` points here, and the harness also injects the critical runtime instructions directly into each eval prompt.

For model timing batches, use the matrix runner. It runs evals in parallel with isolated CLI registry/config directories so `status`, `logs`, and `screenshot` target the correct local serve:

```bash
npx tsx evals/run-agent-matrix.ts --prompt dialogue-rpg --concurrency 3
npx tsx evals/run-agent-matrix.ts --prompt dialogue-rpg --doc-pack minimal --concurrency 3
```

By default this compares `codex:gpt-5.5:high`, `claude:opus:high`, and `claude:sonnet:high`. Add repeated `--spec agent:model:effort` flags to override the default set. Matrix summaries are written to `eval-runs/results/<run-group>.md`; committed cross-run summaries live in `evals/results.md`.

Use `--doc-pack` to test whether appending docs directly to the prompt reduces discovery/tool-call overhead. `minimal` is a short cheat sheet, `focused` appends the small `docs/simple` drawing/input/actor references, and `current` appends the current main instruction plus `docs/simple` core set. The harness records the selected pack in `result.json`.

For non-Castle baselines, use the web smoke runner. It asks the same model set to create a small dialogue RPG in a temp app directory, then installs/builds/serves it and verifies with `agent-browser`:

```bash
npx tsx evals/run-web-smoke-matrix.ts --stack canvas --concurrency 3
npx tsx evals/run-web-smoke-matrix.ts --stack pixi --concurrency 3
npx tsx evals/run-web-smoke-matrix.ts --stack cli-script --concurrency 3
```

Use the transcript profiler to compare where agent time went across Castle and non-Castle runs:

```bash
npx tsx evals/profile-agent-runs.ts eval-runs/<castle-run> eval-runs/react-smoke/<react-run>
python3 evals/transcript-timeline.py eval-runs/<run-id>
```

This does not expose hidden model reasoning. It summarizes observable transcript behavior: tool calls, shell commands, file writes, reads/searches, docs reads, npm install/build commands, token counts when the agent CLI reports them, and cost for Claude runs.

For every prompt, docs, or CLI workflow experiment, inspect representative `transcript.jsonl` files before drawing conclusions. Record the qualitative tool-call story in `evals/results.md`, not only timing tables. Specifically check:

- whether the agent used `edit` for scene structure or edited generated scene YAML directly
- how many setup/discovery calls happened before the first script write
- whether repeated `ls`/`find`/`cat` calls could be replaced by a better CLI inspect/read command or clearer instructions
- whether `serve`, `logs`, `status`, and screenshot checks were run in a useful order
- whether failures came from docs/API confusion, CLI path confusion, scene wiring, generated-code bugs, or browser/harness verification

When comparing two approaches, include at least one timeline excerpt or short narrative such as: "single-script read docs, found main.lua, wrote once, served/logged; separate-actors created blueprints via edit, then drifted into extra source reads while trying to wire Script behavior." These narratives are often more actionable than median seconds alone. When putting tables in monospace blocks, align columns so the numbers scan cleanly.

Outputs are written under `eval-runs/<timestamp>-<prompt>-<agent>-<model>-<effort>/`:

- `transcript.jsonl` — agent output stream
- `claude.stderr.log` or `codex.stderr.log` — agent stderr
- `codex-last-message.txt` — final Codex response when running Codex
- `status.log` — `npx tsx src/index.ts status`
- `logs.txt` — `npx tsx src/index.ts logs`
- `browser-*.log` — `agent-browser` verification output
- `screenshots/browser.png` — `agent-browser` screenshot when a local serve URL is available
- `screenshots/cli.png` — CLI screenshot captured from the served preview
- `result.json` — timings, git commit metadata, timeout status, exit codes, screenshot dimensions, PNG pixel stats, canvas-region pixel stats, and verification summary

Browser verification runs headless by default to avoid UI noise. It opens the served URL, measures the canvas, sends a coordinate mouse down/up at the canvas center, then captures the browser screenshot before collecting slower probes/logs so transient visual feedback is less likely to disappear. Use `--headed` only when you want to inspect the browser. Use `--no-browser` to skip browser verification, and `--timeout-ms` or `--timeout-min` to control the hard agent timeout.

The harness prints timestamped command start/finish lines and streams child stdout/stderr while also saving full artifacts. Live console output is capped per command stream; use `--console-output-limit-kb` to adjust it. Eval prompts should tell agents to start local preview with `serve --detach`; foreground `serve` intentionally stays alive and will block noninteractive eval agents.

For visual checks, inspect both `screenshots/browser.png` and `verification.screenshots.browserCanvas.pixelStats` in `result.json`. A very high `mostCommonRatio` and very low `uniqueColors` or `lumaStdDev` inside the canvas region usually means the served deck is blank or visually too subtle even when status/log checks pass.

The harness also records `verification.scriptWarnings` for known Castle API footguns such as `castle.draw.print`, `castle.dt()`, `my.body`, `my:destroy()`, and `onCollide`. These warnings do not replace visual inspection, but they make common model mistakes easy to compare across runs.

For first-shot game prompts, prefer fast visible slices over elaborate structure. A single visible Stage/Controller actor with `onDraw()` and `onUpdate(dt)` is often the fastest acceptable first pass. If a draw actor owns the scene, HUD, or dialogue, keep `Layout.visible` true or omit it; `visible: false` will make the whole first shot blank.

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
