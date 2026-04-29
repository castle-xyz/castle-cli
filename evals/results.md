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
