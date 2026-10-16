/**
 * Materialises a minimal mirror of the content repository.
 *
 * The full content repo is ~12 GB (mostly Git LFS media) but the site only
 * needs manifest.json plus the cover images and any embeddable demo entry
 * files. A full checkout in CI would clone every asset for no reason, so this
 * script downloads just those files over HTTPS and lays them out under the
 * same relative paths the local build expects.
 *
 * Point CONTENT_REPO at the output directory and the rest of the build works
 * unchanged, whether it is reading a real clone or this mirror.
 *
 * Usage:
 *   node src/fetch-content.mjs [--out content] [--ref main]
 *
 * Env:
 *   CONTENT_REPO_SLUG  owner/name of the content repo
 *   GITHUB_TOKEN       optional, raises the rate limit
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(__dirname, '..');

const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const outDir = resolve(siteRoot, argOf('--out', 'content'));
const ref = argOf('--ref', process.env.CONTENT_REF ?? 'main');
const slug = process.env.CONTENT_REPO_SLUG ?? 'l4place0/ai-lab';
const token = process.env.GITHUB_TOKEN;

const headers = { 'User-Agent': 'ai-lab-site-build' };
if (token) headers.Authorization = `Bearer ${token}`;

const apiBase = `https://api.github.com/repos/${slug}`;

/** Fetch a repo file as text, preferring the API so private repos work. */
async function fetchText(repoPath) {
  const url = `${apiBase}/contents/${encodeURI(repoPath)}?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(url, {
    headers: { ...headers, Accept: 'application/vnd.github.raw' },
  });
  if (!res.ok) throw new Error(`GET ${repoPath} -> ${res.status} ${res.statusText}`);
  return res.text();
}

/** Fetch a repo file as bytes. */
async function fetchBinary(repoPath) {
  const url = `${apiBase}/contents/${encodeURI(repoPath)}?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(url, {
    headers: { ...headers, Accept: 'application/vnd.github.raw' },
  });
  if (!res.ok) {
    // A missing cover is not fatal: the card simply renders without one.
    if (res.status === 404) return null;
    throw new Error(`GET ${repoPath} -> ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function write(repoPath, data) {
  const dest = join(outDir, repoPath);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, data);
}

console.log(`content repo : ${slug}@${ref}`);
console.log(`mirror out   : ${outDir}`);

// --- manifest ---------------------------------------------------------------
const manifestText = await fetchText('manifest.json');
write('manifest.json', manifestText);

const manifest = JSON.parse(manifestText);
console.log(`items        : ${manifest.items.length}`);

// --- covers -----------------------------------------------------------------
// Only covers are mirrored; full-size assets stay in the content repo and are
// linked rather than duplicated.
let covers = 0, missingCovers = 0;
for (const item of manifest.items) {
  if (!item.cover) continue;
  const repoPath = `${item.path}/${item.cover}`;
  const buf = await fetchBinary(repoPath);
  if (buf === null) {
    console.log(`  cover missing : ${repoPath}`);
    missingCovers++;
    continue;
  }
  write(repoPath, buf);
  covers++;
}
console.log(`covers        : ${covers}${missingCovers ? ` (${missingCovers} missing)` : ''}`);

// --- embeddable demo entries ------------------------------------------------
// Only entries that were previously judged to paint on load are fetched; a
// demo that renders blank is linked, not embedded, so its files are not needed.
const verdictFile = join(siteRoot, 'src', 'embed-verdicts.json');
const verdicts = existsSync(verdictFile)
  ? JSON.parse(readFileSync(verdictFile, 'utf8'))
  : {};

let demos = 0;
for (const item of manifest.items) {
  if (!item.entry || verdicts[item.id] !== 'painted') continue;
  const repoPath = `${item.path}/${item.entry}`;
  const buf = await fetchBinary(repoPath);
  if (buf === null) {
    console.log(`  demo missing  : ${repoPath}`);
    continue;
  }
  write(repoPath, buf);
  demos++;
}
console.log(`demo entries  : ${demos}`);

console.log('\nmirror complete');
