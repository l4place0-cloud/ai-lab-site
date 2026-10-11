# ai-lab-site

**AI Lab 展示站** —— 消费内容仓 [`l4place0/ai-lab`](https://github.com/l4place0/ai-lab) 的 `manifest.json`，生成本站静态页面。

## 定位

展示仓与内容仓**解耦**：本站不复制资产、不写回内容仓。它只做三件事：

1. 读取内容仓的 `manifest.json`（作品清单、评分、交付物类型、入口路径）；
2. 复制**封面缩略图**并内嵌**可交互 demo**（原始素材仍留在内容仓）；
3. 生成横评矩阵与详情页静态站点。

因此内容仓可以独立演进，站点重建只需重跑一次构建。

## 构建

需要本机存在内容仓检出（默认 `../ai-benchmark`）：

```sh
node src/covers.mjs   # 复制封面缩略图到 public/covers/
node src/build.mjs    # 生成 index.html 与 public/p/*.html
```

用其他路径的内容仓：

```sh
CONTENT_REPO=/path/to/ai-lab node src/build.mjs
```

本地预览：

```sh
node src/serve.mjs public 4599
# http://127.0.0.1:4599
```

## 目录

```
src/
  build.mjs    从 manifest 生成站点（矩阵 + 详情页）
  covers.mjs   复制封面缩略图
  serve.mjs    本地静态服务器（仅用于预览）
public/        构建产物，可直接部署
  index.html   横评矩阵 + 全部作品
  p/<id>.html  每个作品的详情页
  covers/      封面缩略图
  demos/<id>/  内嵌的可交互 demo
```

## 内嵌 demo 的规则

只有**真正自包含**的交互物才内嵌。判定标准是实测的，不是猜的：

- 单一 `index.html`，且对 `src`/`href` 的引用不含外部 URL 或同目录兄弟文件；
- 不依赖本地 Node 运行时（如需要 `_dev/*.mjs` 或本地 server 的作品**不内嵌**，只在详情页给出仓库链接）。

`public/demos/<id>/index.html` 存在时，详情页自动渲染 iframe 并提供「全屏打开」；否则显示占位说明，不假装可交互。

## 视频

视频成片统一发布到外部平台，本站不在页面内承载视频文件。详情页预留了 `videoUrl` 字段，登记后即显示外链。

## 评分来源

评分**只取自**各作品 README 中明确写下的结论（如「最终评级：A-」「测试判定：不合格」）。没有明确定论的作品标记为「未评分」，不做推断——这也是横评矩阵里大量「未评分」的原因。
