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

export type AppToCliMessage = StateMessage | EditResultMessage | PongMessage | LogsMessage | ScreenshotMessage | CLIScreenshotMessage;
export type CliToAppMessage = EditMessage | PingMessage | RequestScreenshotMessage | StopAndPlayMessage;
