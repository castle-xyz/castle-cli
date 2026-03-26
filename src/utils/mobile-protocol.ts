// Messages from app -> CLI
export interface VariableData {
  variableId: string;
  name: string;
  initialValue: number;
  lifetime: string;
}

// Messages from CLI -> app
export interface EditMessage {
  type: 'edit';
  description: string;
  editId?: number;          // incrementing ID; mobile should not echo state for this edit
  blueprints?: Record<string, any>;
  actors?: Record<string, any>;
  variables?: Record<string, any>;
  sceneProperties?: any;
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
  requestId?: string;
}

export interface CLIScreenshotMessage {
  type: 'cliScreenshot';
  data: string; // base64 PNG
  suffix?: string;
}

// Message sent by mobile with raw EDITOR_LIBRARY/EDITOR_ACTORS (internal format)
// Blueprints: EDITOR_LIBRARY entries { entryType, title, actorBlueprint: { components: {...} } }
// Actors: keyed by `a{actorId}`, each { actorId?, parentEntryId, bp: { components: { Body, ... } } }
//   with Body values in internal format (widthScale 0–1, angle radians)
export interface StateInternalMessage {
  type: 'state_internal';
  deckId: string;
  cardId: string;
  cliSessionId: string;
  blueprints: Record<string, any>;  // raw EDITOR_LIBRARY entries
  actors: Record<string, any>;      // raw EDITOR_ACTORS entries
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

export type CliToAppMessage = EditMessage | RequestStateMessage | RequestDrawDataMessage;
