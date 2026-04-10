## Setup

### 1. Build the Castle app from the CLI branch

In the [castle-client](https://github.com/castle-xyz/castle-client) repo:

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

### 4. Run Claude

```bash
cd castle-cli-4
claude
```

Claude will start the CLI connection automatically and manage the workspace. It will:
- Connect to the Castle app and sync the scene state
- Edit scripts in `workspace/scripts/` (auto-synced to the app)
- Read scene context from `workspace/scene/` (blueprints, actors, variables, docs)
- Use `restart`, `screenshot`, and `edit` commands to test and iterate

## What can the AI do?

- **Edit scripts** — write Lua game logic, auto-synced on save
- **Create blueprints** — fork existing templates, set behaviors and properties
- **Place actors** — add/move/remove actors in the scene
- **Manage variables** — create score counters, game state, etc.
- **Restart & screenshot** — test changes and see results
- **Read scene state** — understand what's in the deck to make informed edits

## How it works

The CLI connects to the Castle app through a WebSocket tunnel. When you open a deck in the editor, the app sends the scene state to the CLI, which writes it to `workspace/`. Script file changes are watched and synced back. Commands like restart, screenshot, and edit go through a local Unix socket to the running CLI process, which forwards them through the tunnel.

No bidirectional sync complexity — the app owns the scene state, the CLI owns scripts. Edit commands are one-shot operations that go through the app's existing edit pipeline with full undo support.
