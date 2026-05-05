# Castle CLI 4 Repo

@docs/agent/AGENTS.md

This file is only the source-checkout wrapper. The canonical Castle agent guide is `docs/agent/AGENTS.md`, and `castle-4 docs` copies that guide to `~/.castle/docs/AGENTS.md` and `~/.castle/docs/CLAUDE.md`.

When reading the included guide from this repo checkout, resolve shared-doc paths like this:

- `simple/...` means `docs/simple/...`
- `full/...` means `docs/full/...`

The included guide is for Castle deck/game work. For CLI source changes, it is fine to inspect `src/`, `bundles/`, package metadata, and tests as needed.

For CLI source changes, do not edit generated `dist/` files directly. Run `npm run build` after TypeScript changes, and use `npm pack --dry-run --json` when package contents matter.

For release/install handoff work, keep `INSTALL.md`, `README.md`, `docs/agent/AGENTS.md`, and `src/commands/docs.ts` consistent. Do not duplicate the full agent guide here.

For eval work, read `evals/README.md` first and keep generated eval output under `eval-runs/`.
