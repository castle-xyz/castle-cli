/**
 * Mock mobile client for testing the CLI ↔ mobile sync protocol.
 *
 * Simulates real mobile behaviour: assigns fresh entity keys for new actors
 * (e.g. CLI adds "a1", mobile assigns "a1048576") and suppresses the state
 * echo for CLI-originated edits (editId present), matching CLIConnection.js.
 *
 * Usage:
 *   npx tsx scripts/mock-mobile.ts <deckId> <cardId>
 *
 * Run alongside: castle serve --dir <deckDir>
 * Edit actors.yaml to trigger syncs and verify actor keys are preserved.
 */

import WebSocket from 'ws';
import { getToken } from '../src/utils/config.js';

const WS_URL = 'wss://ws.castlexyz.com/ws';

const deckId = process.argv[2];
const cardId = process.argv[3];

if (!deckId || !cardId) {
  console.error('Usage: npx tsx scripts/mock-mobile.ts <deckId> <cardId>');
  process.exit(1);
}

const token = getToken();
if (!token) {
  console.error('Not logged in. Run: castle login');
  process.exit(1);
}

// Session ID — stable for the lifetime of this script run
const cliSessionId = `mock-${Date.now()}`;

// Internal state: EDITOR_LIBRARY blueprints and EDITOR_ACTORS actors
// Blueprint: { entryType: 'actorBlueprint', title, actorBlueprint: { components: { Body: {...} } } }
// Actor:     keyed by `a{entityId}`, { actorId, parentEntryId, bp: { components: { Body: {...} } } }
//   Body values in INTERNAL format: widthScale 0–1 (not ×10), angle in radians
let blueprints: Record<string, any> = {};
let actors: Record<string, any> = {};
const variables: any[] = [];

// Entity ID counter — starts high to avoid collisions with CLI-assigned keys like a1, a2
let nextEntityId = 1048576;

// Debounce timer for state echo after receiving an edit
let sendTimer: ReturnType<typeof setTimeout> | null = null;

// Mirrors CLIConnection._suppressDiffUntil: timestamp until which the debounced send is
// suppressed. Extended on each CLI edit (editId present) so multiple rapid edits all
// suppress correctly — a boolean flag would be consumed by the first debounced diff.
const DEBOUNCE_MS = 300;
let suppressDiffUntil = 0;

function initState() {
  blueprints = {
    bp1: {
      entryType: 'actorBlueprint',
      title: 'Mario',
      actorBlueprint: {
        components: {
          Body: { widthScale: 0.5, heightScale: 0.5 },
        },
      },
    },
    bp2: {
      entryType: 'actorBlueprint',
      title: 'Goomba',
      actorBlueprint: {
        components: {
          Body: { widthScale: 0.3, heightScale: 0.3 },
        },
      },
    },
  };

  actors = {
    a1: {
      actorId: 1,
      parentEntryId: 'bp1',
      bp: { components: { Body: { x: 100, y: 200, widthScale: 0.5, heightScale: 0.5, angle: 0 } } },
    },
    a2: {
      actorId: 2,
      parentEntryId: 'bp2',
      bp: { components: { Body: { x: 300, y: 200, widthScale: 0.3, heightScale: 0.3, angle: 0 } } },
    },
    a3: {
      actorId: 3,
      parentEntryId: 'bp1',
      bp: { components: { Body: { x: 500, y: 200, widthScale: 0.5, heightScale: 0.5, angle: 0 } } },
    },
  };
}

function findBlueprintByTitle(title: string): string | null {
  for (const [id, bp] of Object.entries(blueprints)) {
    if ((bp as any).title === title) return id;
  }
  return null;
}

