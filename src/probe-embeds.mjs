/**
 * Probes each self-contained demo in a real browser and records whether it
 * actually paints on load.
 *
 * Static inspection cannot separate a live 3D scene from an MV player that
 * waits for a keypress: both can call requestAnimationFrame and load no
 * external assets. So each candidate is opened headlessly, given time to
 * settle, and its WebGL canvas is sampled. The verdict is written to
 * src/embed-verdicts.json, which covers.mjs consults before embedding.
 *
 * Usage: node src/probe-embeds.mjs [--url-base http://127.0.0.1:4599]
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(__dirname, '..');
const publicDir = join(siteRoot, 'public');
const verdictFile = join(__dirname, 'embed-verdicts.json');

const urlBaseArg = process.argv.indexOf('--url-base');
const urlBase = urlBaseArg > -1 ? process.argv[urlBaseArg + 1] : 'http://127.0.0.1:4599';
const chromePath = process.env.CHROME
  ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const demosDir = join(publicDir, 'demos');
if (!existsSync(demosDir)) {
  console.error('no public/demos found; run covers.mjs and build.mjs first');
  process.exit(2);
}

const { readdirSync } = await import('node:fs');
const ids = readdirSync(demosDir).filter((n) =>
  existsSync(join(demosDir, n, 'index.html')),
);

const verdicts = existsSync(verdictFile)
  ? JSON.parse(readFileSync(verdictFile, 'utf8'))
  : {};

let port = 9500;
for (const id of ids) {
  const url = `${urlBase}/demos/${id}/index.html`;
  const profile = join(process.env.TEMP ?? '/tmp', `probe-${id.slice(0, 12)}-${Date.now()}`);
  port += 1;

  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--window-size=1280,800', url,
  ], { stdio: 'ignore' });

  let verdict = 'unknown';
  try {
    let page = null;
    for (let i = 0; i < 30 && !page; i++) {
      await sleep(500);
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        page = list.find((t) => t.type === 'page' && t.url.startsWith('http'));
      } catch { /* not ready */ }
    }
    if (!page) throw new Error('devtools never became ready');

    // Let any animation settle before sampling.
    await sleep(9000);

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    const evaluate = (expression, id2, awaitPromise = false) => new Promise((res) => {
      const onMsg = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === id2) { ws.removeEventListener('message', onMsg); res(m); }
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({
        id: id2, method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise },
      }));
    });

    // Decide by screenshot, not by gl.readPixels: the drawing buffer is
    // discarded after compositing (preserveDrawingBuffer defaults to false),
    // so readPixels can return all zeros even for a clearly visible scene.
    const cap = await new Promise((res) => {
      const onMsg = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === 2) { ws.removeEventListener('message', onMsg); res(m); }
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({
        id: 2, method: 'Page.captureScreenshot', params: { format: 'png' },
      }));
    });

    const data = cap.result?.data;
    if (!data) throw new Error('no screenshot returned');

    // Count distinct colours and non-background pixels via the page itself,
    // decoding the capture we just took.
    const png = Buffer.from(data, 'base64');
    const analysed = await evaluate(`(async () => {
      const b64 = ${JSON.stringify(png.toString('base64'))};
      const img = new Image();
      await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = 'data:image/png;base64,' + b64; });
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, cv.width, cv.height).data;
      const seen = new Set();
      let nonBlack = 0;
      for (let i = 0; i < d.length; i += 4 * 37) {
        const key = (d[i] >> 3) + ',' + (d[i+1] >> 3) + ',' + (d[i+2] >> 3);
        seen.add(key);
        if (d[i] + d[i+1] + d[i+2] > 24) nonBlack++;
      }
      return JSON.stringify({ colors: seen.size, nonBlack });
    })()`, 3, true);

    const raw = analysed.result?.result?.value;
    if (typeof raw !== 'string') {
      throw new Error(`analysis returned ${JSON.stringify(analysed.result?.result ?? analysed)}`);
    }
    const stats = JSON.parse(raw);
    // A blank page yields a handful of colours (background) and almost no
    // bright pixels. Real content yields many distinct colours.
    verdict = (stats.colors ?? 0) > 40 || (stats.nonBlack ?? 0) > 200 ? 'painted' : 'blank';
    ws.close();
  } catch (e) {
    verdict = `error:${e.message}`;
  } finally {
    try { chrome.kill(); } catch { /* ignore */ }
  }

  verdicts[id] = verdict;
  const label = verdict === 'painted' ? 'EMBED ' : 'LINK  ';
  console.log(`  ${label} ${id}  (${verdict})`);
}

writeFileSync(verdictFile, `${JSON.stringify(verdicts, null, 2)}\n`);
console.log(`\nwrote ${verdictFile}`);
