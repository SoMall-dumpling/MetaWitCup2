# MetaWitCup2 · 第二届元见联会

**MetaWitCup2** is a line-drawing puzzle game in the style of *The Witness*, built for the 2nd Meta Witness Cup (元见联会). Draw a continuous path from the start to the exit, satisfy every symbol on the board, and chase the maximum placement score.

**MetaWitCup2** 是一款《见证者》风格的划线解谜游戏，为第二届元见联会而作：从起点连到出口，让题板上的每个符号都得到满足，并追逐最高的放置得分。

## 🎮 直接游玩 / Play Now

🌐 **在线游玩 / Play online**：**[somall-dumpling.github.io/MetaWitCup2](https://somall-dumpling.github.io/MetaWitCup2/)**（GitHub Pages，中英文两个版本任选）

| 版本 / Version | 单文件下载 / Download |
| --- | --- |
| 中文版（默认中文界面） | [MetaWitCup2.html](MetaWitCup2.html) |
| English build (English UI by default) | [MetaWitCup2_en.html](MetaWitCup2_en.html) |

Download a file and double-click to play — no server needed. 下载后双击即可游玩，无需服务器。In-game language can be switched at any time in Settings. 游戏内设置里随时可以切换中英文界面。

## 🧩 玩法 / Gameplay

- **5 chapters, 52 preset puzzles**：Chapters 1–4 plus an extra E chapter. 五章共 52 道预设题：第一至第四章 + E 附加章。
- **Symbols / 符号机制**：polyominoes 骨牌、stars 八角星配对、colored squares 彩色方块、triangles 三角形、dots 六边形点、cancellation (Y) 消除符号等。
- **Scoring / 计分**：each puzzle has a placement score with baseline / target / max-score rules (计分下限 / 计分上限 / 最大分 + 满分奖励). The full-game maximum is **675**. 每题按放置得分计分（基准线、目标分、最大分与满分奖励），全部满分合计 675。

## 🛠️ 编辑器 / Puzzle Editor

Press **`Ctrl+E`**（macOS：`Cmd+E`）to toggle the built-in puzzle workshop: build custom puzzles on a 1–8 grid, set symbols, starts/exits, scoring rules, import/export puzzle JSON or TypeScript literals, and share puzzles via link.

按 **`Ctrl+E`**（macOS 为 `Cmd+E`）打开内置谜题工坊：在 1–8 网格上自制关卡、摆放符号、设置起点出口与计分规则、导入导出 JSON / TS 关卡数据、生成分享链接。

## 🏆 比赛与排名 / Competition & Results

The competition has ended. Scoring rules 计分规则：

- Only puzzles solved within **02:00:00** count; each puzzle scores its in-game placement score. 仅 02:00:00 以内解出的题目计分，每题分 = 存档内置累计分增量（满分 675）。
- Players reaching the full **675** earn a time bonus: +10 per full remaining minute, based on their last scored time before 02:00:00. 内置分达到 675 后按 02:00:00 前最后一次得分的时间，每剩余完整 1 分钟加 10 分。

Final standings 最终排名：[比赛排名.md](比赛排名.md) · [比赛排名.xlsx](比赛排名.xlsx)（82 players 位选手，中文版 72 + 英文版 10）

## 🚀 本地构建 / Build Locally

```bash
npm install       # 安装依赖 / install dependencies
npm run dev       # 本地开发（vite，端口 3000）/ dev server
npm run package   # 构建并内联为单文件 HTML（vite build + inline）
npm run score     # 扫描存档目录并重新生成比赛排名（md + xlsx）
```

The single-file builds are produced at the repository root: `MetaWitCup2.html` (zh default) and `MetaWitCup2_en.html` (en default — flip the default language in `src/utils/i18n.ts` and the `<title>` in `index.html`, then run `npm run package`).

## 制作人员 / Credits

See the in-game Credits page（游戏内设置 → 制作人员）for the full list of directors, developers, puzzle designers, visual designers, and testers.

## License

[Apache-2.0](LICENSE)（源码文件头部均标注 SPDX-License-Identifier: Apache-2.0）
