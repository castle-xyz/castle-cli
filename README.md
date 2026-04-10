# Castle CLI 4

AI-assisted game development for Castle. Connect Claude (or any AI agent) to the Castle app and let it edit scripts, create blueprints, place actors, and test games — all from the command line.

## Setup

### 1. Build the Castle app from the CLI branch

In the [castle-client](https://github.com/anthropics/castle-client) repo:

```bash
git checkout @nikki/cli-4
cd mobile && yarn
# Build and run for your platform (iOS simulator, device, etc.)
```

### 2. Install the CLI

```bash
cd castle-cli-4
npm install
```

### 3. Open a deck in the Castle editor

Open the Castle app, create or open a deck, and enter the editor.

### 4. Run Claude in the CLI workspace

```bash
cd castle-cli-4

# Start the connection (keep this running)
npx tsx src/index.ts &

# Run Claude Code in this directory
claude
```

Claude will see the `workspace/` directory with:
- `scripts/*.lua` — editable game scripts (auto-synced to the app)
- `scene/` — read-only scene state from the app (blueprints, actors, variables, etc.)
- `CLAUDE.md` — instructions for the AI on how to use the Castle APIs

Claude can edit scripts, use `npx tsx src/index.ts restart` to test, `npx tsx src/index.ts screenshot` to see results, and `npx tsx src/index.ts edit` to create blueprints/actors/variables.

## What can the AI do?

- **Edit scripts** — write Lua game logic, auto-synced on save
- **Create blueprints** — fork existing templates, set behaviors and properties
- **Place actors** — add/move/remove actors in the scene
- **Manage variables** — create score counters, game state, etc.
- **Restart & screenshot** — test changes and see results
- **Read scene state** — understand what's in the deck to make informed edits

## Commands

```bash
npx tsx src/index.ts              # connect to app (run in background)
npx tsx src/index.ts restart      # stop and restart the scene
npx tsx src/index.ts screenshot   # capture what's on screen
npx tsx src/index.ts edit         # apply scene edits (pipe JSON to stdin)
```

## How it works

The CLI connects to the Castle app through a WebSocket tunnel (`wss://ws.castlexyz.com/ws`). When you open a deck in the editor, the app sends the scene state to the CLI, which writes it to `workspace/`. Script file changes are watched and synced back. Commands like restart, screenshot, and edit go through a local Unix socket to the running CLI process, which forwards them through the tunnel.

No bidirectional sync complexity — the app owns the scene state, the CLI owns scripts. Edit commands are one-shot operations that go through the app's existing edit pipeline with full undo support.
