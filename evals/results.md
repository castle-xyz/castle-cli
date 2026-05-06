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

## Breakout Stack And CLI4 Prompt Experiments, High Effort

These batches compare the breakout prompt across web stacks and CLI 4 prompt/doc states. Raw run directories remain under ignored `eval-runs/`; this section is the committed summary.

Important timing note: CLI 4 result files have both `agentRun.durationMs` and top-level `durationMs`. Earlier ad hoc tables sometimes labeled total run duration as agent duration. The tables below keep `agent` and `total` separate.

Campaigns and commits:

- Opus original all-stack baseline: `before-simple-20260429-2130` at `17aa381`
- Opus docs/simple CLI4: `simple-docs-cli4-20260429-2155` at `097726d`
- Opus focused `CLAUDE.md` CLI4: `focused-claude-cli4-20260429-2206` at `880e375`
- Sonnet CLI4 original/docs/focused: `orig-sonnet-cli4-20260429-2237`, `simple-docs-sonnet-cli4-20260429-2237`, `focused-claude-sonnet-cli4-20260429-2237`
- Sonnet other stacks: `sonnet-other-stacks-20260429-2324`
- Opus other stacks: `opus-other-stacks-20260429-2335` was stopped after one complete round.

### CLI4 Single-Script Improvement

This table isolates single-script CLI 4, comparing docs/simple and focused `CLAUDE.md` against the original prompt state.

```text
model   condition       n  agent med  agent vs orig  total med  total vs orig  warn
------  --------------  -  ---------  -------------  ---------  -------------  ----
opus    orig            3        99s  baseline            183s  baseline       0/3
opus    docs/simple     3       104s  +5s,  +5%           150s  -33s, -18%     1/3
opus    focused CLAUDE  3        91s  -8s,  -8%           132s  -51s, -28%     1/3
sonnet  orig            3       128s  baseline            161s  baseline       0/3
sonnet  docs/simple     3       127s  -1s,  -1%           157s   -4s,  -2%     0/3
sonnet  focused CLAUDE  3        90s  -38s, -30%          122s  -39s, -24%     0/3
```

Takeaway: docs/simple reduced Opus total time but did not reduce Opus agent-only time on single-script. Focused `CLAUDE.md` improved both models on agent median, with the clearest Sonnet gain. The Opus docs/simple and focused warning runs were real generated-code failures caused by Lua `goto` before the no-goto instruction was added.

### CLI4 Conditions

```text
model   condition       variant          n  agent med  agent p75  agent range  total med  total p75  total range  warn  timeout
------  --------------  ---------------  -  ---------  ---------  -----------  ---------  ---------  -----------  ----  -------
opus    orig            single-script    3        99s       108s  83-108s           183s       191s  163-191s     0/3   0/3
opus    orig            separate-actors  3       271s       300s  214-300s          308s       332s  247-332s     2/3   1/3
opus    docs/simple     single-script    3       104s       124s  103-124s          150s       161s  139-161s     1/3   0/3
opus    docs/simple     separate-actors  3       162s       219s  160-219s          201s       259s  198-259s     0/3   0/3
opus    focused CLAUDE  single-script    3        91s       140s  87-140s           132s       179s  125-179s     1/3   0/3
opus    focused CLAUDE  separate-actors  3       224s       300s  223-300s          311s       334s  261-334s     0/3   1/3
sonnet  orig            single-script    3       128s       133s  123-133s          161s       172s  159-172s     0/3   0/3
sonnet  orig            separate-actors  3       300s       300s  181-300s          332s       336s  219-336s     0/3   2/3
sonnet  docs/simple     single-script    3       127s       130s  110-130s          157s       165s  151-165s     0/3   0/3
sonnet  docs/simple     separate-actors  3       300s       300s  300-300s          332s       339s  330-339s     2/3   3/3
sonnet  focused CLAUDE  single-script    3        90s       113s  88-113s           122s       144s  121-144s     0/3   0/3
sonnet  focused CLAUDE  separate-actors  2       300s       300s  300-300s          348s       348s  332-348s     2/2   2/2
```

Focused Sonnet separate-actors was intentionally stopped after 2 completed runs because both hit the 5-minute agent timeout with warnings.

### Sonnet Other Stacks

```text
stack           n  agent med  agent p75  agent range  total med  warn  timeout
--------------  -  ---------  ---------  -----------  ---------  ----  -------
canvas          3        78s        85s  77-85s            122s  1/3   0/3
pixi            3        89s        97s  85-97s            134s  0/3   0/3
cli-script      3       112s       118s  77-118s           149s  0/3   0/3
exp-web-canvas  3        85s        95s  80-95s            129s  1/3   0/3
exp-web-pixi    3       175s       240s  129-240s          201s  0/3   0/3
```

