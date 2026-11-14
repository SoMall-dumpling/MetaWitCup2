/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PuzzleDefinition, Point, normalizePuzzle } from '../types/puzzle';

const STORAGE_KEY = 'witness_custom_puzzles';

export function getCustomPuzzles(): PuzzleDefinition[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: PuzzleDefinition[] = raw ? JSON.parse(raw) : [];
    return list.map(normalizePuzzle);
  } catch (err) {
    console.error('Failed to load custom puzzles', err);
    return [];
  }
}

export function saveCustomPuzzle(puzzle: PuzzleDefinition): PuzzleDefinition[] {
  try {
    const list = getCustomPuzzles();
    const normalized = normalizePuzzle(puzzle);
    const existingIdx = list.findIndex((p) => p.title === puzzle.title);
    let updated: PuzzleDefinition[];

    if (existingIdx >= 0) {
      updated = [...list];
      updated[existingIdx] = normalized;
    } else {
      updated = [normalized, ...list];
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.error('Failed to save puzzle', err);
    return getCustomPuzzles();
  }
}

export function deleteCustomPuzzle(title: string): PuzzleDefinition[] {
  try {
    const list = getCustomPuzzles();
    const updated = list.filter((p) => p.title !== title);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.error('Failed to delete puzzle', err);
    return getCustomPuzzles();
  }
}

// 每题最高分（键为谜题 title，与 custom puzzles 的题号/标题唯一标识一致）
const SCORES_KEY = 'witness_puzzle_scores';

export function getBestScores(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('Failed to load best scores', err);
    return {};
  }
}

/**
 * 若得分刷新了该题的最高分则写入 localStorage，返回更新后的全量记录；
 * 未刷新（得分不高于已有纪录）返回 null，不写盘。
 */
export function saveBestScore(title: string, score: number): Record<string, number> | null {
  if (score < 0) return null;
  try {
    const scores = getBestScores();
    if (score <= (scores[title] ?? -1)) return null;
    scores[title] = score;
    localStorage.setItem(SCORES_KEY, JSON.stringify(scores));
    return scores;
  } catch (err) {
    console.error('Failed to save best score', err);
    return null;
  }
}

/**
 * 该题"拿到最高分"时对应的最终得分：完成计分上限（目标分）或达到最大分时的
 * 原始分 − 基准线 + 满分奖励加分。优先级与计分规则一致：计分上限优先于最大分。
 * 无 maxScore/targetScore 的题返回 null（永不金色）。
 */
export function getPuzzleMaxFinalScore(puzzle: PuzzleDefinition): number | null {
  const base = puzzle.baselineScore ?? 0;
  const extra = puzzle.extraBonus ?? 0;
  if (puzzle.targetScore != null) return puzzle.targetScore - base + extra;
  if (puzzle.maxScore != null) return puzzle.maxScore - base + extra;
  return null;
}

// 已解出（路径合法、题板符号全对）的题目：解锁下一关的依据，无论得分多少
const SOLVED_KEY = 'witness_solved';

export function getSolvedTitles(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SOLVED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to load solved titles', err);
    return [];
  }
}

export function markSolved(title: string): string[] {
  try {
    const list = getSolvedTitles();
    if (!list.includes(title)) {
      list.push(title);
      localStorage.setItem(SOLVED_KEY, JSON.stringify(list));
    }
    return list;
  } catch (err) {
    console.error('Failed to mark solved', err);
    return getSolvedTitles();
  }
}

// 已向玩家揭示"最高分"数值的题目（达到过一次即永久揭示）
const REVEALED_MAX_KEY = 'witness_revealed_max';

export function getRevealedMaxTitles(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(REVEALED_MAX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to load revealed max titles', err);
    return [];
  }
}

export function markMaxRevealed(title: string): string[] {
  try {
    const list = getRevealedMaxTitles();
    if (!list.includes(title)) {
      list.push(title);
      localStorage.setItem(REVEALED_MAX_KEY, JSON.stringify(list));
    }
    return list;
  } catch (err) {
    console.error('Failed to mark max revealed', err);
    return getRevealedMaxTitles();
  }
}

// 每题保存的答案（从起点出发的四方向序列，如 "up,right,up,right"）
const ANSWERS_KEY = 'witness_puzzle_answers';

export function getSavedAnswers(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(ANSWERS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('Failed to load saved answers', err);
    return {};
  }
}

