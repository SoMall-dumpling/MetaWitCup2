/**
 * 把根目录的单文件成品同步到 docs/（GitHub Pages 发布目录）：
 * - 中文版 → docs/index.html（Pages 根路径直达游戏，无落地页）
 * - 英文版 → docs/MetaWitCup2_en.html
 *
 * 用法：npm run sync-docs
 * 注意：重新打包后记得跑一次；英文版构建后先复制出 MetaWitCup2_en.html 再同步。
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'docs');
mkdirSync(docs, { recursive: true });

const pairs = [
  ['MetaWitCup2.html', 'index.html'],
  ['MetaWitCup2_en.html', 'MetaWitCup2_en.html'],
];
for (const [src, dst] of pairs) {
  const from = join(root, src);
  if (!existsSync(from)) {
    console.error(`缺少 ${from}，请先运行 npm run package`);
    process.exit(1);
  }
  copyFileSync(from, join(docs, dst));
  console.log(`已同步 docs/${dst}（来自 ${src}）`);
}
