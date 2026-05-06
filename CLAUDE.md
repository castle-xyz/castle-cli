# Castle CLI Repo

@docs/agent/AGENTS.md

This file is only the source-checkout wrapper. The canonical Castle agent guide is `docs/agent/AGENTS.md`, and `castle docs` copies that guide to `~/.castle/docs/AGENTS.md` and `~/.castle/docs/CLAUDE.md`.

When reading the included guide from this repo checkout, resolve shared-doc paths like this:

- `simple/...` means `docs/simple/...`
- `full/...` means `docs/full/...`

The included guide is for Castle deck/game work. For CLI source changes, it is fine to inspect `src/`, `bundles/`, package metadata, and tests as needed.

For CLI source changes, do not edit generated `dist/` files directly. Run `npm run build` after TypeScript changes, and use `npm pack --dry-run --json` when package contents matter.

For release/package handoff work, keep `README.md`, `docs/agent/AGENTS.md`, `src/commands/docs.ts`, and the `castle --help` text in `src/index.ts` consistent. Do not duplicate the full agent guide here.
