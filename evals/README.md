# CLI 4 Agent Evals

Run a Claude Code task end-to-end, then verify the served deck with CLI commands and `npx agent-browser`.

```bash
npx tsx evals/run-agent-eval.ts --prompt breakout --model sonnet --timeout-min 20
```

Outputs are written under `eval-runs/<timestamp>-<prompt>-<model>/`:

- `transcript.jsonl` — Claude stream output
- `claude.stderr.log` — Claude stderr
- `status.log` — `npx tsx src/index.ts status`
- `logs.txt` — `npx tsx src/index.ts logs`
- `browser-*.log` — `agent-browser` verification output
- `screenshot.png` — browser screenshot when a local serve URL is available
- `result.json` — timings, timeout status, exit codes, and verification summary

Use `--no-browser` to skip browser verification, `--headless` to avoid a visible browser window, and `--timeout-ms` or `--timeout-min` to control the hard agent timeout.
