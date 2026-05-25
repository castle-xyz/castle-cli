# Castle CLI Repo

@docs/agent/AGENTS.md

This file is only the source-checkout wrapper. The canonical Castle agent guide is `docs/agent/AGENTS.md`, and `castle docs` copies that guide to `~/.castle/docs/AGENTS.md` and `~/.castle/docs/CLAUDE.md`.

When reading the included guide from this repo checkout, resolve shared-doc paths like this:

- `simple/...` means `docs/simple/...`
- `full/...` means `docs/full/...`

The included guide is for Castle deck/game work. For CLI source changes, it is fine to inspect `src/`, `bundles/`, package metadata, and tests as needed.

For CLI source changes, do not edit generated `dist/` files directly. Run `npm run build` after TypeScript changes, and use `npm pack --dry-run --json` when package contents matter.

## Engine bundle refresh

Castle CLI loads the Node engine bundle from `bundles/player/node/`.
Run this from a `castle-cli` checkout:

```sh
CLI_REPO="$(pwd -P)"
CASTLE_CLIENT_CORE="${CASTLE_CLIENT_CORE:-../castle-client/core}"

cd "$CASTLE_CLIENT_CORE"
source vendor/emsdk/emsdk_env.sh
bash run.sh node-release

mkdir -p "$CLI_REPO/bundles/player/node"
cp build/node-release/castle-core-node.* "$CLI_REPO/bundles/player/node/"

cd "$CLI_REPO"
npm run build
```

Set `CASTLE_CLIENT_CORE` to the actual `castle-client/core` path if the repos are not sibling checkouts.
If `vendor/emsdk/emsdk_env.sh` is missing, run `bash run.sh web-init` in `castle-client/core` once first.
`node-release` builds `build/node-release/` and also tries to copy `castle-core-node.js` and `castle-core-node.wasm` to `../../castle-www/player/node/` relative to `castle-client/core`.
The `cp build/node-release/...` step is what refreshes the packaged CLI copy.
Keep `bundles/player/node/package.json` in place; it marks the generated bundle as CommonJS for the ESM CLI.

`bash run.sh node-dev` is faster, but it writes to `../../castle-cli/node-dev/` relative to `castle-client/core`.
That directory is useful for temporary local experiments only and is not the package bundle.

For local testing, run `node dist/index.js ...` from the repo or `npm link` and test the `castle` bin.
Use `npm pack --dry-run --json` when checking packaged contents.
Do not run `npm publish`; the user handles publishing separately.

For release/package handoff work, keep `README.md`, `docs/agent/AGENTS.md`, `src/commands/docs.ts`, and the `castle --help` text in `src/index.ts` consistent. Do not duplicate the full agent guide here.
