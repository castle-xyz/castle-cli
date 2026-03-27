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
| `--no-draw-previews` | Disable draw preview PNG generation (stores `drawPreviews: false` in `deck.yaml`) |

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
| `--no-draw-previews` | Disable draw preview PNG generation (stores `drawPreviews: false` in `deck.yaml`) |

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

### `castle draw-preview <draw-json>`
Render a blueprint's `.draw.json` file to a PNG image.

```bash
castle draw-preview blueprints/player.draw.json           # → blueprints/player.preview.png
castle draw-preview blueprints/player.draw.json -o out.png
```

| Option | Description |
|--------|-------------|
| `-o, --output <path>` | Output PNG path (default: replaces `.draw.json` with `.preview.png`) |
| `-f, --frame <n>` | Zero-based frame index (default: 0) |
| `-s, --size <n>` | Output image size in pixels (default: 256) |

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
├── deck.yaml                 # Deck metadata
├── AGENTS.md                 # Agent instructions (generated)
├── .castle/                  # Deck-level runtime state (git-ignored)
│   ├── logs.txt              # CLI and deck logs
│   ├── commands.json         # JSONL command interface
│   └── screenshots/          # Captured screenshots
└── card-{cardId}/
    ├── card.yaml             # Card metadata and scene properties
    ├── variables.yaml        # Variable definitions
    ├── actors.yaml           # Actor instances
    ├── .castle/
    │   └── meta.json         # Content hashes (do not edit)
    └── blueprints/
        ├── {name}.yaml         # Blueprint definition
        ├── {name}.lua          # Optional Lua script
        ├── {name}.draw.json    # Engine-computed drawing/physics data
        └── {name}.preview.png  # Auto-generated PNG preview of the drawing
```

## Mobile Client Compatibility

The mobile client (castle-client) must be on the **`@jesse/cli`** branch for the CLI bridge features (real-time file sync, blueprint editing, actor sync) to work correctly.

## Development

### Prerequisites

- Node.js ≥ 20
- npm

### Setup

```bash
git clone <repo>
cd castle-cli
npm install
```

### Running Locally

`npm run dev` runs `src/index.ts` directly via `tsx` — no build step needed. Pass CLI subcommands after `--`:

```bash
npm run dev -- serve           # run serve command
npm run dev -- clone <deckId>  # run clone command
npm run dev -- --help          # show help
```

### Testing

```bash
npm run test        # single vitest run (unit tests)
npm run test:watch  # vitest in watch mode for TDD
npm run test:chess  # Playwright integration test
```

`npm run test:chess` spawns `castle serve` locally, launches a headless Chromium browser, and verifies the chess deck renders and responds to interaction correctly. Screenshots are saved to `test/screenshots/`.

### Building

```bash
npm run build  # compile TypeScript via tsup → dist/
```

Copies `src/assets/AGENTS.md` to `dist/assets/`. Output is ESM-only; binary entry point is `bin/castle.js`.

### Publishing

```bash
npm publish  # runs npm run build first via prepublishOnly hook
```
