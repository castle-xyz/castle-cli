## Setup

### 1. Clone and install

```bash
git clone git@github.com:castle-xyz/castle-cli-4.git
cd castle-cli-4
npm install
```

### 2. Open the Castle app when using app-connected mode

Use either the main Castle app build or a TestFlight beta build. Open the editor on a deck. When the CLI connects, a terminal icon will appear in the editor header.

### 3. Run Claude

```bash
claude
```

Claude will start the CLI connection automatically and manage the active project directory. It will:
- Connect to the Castle app and sync the scene state
- Edit scripts in `decks/<deck>/cards/<card-id>/scripts/` (auto-synced to the app)
- Read scene context from `decks/<deck>/cards/<card-id>/scene/`
- Use `restart`, `screenshot`, and `edit` commands to test and iterate

## What can the AI do?

- **Edit scripts** — write Lua game logic, auto-synced on save
- **Create blueprints** — fork existing templates, set behaviors and properties
- **Place actors** — add/move/remove actors in the scene
- **Manage variables** — create score counters, game state, etc.
- **Restart & screenshot** — test changes and see results
- **Read scene state** — understand what's in the deck to make informed edits

## How it works

The CLI connects to the Castle app through a WebSocket tunnel. When you open a deck in the editor, the app sends its `deckId` and `cardId`; CLI 4 finds the matching local project under `decks/` and writes the card projection into `cards/<card-id>/`. Script file changes are watched and synced back. Commands like restart, screenshot, and edit go through a local Unix socket to the running CLI process, which forwards them through the tunnel.

No bidirectional sync complexity — the app owns the scene state, the CLI owns scripts. Edit commands are one-shot operations that go through the app's existing edit pipeline with full undo support.
