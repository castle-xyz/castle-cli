import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';

const WS_URL = 'wss://ws.castlexyz.com/ws';

export async function sendCommand(token: string, command: string, filename?: string) {
  const ws = new WebSocket(`${WS_URL}?token=${token}`);

  const send = (data: any) => {
    ws.send(JSON.stringify({ type: 'cli_tunnel_send_message', ...data }));
  };

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error('timed out waiting for response');
      ws.close();
      reject(new Error('timeout'));
    }, 10000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'cli_tunnel_start_listening' }));

      if (command === 'restart') {
        send({ innerType: 'cli4_restart' });
        console.log('restart sent');
        clearTimeout(timeout);
        ws.close();
        resolve();
      } else if (command === 'screenshot') {
        send({ innerType: 'cli4_screenshot' });
        console.log('screenshot requested, waiting...');
      }
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'cli_tunnel_send_message' && msg.innerType === 'cli4_screenshot_data') {
          const data = msg.data;
          const outPath = filename || path.join('workspace', '.castle', 'screenshots', `${Date.now()}.png`);
          const dir = path.dirname(outPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(outPath, Buffer.from(data, 'base64'));

          const latestDir = path.join('workspace', '.castle', 'screenshots');
          if (!fs.existsSync(latestDir)) fs.mkdirSync(latestDir, { recursive: true });
          fs.copyFileSync(outPath, path.join(latestDir, 'latest.png'));

          console.log(`screenshot saved: ${outPath}`);
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      } catch {}
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      console.error('connection error:', err.message);
      reject(err);
    });
  });
}
