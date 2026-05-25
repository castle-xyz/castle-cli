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
The source build target is in `~/Development/castle-xyz/castle-client/core`:

```sh
cd ~/Development/castle-xyz/castle-client/core
source vendor/emsdk/emsdk_env.sh
bash run.sh node-release
cp ../../castle-www/player/node/castle-core-node.* ../../castle-cli/bundles/player/node/
```

`node-release` builds `build/node-release/` and copies `castle-core-node.js` and `castle-core-node.wasm` to `~/Development/castle-xyz/castle-www/player/node/`.
The final `cp` is the step that refreshes the packaged CLI copy.
Keep `bundles/player/node/package.json` in place; it marks the generated bundle as CommonJS for the ESM CLI.

`bash run.sh node-dev` is faster, but it writes to `~/Development/castle-xyz/castle-cli/node-dev/`.
That directory is useful for temporary local experiments only and is not the package bundle.

After copying, run `npm run build` in `castle-cli`.
For local testing, run `node dist/index.js ...` from the repo or `npm link` and test the `castle` bin.
Use `npm pack --dry-run --json` when checking packaged contents.
Do not run `npm publish`; the user handles publishing separately.

For release/package handoff work, keep `README.md`, `docs/agent/AGENTS.md`, `src/commands/docs.ts`, and the `castle --help` text in `src/index.ts` consistent. Do not duplicate the full agent guide here.