// Apply a CLI edit message to internal state.
// Actor data from CLI is in disk/external format: widthScale ×10, angle in degrees.
function applyEdit(edit: any) {
  if (edit.blueprints) {
    for (const [entryId, data] of Object.entries(edit.blueprints) as [string, any][]) {
      if (data.removeBlueprint) {
        delete blueprints[entryId];
      } else if (data.isNew) {
        const id = data.entryId || entryId;
        blueprints[id] = {
          entryType: 'actorBlueprint',
          title: data.title ?? 'untitled',
          actorBlueprint: { components: {} },
        };
      } else if (entryId in blueprints) {
        if (data.title) blueprints[entryId] = { ...blueprints[entryId], title: data.title };
      }
    }
  }

  if (edit.actors) {
    for (const [key, data] of Object.entries(edit.actors) as [string, any][]) {
      if (data.removeActor) {
        console.log(`[mock-mobile]   delete actor ${key}`);
        delete actors[key];
      } else if (key in actors) {
        // Update existing actor — convert disk format (×10, degrees) to internal (0–1, radians)
        console.log(`[mock-mobile]   update actor ${key}`);
        const body = { ...(actors[key].bp?.components?.Body ?? {}) };
        if (data.x !== undefined) body.x = data.x;
        if (data.y !== undefined) body.y = data.y;
        if (data.angle !== undefined) body.angle = data.angle * (Math.PI / 180);
        if (data.widthScale !== undefined) body.widthScale = data.widthScale / 10;
        if (data.heightScale !== undefined) body.heightScale = data.heightScale / 10;
        actors[key] = { ...actors[key], bp: { components: { Body: body } } };
      } else {
        // New actor: mobile always assigns a fresh entity ID — never reuses the CLI's key.
        // This ID mismatch is the root cause of the sync loop bug.
        const freshKey = `a${nextEntityId++}`;
        const title = data.title;
        const parentEntryId = (title && findBlueprintByTitle(title)) ?? '';
        const body = {
          x: data.x ?? 0,
          y: data.y ?? 0,
          angle: data.angle !== undefined ? data.angle * (Math.PI / 180) : 0,
          widthScale: data.widthScale !== undefined ? data.widthScale / 10 : 0.5,
          heightScale: data.heightScale !== undefined ? data.heightScale / 10 : 0.5,
        };
        console.log(`[mock-mobile]   add actor: CLI key=${key} title=${title ?? '(none)'} → assigned fresh key=${freshKey}`);
        actors[freshKey] = {
          actorId: nextEntityId - 1,
          parentEntryId,
          bp: { components: { Body: body } },
        };
      }
    }
  }
}

function sendState(ws: WebSocket) {
  const actorKeys = Object.keys(actors);
  console.log(`[mock-mobile] sending state_internal: ${Object.keys(blueprints).length} blueprints, ${actorKeys.length} actors`);
  console.log(`[mock-mobile]   actor keys: [${actorKeys.join(', ')}]`);

  ws.send(JSON.stringify({
    type: 'cli_tunnel_send_message',
    innerType: 'state_internal',
    deckId,
    cardId,
    cliSessionId,
    blueprints: { ...blueprints },
    actors: { ...actors },
    variables,
  }));
}

// Debounced state send matching real mobile behaviour.
// Extends suppressDiffUntil on each call while suppression is active (mirrors the
// CLIConnection.js fix for multiple rapid UPDATE_SCENE events after toolEditScene).
function scheduleSendState(ws: WebSocket) {
  if (sendTimer) clearTimeout(sendTimer);
  if (Date.now() < suppressDiffUntil) {
    suppressDiffUntil = Date.now() + DEBOUNCE_MS + 100;
  }
  sendTimer = setTimeout(() => {
    sendTimer = null;
    if (Date.now() < suppressDiffUntil) {
      console.log('[mock-mobile]   suppressed engine-triggered diff (CLI edit in progress)');
      return;
    }
    sendState(ws);
  }, DEBOUNCE_MS);
}

function main() {
  initState();

  console.log(`[mock-mobile] connecting to ${WS_URL}...`);
  console.log(`[mock-mobile] deckId=${deckId}  cardId=${cardId}  cliSessionId=${cliSessionId}`);

  const ws = new WebSocket(`${WS_URL}?token=${token}`);

  ws.on('open', () => {
    console.log('[mock-mobile] connected — sending cli_tunnel_start_listening');
    // Both CLI and mobile send this; relay uses it to pair the two connections
    ws.send(JSON.stringify({ type: 'cli_tunnel_start_listening' }));
    sendState(ws);
  });

  ws.on('message', (data: WebSocket.RawData) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.type !== 'cli_tunnel_send_message') return;

    // Unwrap tunnel envelope (same pattern the CLI uses)
    const inner: any = { ...msg };
    delete inner.type;
    delete inner.clientId;
    if (inner.innerType) {
      inner.type = inner.innerType;
      delete inner.innerType;
    }

    if (inner.type === 'requestState') {
      console.log('[mock-mobile] received requestState → sending state_internal');
      sendState(ws);
    } else if (inner.type === 'edit') {
      console.log(`[mock-mobile] received edit: ${inner.description ?? '(no description)'}  editId=${inner.editId ?? 'none'}`);
      applyEdit(inner);
      // Always schedule a send — mirrors real mobile's UPDATE_SCENE firing after toolEditScene.
      // For CLI edits (editId set), extend suppressDiffUntil so the debounce will no-op.
      if (inner.editId != null) suppressDiffUntil = Date.now() + DEBOUNCE_MS + 100;
      scheduleSendState(ws);
    } else if (inner.type === 'ping') {
      ws.send(JSON.stringify({ type: 'cli_tunnel_send_message', innerType: 'pong' }));
    } else {
      console.log(`[mock-mobile] unknown inner type: ${inner.type}`);
    }
  });

  ws.on('close', () => {
    console.log('[mock-mobile] disconnected');
    process.exit(0);
  });

  ws.on('error', (error: Error) => {
    console.error(`[mock-mobile] error: ${error.message}`);
  });
}

main();
