## Setup

### 1. Clone

```bash
git clone git@github.com:castle-xyz/castle-cli-4.git
cd castle-cli-4
```

### 2. Run an agent

```bash
claude
```

For a new deck, ask the agent to create a deck, serve it locally, and push it:

```text
Start a new deck, serve it, and push it.
```

The agent should create a local project under `decks/`, run the bundled local player with `serve`, give you the local preview URL, and push an unlisted Castle deck when it is ready. After that, the agent can keep improving the game locally without the Castle app open.

### 3. Connect the Castle editor when needed

After the deck has been pushed, you can open it in the Castle editor. If you want the agent to work with that editor instance too, tell it to connect to the app:

```text
Connect to the app/editor for this deck.
```

The agent should start `npx tsx src/index.ts connect` from this repo. Use either the main branch Castle app build or a TestFlight beta build. When the CLI connects, a terminal icon will appear in the editor header.

## What can the AI do?

- **Edit scripts** — write Lua game logic in local project files
- **Create blueprints** — fork existing templates, set behaviors and properties
- **Place actors** — add/move/remove actors in the scene
- **Manage variables** — create score counters, game state, etc.
- **Restart & screenshot** — test changes and see results
- **Push & cover** — publish an unlisted deck and capture a new-deck cover from local serve
- **Connect to editor** — attach to an open Castle editor for the pushed deck when app-backed work is needed
- **Read scene state** — understand what's in the deck to make informed edits
