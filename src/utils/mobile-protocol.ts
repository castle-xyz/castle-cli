// Messages from app -> CLI
export interface StateMessage {
  type: 'state';
  deckId: string;
  cardId: string;
  cliSessionId: string;
  blueprints: Record<string, BlueprintData>;
  actors: Record<string, ActorData>;
  variables: VariableData[];
  prompt: string;
}

export interface BlueprintData {
  entryId: string;
  title: string;
  components: Record<string, any>;
  scriptCode: string | null;
}

export interface ActorData {
  title?: string;
  entryId?: string;
  x?: number;
  y?: number;
  angle?: number;
  widthScale?: number;
  heightScale?: number;
  initialFrame?: number;
  content?: string;
  fontSizeScale?: number;
  targetDeckId?: string;
}

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
  blueprints?: Record<string, any>;
  actors?: Record<string, any>;
  variables?: Record<string, any>;
}

export interface EditResultMessage {
  type: 'editResult';
  success: boolean;
  error?: string;
}

export interface PingMessage {
  type: 'ping';
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

export interface RequestScreenshotMessage {
  type: 'requestScreenshot';
}

export interface StopAndPlayMessage {
  type: 'stopAndPlay';
}

export interface CLIScreenshotMessage {
  type: 'cliScreenshot';
  data: string; // base64 PNG
  suffix: string;
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
  prompt: string;
}

// Incremental diff message: only changed blueprints/actors vs last sent full state
export interface StateInternalDiffMessage {
  type: 'state_internal_diff';
  deckId: string;
  cardId: string;
  cliSessionId: string;
  blueprintChanges?: Record<string, any>;  // entryId → entry | { removed: true }
  actorChanges?: Record<string, any>;      // 'a{id}' → actor | { removed: true }
  variables?: VariableData[];              // full list (always included, small)
}

export type AppToCliMessage = StateMessage | StateInternalMessage | StateInternalDiffMessage | EditResultMessage | PongMessage | LogsMessage | ScreenshotMessage | CLIScreenshotMessage;
export type CliToAppMessage = EditMessage | PingMessage | RequestScreenshotMessage | StopAndPlayMessage;
