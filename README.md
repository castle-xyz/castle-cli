# castle-cli

Command-line toolchain for developing Castle decks locally.

## Installation

```bash
npm install -g castle-cli
```

## Quick Start

```bash
# Log in to your Castle account
castle login

# Clone a deck from the server
castle clone <deckId>

# Serve it locally (opens web player + syncs with mobile)
cd deck-<deckId>
castle serve
```

## Commands

### `castle clone <deckId>`
Clone a deck from the server into a local directory.

| Option | Description |
|--------|-------------|
| `-d, --directory <directory>` | Directory to clone into |
| `--replace` | Replace the directory if it already exists |

### `castle serve [directory]`
Start the local web player and mobile bridge. Defaults to current directory.

`serve` always connects to the Castle mobile app over WebSocket (requires `castle login`). Local file edits are sent back to the mobile app in real time, and state from the mobile app is written to disk automatically.

It works in two modes:

- **Deck mode** — run inside a cloned deck directory. The web player loads the deck immediately and hot-reloads on file changes. The mobile app can still connect and sync state.
- **Mobile-first mode** — run in any empty directory (or without a deck). The web player waits for the mobile app to connect, then streams the active deck's state to disk and loads it automatically. This lets you view and edit a deck live from your phone without cloning it first.

Keyboard shortcuts while running: `o` open in browser · `r` reload · `q` quit

| Option | Description |
|--------|-------------|
| `-p, --port <port>` | Web player port (default: 4321) |
| `-c, --card <cardId>` | Initial card to load |
| `--open` | Automatically open browser |
| `--debug` | Show verbose connection and file-change logs |

### `castle pull`
Pull latest changes from the server into the current deck directory.

| Option | Description |
|--------|-------------|
| `-d, --directory <directory>` | Directory to pull (default: `.`) |

### `castle push`
Push local changes to the server.

| Option | Description |
|--------|-------------|
| `-d, --directory <directory>` | Directory to push (default: `.`) |

### `castle login`
Log in to your Castle account (stores token in `~/.castle/config.json`).

### `castle logout`
Log out from your Castle account.

### `castle whoami`
Display the currently logged-in user.

### `castle version`
Show the current CLI version.

## Core Concepts

- **Deck** — a collection of game cards, stored in `deck-{deckId}/`
- **Card** — a single game scene with blueprints, actors, and scripts
- **Blueprint** — a reusable game object template with components (Body, Drawing2, etc.)
- **Actor** — an instance of a blueprint placed in a scene

## File Structure

```
deck-{deckId}/
└── card-{cardId}/
    ├── card.yaml          # Card metadata
    ├── scene-data.json    # Full serialized card state
    ├── variables.yaml     # Variable definitions
    ├── actors.yaml        # Actor instances
    ├── blueprints/        # One YAML file per blueprint
    └── scripts/           # Optional Lua scripts
```

The `.castle/` directory inside a deck holds runtime state (logs, command queue, screenshots) and is git-ignored.

## Development

```bash
npm run build       # Compile TypeScript → dist/
npm run dev         # Run directly with tsx (no build needed)
npm run test        # Run tests with vitest
npm run test:watch  # Vitest watch mode
```
