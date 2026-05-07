import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './styles.css';

type ServerSessionSummary = {
  id: string;
  cwd: string;
  command: string;
  args: string[];
  pid: number;
  startedAt: string;
  exited: { exitCode: number; signal?: number } | null;
  scrollbackLimit?: number;
};

type ServerMessage =
  | { type: 'hello'; session: ServerSessionSummary }
  | { type: 'replay'; session: ServerSessionSummary; data: string }
  | { type: 'output'; session: ServerSessionSummary; data: string }
  | { type: 'exit'; session: ServerSessionSummary; exitCode: number; signal?: number }
  | { type: 'error'; error: string };

type ServeInfo = {
  url: string;
  port: number;
  deckDir: string;
};

const reconnectDelaysMs = [250, 500, 1000, 2000, 4000, 8000, 12000, 15000] as const;
const defaultScrollback = 2000;
const minScrollback = 200;
const maxScrollback = 20000;

// Force text presentation for symbols that browsers like to emoji-render. Same
// trick lemo's xterm uses; without it bullets and arrows in CLI output get
// drawn as wide colour glyphs that confuse the terminal grid.
const textPresentationPattern = /[•‣⁃∙■-◿☀-➿⬀-⯿]/g;
const textVariationSelector = '︎';

function forceTextSymbols(value: string): string {
  return value.replace(textPresentationPattern, (c) => `${c}${textVariationSelector}`);
}

function clampScrollback(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return defaultScrollback;
  return Math.min(maxScrollback, Math.max(minScrollback, Math.trunc(value)));
}

