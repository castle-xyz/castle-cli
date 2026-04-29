# CLI 4 Eval Results

This file tracks committed CLI/eval changes against model timing and first-shot game quality. Raw artifacts stay under ignored `eval-runs/`; rows here are the durable summary.

## Dialogue RPG, High Effort

Commit: `0723020` (`improve cli4 serve and eval loop`)

| run | agent | model | total(s) | agent(s) | warnings | visual verdict | key failure or note |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `2026-04-29-22-33-36-752-dialogue-rpg-codex-gpt-5-5-high` | codex | gpt-5.5 | 229.7 | 204.5 | 0 | fail | room and characters rendered, but screenshot after one tap had no visible dialogue panel/text |
| `2026-04-29-22-37-57-839-dialogue-rpg-claude-opus-high` | claude | opus | 101.2 | 74.8 | 3 | fail | fastest run, but blank canvas; model set the draw actor `visible: false` |
| `2026-04-29-22-39-58-140-dialogue-rpg-claude-sonnet-high` | claude | sonnet | 124.5 | 99.2 | 0 | partial | visible dialogue panel, but labels/text overlap and the dialogue line clips |

Immediate follow-up from this batch:

- Parallel evals should use isolated CLI config/registry dirs so `status`, `logs`, and `screenshot` do not fight over global serve state.
- `CLAUDE.md` and injected eval prompts should warn that draw/controller actors must remain visible.
- Quality gates need to catch text-heavy failures, not only blank canvases.

## Dialogue RPG, High Effort, Parallel

Commit: `0be125a` (`shorten eval browser sessions`)

Command:

```bash
npx tsx evals/run-agent-matrix.ts --prompt dialogue-rpg --run-group dialogue-high-0be125a --concurrency 3 --timeout-min 12 --browser-timeout-ms 45000 --command-timeout-ms 15000 --console-output-limit-kb 16
```

The parallel batch completed in about `274.7s` wall time, gated by Sonnet, versus `588.3s` summed per-run time.

| run | agent | model | total(s) | agent(s) | warnings | visual verdict | key failure or note |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `2026-04-29-22-50-01-051-dialogue-high-0be125a-dialogue-rpg-claude-opus-high` | claude | opus | 121.0 | 95.8 | 0 | partial | fastest usable run; visible characters and dialogue panel, but text is too tiny because it used `castle.draw.text` sizes around `0.5` |
| `2026-04-29-22-50-01-059-dialogue-high-0be125a-dialogue-rpg-codex-gpt-5-5-high` | codex | gpt-5.5 | 194.3 | 169.1 | 0 | fail | screenshot was mostly a two-tone background/default drawing despite script edits claiming room/dialogue content |
| `2026-04-29-22-50-01-067-dialogue-high-0be125a-dialogue-rpg-claude-sonnet-high` | claude | sonnet | 273.1 | 249.1 | 0 | partial | best first shot with room, player, NPC, and dialogue panel; dialogue line clipped at the bottom after one tap |

Immediate follow-up from this batch:

- Parallel evals are viable in one worktree when each run gets its own `CASTLE_CLI_HOME`.
- `agent-browser` session names must stay short; long run IDs can exceed Unix socket path limits.
- Warning count was too optimistic, so the next harness pass should flag tiny literal `castle.draw.text` sizes and low-detail screenshots.

## React Smoke Baseline, High Effort, Parallel

Commit: `1ca8bdc` (`record parallel dialogue eval results`)

Command:

```bash
npx tsx evals/run-react-smoke-matrix.ts --run-group react-smoke-high-1ca8bdc --concurrency 3 --timeout-min 8 --command-timeout-ms 120000 --browser-timeout-ms 45000 --console-output-limit-kb 16
```

| run | agent | model | total(s) | agent(s) | browser(s) | warnings | visual verdict | key note |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| `2026-04-29-23-05-01-045-react-smoke-high-1ca8bdc-react-smoke-codex-gpt-5-5-high` | codex | gpt-5.5 | 107.1 | 83.7 | 22.2 | 0 | pass | strong scene, readable dialogue, state changed after click |
| `2026-04-29-23-05-01-050-react-smoke-high-1ca8bdc-react-smoke-claude-opus-high` | claude | opus | 100.0 | 68.1 | 24.4 | 0 | pass | fastest React run, readable RPG dialogue and branch UI |
| `2026-04-29-23-05-01-069-react-smoke-high-1ca8bdc-react-smoke-claude-sonnet-high` | claude | sonnet | 115.0 | 92.2 | 21.0 | 0 | pass | functional dialogue scene; state text changed less informatively after first click |

Comparison against the Castle parallel dialogue batch:

| agent | React agent(s) | Castle agent(s) | Castle delta(s) | likely implication |
| --- | ---: | ---: | ---: | --- |
| codex gpt-5.5 | 83.7 | 169.1 | +85.4 | Castle roughly doubled agent time and still failed visually |
| claude opus | 68.1 | 95.8 | +27.7 | Castle overhead was smaller for Opus, but text-size API confusion hurt quality |
| claude sonnet | 92.2 | 249.1 | +156.9 | Castle was the largest slowdown and produced a clipped result |

Immediate follow-up from this batch:

- Browser verification overhead was similar across React and Castle, so the main delta is agent work time.
- React agents did not need docs and all passed visually, so the next Castle experiments should isolate context/doc load from Castle file-format/API complexity.
- A staged Castle eval should compare minimal cheat sheet, focused docs, current `CLAUDE.md`/docs, and broader docs.

Transcript profile for the Castle and React batches:

| suite | agent/model | agent(s) | commands | writes | reads | docs reads | output tokens | cache read |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Castle | codex gpt-5.5 | 169.1 | 47 | 1 | 0 | 2 | 11579 | 610816 |
| Castle | claude opus | 95.8 | 11 | 1 | 1 | 1 | 6274 | 604876 |
| Castle | claude sonnet | 249.1 | 21 | 5 | 9 | 4 | 10331 | 1392222 |
| React | codex gpt-5.5 | 83.7 | 3 | 4 | 0 | 0 | 5844 | 79744 |
| React | claude opus | 68.1 | 2 | 6 | 0 | 0 | 5197 | 355664 |
| React | claude sonnet | 92.2 | 4 | 6 | 0 | 0 | 5389 | 326012 |

This points to the next optimization target: reduce Castle discovery/tool churn first, not browser verification. Hidden model reasoning traces are not available from these agent CLIs, but transcript timing/tool-use profiles are enough to test whether smaller docs and more direct file instructions reduce first-shot latency.
