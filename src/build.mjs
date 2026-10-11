/**
 * Builds the static showcase site from the content repository's manifest.
 *
 * The site is a pure consumer: it reads `manifest.json` (produced by the
 * content repo) plus the referenced asset paths, and emits static HTML into
 * `public/`. Nothing here writes back to the content repo, which keeps the
 * two repositories decoupled.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, cpSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(__dirname, '..');
const publicDir = join(siteRoot, 'public');

// The content repository checkout. Override with CONTENT_REPO for CI.
const contentRoot = process.env.CONTENT_REPO
  ? resolve(process.env.CONTENT_REPO)
  : resolve(siteRoot, '..', 'ai-benchmark');

const RAW_BASE = 'https://raw.githubusercontent.com/l4place0/ai-lab/main';
const REPO_BASE = 'https://github.com/l4place0/ai-lab';

function readManifest() {
  const p = join(contentRoot, 'manifest.json');
  if (!existsSync(p)) {
    throw new Error(
      `manifest.json not found at ${p}\n` +
      `Set CONTENT_REPO to the content repository checkout, or run the\n` +
      `content repo's tools/build-manifest.ps1 first.`
    );
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** Grade -> visual weight. Ungraded work is shown honestly, never guessed. */
function gradeClass(grade) {
  if (!grade) return 'g-none';
  if (grade === '不合格') return 'g-fail';
  const letter = grade[0];
  return `g-${letter.toLowerCase()}${grade.includes('-') ? ' minus' : ''}${grade.includes('+') ? ' plus' : ''}`;
}

const kindLabel = {
  interactive: '可交互',
  assets: '素材',
};

/**
 * Cover images are copied into the site by `covers.mjs` because raw GitHub
 * URLs cannot serve Git LFS content. Fall back to the repo path only when a
 * local copy is genuinely absent, so a missing thumbnail is visible rather
 * than silently broken.
 */
const COVER_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

function coverUrl(item, prefix = '.') {
  if (!item.cover) return null;
  for (const ext of COVER_EXTS) {
    if (existsSync(join(publicDir, 'covers', `${item.id}${ext}`))) {
      return `${prefix}/covers/${item.id}${ext}`;
    }
  }
  // No local copy: point at the content repo so the gap is traceable.
  const path = `${item.path}/${item.cover}`;
  return `${RAW_BASE}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function layout({ title, body, relRoot = '.' }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${relRoot}/style.css">
</head>
<body>
<header class="top">
  <a class="brand" href="${relRoot}/index.html">AI <span>Lab</span></a>
  <nav><a href="${REPO_BASE}" target="_blank" rel="noopener">内容仓库</a></nav>
</header>
${body}
<footer class="foot">
  <p>AI Lab · AI 模型实战评测、横评数据与视频展示实验室</p>
  <p class="muted">工程文件与交付物见 <a href="${REPO_BASE}" target="_blank" rel="noopener">l4place0/ai-lab</a></p>
</footer>
</body>
</html>
`;
}

function renderIndex(manifest) {
  const { items } = manifest;

  // Build the model x task matrix. Repeated (model, task) pairs are collapsed
  // to the first shot, since the matrix answers "did this model do this task".
  const models = [...new Set(items.map((i) => i.model))];
  const tasks = [...new Set(items.map((i) => i.task))];

  const cellFor = (model, task) => items.filter((i) => i.model === model && i.task === task);

  const head = tasks.map((t) => `<th><span>${esc(t)}</span></th>`).join('');
  const rows = models.map((m) => {
    const tds = tasks.map((t) => {
      const hits = cellFor(m, t);
      if (!hits.length) return '<td class="empty">·</td>';
      const item = hits[0];
      const extra = hits.length > 1 ? `<sup>${hits.length}</sup>` : '';
      return `<td><a class="cell ${gradeClass(item.grade)}" href="./p/${item.id}.html"
        title="${esc(item.model)} / ${esc(item.tool)} / ${esc(item.task)} / ${esc(item.shot)}">
        <span class="badge">${esc(item.grade ?? '未评分')}</span>${extra}</a></td>`;
    }).join('');
    return `<tr><th class="rowhead">${esc(m)}</th>${tds}</tr>`;
  }).join('');

  const stats = {
    total: items.length,
    graded: items.filter((i) => i.grade).length,
    interactive: items.filter((i) => i.kind.includes('interactive')).length,
    models: models.length,
    tasks: tasks.length,
  };

  const cards = items.map((i) => {
    const cover = coverUrl(i);
    return `<a class="card" href="./p/${i.id}.html">
      <div class="thumb">${cover
        ? `<img src="${esc(cover)}" alt="" loading="lazy">`
        : '<span class="nothumb">无封面</span>'}</div>
      <div class="meta">
        <span class="badge ${gradeClass(i.grade)}">${esc(i.grade ?? '未评分')}</span>
        <strong>${esc(i.task)}</strong>
        <small>${esc(i.model)} · ${esc(i.tool)} · ${esc(i.shot)}</small>
        <small class="kind">${esc(kindLabel[i.kind.split('+')[0]] ?? i.kind)}</small>
      </div>
    </a>`;
  }).join('');

  const body = `<main>
  <section class="hero">
    <h1>同一个需求，交给不同模型</h1>
    <p>用同一批真实创意编程任务横评 AI 模型与 Agent 工具链。${stats.total} 个作品，
       ${stats.models} 个模型，${stats.tasks} 类任务，其中 ${stats.interactive} 个可交互实跑。</p>
  </section>

  <section>
    <h2>横评矩阵</h2>
    <p class="muted">行 = 模型，列 = 任务。点击进入详情。数字上标表示该模型在同一任务下有多个 shot。</p>
    <div class="tablewrap">
      <table class="matrix">
        <thead><tr><th class="corner">模型 \\ 任务</th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="legend">
      <span class="badge g-a">A</span> 优秀
      <span class="badge g-c">C</span> 合格但有明显问题
      <span class="badge g-fail">不合格</span> 未通过
      <span class="badge g-none">未评分</span> 无留存评审记录
      <em>（评分只取自各作品 README 中明确写下的结论，不做推测）</em>
    </p>
  </section>

  <section>
    <h2>全部作品</h2>
    <div class="grid">${cards}</div>
  </section>
</main>`;
  return layout({ title: 'AI Lab · 横评矩阵', body });
}

