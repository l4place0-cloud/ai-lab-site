/**
 * Copies cover images and self-contained interactive demos out of the content
 * repo into `public/`.
 *
 * Raw GitHub URLs cannot serve Git LFS content, so the site ships its own
 * copies of the thumbnails. Demos are copied only when they are genuinely
 * self-contained, because the detail page embeds them in an iframe.
 */
import {
  readFileSync, mkdirSync, copyFileSync, existsSync, statSync, readdirSync, rmSync,
} from 'node:fs';
import { dirname, join, resolve, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(__dirname, '..');
const publicDir = join(siteRoot, 'public');
const contentRoot = process.env.CONTENT_REPO
  ? resolve(process.env.CONTENT_REPO)
  : resolve(siteRoot, '..', 'ai-benchmark');

const manifest = JSON.parse(readFileSync(join(contentRoot, 'manifest.json'), 'utf8'));

// --- Covers -----------------------------------------------------------------
const coverDir = join(publicDir, 'covers');
mkdirSync(coverDir, { recursive: true });

let copied = 0, skipped = 0, missing = 0;

for (const item of manifest.items) {
  if (!item.cover) { skipped++; continue; }
  const src = join(contentRoot, item.path, item.cover);
  if (!existsSync(src) || !statSync(src).isFile()) { missing++; continue; }
  const ext = extname(item.cover).toLowerCase() || '.png';
  copyFileSync(src, join(coverDir, `${item.id}${ext}`));
  copied++;
}

console.log(`covers copied : ${copied}`);
console.log(`no cover      : ${skipped}`);
console.log(`missing file  : ${missing}`);
console.log(`covers output : ${coverDir}`);

// --- Demos ------------------------------------------------------------------
// A demo is embeddable only when its entry HTML is self-contained: no external
// URLs and no sibling-file references. Anything else is linked, not embedded,
// so the site never promises interactivity it cannot deliver.
const EXTERNAL = /(?:src|href)\s*=\s*["'](https?:)?\/\//i;
const SIBLING = /(?:src|href)\s*=\s*["'](?!data:|#|mailto:)[^"']*\.(?:js|css|mjs|png|jpg|jpeg|gif|svg|webp|mp3|wav|ogg|json|glb|gltf)["']/i;

// A purely self-contained page can still embed badly. The MV works are frame
// renderers that paint nothing until the visitor presses play, so an iframe
// would show a blank rectangle. Static inspection cannot tell these apart from
// a live scene (both may call requestAnimationFrame), so the decision is made
// by probing the rendered canvas in a browser, and the verdict is cached.
function isSelfContained(html) {
  return !EXTERNAL.test(html) && !SIBLING.test(html);
}

const VERDICT_FILE = join(siteRoot, 'src', 'embed-verdicts.json');
let verdicts = {};
if (existsSync(VERDICT_FILE)) {
  try { verdicts = JSON.parse(readFileSync(VERDICT_FILE, 'utf8')); } catch { verdicts = {}; }
}

const demosDir = join(publicDir, 'demos');
let demosCopied = 0, demosSkipped = 0;
const notEmbeddable = [];
const notSelfContained = [];
const blankUntilPlayed = [];

for (const item of manifest.items) {
  if (!item.entry) { continue; }
  const entryPath = join(contentRoot, item.path, item.entry);
  if (!existsSync(entryPath)) { continue; }

  let html;
  try {
    html = readFileSync(entryPath, 'utf8');
  } catch {
    continue;
  }

  if (!isSelfContained(html)) {
    demosSkipped++; notEmbeddable.push(item.id); notSelfContained.push(item.id);
    continue;
  }

  // Probed verdicts win: a self-contained page that paints nothing on load is
  // linked rather than embedded, so the site never shows a blank rectangle.
  if (verdicts[item.id] === 'blank') {
    demosSkipped++; notEmbeddable.push(item.id); blankUntilPlayed.push(item.id);
    continue;
  }

  const destDir = join(demosDir, item.id);
  mkdirSync(destDir, { recursive: true });
  copyFileSync(entryPath, join(destDir, 'index.html'));
  demosCopied++;
}

// Remove demos that are no longer embedded, so a stale copy cannot linger and
// keep an iframe alive for a work that is no longer eligible.
if (existsSync(demosDir)) {
  const eligible = new Set(
    manifest.items
      .filter((i) => i.entry && verdicts[i.id] !== 'blank')
      .map((i) => i.id),
  );
  for (const name of readdirSync(demosDir)) {
    if (!eligible.has(name)) {
      rmSync(join(demosDir, name), { recursive: true, force: true });
    }
  }
}

console.log(`demos embedded: ${demosCopied}`);
console.log(`demos linked  : ${demosSkipped} (${notSelfContained.length} not self-contained, ${blankUntilPlayed.length} blank until played)`);
if (blankUntilPlayed.length) {
  console.log('  self-contained but paint nothing on load:');
  blankUntilPlayed.forEach((id) => console.log(`    - ${id}`));
}
if (notSelfContained.length) {
  console.log('  need a server or external assets:');
  notSelfContained.slice(0, 12).forEach((id) => console.log(`    - ${id}`));
}