Current read: Sonnet is competitive on plain canvas/pixi and exp-web-canvas, slower on cli-script, and much slower on exp-web-pixi.

Warning inspection:

- `sonnet-other-stacks-20260429-2324-r2-experimental-web-canvas`: real failure. Screenshot shows a dark canvas with only the `New Game` button. `app/serve.log` reports `ReferenceError: _ is not defined` at `game.js:84` from `resetGame()`, so the state readout never updates.
- `sonnet-other-stacks-20260429-2324-r3-canvas`: mostly functional visually. Screenshot shows a breakout board, score/lives, bricks, and button, but the DOM state readout is `<div id="state">...` without `data-testid="state"`, so harness state verification failed.

### Opus Other Stacks

The Opus other-stack run was stopped after one complete round because the batch had produced enough signal for the day. Round 2 was in browser verification when stopped and did not write result files.

```text
stack           n  agent med  agent p75  agent range  total med  warn  timeout
--------------  -  ---------  ---------  -----------  ---------  ----  -------
canvas          1        94s        94s  94-94s            150s  0/1   0/1
pixi            1        98s        98s  98-98s            157s  0/1   0/1
cli-script      1        97s        97s  97-97s            152s  0/1   0/1
exp-web-canvas  1        80s        80s  80-80s            134s  0/1   0/1
exp-web-pixi    1        96s        96s  96-96s            150s  0/1   0/1
```

This partial Opus result did not reproduce Sonnet's exp-web-pixi slowdown; all five stacks landed in roughly 80-98s agent time.

### Transcript Profile

Transcript profile averages count agent tool calls from `transcript.jsonl`. This is a coarse but useful way to separate model thinking/editing time from browser verification or dependency install time.

```text
group                stack                 n  agent med  total med  tools avg  bash  read  writes  search  docs  shell reads  npm i  build  init  serve  curl
-------------------  --------------------  -  ---------  ---------  ---------  ----  ----  ------  ------  ----  -----------  -----  -----  ----  -----  ----
opus orig web+cli4   canvas                3        83s       161s        7.7   4.3   0.0     3.3     0.0   0.0          2.3    1.0    0.0   0.0    0.0   1.0
opus orig web+cli4   pixi                  3        95s       180s        9.0   5.3   0.0     3.7     0.0   0.0          2.3    1.0    0.0   0.0    0.0   1.0
opus orig web+cli4   cli-script            3        93s       185s        6.7   3.3   1.7     1.7     0.0   1.7          1.0    0.0    0.0   0.0    1.3   0.0
opus orig web+cli4   exp-web-canvas        3        73s       149s        8.0   4.0   3.0     1.0     0.0   1.0          1.0    1.0    0.0   1.0    1.0   0.0
opus orig web+cli4   exp-web-pixi          3        90s       174s        9.7   5.0   3.3     1.3     0.0   1.0          1.7    1.0    0.0   1.0    1.3   0.0
opus orig web+cli4   cli4-single-script    3        99s       183s       11.3   6.0   3.7     1.3     0.3   1.3          3.0    0.0    0.0   1.0    2.0   0.0
opus orig web+cli4   cli4-separate-actors  3       271s       308s       34.0  18.0   7.0     8.0     1.0   2.0         10.0    0.0    0.0   1.0    2.3   0.0
opus focused cli4    cli4-single-script    3        91s       132s       15.0   8.3   5.7     1.0     0.0   3.0          4.3    0.0    0.0   1.0    1.3   0.0
opus focused cli4    cli4-separate-actors  3       224s       311s       42.3  20.0  13.0     5.0     4.0   4.7         13.7    0.0    0.0   1.0    1.3   0.0
sonnet other stacks  canvas                3        78s       122s        6.3   3.3   0.0     3.0     0.0   0.0          0.0    1.0    0.0   0.0    0.0   1.0
sonnet other stacks  pixi                  3        89s       134s        7.3   4.3   0.0     3.0     0.0   0.0          1.0    1.0    0.0   0.0    0.0   1.0
sonnet other stacks  cli-script            3       112s       149s       10.0   6.3   2.0     1.7     0.0   1.3          2.7    0.0    0.0   0.0    1.0   0.7
sonnet other stacks  exp-web-canvas        3        85s       129s       11.7   8.7   2.0     1.0     0.0   0.0          4.0    1.0    0.0   1.0    1.0   1.0
sonnet other stacks  exp-web-pixi          3       175s       201s       13.7  10.7   1.3     1.7     0.0   0.0          4.7    2.0    0.0   2.3    1.0   0.7
sonnet focused cli4  cli4-single-script    3        90s       122s        9.3   6.0   2.0     1.3     0.0   2.3          3.3    0.0    0.0   1.0    1.3   0.0
sonnet focused cli4  cli4-separate-actors  2       300s       348s       45.5  19.0  10.5    16.0     0.0   3.5          9.5    0.0    0.0   1.0    3.5   0.0
```