function renderDetail(item, manifest) {
  const cover = coverUrl(item, '..');
  const repoLink = `${REPO_BASE}/tree/main/${item.path.split('/').map(encodeURIComponent).join('/')}`;
  const docLink = `${RAW_BASE}/${(item.path + '/README.md').split('/').map(encodeURIComponent).join('/')}`;

  // Embed the demo when this site actually ships a local copy of it. Demos are
  // published at /demos/<id>/, a sibling of the /p/ detail pages, so the
  // reference must climb out of /p/ before descending.
  const embeddable = existsSync(join(publicDir, 'demos', item.id, 'index.html'));
  const demoHref = `../demos/${item.id}/index.html`;

  const siblings = manifest.items.filter((i) => i.model === item.model && i.task === item.task && i.id !== item.id);

  const body = `<main class="detail">
  <a class="back" href="../index.html">← 返回矩阵</a>
  <div class="dhead">
    <div>
      <h1>${esc(item.task)}</h1>
      <p class="muted">${esc(item.model)} · ${esc(item.tool)} · ${esc(item.shot)}</p>
    </div>
    <span class="badge big ${gradeClass(item.grade)}">${esc(item.grade ?? '未评分')}</span>
  </div>

  ${embeddable
    ? `<section class="stage">
        <div class="stagebar">
          <span>交互演示（本站内嵌实跑）</span>
          <a href="${demoHref}" target="_blank" rel="noopener">全屏打开 ↗</a>
        </div>
        <iframe src="${demoHref}" title="${esc(item.task)} 交互演示" loading="lazy"></iframe>
      </section>`
    : `<section class="stage placeholder">
        <div class="stagebar"><span>交互演示</span></div>
        <div class="ph">
          <p>此作品尚未在本站内嵌部署。</p>
          <p class="muted">它仍然存在于内容仓库中，可克隆后本地运行。</p>
        </div>
      </section>`}

  ${cover ? `<section><h2>预览</h2><img class="cover" src="${esc(cover)}" alt="${esc(item.task)} 预览"></section>` : ''}

  <section>
    <h2>作品信息</h2>
    <table class="kv">
      <tr><th>模型</th><td>${esc(item.model)}</td></tr>
      <tr><th>工具链</th><td>${esc(item.tool)}</td></tr>
      <tr><th>任务</th><td>${esc(item.task)}</td></tr>
      <tr><th>版本</th><td>${esc(item.shot)}</td></tr>
      <tr><th>交付类型</th><td>${esc(item.kind)}</td></tr>
      <tr><th>评分</th><td>${esc(item.grade ?? '未评分（README 中无明确结论）')}</td></tr>
      <tr><th>仓库路径</th><td><code>${esc(item.path)}</code></td></tr>
      <tr><th>视频</th><td>${item.videoUrl
        ? `<a href="${esc(item.videoUrl)}" target="_blank" rel="noopener">外部链接 ↗</a>`
        : '<span class="muted">未登记（视频统一发布于外部平台）</span>'}</td></tr>
    </table>
  </section>

  <section>
    <h2>文档</h2>
    <p>
      <a href="${repoLink}" target="_blank" rel="noopener">在内容仓库中查看该目录 ↗</a> ·
      <a href="${docLink}" target="_blank" rel="noopener">阅读 README ↗</a>
    </p>
  </section>

  ${siblings.length ? `<section><h2>同任务其他版本</h2><ul class="sibs">
    ${siblings.map((s) => `<li><a href="./${s.id}.html">${esc(s.model)} · ${esc(s.tool)} · ${esc(s.shot)}
      <span class="badge ${gradeClass(s.grade)}">${esc(s.grade ?? '未评分')}</span></a></li>`).join('')}
  </ul></section>` : ''}
</main>`;
  return layout({ title: `${item.task} · ${item.model} · AI Lab`, body, relRoot: '..' });
}

function main() {
  const manifest = readManifest();

  mkdirSync(join(publicDir, 'p'), { recursive: true });
  writeFileSync(join(publicDir, 'index.html'), renderIndex(manifest), 'utf8');
  writeFileSync(join(publicDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  for (const item of manifest.items) {
    writeFileSync(join(publicDir, 'p', `${item.id}.html`), renderDetail(item, manifest), 'utf8');
  }

  const embedded = manifest.items.filter((i) =>
    existsSync(join(publicDir, 'demos', i.id, 'index.html'))).length;
  console.log(`content repo : ${contentRoot}`);
  console.log(`items        : ${manifest.items.length}`);
  console.log(`detail pages : ${manifest.items.length}`);
  console.log(`embedded demos: ${embedded}`);
}

main();
