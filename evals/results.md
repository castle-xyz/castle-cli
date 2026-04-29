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
