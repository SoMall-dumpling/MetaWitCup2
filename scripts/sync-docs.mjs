/**
 * 把根目录的中英单文件成品同步到 docs/（GitHub Pages 发布目录）。
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

for (const f of ['MetaWitCup2.html', 'MetaWitCup2_en.html']) {
  const src = join(root, f);
  if (!existsSync(src)) {
    console.error(`缺少 ${src}，请先运行 npm run package`);
    process.exit(1);
  }
  copyFileSync(src, join(docs, f));
}
console.log('已同步 docs/（MetaWitCup2.html、MetaWitCup2_en.html）');
