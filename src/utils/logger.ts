import * as fs from 'fs';
import * as path from 'path';

const MAX_LINES = 4000;
const CASTLE_DIR = '.castle';
const LOG_FILE = 'logs.txt';

export class Logger {
  private filePath: string;
  private lines: string[] = [];

  constructor(dir: string) {
    const castleDir = path.join(dir, CASTLE_DIR);
    if (!fs.existsSync(castleDir)) fs.mkdirSync(castleDir, { recursive: true });
    this.filePath = path.join(castleDir, LOG_FILE);

    // Load existing lines if file exists
    if (fs.existsSync(this.filePath)) {
      try {
        this.lines = fs.readFileSync(this.filePath, 'utf-8').split('\n');
        if (this.lines[this.lines.length - 1] === '') this.lines.pop();
      } catch {}
    }
  }

  cli(message: string) {
    this._append(`[CLI] ${message}`);
  }

  deck(message: string, level?: string, blueprintTitle?: string) {
    let prefix = '[Deck]';
    if (blueprintTitle) prefix += ` [${blueprintTitle}]`;
    if (level && level !== 'info') prefix += ` (${level})`;
    this._append(`${prefix} ${message}`);
  }

  private _append(line: string) {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    const full = `${timestamp} ${line}`;
    this.lines.push(full);

    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      if (this.lines.length > MAX_LINES + 500) {
        // Trim with headroom and rewrite
        this.lines = this.lines.slice(this.lines.length - MAX_LINES);
        fs.writeFileSync(this.filePath, this.lines.join('\n') + '\n');
      } else {
        // Append only
        fs.appendFileSync(this.filePath, full + '\n');
      }
    } catch (e: any) {
      console.error(`[logger] failed to write: ${e.message}`);
    }
  }
}
