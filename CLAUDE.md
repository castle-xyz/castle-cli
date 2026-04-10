# Castle CLI 4

Bridge between the Castle app and a local workspace for AI-assisted script editing.

## Setup

```bash
npm install
```

## Usage

### 1. Start the connection

```bash
npx tsx src/index.ts
```

This connects to the Castle app via tunnel. Open a deck in the Castle editor first — the CLI sends a hello and the app responds with the current scene state.

The CLI writes to `workspace/`:
- `scripts/*.lua` — one Lua file per blueprint that has a script (editable)
- `context/` — read-only scene state (blueprints, actors, variables, behaviors, rules, docs)
- `CLAUDE.md` — auto-generated instructions for the AI working in the workspace
- `.castle/logs.txt` — script logs and errors from the running scene

### 2. Edit scripts

Edit any `workspace/scripts/<name>.lua` file. Changes are detected by file watcher and sent to the app automatically.

### 3. Restart the scene

```bash
npx tsx src/index.ts restart
```

Stops and restarts the scene so new script code runs. You must restart to see script changes take effect.

### 4. Take a screenshot

```bash
npx tsx src/index.ts screenshot
npx tsx src/index.ts screenshot output.png
```

Captures what's currently on screen. Saved to `workspace/.castle/screenshots/` by default (also writes `latest.png`).

## Best practices for AI agents working in the workspace

IMPORTANT: Run the CLI (`npx tsx src/index.ts`) in the background in a separate terminal. Use `restart` and `screenshot` subcommands from another terminal.

IMPORTANT: You MUST verify every Castle API function exists in the docs before using it. Read `context/scripting-reference.md` and `context/docs/`. Do NOT guess function names — if it's not documented, it doesn't exist.

IMPORTANT: After editing a script, run `npx tsx src/index.ts restart` to restart the scene, then `npx tsx src/index.ts screenshot` to see the result. Always check `.castle/logs.txt` for errors.

IMPORTANT: `onUpdate(dt)` receives delta time as a parameter. There is NO `castle.dt()`. `onDraw()` does not receive dt — use `castle.getTime()` for elapsed time. `castle.draw.*` functions only work inside `onDraw()`.

IMPORTANT: Only `scripts/` files are editable. If you need new blueprints, new actors, behavior changes, or property edits (e.g. making something solid, changing size, adding tags) — tell the user, as those must be done in the Castle app.

IMPORTANT: Check `context/script-property-names.md` for name differences between YAML property names and script property names (e.g. `angle` in YAML is `rotation` in scripts).

IMPORTANT: Context files in `context/` use display names for behaviors (e.g. "Layout", "Dynamic Motion", "Slow Down") not internal names. Scripts access behaviors using camelCase versions without spaces (e.g. `my.layout`, `my.dynamicMotion`, `my.slowDown`).

## Architecture

- `src/index.ts` — entry point, routes to connect/restart/screenshot
- `src/server.ts` — persistent tunnel connection, file watching, state management
- `src/command.ts` — one-shot subcommands (restart, screenshot) that connect, send, and exit
- `src/api.ts` — Castle GraphQL API for authentication
- `src/config.ts` — token storage in ~/.castle/config.json

The CLI talks to the Castle app through `wss://ws.castlexyz.com/ws` tunnel. Messages use `cli_tunnel_send_message` wrapper with `innerType` prefixed `cli4_`.

Client-side code lives in the castle-client repo on the `@nikki/cli-4` branch:
- `mobile/js/scenecreator/cli/CLIBridge.js` — WebSocket bridge
- `mobile/js/scenecreator/agent/AgentUtils.js` — shared context-gathering functions
