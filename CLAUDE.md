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

The deck root and card subdirectories contain:
```
deck-{deckId}/
├── deck.yaml                 # Deck metadata
├── AGENTS.md                 # Agent instructions (generated)
├── .castle/                  # Deck-level runtime state (git-ignored)
│   ├── logs.txt              # Combined CLI + deck script logs
│   ├── commands.json         # JSONL command interface (CLI polls this)
│   └── screenshots/          # Captured screenshots
└── card-{cardId}/            # One subdirectory per card
    ├── card.yaml             # Card metadata (cardId, sceneProperties, actorBlueprintInherit, linkTargetDeckIds)
    ├── SCENE.md              # Generated scene context for agents
    ├── variables.yaml        # Variable definitions
    ├── actors.yaml           # Actor instances (positions, state)
    ├── .castle/
    │   └── meta.json         # Content hashes for change detection
    └── blueprints/           # Blueprint files
        ├── {name}.yaml         # Blueprint definition (components as YAML)
        ├── {name}.lua          # Optional Lua script for blueprint
        ├── {name}.draw.json    # Optional extracted drawing/physics data
        └── {name}.preview.png  # Auto-generated 256×256 PNG preview of the drawing
```

Note: `scene-data.json` is NOT a disk file — it is generated on-the-fly by the `/scene-data` HTTP endpoint.

### Key Source Files

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI entry (Commander.js command definitions) |
| `src/commands/serve.ts` | Express server, web player, mobile bridge coordination |
| `src/commands/clone.ts` / `push.ts` / `pull.ts` | Server sync commands |
| `src/utils/decks.ts` | Core file I/O: YAML parsing, scene data generation |
| `src/utils/mobile.ts` | WebSocket handler for mobile ↔ CLI state sync |
| `src/utils/mobile-protocol.ts` | Message type definitions for the mobile WebSocket protocol |
| `src/utils/mobile-files.ts` | Format conversion between mobile state and YAML files |
| `src/utils/castle-core-node.ts` | WASM module wrapper (downloads from CDN, caches in `~/.castle/cache/node/`) |
| `src/utils/api.ts` | GraphQL client for `api.castle.xyz` |
| `src/utils/config.ts` | Auth token persistence in `~/.castle/config.json` |
| `src/commands/draw-preview.ts` | `castle draw-preview` command — renders a `.draw.json` to a PNG |

### Serve Command

`castle serve` starts:
1. **Express web server** (`http://localhost:4321`) — serves the castle-core WASM player in a browser, proxies the player bundle from CDN with COOP/COEP headers (required for SharedArrayBuffer/threaded WASM), with graceful offline fallback to `~/.castle/cache/`
2. **Hot reload** — file watcher increments a version counter; the browser long-polls `/version` and reloads on change
3. **Mobile bridge** — WebSocket client connects to `wss://ws.castlexyz.com/ws` (when logged in) to sync live state between mobile app and local files

### Dual-Format Values

The engine uses internal values (e.g. `Body.widthScale = 0.5`, 0–1 scale) while the editor uses external values (`Body.widthScale = 5.0`, 0–10 scale). Conversion is done via WASM functions `applySnapshot` / `getSnapshotExternalValues` in `castle-core-node.ts`.

### Mobile Sync Protocol

The mobile app sends state over WebSocket via one message type:
- `StateInternalMessage` — full state in raw internal format (requires WASM conversion via `getSnapshotExternalValues`). Optional fields: `sceneProperties`, `actorBlueprintInherit`, `linkTargetDeckIds` — written to `card.yaml` on receive.

The CLI writes received state to YAML files on disk. A file watcher detects local changes → sends `EditMessage` back to the mobile app. Files are the single source of truth; WebSocket is the transport layer.

### JSONL Commands

`.castle/commands.json` is newline-delimited JSON. CLI polls for entries without a `response` field and appends the response in-place. Example: `{"type":"screenshot"}` → `{"type":"screenshot","response":{...}}`.

### WASM Module

The compiled C++ game engine is downloaded from `https://cdn.castle.xyz/player/{playerId}/node/` and cached in `~/.castle/cache/node/{playerId}/`. It is loaded by `castle-core-node.ts` and exposes behavior/rules metadata and value-conversion functions. The player ID is fetched from `https://castle.xyz/api/player-id` and cached locally.

Set `CASTLE_LOCAL_NODE` to use a local build of the WASM module instead of downloading from CDN:
- `CASTLE_LOCAL_NODE=1` — loads from `./node-dev/` relative to the current working directory
- `CASTLE_LOCAL_NODE=/path/to/dir` — loads from the specified directory

The directory must contain `castle-core-node.js` and `castle-core-node.wasm`.

Two module instances are kept alive simultaneously:
- **M** (main) — loaded without GL, used for `applySnapshot`, `getCastleMetadata`, `getSnapshotExternalValues`
- **R** (render) — loaded with a headless-gl canvas (`gl` npm package) and initialized for GL rendering via `castle_node_init_rendering`; used only for `renderDrawDataPng`

