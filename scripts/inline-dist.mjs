/**
 * 构建后处理：把 dist/index.html 内联为单个 HTML 文件（JS + CSS 全部嵌入），
 * 生成可双击直接游玩、无需任何服务器的单文件版本。
 *
 * 用法：npm run package  （= vite build && node scripts/inline-dist.mjs）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const indexHtml = join(distDir, 'index.html');

if (!existsSync(indexHtml)) {
  console.error('dist/index.html 不存在，请先运行 vite build');
  process.exit(1);
}

let html = readFileSync(indexHtml, 'utf8');

// 内联 JS（type="module" 的内联脚本在 file:// 下可以正常执行）
html = html.replace(/<script[^>]*src="([^"]+\.js)"[^>]*><\/script>/, (tag, src) => {
  const file = join(distDir, src.replace(/^\.?\//, ''));
  if (!existsSync(file)) {
    console.error(`找不到脚本文件: ${file}`);
    process.exit(1);
  }
  const code = readFileSync(file, 'utf8').replace(/<\/script>/g, '<\\/script>');
  return `<script type="module">${code}</script>`;
});

// 内联 CSS
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/, (tag, href) => {
  const file = join(distDir, href.replace(/^\.?\//, ''));
  if (!existsSync(file)) {
    console.error(`找不到样式文件: ${file}`);
    process.exit(1);
  }
  const css = readFileSync(file, 'utf8').replace(/<\/style>/g, '<\\/style>');
  return `<style>${css}</style>`;
});

// 移除可能残留的 modulepreload 引用
html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '');

const outFile = join(root, 'MetaWitCup2.html');
writeFileSync(outFile, html, 'utf8');
console.log(`已生成单文件版本: ${outFile} (${(html.length / 1024).toFixed(0)} KB)`);
