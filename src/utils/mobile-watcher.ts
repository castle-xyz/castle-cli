import chokidar, { type FSWatcher } from 'chokidar';
import * as path from 'path';
import { detectChanges, FileChanges } from './mobile-files.js';

const DEBOUNCE_MS = 500;

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private cardDir: string;
  private onChange: (changes: FileChanges) => void;

  constructor(cardDir: string, onChange: (changes: FileChanges) => void) {
    this.cardDir = cardDir;
    this.onChange = onChange;
  }

  start() {
    // Watch source files only (not .castle/)
    const watchPaths = [
      path.join(this.cardDir, 'blueprints'),
      path.join(this.cardDir, 'actors.yaml'),
      path.join(this.cardDir, 'variables.yaml'),
    ];

    this.watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    this.watcher.on('all', (_event: string, _filePath: string) => {
      this._debounceCheck();
    });

    console.log('[watcher] watching for file changes in', this.cardDir);
  }

  private _debounceCheck() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this._check();
    }, DEBOUNCE_MS);
  }

  private _check() {
    const changes = detectChanges(this.cardDir);
    if (changes && changes.hasChanges) {
      console.log('[watcher] detected changes in', this.cardDir);
      this.onChange(changes);
    }
  }

  stop() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
