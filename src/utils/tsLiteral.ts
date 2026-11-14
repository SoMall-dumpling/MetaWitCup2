/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PuzzleDefinition } from '../types/puzzle';

// 单行内联的最大字符数，超过则展开成多行（与 presets/index.ts 的手写风格一致）
const INLINE_MAX_LENGTH = 60;

function quoteString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function keyToString(key: string): string {
  // 合法标识符不加引号，'5,0' 这类坐标键加单引号
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : quoteString(key);
}

function isPrimitive(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean'
  );
}

// 对象的所有值都是原始值时可内联；数组的所有项都可内联时可内联
function isInlineCandidate(v: unknown): boolean {
  if (Array.isArray(v)) return v.every(isInlineCandidate);
  if (v !== null && typeof v === 'object') return Object.values(v).every(isPrimitive);
  return true;
}

function inlineString(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inlineString).join(', ')}]`;
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, val]) => val !== undefined);
    if (entries.length === 0) return '{}';
    return `{ ${entries.map(([k, val]) => `${keyToString(k)}: ${inlineString(val)}`).join(', ')} }`;
  }
  if (typeof v === 'string') return quoteString(v);
  return String(v);
}

function multilineString(v: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  const childPad = '  '.repeat(indent + 1);
  if (Array.isArray(v)) {
    return `[\n${v.map((item) => `${childPad}${renderValue(item, indent + 1)},\n`).join('')}${pad}]`;
  }
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, val]) => val !== undefined);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([k, val]) => `${childPad}${keyToString(k)}: ${renderValue(val, indent + 1)},\n`).join('')}${pad}}`;
  }
  if (typeof v === 'string') return quoteString(v);
  return String(v);
}

function renderValue(v: unknown, indent: number): string {
  if (isInlineCandidate(v)) {
    const inline = inlineString(v);
    if (inline.length <= INLINE_MAX_LENGTH) return inline;
  }
  return multilineString(v, indent);
}

/**
 * 把单个谜题序列化成可直接粘贴进 src/presets/index.ts（PRESET_PUZZLES 数组）的
 * TS 对象字面量：单引号字符串、尾逗号、2 空格缩进，条目自带 2 空格缩进并以逗号结尾。
 */
export function puzzleToTsLiteral(puzzle: PuzzleDefinition, baseIndent = 1): string {
  // 顶层开括号需要自带缩进；嵌套值的开括号跟在键后，无需缩进
  return `${'  '.repeat(baseIndent)}${renderValue(puzzle, baseIndent)},`;
}

/**
 * 把多个谜题序列化成 PRESET_PUZZLES 数组片段（带首尾方括号），可直接整体粘贴进 index.ts。
 */
export function puzzlesToTsLiteral(puzzles: PuzzleDefinition[]): string {
  return `[\n${puzzles.map((p) => puzzleToTsLiteral(p, 1)).join('\n')}\n]`;
}
