import * as fs from 'fs';
import * as path from 'path';

export async function stopAndPlay(directory: string = '.') {
  const portFile = path.join(directory, '.castle', 'serve.port');

  if (!fs.existsSync(portFile)) {
    console.error(`Error: castle serve is not running for this directory.`);
    console.error(`  Start it with: castle serve${directory === '.' ? '' : ` ${directory}`}`);
    process.exit(1);
  }

  const port = parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10);
  if (isNaN(port)) {
    console.error(`Error: serve.port file is invalid.`);
    process.exit(1);
  }

  let res: Response;
  try {
    res = await fetch(`http://localhost:${port}/api/stop-and-play`, { method: 'POST' });
  } catch (e: any) {
    console.error(`Error: could not reach castle serve at port ${port}.`);
    console.error(`  Make sure castle serve is still running.`);
    process.exit(1);
  }

  const data = await res.json() as any;

  if (!res.ok || data.error) {
    console.error(`Error: ${data.error ?? res.statusText}`);
    process.exit(1);
  }
}
