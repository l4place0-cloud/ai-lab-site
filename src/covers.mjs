/**
 * Copies cover images referenced by the manifest out of the content repo
 * into `public/covers/`.
 *
 * Raw GitHub URLs cannot serve Git LFS content, so the site ships its own
 * copies of the thumbnails. Only covers are copied; full-size assets stay in
 * the content repo and are linked rather than duplicated.
 */
import { readFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(__dirname, '..');
const publicDir = join(siteRoot, 'public');
const contentRoot = process.env.CONTENT_REPO
  ? resolve(process.env.CONTENT_REPO)
  : resolve(siteRoot, '..', 'ai-benchmark');

const manifest = JSON.parse(readFileSync(join(contentRoot, 'manifest.json'), 'utf8'));
const outDir = join(publicDir, 'covers');
mkdirSync(outDir, { recursive: true });

let copied = 0, skipped = 0, missing = 0;
const index = {};

for (const item of manifest.items) {
  if (!item.cover) { skipped++; continue; }
  const src = join(contentRoot, item.path, item.cover);
  if (!existsSync(src) || !statSync(src).isFile()) { missing++; continue; }
  const ext = extname(item.cover).toLowerCase() || '.png';
  const name = `${item.id}${ext}`;
  copyFileSync(src, join(outDir, name));
  index[item.id] = name;
  copied++;
}

console.log(`covers copied : ${copied}`);
console.log(`no cover      : ${skipped}`);
console.log(`missing file  : ${missing}`);
console.log(`output        : ${outDir}`);
