/**
 * 比赛计分脚本（元见联会第二届）。
 *
 * 计分规则（已与主办确认）：
 * - 每题分 = 存档尾随累计分的增量（游戏内置计分，总满分 675）；
 *   仅 02:00:00（两小时）以内解出的题目计入。
 * - 时间加分 = 内置分达到 675 后才有：按 02:00:00 前最后一次得分的时间，
 *   每剩余完整 1 分钟加 10 分（超过 02:00:00 的题不计分，按超时前最后一题算）。
 * - 昵称 = 存档文件名（去 .save）。中/英两个文件夹理论上不会出现同一玩家。
 *
 * 用法：node scripts/competition-score.mjs（或 npm run score）
 * 输出：终端打印三张排名表，并写入 ../比赛排名.md
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = [
  { key: 'zh', label: '中文版', dir: join(root, 'MetaWitCup2Saves') },
  { key: 'en', label: '英文版', dir: join(root, 'MetaWitCup2Saves_en') },
];

const DEADLINE_S = 2 * 60 * 60; // 02:00:00
const CHAPTERS = ['ch1', 'ch2', 'ch3', 'ch4', 'chE'];

function fnv1a32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function chapterOf(puzzle) {
  const c = puzzle[0];
  if (c >= '1' && c <= '4') return 'ch' + c;
  if (c === 'E') return 'chE';
  return null;
}

function parseSave(content, source) {
  const lines = content.trimEnd().split('\n');
  let logLines = lines;
  let expectedHash = null;

  const lastLine = lines[lines.length - 1];
  if (/^校验位: [0-9a-f]{8}$/.test(lastLine)) {
    expectedHash = lastLine.split(': ')[1];
    logLines = lines.slice(0, -1);
  } else {
    console.warn(`[警告] ${source} 没有校验位行`);
  }
  const log = logLines.join('\n');
  const actual = fnv1a32(log);
  if (expectedHash == null) {
    /* 已警告 */
  } else if (actual === expectedHash) {
    console.log(`[校验通过] ${source}`);
  } else {
    console.warn(`[警告] ${source} 校验位不匹配：期望 ${expectedHash}，实际 ${actual}`);
  }

  const scores = { ch1: 0, ch2: 0, ch3: 0, ch4: 0, chE: 0 };
  let prevCum = 0;
  let finishS = 0;
  let solved = 0;

  for (const raw of logLines) {
    const line = raw.trim();
    if (line === '') continue;
    const m = /^\[(\d{2}):(\d{2}):(\d{2})\]\s+(\S+)\s+([uldr]+)\s+(-?\d+)$/.exec(line);
    if (!m) {
      console.warn(`[警告] ${source} 无法解析的行: ${line}`);
      continue;
    }
    const [, hh, mm, ss, puzzle, , cumStr] = m;
    const t = Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
    const cum = Number(cumStr);

    // 累计分增量先于超时过滤更新：时间戳单调递增，超时后的行不会再回头计分
    const delta = cum - prevCum;
    prevCum = cum;
    if (delta < 0) {
      console.warn(`[警告] ${source} 累计分回退: ${line}`);
    }
    if (t > DEADLINE_S) continue; // 超过 02:00:00 的题目不计入

    finishS = Math.max(finishS, t);
    if (puzzle === '0') continue; // 第 0 题：只起计时作用，不计章
    const ch = chapterOf(puzzle);
    if (!ch) {
      console.warn(`[警告] ${source} 未知章节: ${puzzle}`);
      continue;
    }
    solved++;
    if (delta > 0) scores[ch] += delta;
  }

  // 内置分（各章合计）达到满分 675 才有时间加分；
  // 按 02:00:00 前最后一次得分的时间计算（finishS 只累计 2 小时内的行）
  const base = CHAPTERS.reduce((s, c) => s + scores[c], 0);
  const timeBonus = base >= 675 ? Math.floor((DEADLINE_S - finishS) / 60) * 10 : 0;
  return { scores, timeBonus, finishS, solved };
}

