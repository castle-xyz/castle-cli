# Castle CLI 4

Bridge between the Castle app and a local workspace for AI-assisted game development.

## First thing to do

Run `npm install` if `node_modules/` doesn't exist. Then start the CLI connection in the background. The user should already have a deck open in the Castle editor.

```bash
npm install  # only if needed
npx tsx src/index.ts
```

Run this in the background — it needs to stay running for the duration of the session. Wait for it to log `[state]` — that means the app is connected and scene state has been synced to `workspace/`. Then read `workspace/CLAUDE.md` for the full workspace instructions.

## Commands

```bash
npx tsx src/index.ts              # connect to app (run in background)
npx tsx src/index.ts restart      # stop and restart the scene
npx tsx src/index.ts screenshot   # capture what's on screen
npx tsx src/index.ts edit         # apply scene edits (pipe JSON to stdin)
```

## Workspace

The connection writes to `workspace/`:
- `scripts/*.lua` — editable Lua scripts, one per blueprint. Changes auto-sync to the app.
- `scene/blueprints/<slug>.yaml` — one file per blueprint (same slugs as scripts)
- `scene/` — read-only scene state (actors, variables, behaviors, rules, docs)
- `CLAUDE.md` — detailed instructions for working in the workspace (read this!)
- `.castle/logs.txt` — script logs and errors
- `.castle/screenshots/` — captured screenshots (latest.png)

## Architecture

- `src/index.ts` — entry point, routes to connect/restart/screenshot/edit
- `src/server.ts` — persistent tunnel connection, file watching, IPC server, state management
- `src/command.ts` — IPC client for subcommands (restart, screenshot, edit)
- `src/api.ts` — Castle GraphQL API for authentication
- `src/config.ts` — token storage in ~/.castle/config.json

Client-side code lives in the castle-client repo on the `@nikki/cli-4` branch:
- `mobile/js/scenecreator/cli/CLIBridge.js` — WebSocket bridge
- `mobile/js/scenecreator/agent/AgentUtils.js` — shared context-gathering functions
- `mobile/js/scenecreator/agent/AgentSheet.js` — toolEditScene (scene edit processing)
