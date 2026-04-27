# Castle CLI 4

Bridge between Castle and a local workspace for AI-assisted game development.

## First thing to do

Run `npm install` if `node_modules/` doesn't exist.

For app-backed editing, start the CLI connection in the background. The user should already have a deck open in the Castle editor.

```bash
npm install  # only if needed
npx tsx src/index.ts
```

Run this in the background — it needs to stay running for the duration of the session. Wait for it to log `[state]` — that means the app is connected and scene state has been synced to `workspace/`. Then read `workspace/CLAUDE.md` for the full workspace instructions.

For app-independent project work, use `pull`, `serve`, `edit`, `screenshot`, and `push` against a project directory. Local project directories normally live under ignored `decks/`.

## Commands

```bash
npx tsx src/index.ts                            # connect to app (run in background)
npx tsx src/index.ts init [dir] --title "Game"  # create a new local project deck
npx tsx src/index.ts pull <deck-id> [dir]       # pull a deck into local project files
npx tsx src/index.ts serve [dir] --open         # serve local project files with bundled player
npx tsx src/index.ts restart                    # stop and restart the active scene
npx tsx src/index.ts screenshot [filename]      # capture through Castle bridge
npx tsx src/index.ts edit < edit.json           # apply scene edits (pipe JSON to stdin)
npx tsx src/index.ts logs                       # show script logs since last restart
npx tsx src/index.ts status                     # show connection/preview status
npx tsx src/index.ts push [dir]                 # push local project files as an unlisted deck
```

## App Workspace

The connection writes to `workspace/`:
- `scripts/*.lua` — editable Lua scripts, one per blueprint. Changes auto-sync to the app.
- `scene/blueprints/<slug>.yaml` — one file per blueprint (same slugs as scripts)
- `scene/` — read-only scene state (actors, variables, behaviors, rules, docs)
- `CLAUDE.md` — detailed instructions for working in the workspace (read this!)
- `.castle/logs.txt` — script logs and errors
- `.castle/screenshots/` — captured screenshots (latest.png)

## Local Project Format

`pull` and app-independent editing use a local project directory:

- `deck.json` — local deck/card metadata
- `cards/<card-id>/card.json` — card metadata and scene properties
- `cards/<card-id>/scene/blueprints/<slug>.yaml` — human-editable blueprint data
- `cards/<card-id>/scene/blueprints/<slug>.json` — opaque engine/app data such as drawings, physics fixtures, and other non-YAML fields
- `cards/<card-id>/scripts/<slug>.lua` — script code, not duplicated in YAML
- `cards/<card-id>/scene/actors.yaml` — placed actors
- `cards/<card-id>/scene/variables.yaml` — deck variables

`init` creates this structure from scratch, forks a bundled default blueprint, applies bundled drawing data, and places one starter actor with a Lua script. Use `--title` for the deck title and `--force` only when replacing a throwaway local project directory.

`serve` materializes these files into scene data and runs them through the bundled web player in `bundles/player`. It does not fall back to published Castle bundles. Keep `bundles/player` current when testing new engine features.

`edit` on a served local project follows the app AgentSheet/toolEditScene semantics as closely as possible, then rewrites the project files. Default blueprint templates and drawing replacements are bundled in this repo under `data/agent/`, so local edits do not depend on a sibling `castle-client` checkout.

`push` uploads the materialized local project as an unlisted deck and applies the required content moderation flag payload. Use unlisted pushes while testing.

For Lua script logs, use `print(...)`. There is no `castle.log(...)` script API.

## Architecture

- `src/index.ts` — entry point, routes to connect/restart/screenshot/edit
- `src/server.ts` — persistent tunnel connection, file watching, IPC server, state management
- `src/command.ts` — IPC client for subcommands (restart, screenshot, edit)
- `src/commands/init.ts` — creates a new local project deck
- `src/commands/pull.ts` — downloads deck/card scene data into the local project format
- `src/commands/serve.ts` — local project preview through bundled browser player
- `src/commands/push.ts` — uploads local project scene data as an unlisted deck
- `src/api.ts` — Castle GraphQL API for authentication
- `src/config.ts` — token storage in ~/.castle/config.json
- `src/utils/project.ts` — local project read/write and materialization helpers
- `src/utils/edit.ts` — local AgentSheet-style scene edit implementation
- `src/utils/agent-data.ts` — bundled default blueprint and drawing replacement data

Client-side bridge code lives in the castle-client repo; use current main or a TestFlight beta build:
- `mobile/js/scenecreator/cli/CLIBridge.js` — WebSocket bridge
- `mobile/js/scenecreator/agent/AgentUtils.js` — shared context-gathering functions
- `mobile/js/scenecreator/agent/AgentSheet.js` — toolEditScene (scene edit processing)