The CLI4 slowdown is mostly tool churn, not just docs. CLI4 single-script is now close to the web/cli-script stacks: focused Sonnet single-script used 9.3 tools on average and had a 90s agent median. CLI4 separate-actors is a different profile: 34-46 tools on average, many more shell reads, more file reads, and many more writes across multiple scripts/blueprints. That matches the hypothesis that the agent is spending time coordinating a multi-file Castle deck, not just reading the wrong docs.

### 2026-04-30 CLI4 Focused Trim And Targeted Fixes

These serial one-at-a-time runs followed the over-expanded CLAUDE.md trim. The baseline commit was `8c9575e` (`agent: trim cli4 tool guidance`). Two small follow-up fixes were then made from transcript evidence:

- `2502813` (`agent: clarify edit script shape`) documented `script: [{ "code": "..." }]` and numeric deck variables.
- `8175c3d` (`agent: remove invalid broadcast api`) removed nonexistent `my:broadcastMessage(...)` guidance.
- `2f0cec4` (`agent: clarify deck variables`) documented predeclaring shared deck variables and actor scale overrides.

```text
commit   variant          model   agent_s  total_s  timeout  warn  visual/verdict
-------  ---------------  ------  -------  -------  -------  ----  -------------------------------
8c9575e  single-script    sonnet      116      202   no          0  pass; game over after harness tap
8c9575e  single-script    opus         95      226   no          0  pass; game over after harness tap
8c9575e  separate-actors  sonnet      240      331   yes        12  partial/static; bad script field shape
8c9575e  separate-actors  opus        240      329   yes        20  partial/static; bad script field + variable warning
2502813  separate-actors  sonnet      155      251   no         17  visible, but runtime error after tap
8175c3d  separate-actors  sonnet      174      260   no         12  usable visible pass; no runtime errors
99dcfa7  separate-actors  opus        240      327   yes        12  visible but unfinished; variables/scale confusion
2f0cec4  separate-actors  opus        240      293   yes        20  visible but unfinished; no source dive or Lua errors
```

Warning counts in this table include duplicated screenshot-poll `Failed to fetch` lines during hot reloads. The important real warnings were:

- Before `2502813`, both separate-actors runs used the wrong `script` shape in `edit`, so scripts did not attach and both models source-dived into `src/` before timing out.
- The Opus pre-fix run also hit `Expected number in setVariable for argument #2`; the docs now state deck variables store numbers.
- After `2502813`, Sonnet attached scripts and finished, but used `my:broadcastMessage(...)`, which is not registered by `script.cpp`; `8175c3d` removed that bad instruction.
- After `8175c3d`, Opus still timed out and spent time debugging why `getVariable` values were `0` and why placed actor scales overrode blueprint scales; `2f0cec4` documented those constraints.
- After `2f0cec4`, Opus used the deck-variable schema and avoided the source dive, but still timed out from multi-script/multi-edit iteration. The resulting screenshot had score/lives updating and no Lua errors, but the game was still visually unfinished.

Transcript notes:

- Single-script Sonnet was lean: simple docs, one targeted deck discovery command, direct `main.lua` write, serve/logs. No direct YAML edits.
- Single-script Opus did more directory probing and read one blueprint YAML, but still wrote only Lua and did not source-dive.
- Separate-actors before the fixes spent most of the extra time on schema uncertainty: repeated `edit` attempts, YAML inspection, `find/ls/cat`, then source exploration.
- After the script-shape and broadcast fixes, Sonnet separate-actors avoided the source dive and completed inside the 4-minute agent cap. It still used multiple `edit --deck ...` calls even though CLAUDE.md says active socket commands need no `--deck`, so command examples may need more force later.
- Opus separate-actors remained above the 4-minute cap even with the targeted docs fixed. The latest run created variables, blueprints, actors, and five Lua files without source exploration, then kept reading/revising scripts and inspecting scene files until timeout.
- The JS canvas `toDataURL` probe continued to report all-black/transparent samples even when saved screenshots and pixel stats were visibly nonblank; screenshot files are the trusted visual artifact for this batch.