Both instances call `ensureBrowserGlobals()` on load to stub `screen`, `document`, `window`, etc. that SDL's Emscripten bindings reference even without a real window.

### Draw Previews

`{name}.preview.png` files are auto-generated alongside each `.draw.json` whenever a card is cloned, pulled, or served. The Drawing2 hash is tracked in `.castle/meta.json` (`drawPreviewHashes`) to avoid redundant re-renders.

Set `drawPreviews: false` in `deck.yaml` to disable preview generation project-wide (useful for CI):
```yaml
deckId: abc123
drawPreviews: false
```

Or pass `--no-draw-previews` to `clone` or `serve` to write this setting on first run.

The `castle draw-preview` command renders a single `.draw.json` on demand:
```bash
castle draw-preview blueprints/foo.draw.json          # → blueprints/foo.preview.png
castle draw-preview blueprints/foo.draw.json -o out.png -s 512
```

### Mobile Actor Key Sync

Mobile always assigns fresh entity IDs for new actors (e.g. CLI adds `a1`, mobile assigns `a1048576`). The CLI handles this via:

- **`editId` on `EditMessage`**: incrementing ID sent with every CLI-originated edit. Mobile uses this to suppress the state echo that would otherwise overwrite CLI-assigned keys on disk.
- **`_suppressDiffUntil` in `CLIConnection.js`**: timestamp-based suppression window (set to `Date.now() + DEBOUNCE_MS + 100` on each CLI edit). State sends are no-ops while `Date.now() < _suppressDiffUntil`. Also extended inside `sendStateInternalDebounced` while suppression is active — this is critical because `toolEditScene` triggers multiple `UPDATE_SCENE` events, each resetting the 500ms debounce timer and potentially pushing it past the suppression window.

### Mock Mobile Test (Sync Bug Reproduction)

`scripts/mock-mobile.ts` is a fake mobile client that connects to the Castle relay and simulates a device. Use it to reproduce and test the actor sync bug without a real device.

**Setup** (two terminals):
```bash
# Terminal 1 — serve a deck dir (must be logged in)
npx tsx src/index.ts serve /tmp/some-deck-dir --debug

# Terminal 2 — fake mobile client
npx tsx scripts/mock-mobile.ts <deckId> <cardId>
```

The script sends initial state with 2 blueprints (Mario, Goomba) and 3 actors (a1, a2, a3). Once both are running, edit `actors.yaml` in the served deck dir to trigger syncs.

Watch `.castle/logs.txt` in the deck dir for CLI-side events. Mock-mobile logs to stdout.

**Relay protocol note:** Both CLI and mock-mobile send `{ type: 'cli_tunnel_start_listening' }` on WebSocket connect — this is how the relay at `wss://ws.castlexyz.com/ws` pairs the two connections. Without it, the relay does not route messages back to the sender.

**Debugging state echo issues:** If mobile is still sending `state_internal` after CLI edits, check:
1. Is the `[CLIConnection] edit applied` suppression log appearing? If not, either `_suppressDiffUntil` isn't being set or the timer fires after the window.
2. Multiple `UPDATE_SCENE` events after `toolEditScene` push the debounce timer past the suppression window — that's why `sendStateInternalDebounced` extends `_suppressDiffUntil` on each call while suppression is active.
3. Check for stale JS bundles on device — React Native fast refresh can partially apply changes. If the new log format appears in `_applyEdit` but not in `sendStateInternalDebounced`, the bundle is stale and needs a full reload.

### Per-Actor Field Spec (castle-client Scene::writeActor)

`Scene::writeActor` in `castle-client/core/src/scene.cpp` defines exactly which fields may be overridden per actor (when `params.inheritedProperties` is false, which is the normal actor-instance case). **Only these fields are allowed as per-actor overrides** — everything else must be set at the blueprint level:

| Component | Fields |
|-----------|--------|
| `Body` | `x`, `y` (always); `angle`, `widthScale`, `heightScale` (layout mode only) |
| `Drawing2` | `initialFrame` |
| `Text` | `content` (only when different from blueprint), `fontSizeScale` |
| `Link` | `targetDeckId` (only when different from blueprint) |

**Do not add per-actor overrides for any other components** (e.g. `Rules`, `Tags`, `Solid`, `Friction`). Rules in particular must be set at the blueprint level only.

### Adding New Decks to Round-Trip Tests

`test/clone-serve-round-trip.test.ts` automatically picks up any JSON file in `test/fixtures/decks/`. To add a new deck:

1. Add the deck ID to the `DECK_IDS` array in `scripts/generate-deck-fixtures.ts`
2. Run `npx tsx scripts/generate-deck-fixtures.ts` (requires auth token — must be logged in)
3. The fixture file `test/fixtures/decks/{deckId}.json` will be created; already-downloaded decks are skipped
4. Commit the fixture file — the test will automatically include the new deck