function App() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState('connecting');
  const [serveInfo, setServeInfo] = useState<ServeInfo | null>(null);

  // Fetch the deck preview url so the iframe shows the same thing `castle serve --open` would.
  useEffect(() => {
    let cancelled = false;
    fetch('/ide/api/serve-info')
      .then(async (response) => {
        if (!response.ok) throw new Error(`serve-info: ${response.status}`);
        return (await response.json()) as ServeInfo;
      })
      .then((info) => {
        if (!cancelled) setServeInfo(info);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hostRef.current) return;

    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      macOptionIsMeta: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: defaultScrollback,
      theme: {
        background: '#1a1b26',
        foreground: '#c0caf5',
        cursor: '#c0caf5',
        cursorAccent: '#1a1b26',
        selectionBackground: '#283457',
        selectionForeground: '#c0caf5',
        black: '#15161e',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
        brightBlack: '#414868',
        brightRed: '#f7768e',
        brightGreen: '#9ece6a',
        brightYellow: '#e0af68',
        brightBlue: '#7aa2f7',
        brightMagenta: '#bb9af7',
        brightCyan: '#7dcfff',
        brightWhite: '#c0caf5',
      },
    });
    const fit = new FitAddon();
    termRef.current = term;
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    term.focus();

    let disposed = false;
    let reconnectEnabled = true;
    let renderedTerminal = false;
    let currentSocket: WebSocket | null = null;
    let socketToken = 0;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    let needsWakeReconnect = document.visibilityState === 'hidden';
    const intentionallyClosed = new WeakSet<WebSocket>();

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ide/pty`;

    function clearReconnectTimer(): void {
      if (reconnectTimer === null) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    function isCurrentSocket(socket: WebSocket, token: number): boolean {
      return !disposed && currentSocket === socket && socketToken === token;
    }

    function pausedStatus(): string {
      if (navigator.onLine === false) return 'offline; reconnecting when online';
      if (document.visibilityState === 'hidden') return 'paused; reconnecting when visible';
      return 'paused';
    }

    function canReconnectNow(): boolean {
      return (
        reconnectEnabled &&
        !disposed &&
        document.visibilityState !== 'hidden' &&
        navigator.onLine !== false
      );
    }

    function closeCurrentSocket(reason: string): void {
      const socket = currentSocket;
      currentSocket = null;
      if (!socket) return;
      intentionallyClosed.add(socket);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, reason);
      }
    }

    function refreshVisibleRows(): void {
      const refresh = () => {
        if (disposed || termRef.current !== term) return;
        term.refresh(0, Math.max(0, term.rows - 1));
      };
      refresh();
      window.requestAnimationFrame(refresh);
      window.setTimeout(refresh, 80);
    }

    function fitAndSendResize(socket: WebSocket | null = currentSocket): void {
      window.requestAnimationFrame(() => {
        if (disposed || termRef.current !== term) return;
        fit.fit();
        refreshVisibleRows();
        if (socket && socket === currentSocket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      });
    }

    function sendToCurrent(message: unknown): boolean {
      const socket = currentSocket;
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    }

    function scheduleReconnect(): void {
      if (!reconnectEnabled || disposed) return;
      clearReconnectTimer();
      if (!canReconnectNow()) {
        setStatus(pausedStatus());
        return;
      }
      if (reconnectAttempt >= reconnectDelaysMs.length) {
        setStatus('reconnect failed; reload this tab');
        return;
      }
      const delay = reconnectDelaysMs[reconnectAttempt]!;
      reconnectAttempt += 1;
      setStatus(`reconnecting ${reconnectAttempt}/${reconnectDelaysMs.length}`);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectSocket({ force: true });
      }, delay);
    }

    function handleServerMessage(message: ServerMessage): void {
      if (message.type === 'hello' || message.type === 'replay') {
        term.options.scrollback = clampScrollback(message.session.scrollbackLimit);
      }
      if (message.type === 'replay') {
        if (renderedTerminal) {
          term.reset();
        }
        renderedTerminal = true;
        term.write(forceTextSymbols(message.data));
        fitAndSendResize();
      }
      if (message.type === 'output') {
        renderedTerminal = true;
        term.write(forceTextSymbols(message.data));
      }
      if (message.type === 'exit') {
        reconnectEnabled = false;
        clearReconnectTimer();
        const sig = message.signal ? ` signal ${message.signal}` : '';
        setStatus(`exited ${message.exitCode}${sig}`);
        closeCurrentSocket('terminal exited');
      }
      if (message.type === 'error') {
        setStatus(`error: ${message.error}`);
      }
    }

    function connectSocket(opts: { force?: boolean; resetBackoff?: boolean } = {}): void {
      if (disposed || !reconnectEnabled) return;
      clearReconnectTimer();
      if (!canReconnectNow()) {
        setStatus(pausedStatus());
        return;
      }
      if (opts.resetBackoff) reconnectAttempt = 0;
      const existing = currentSocket;
      const existingState = existing?.readyState;
      if (
        existing &&
        !opts.force &&
        (existingState === WebSocket.OPEN || existingState === WebSocket.CONNECTING)
      ) {
        if (existingState === WebSocket.OPEN) fitAndSendResize(existing);
        return;
      }
      if (existing) closeCurrentSocket('reconnect');

      const socket = new WebSocket(wsUrl);
      const token = ++socketToken;
      currentSocket = socket;
      setStatus(reconnectAttempt > 0 ? `reconnecting ${reconnectAttempt}/${reconnectDelaysMs.length}` : 'connecting');

      socket.addEventListener('open', () => {
        if (!isCurrentSocket(socket, token)) return;
        reconnectAttempt = 0;
        setStatus('connected');
        fitAndSendResize(socket);
      });
      socket.addEventListener('close', () => {
        if (!isCurrentSocket(socket, token)) return;
        currentSocket = null;
        if (!reconnectEnabled || intentionallyClosed.has(socket)) {
          if (reconnectEnabled) setStatus('closed');
          return;
        }
        scheduleReconnect();
      });
      socket.addEventListener('error', () => {
        if (!isCurrentSocket(socket, token)) return;
        setStatus('connection error');
      });
      socket.addEventListener('message', (event) => {
        if (!isCurrentSocket(socket, token)) return;
        try {
          handleServerMessage(JSON.parse(String(event.data)) as ServerMessage);
        } catch {
          setStatus('error: invalid server message');
        }
      });
    }

    function handleWake(force: boolean): void {
      if (!reconnectEnabled || disposed || document.visibilityState === 'hidden') return;
      reconnectAttempt = 0;
      const socket = currentSocket;
      if (socket?.readyState === WebSocket.OPEN) {
        fitAndSendResize(socket);
        return;
      }
      if (socket?.readyState === WebSocket.CONNECTING) {
        refreshVisibleRows();
        return;
      }
      if (force || !socket || socket.readyState >= WebSocket.CLOSING) {
        connectSocket({ force: true, resetBackoff: true });
      }
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState === 'hidden') {
        needsWakeReconnect = true;
        const socket = currentSocket;
        if (!socket || socket.readyState >= WebSocket.CLOSING) {
          clearReconnectTimer();
          setStatus(pausedStatus());
        }
        return;
      }
      const force = needsWakeReconnect;
      needsWakeReconnect = false;
      handleWake(force);
    }

    function handlePageHide(): void {
      needsWakeReconnect = true;
      closeCurrentSocket('page hidden');
      clearReconnectTimer();
      setStatus(pausedStatus());
    }

    function handlePageShow(event: PageTransitionEvent): void {
      const force = needsWakeReconnect || event.persisted;
      needsWakeReconnect = false;
      handleWake(force);
    }

    function handleFocus(): void {
      const force = needsWakeReconnect;
      needsWakeReconnect = false;
      handleWake(force);
    }

    function handleOffline(): void {
      needsWakeReconnect = true;
      closeCurrentSocket('offline');
      clearReconnectTimer();
      setStatus(pausedStatus());
    }

    function handleOnline(): void {
      const force = needsWakeReconnect;
      needsWakeReconnect = false;
      handleWake(force);
    }

    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true;
      // Send Ctrl+Enter as CSI 13;5u so claude/codex CLIs receive a real newline-with-modifier.
      if (ev.key === 'Enter' && ev.ctrlKey && !ev.shiftKey && !ev.altKey && !ev.metaKey) {
        ev.preventDefault();
        sendToCurrent({ type: 'input', data: '\x1b[13;5u' });
        return false;
      }
      return true;
    });

    const inputHandle = term.onData((data) => {
      sendToCurrent({ type: 'input', data });
    });
    const resizeHandle = term.onResize(({ cols, rows }) => {
      sendToCurrent({ type: 'resize', cols, rows });
    });
    const observer = new ResizeObserver(() => fitAndSendResize());
    observer.observe(hostRef.current);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    connectSocket({ resetBackoff: true });

    return () => {
      disposed = true;
      reconnectEnabled = false;
      clearReconnectTimer();
      observer.disconnect();
      inputHandle.dispose();
      resizeHandle.dispose();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      closeCurrentSocket('component unmounted');
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  const isError = status.startsWith('error:');
  const previewUrl = serveInfo?.url ?? null;
  const workspaceClasses = ['workspace'];
  if (previewUrl) workspaceClasses.push('has-preview');

  return (
    <div className="shell" data-testid="ide-shell">
      <div className={workspaceClasses.join(' ')}>
        {previewUrl && (
          <aside className="preview-pane" aria-label="deck preview">
            <iframe
              className="preview-frame"
              src={previewUrl}
              title="deck preview"
              data-testid="preview-frame"
              sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"
              referrerPolicy="no-referrer"
              allow="autoplay; clipboard-read; clipboard-write; fullscreen; gamepad"
            />
          </aside>
        )}
        <section className="terminal-pane" aria-label="cli terminal">
          {isError && (
            <div className="error-banner" role="alert">
              {status}
            </div>
          )}
          <div ref={hostRef} className="terminal-host" data-testid="terminal-host" />
        </section>
      </div>
      <footer className="statusbar" aria-live="polite">
        <span data-testid="status">{status}</span>
      </footer>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
