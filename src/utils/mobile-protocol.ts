// Messages from app -> CLI
export interface VariableData {
  variableId: string;
  name: string;
  initialValue: number;
  lifetime: string;
}

export interface EditResultMessage {
  type: 'editResult';
  success: boolean;
  error?: string;
}

export interface PongMessage {
  type: 'pong';
}

export interface LogEntry {
  log: string;
  level: string;
  blueprintTitle?: string;
  count?: number;
  createdAt?: number;
}

export interface LogsMessage {
  type: 'logs';
  logs: LogEntry[];
}

export interface ScreenshotMessage {
  type: 'screenshot';
  data: string; // base64 PNG
}

export interface CLIScreenshotMessage {
  type: 'cliScreenshot';
  data: string; // base64 PNG
  suffix?: string;
}

// Message sent by mobile with raw EDITOR_LIBRARY/EDITOR_ACTORS (internal format).
// Also sent by CLI to mobile with full disk state (editId present).
// Blueprints (from mobile): EDITOR_LIBRARY entries { entryType, title, actorBlueprint: { components: {...} } }
// Blueprints (from CLI): { entryId, title, components: "yaml string", script?: [...], drawing? }
// Actors (from mobile): keyed by `a{actorId}`, each { actorId?, parentEntryId, bp: { components: { Body, ... } } }
//   with Body values in internal format (widthScale 0–1, angle radians)
// Actors (from CLI): keyed by disk key (a0, a1...), flat { title, x, y, widthScale, persistentId }
//   with Body values in external format (widthScale 0–10, angle degrees)
export interface StateInternalMessage {
  type: 'state_internal';
  deckId: string;
  cardId: string;
  cliSessionId: string;
  editId?: number;          // set by CLI when sending; mobile suppresses echo when set
  blueprints: Record<string, any>;
  actors: Record<string, any>;
  variables: VariableData[];
  sceneProperties?: any;
  actorBlueprintInherit?: boolean;
  linkTargetDeckIds?: any[];
}

export type AppToCliMessage = StateInternalMessage | EditResultMessage | PongMessage | LogsMessage | ScreenshotMessage | CLIScreenshotMessage;

export interface RequestStateMessage {
  type: 'requestState';
  knownDrawHashes?: Record<string, string>;  // entryId → Drawing2.hash CLI already has on disk
}

export interface RequestDrawDataMessage {
  type: 'requestDrawData';
  entryIds: string[];  // blueprints whose draw data CLI needs (hash mismatch detected)
}

export type CliToAppMessage = StateInternalMessage | RequestStateMessage | RequestDrawDataMessage;