export function saveAnswer(title: string, dirs: string): Record<string, string> {
  try {
    const answers = getSavedAnswers();
    answers[title] = dirs;
    localStorage.setItem(ANSWERS_KEY, JSON.stringify(answers));
    return answers;
  } catch (err) {
    console.error('Failed to save answer', err);
    return getSavedAnswers();
  }
}

const DIR_DELTAS: Record<string, Point> = {
  u: { r: -1, c: 0 },
  d: { r: 1, c: 0 },
  l: { r: 0, c: -1 },
  r: { r: 0, c: 1 },
};

/** 路径 → 方向串（u/d/l/r 紧凑形式）；路径含非法步长时返回空串 */
export function pathToDirections(path: Point[]): string {
  const dirs: string[] = [];
  for (let i = 1; i < path.length; i++) {
    const dr = path[i].r - path[i - 1].r;
    const dc = path[i].c - path[i - 1].c;
    if (dr === -1 && dc === 0) dirs.push('u');
    else if (dr === 1 && dc === 0) dirs.push('d');
    else if (dr === 0 && dc === -1) dirs.push('l');
    else if (dr === 0 && dc === 1) dirs.push('r');
    else return '';
  }
  return dirs.join('');
}

/** 方向串（u/d/l/r）→ 路径（从 start 出发）；方向非法或越出题板时返回空数组 */
export function directionsToPath(
  dirs: string,
  start: Point,
  width: number,
  height: number
): Point[] {
  const path: Point[] = [{ ...start }];
  for (const d of dirs.split('')) {
    const delta = DIR_DELTAS[d];
    if (!delta) return [];
    const last = path[path.length - 1];
    const next = { r: last.r + delta.r, c: last.c + delta.c };
    if (next.r < 0 || next.r > height || next.c < 0 || next.c > width) return [];
    path.push(next);
  }
  return path.length > 1 ? path : [];
}

// Shareable URL Hash
export function encodePuzzleToHash(puzzle: PuzzleDefinition): string {
  try {
    const str = JSON.stringify(puzzle);
    return encodeURIComponent(btoa(unescape(encodeURIComponent(str))));
  } catch {
    return '';
  }
}

export function decodePuzzleFromHash(hash: string): PuzzleDefinition | null {
  try {
    const clean = hash.replace(/^#/, '');
    if (!clean) return null;
    const str = decodeURIComponent(escape(atob(decodeURIComponent(clean))));
    return normalizePuzzle(JSON.parse(str));
  } catch {
    return null;
  }
}

// 比赛计时起点：解出第 0 题的瞬间（毫秒时间戳），只记录首次
const TIMER_START_KEY = 'witness_timer_start';

export function getTimerStartMs(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TIMER_START_KEY);
    const v = raw ? Number(raw) : NaN;
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch (err) {
    console.error('Failed to load timer start', err);
    return null;
  }
}

export function markTimerStart(ms: number): void {
  try {
    if (getTimerStartMs() == null) {
      localStorage.setItem(TIMER_START_KEY, String(ms));
    }
  } catch (err) {
    console.error('Failed to save timer start', err);
  }
}

// 比赛计时终点：总分达到 675 的瞬间（毫秒时间戳），只记录首次
const TIMER_STOP_KEY = 'witness_timer_stop';

export function getTimerStopMs(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TIMER_STOP_KEY);
    const v = raw ? Number(raw) : NaN;
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch (err) {
    console.error('Failed to load timer stop', err);
    return null;
  }
}

export function markTimerStop(ms: number): void {
  try {
    if (getTimerStopMs() == null) {
      localStorage.setItem(TIMER_STOP_KEY, String(ms));
    }
  } catch (err) {
    console.error('Failed to save timer stop', err);
  }
}

// 存档日志：纯文本，在玩家分数变化或解出未解出的题目时追加一条。
// 每条记录：时间戳（按比赛计时器）、谜题、谜题解法、当前分数
const SAVE_LOG_KEY = 'witness_save_log';

export function getSaveLog(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(SAVE_LOG_KEY) ?? '';
  } catch (err) {
    console.error('Failed to load save log', err);
    return '';
  }
}

export function appendSaveEntry(entry: string): void {
  try {
    const prev = getSaveLog();
    localStorage.setItem(SAVE_LOG_KEY, prev ? `${prev}\n${entry}` : entry);
  } catch (err) {
    console.error('Failed to append save entry', err);
  }
}

// 存档校验位：对日志内容做 FNV-1a 32 位哈希（十六进制）。
// 导出时附加在存档末尾，校验时对「校验位」行之前的内容重算即可
export function computeSaveChecksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