function fmtClock(s) {
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function renderTable(rows) {
  const head = [
    '排名', '昵称', '第一章得分', '第二章得分', '第三章得分', '第四章得分', '第E章得分', '时间加分', '总得分',
  ];
  const out = [];
  out.push('| ' + head.join(' | ') + ' |');
  out.push('|' + head.map(() => ' --- ').join('|') + '|');
  rows.forEach((p, i) => {
    out.push(
      `| ${i + 1} | ${p.nick} | ${p.scores.ch1} | ${p.scores.ch2} | ${p.scores.ch3} | ${p.scores.ch4} | ${p.scores.chE} | ${p.timeBonus} | ${p.total} |`
    );
  });
  return out.join('\n');
}

function rank(rows) {
  return rows
    .slice()
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.timeBonus - a.timeBonus ||
        a.nick.localeCompare(b.nick)
    );
}

function main() {
  const players = [];
  for (const { key, label, dir } of DIRS) {
    if (!existsSync(dir)) {
      console.warn(`[警告] 目录不存在: ${dir}`);
      continue;
    }
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.save')) continue;
      const content = readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n');
      const nick = f.slice(0, -'.save'.length);
      const res = parseSave(content, `${label}/${f}`);
      res.total = CHAPTERS.reduce((s, c) => s + res.scores[c], 0) + res.timeBonus;
      players.push({ nick, group: key, label, ...res });
    }
  }

  // 中/英两个文件夹理论上不会出现同一昵称，出现则报警
  const seen = new Map();
  for (const p of players) {
    if (seen.has(p.nick)) {
      console.warn(`[警告] 昵称「${p.nick}」同时出现在 ${seen.get(p.nick)} 和 ${p.label}！`);
    }
    seen.set(p.nick, p.label);
  }

  const zh = rank(players.filter((p) => p.group === 'zh'));
  const en = rank(players.filter((p) => p.group === 'en'));
  const all = rank(players);

  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  const md = [
    `# MetaWitCup2 比赛排名（生成于 ${now}）`,
    '',
    '计分规则：仅 02:00:00 以内解出的题目计入（每题分 = 存档内置累计分增量，总满分 675）；',
    '内置分达到 675 才有时间加分：按 02:00:00 前最后一次得分的时间，每剩余完整 1 分钟加 10 分。',
    '',
    '## 表一：仅中文版存档（MetaWitCup2Saves）',
    '',
    renderTable(zh),
    '',
    '## 表二：仅英文版存档（MetaWitCup2Saves_en）',
    '',
    renderTable(en),
    '',
    '## 表三：全体排名（两文件夹合并）',
    '',
    renderTable(all),
    '',
    '明细（完成时间 / 2小时内解出题数）：',
    '',
    ...all.map(
      (p) => `- ${p.nick}：完成时间 ${fmtClock(p.finishS)}，2小时内记录 ${p.solved} 条（${p.label}）`
    ),
    '',
  ].join('\n');

  const outFile = join(root, '比赛排名.md');
  writeFileSync(outFile, md, 'utf8');
  console.log(`\n已写入: ${outFile}`);

  // 导出 xlsx（依赖 python + openpyxl；失败不阻断 md 输出）
  const toRows = (rows) =>
    rows.map((p, i) => ({
      rank: i + 1,
      nick: p.nick,
      scores: p.scores,
      timeBonus: p.timeBonus,
      total: p.total,
    }));
  const payload = JSON.stringify({ zh: toRows(zh), en: toRows(en), all: toRows(all) });
  const xlsxFile = join(root, '比赛排名.xlsx');
  const pyScript = join(root, 'scripts', 'render-xlsx.py');
  let res = spawnSync('python', [pyScript, xlsxFile], { input: payload, encoding: 'utf8' });
  if (res.error || res.status !== 0) {
    res = spawnSync('py', [pyScript, xlsxFile], { input: payload, encoding: 'utf8' });
  }
  if (!res.error && res.status === 0) {
    console.log((res.stdout || '').trim() || `已写入: ${xlsxFile}`);
  } else {
    console.warn(
      `[警告] xlsx 生成失败（需要 python + openpyxl）：${(res.stderr || res.error?.message || '').trim()}`
    );
  }
  console.log('');
  console.log(md);
}

main();
