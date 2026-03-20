# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build       # Compile TypeScript via tsup → dist/, copies assets
npm run dev         # Run src/index.ts directly with tsx (no build needed)
npm run test        # Single run with vitest
npm run test:watch  # Vitest watch mode
npm run test:chess  # Playwright integration test (deck on device)
```

No linter is configured; TypeScript strict mode covers most issues.

## Architecture

Castle CLI is a Node.js/TypeScript toolchain for developing interactive card-based games. It bridges a C++ game engine (castle-core, compiled to WASM) running on mobile devices with a local web editor for rapid iteration.

### Core Concepts

- **Deck** — a collection of game cards, stored in `deck-{deckId}/`
- **Card** — a single game scene, stored in `deck-{deckId}/card-{cardId}/`
- **Blueprint** — a reusable game object template with components (Body, Drawing2, etc.)
- **Actor** — an instance of a blueprint placed in a scene
- **Behavior** — component metadata sourced from the castle-core WASM module

### File Format

Each card directory contains:
```
card-{cardId}/
├── card.yaml         # Card metadata
├── scene-data.json   # Full serialized card state (blueprints + actors)
├── variables.yaml    # Variable definitions
├── actors.yaml       # Actor instances (positions, state)
├── blueprints/       # One YAML file per blueprint
└── scripts/          # Optional Lua scripts
```

`.castle/` inside a deck is git-ignored and holds runtime state:
- `logs.txt` — combined CLI + deck script logs
- `commands.json` — JSONL command interface (CLI polls this)
- `screenshots/`, `cache/` — ephemeral build artifacts

### Key Source Files

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI entry (Commander.js command definitions) |
| `src/commands/serve.ts` | Express server, web player, mobile bridge coordination |
| `src/commands/clone.ts` / `push.ts` / `pull.ts` | Server sync commands |
| `src/utils/decks.ts` | Core file I/O: YAML parsing, scene data generation |
| `src/utils/mobile.ts` | WebSocket handler for mobile ↔ CLI state sync |
| `src/utils/mobile-files.ts` | Format conversion between mobile state and YAML files |
| `src/utils/castle-core-node.ts` | WASM module wrapper (downloads from CDN, caches in `~/.castle/cache/node/`) |
| `src/utils/api.ts` | GraphQL client for `api.castle.xyz` |
| `src/utils/config.ts` | Auth token persistence in `~/.castle/config.json` |

### Serve Command

`castle serve` starts:
1. **Express web server** (`http://localhost:4321`) — serves the castle-core WASM player in a browser, proxies the player bundle from CDN with COOP/COEP headers (required for SharedArrayBuffer/threaded WASM), with graceful offline fallback to `~/.castle/cache/`
2. **Hot reload** — file watcher increments a version counter; the browser long-polls `/version` and reloads on change
3. **Mobile bridge** — WebSocket client connects to `wss://ws.castlexyz.com/ws` (when logged in) to sync live state between mobile app and local files

### Dual-Format Values

The engine uses internal values (e.g. `Body.widthScale = 0.5`, 0–1 scale) while the editor uses external values (`Body.widthScale = 5.0`, 0–10 scale). Conversion is done via WASM functions `applySnapshot` / `getSnapshotExternalValues` in `castle-core-node.ts`.

### Mobile Sync Protocol

The mobile app sends a `StateMessage` (full serialized game state) over WebSocket → CLI writes to YAML files on disk. A file watcher detects local changes → sends `EditMessage` back to the mobile app. Files are the single source of truth; WebSocket is the transport layer.

### JSONL Commands

`.castle/commands.json` is newline-delimited JSON. CLI polls for entries without a `response` field and appends the response in-place. Example: `{"type":"screenshot"}` → `{"type":"screenshot","response":{...}}`.

### WASM Module

The compiled C++ game engine is downloaded from `https://cdn.castle.xyz/player/{playerId}/node/` and cached in `~/.castle/cache/node/{playerId}/`. It is loaded by `castle-core-node.ts` and exposes behavior/rules metadata and value-conversion functions. The player ID is fetched from `https://castle.xyz/api/player-id` and cached locally.

### Adding New Decks to Round-Trip Tests

`test/clone-serve-round-trip.test.ts` automatically picks up any JSON file in `test/fixtures/decks/`. To add a new deck:

1. Add the deck ID to the `DECK_IDS` array in `scripts/generate-deck-fixtures.ts`
2. Run `npx tsx scripts/generate-deck-fixtures.ts` (requires auth token — must be logged in)
3. The fixture file `test/fixtures/decks/{deckId}.json` will be created; already-downloaded decks are skipped
4. Commit the fixture file — the test will automatically include the new deck
