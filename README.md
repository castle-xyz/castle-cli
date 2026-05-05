# Castle CLI 4

Castle CLI 4 lets agents create, preview, edit, and push Castle deck projects from local files.

Install with `npm install -g @castle/cli-4`, or paste [INSTALL.md](./INSTALL.md) to an agent.

## Setup

### 1. Install

```bash
npm install -g @castle/cli-4
```

### 2. Run an agent

Install the shared Castle agent docs:

```bash
castle-4 docs
```

This writes Castle instructions and API docs to `~/.castle/docs` by default.

```bash
claude
```

For a new deck, ask the agent to create a deck, serve it locally, and push it:

```text
Read ~/.castle/docs/AGENTS.md. Start a new Castle deck, serve it locally, and push it.
```

The agent should create a local project, run `castle-4 serve`, give you the local preview URL, and push an unlisted Castle deck when it is ready. Each deck also gets a short `AGENTS.md` and `CLAUDE.md` that point back to the shared docs.

### 3. Connect the Castle editor when needed

After the deck has been pushed, you can open it in the Castle editor. If you want the agent to work with that editor instance too, tell it to connect to the app:

```text
Connect to the app/editor for this deck.
```

The agent should start `castle-4 connect`. Use either the main branch Castle app build or a TestFlight beta build. When the CLI connects, a terminal icon will appear in the editor header.

## What can the AI do?

- **Edit scripts** — write Lua game logic in local project files
- **Create blueprints** — fork existing templates, set behaviors and properties
- **Place actors** — add/move/remove actors in the scene
- **Manage variables** — create score counters, game state, etc.
- **Manage cards** — add/remove cards in local deck projects
- **Restart & screenshot** — test changes and see results
- **Find and pull decks** — list your recent decks and pull existing decks into local project files
- **Push & cover** — publish an unlisted deck and capture a new-deck cover from local serve
- **Connect to editor** — attach to an open Castle editor for the pushed deck when app-backed work is needed
- **Read scene state** — understand what's in the deck to make informed edits
