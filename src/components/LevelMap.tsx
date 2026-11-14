/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { PuzzleDefinition, Point, edgeKey } from '../types/puzzle';
import { PuzzleSymbol, HexagonDot } from './PuzzleSymbol';
import { getPuzzleMaxFinalScore, directionsToPath } from '../utils/storage';
import { t, useLang } from '../utils/i18n';
import { useTheme, getBoardPalette } from '../utils/theme';

// —— 地图布局 ——
// 第 0 关在最左上角；竖线自第 0 关与 1-1 之间缝隙的中点向下延伸，各章（含第一章）
// 的行都自竖线向右接一段缝隙后连接本章第一关，1-1 与 2-1 保持同一竖直线。
// 章内按分组排列：组内方块紧贴（无缝隙），组与组之间留缝并露出连接线段。
const NODE = 112; // 关卡方块边长
const GAP = 64; // 组间缝隙（也是行距缝隙与竖线到第一关的接缝长度）
const MARGIN = 72; // 地图内容边距（左/下）
const TOP_MARGIN = 140; // 地图上边距：加宽以避开左上角按钮与计时器
const RIGHT_MARGIN = 224; // 地图右边界外延：给最后一列留出更宽的空白
const THUMB_PAD = 8; // 方块内缩略图内边距
const AND_SQ = 44; // 与门「&」方块边长

// 顶行 y 与第 0 关中心 x
const ROW0_Y = TOP_MARGIN + NODE / 2;
const L0_X = MARGIN + NODE / 2;
// 竖线 x：第 0 关右边缘与 1-1 左边缘缝隙的中点（此时 1-1 与 2-1 同竖直线）
const SPINE_X = MARGIN + NODE + NODE / 2 + GAP;
// 行中心距（垂直缝隙与水平缝隙一致）
const ROW = NODE + GAP;

// —— E 附加区 ——
// E-x-y：附加关卡行。通关全部主线末关（1-13 / 2-9 / 3-9 / 4-9）后解锁
// 所有 E-x-1；同行的后续关卡按顺序依次解锁（E-x-y 需先通关 E-x-(y-1)）。
// 地图上四章行末关各向右引一条输入线汇成一条竖线（与门结构），
// 再从竖线中部引出输出线，分叉到各 E 行
const MAIN_END_TITLES = ['1-13', '2-9', '3-9', '4-9'];
const EXTRA_RE = /^E-(\d+)-(\d+)$/;

// 滚轮缩放限制
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;

/** 平移 + 缩放后的边界钳制：内容至少保留 MARGIN·zoom 的边距，不拖出视野。
 * 上边距用 TOP_MARGIN（避开左上角按钮与计时器）。
 * 右/下边界放宽：允许内容一直拖到视口中心对准其最右/最下边缘，
 * 使右侧（E 区）题目也能被拖到视觉中心 */
function clampView(
  v: { x: number; y: number; zoom: number },
  mapW: number,
  mapH: number
) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const contentW = mapW * v.zoom;
  const contentH = mapH * v.zoom;
  const m = MARGIN * v.zoom;
  const mt = TOP_MARGIN * v.zoom;
  const minX = contentW > vw ? vw / 2 - contentW + m : 0;
  const minY = contentH > vh ? vh / 2 - contentH + mt : 0;
  return {
    zoom: v.zoom,
    x: Math.min(m, Math.max(minX, v.x)),
    y: Math.min(mt, Math.max(minY, v.y)),
  };
}

// —— 缩略图绘制参数（与题板同一套比例）——
const CELL = 80;
const LINE = 18;
const TPAD = 40;
const START_R = 22;
const END_R = 9;
const END_STEM = 16;

// 关卡状态配色：与得分条一致 —— 达成（琥珀）/ 已得分（白）/ 0 分（灰）
type NodeState = 'perfect' | 'progress' | 'none';

const STATE_STYLE: Record<NodeState, { stroke: string; text: string }> = {
  perfect: { stroke: '#fbbf24', text: '#fbbf24' },
  progress: { stroke: 'rgba(248, 250, 252, 0.9)', text: '#f1f5f9' },
  none: { stroke: '#64748b', text: '#64748b' },
};

// 亮色主题下的关卡状态配色：近白色的「已得分」边框/文字在浅色方块上看不清，
// 改为深色；0 分（与得分条「低于下限」一致）更浅；
// 完美通关保持与暗色模式一致的琥珀黄
const LIGHT_STATE_STYLE: Record<NodeState, { stroke: string; text: string }> = {
  perfect: { stroke: '#fbbf24', text: '#fbbf24' },
  progress: { stroke: '#1e293b', text: '#0f172a' },
  none: { stroke: '#94a3b8', text: '#94a3b8' },
};

// 未解锁关卡：暗灰边框，只显示锁图标，不显示缩略图与得分
const LOCKED_STYLE = { stroke: '#334155', text: '#334155' };
// 亮色主题：未解锁边框改淡色（与锁图标、0 分边框一致）
const LIGHT_LOCKED_STYLE = { stroke: '#94a3b8', text: '#94a3b8' };

/** 解锁判定：第 0 关始终解锁；C-1 需完成第 0 关；C-N 需完成 C-(N-1)；
 *  E-x-1 需完成全部主线末关；E-x-y (y>1) 需完成 E-x-(y-1)；自制关卡不设锁 */
function isUnlocked(title: string, solved: Set<string>): boolean {
  if (title === '0') return true;
  const m = /^(\d+)-(\d+)$/.exec(title);
  if (m) {
    const ch = Number(m[1]);
    const n = Number(m[2]);
    if (n === 1) return solved.has('0');
    return solved.has(`${ch}-${n - 1}`);
  }
  const e = EXTRA_RE.exec(title);
  if (e) {
    if (e[2] === '1') return MAIN_END_TITLES.every((t) => solved.has(t));
    return solved.has(`E-${e[1]}-${Number(e[2]) - 1}`);
  }
  return true;
}

function nodeState(p: PuzzleDefinition, best: number | undefined): NodeState {
  if (best == null) return 'none';
  const maxFinal = getPuzzleMaxFinalScore(p);
  if (maxFinal != null && best >= maxFinal) return 'perfect';
  return best > 0 ? 'progress' : 'none';
}

function scoreLabel(best: number | undefined): string {
  const v = best ?? 0;
  return `${v} pt${v === 1 ? '' : 's'}`;
}

/** 关卡分组：title '0' → 第 0 关；'C-N' → 第 C 章第 N 题（按 N 升序）；
 *  'E-x-y' → 第 E-x 附加行第 y 题（按 y 升序） */
function groupChapters(puzzles: PuzzleDefinition[]) {
  const ch0 = puzzles.find((p) => p.title === '0') ?? null;
  const rows = new Map<number, PuzzleDefinition[]>();
  const extraRows = new Map<string, PuzzleDefinition[]>();
  for (const p of puzzles) {
    const m = /^(\d+)-(\d+)$/.exec(p.title);
    if (m) {
      const ch = Number(m[1]);
      if (!rows.has(ch)) rows.set(ch, []);
      rows.get(ch)!.push(p);
      continue;
    }
    const e = EXTRA_RE.exec(p.title);
    if (e) {
      const key = `E-${e[1]}`;
      if (!extraRows.has(key)) extraRows.set(key, []);
      extraRows.get(key)!.push(p);
    }
  }
  const chapters = [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ch, list]) => ({
      ch,
      puzzles: list.sort(
        (a, b) => Number(a.title.split('-')[1]) - Number(b.title.split('-')[1])
      ),
    }));
  const extras = [...extraRows.entries()]
    .sort((a, b) => Number(a[0].slice(2)) - Number(b[0].slice(2)))
    .map(([key, list]) => ({
      key,
      puzzles: list.sort(
        (a, b) => Number(a.title.split('-')[2]) - Number(b.title.split('-')[2])
      ),
    }));
  return { ch0, chapters, extras };
}

// 每章的关卡分组（题号「-」后的数字）：组内方块紧贴，组间留缝连线段
const CHAPTER_GROUPS: Record<number, number[][]> = {
  1: [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12, 13]],
  2: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
  3: [[1], [2, 3, 4], [5, 6, 7], [8, 9]],
  4: [[1, 2], [3, 4], [5, 6], [7, 8], [9]],
};

/** 把一章的题按分组表切分；分组表未覆盖的题逐个自成一组兜底 */
function chapterGroups(ch: number, puzzles: PuzzleDefinition[]): PuzzleDefinition[][] {
  const def = CHAPTER_GROUPS[ch];
  if (!def) return puzzles.length > 0 ? [puzzles] : [];
  const result: PuzzleDefinition[][] = [];
  const used = new Set<string>();
  for (const idxs of def) {
    const group = idxs
      .map((n) => puzzles.find((p) => Number(p.title.split('-')[1]) === n))
      .filter((p): p is PuzzleDefinition => p != null);
    if (group.length > 0) {
      result.push(group);
      group.forEach((p) => used.add(p.title));
    }
  }
  for (const p of puzzles) {
    if (!used.has(p.title)) result.push([p]);
  }
  return result;
}

/** 题板缩略图：只画题板本身（网格线、缺口、起终点、六边形点、格内符号）+ 最高分解法路径，不含外部符号 */
const BoardThumbnail: React.FC<{ puzzle: PuzzleDefinition; path: Point[] }> = ({ puzzle, path }) => {
  const theme = useTheme();
  const pal = getBoardPalette(theme);
  const W = puzzle.width;
  const H = puzzle.height;
  const broken = useMemo(() => new Set(puzzle.brokenEdges), [puzzle.brokenEdges]);
  const vx = (p: Point) => ({ x: TPAD + p.c * CELL, y: TPAD + p.r * CELL });
  const cc = (p: Point) => ({ x: TPAD + p.c * CELL + CELL / 2, y: TPAD + p.r * CELL + CELL / 2 });

  // 最高分解法路径：琥珀色线 + 起点圆染色，终点向出口方向延伸一小段
  const pathD = useMemo(() => {
    if (path.length < 2) return '';
    let d = path.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${vx(pt).x} ${vx(pt).y}`).join(' ');
    const last = path[path.length - 1];
    const endInfo = puzzle.ends.find((e) => e.r === last.r && e.c === last.c);
    if (endInfo) {
      const ext = vx(last);
      if (endInfo.dir === 'up') ext.y -= END_STEM;
      else if (endInfo.dir === 'down') ext.y += END_STEM;
      else if (endInfo.dir === 'left') ext.x -= END_STEM;
      else ext.x += END_STEM;
      d += ` L ${ext.x} ${ext.y}`;
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, puzzle.ends]);

  return (
    <>
      {/* 题板底板 */}
      <rect
        x={TPAD - 24}
        y={TPAD - 24}
        width={W * CELL + 48}
        height={H * CELL + 48}
        rx={20}
        fill={pal.bg}
        stroke={pal.bd}
        strokeWidth={4}
      />

      {/* 水平网格线（阻断缺口从中间断开） */}
      {Array.from({ length: H + 1 }).map((_, r) =>
        Array.from({ length: W }).map((_, c) => {
          const a = vx({ r, c });
          const b = vx({ r, c: c + 1 });
          const key = edgeKey({ r, c }, { r, c: c + 1 });
          if (broken.has(key)) {
            const midX = (a.x + b.x) / 2;
            return (
              <g key={key}>
                <line x1={a.x} y1={a.y} x2={midX - 11} y2={a.y} stroke={pal.grid} strokeWidth={LINE} strokeLinecap="butt" />
                <line x1={midX + 11} y1={a.y} x2={b.x} y2={a.y} stroke={pal.grid} strokeWidth={LINE} strokeLinecap="butt" />
              </g>
            );
          }
          return (
            <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={pal.grid} strokeWidth={LINE} strokeLinecap="round" />
          );
        })
      )}

      {/* 垂直网格线（阻断缺口从中间断开） */}
      {Array.from({ length: H }).map((_, r) =>
        Array.from({ length: W + 1 }).map((_, c) => {
          const a = vx({ r, c });
          const b = vx({ r: r + 1, c });
          const key = edgeKey({ r, c }, { r: r + 1, c });
          if (broken.has(key)) {
            const midY = (a.y + b.y) / 2;
            return (
              <g key={key}>
                <line x1={a.x} y1={a.y} x2={a.x} y2={midY - 11} stroke={pal.grid} strokeWidth={LINE} strokeLinecap="butt" />
                <line x1={a.x} y1={midY + 11} x2={a.x} y2={b.y} stroke={pal.grid} strokeWidth={LINE} strokeLinecap="butt" />
              </g>
            );
          }
          return (
            <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={pal.grid} strokeWidth={LINE} strokeLinecap="round" />
          );
        })
      )}

      {/* 出口半圆 + 外延段 */}
      {puzzle.ends.map((end, idx) => {
        const coords = vx(end);
        const R = END_R;
        let cx = coords.x;
        let cy = coords.y;
        if (end.dir === 'up') cy -= END_STEM;
        else if (end.dir === 'down') cy += END_STEM;
        else if (end.dir === 'left') cx -= END_STEM;
        else cx += END_STEM;

        let d = '';
        if (end.dir === 'up') d = `M ${cx - R} ${cy} A ${R} ${R} 0 0 0 ${cx + R} ${cy} Z`;
        else if (end.dir === 'down') d = `M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy} Z`;
        else if (end.dir === 'left') d = `M ${cx} ${cy - R} A ${R} ${R} 0 0 0 ${cx} ${cy + R} Z`;
        else d = `M ${cx} ${cy - R} A ${R} ${R} 0 0 1 ${cx} ${cy + R} Z`;

        return (
          <g key={`exit-${idx}`}>
            <line x1={coords.x} y1={coords.y} x2={cx} y2={cy} stroke={pal.grid} strokeWidth={LINE} strokeLinecap="round" />
            <path d={d} fill={pal.grid} />
          </g>
        );
      })}

      {/* 起点圆 */}
      {puzzle.starts.map((s, idx) => {
        const c = vx(s);
        return <circle key={`start-${idx}`} cx={c.x} cy={c.y} r={START_R} fill={pal.grid} />;
      })}

      {/* 边 / 顶点六边形点 */}
      {Object.entries(puzzle.edgeDots).map(([key, col]) => {
        const [p1Key, p2Key] = key.split('-');
        const [r1, c1] = p1Key.split(',').map(Number);
        const [r2, c2] = p2Key.split(',').map(Number);
        const a = vx({ r: r1, c: c1 });
        const b = vx({ r: r2, c: c2 });
        return (
          <HexagonDot
            key={`edot-${key}`}
            cx={(a.x + b.x) / 2}
            cy={(a.y + b.y) / 2}
            radius={7}
            color={col === 'cyan' ? '#06b6d4' : col === 'yellow' ? '#eab308' : '#0f172a'}
          />
        );
      })}
      {Object.entries(puzzle.vertexDots).map(([key, col]) => {
        const [r, c] = key.split(',').map(Number);
        const p = vx({ r, c });
        return (
          <HexagonDot
            key={`vdot-${key}`}
            cx={p.x}
            cy={p.y}
            radius={7}
            color={col === 'cyan' ? '#06b6d4' : col === 'yellow' ? '#eab308' : '#0f172a'}
          />
        );
      })}

      {/* 最高分解法路径（画在格内符号之前，与题板渲染顺序一致） */}
      {pathD && (
        <g>
          <path d={pathD} fill="none" stroke="#facc15" strokeWidth={LINE} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={vx(path[0]).x} cy={vx(path[0]).y} r={START_R} fill="#facc15" />
        </g>
      )}

      {/* 格内符号 */}
      {Object.entries(puzzle.cellSymbols).map(([key, sym]) => {
        const [r, c] = key.split(',').map(Number);
        const p = cc({ r, c });
        return <PuzzleSymbol key={key} symbol={sym} cx={p.x} cy={p.y} size={CELL} />;
      })}
    </>
  );
};

// 与门方块：黄色边框内写 &。上半/下半分别对应一对章节的两关——
// 对应章节通关后该半填黄；两半都亮即整块点亮
const AndGate: React.FC<{ x: number; y: number; litTop: boolean; litBottom: boolean }> = ({
  x,
  y,
  litTop,
  litBottom,
}) => {
  const theme = useTheme();
  // 底板：与关卡方块一致的底色（亮色模式适配）
  const tile = theme === 'light' ? '#e2e8f0' : '#0f172a';
  const lit = litTop || litBottom;
  // 边框/& 符号：前置全未满足时用未激活线的灰色，满足任一前置后变黄
  const accent = lit ? '#facc15' : theme === 'light' ? '#94a3b8' : '#475569';
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      {/* 底板 */}
      <rect x={-AND_SQ / 2} y={-AND_SQ / 2} width={AND_SQ} height={AND_SQ} fill={tile} />
      {/* 上半 / 下半：对应章节通关后填黄（直角）。
          两半都亮时画一整块，避免两个矩形在共享边 y=0 处抗锯齿透出细缝 */}
      {litTop && litBottom ? (
        <rect x={-AND_SQ / 2} y={-AND_SQ / 2} width={AND_SQ} height={AND_SQ} fill="#facc15" />
      ) : (
        <>
          <rect
            x={-AND_SQ / 2}
            y={-AND_SQ / 2}
            width={AND_SQ}
            height={AND_SQ / 2}
            fill={litTop ? '#facc15' : 'transparent'}
          />
          <rect
            x={-AND_SQ / 2}
            y={0}
            width={AND_SQ}
            height={AND_SQ / 2}
            fill={litBottom ? '#facc15' : 'transparent'}
          />
        </>
      )}
      {/* 边框（直角）：未满足任一前置时灰色，点亮后黄色 */}
      <rect
        x={-AND_SQ / 2}
        y={-AND_SQ / 2}
        width={AND_SQ}
        height={AND_SQ}
        fill="none"
        stroke={accent}
        strokeWidth={3.5}
      />
      {/* & 符号：点亮时黄字深描边（黄底/深底上都清晰）；未点亮时仅灰色描边（空心，与底板同色） */}
      <text
        x={0}
        y={0}
        dy={-1}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={24}
        fontWeight={900}
        fill={lit ? '#facc15' : tile}
        stroke={lit ? '#0f172a' : accent}
        strokeWidth={3}
        paintOrder="stroke"
      >
        {'&'}
      </text>
    </g>
  );
};

// —— 三角斜接帽辅助（E-9 组合图标三角用）：——
// 每条边拆成两个独立填充多边形：1) 全宽矩形（两端平切，宽度恒定）；
// 2) 顶点斜接帽四边形 [本边外角点, 斜接尖 tip, 邻边外角点, 顶点 v2]——
//    60° 角处向外延伸出斜接尖角，与邻边外边界完美贴合、无缺角无台阶。
// 注意：形心必须在原点（外侧法向按背离原点判定）。
type Pt = { x: number; y: number };
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const unit = (a: Pt): Pt => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
const perp = (a: Pt): Pt => ({ x: -a.y, y: a.x });

// 顶点 v 处方向 u 的边的外侧法向（背离形心）
const outerNormal = (v: Pt, u: Pt): Pt => {
  const n = perp(u);
  return n.x * v.x + n.y * v.y < 0 ? mul(n, -1) : n;
};

// 线段 v1→v2（宽 sw）拆成两个独立填充多边形：
// 全宽矩形 + 斜接帽四边形（otherV 提供时，在 v2 处与 v2→otherV 边斜接）
const miterSeg = (v1: Pt, v2: Pt, otherV: Pt | null, sw: number, color: string): React.ReactNode => {
  const w = sw / 2;
  const u = unit(sub(v2, v1));
  const n = outerNormal(v2, u);
  const fmt = (ps: Pt[]) => ps.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const rect = fmt([add(v1, mul(n, w)), sub(v1, mul(n, w)), sub(v2, mul(n, w)), add(v2, mul(n, w))]);
  let wedge: string | undefined;
  if (otherV) {
    const n2 = outerNormal(v2, unit(sub(otherV, v2)));
    const denom = 1 + (n.x * n2.x + n.y * n2.y);
    const tip = Math.abs(denom) > 1e-6 ? add(v2, mul(add(n, n2), w / denom)) : v2;
    wedge = fmt([add(v2, mul(n, w)), tip, add(v2, mul(n2, w)), v2]);
  }
  return (
    <g>
      <polygon points={rect} fill={color} stroke="none" />
      {wedge && <polygon points={wedge} fill={color} stroke="none" />}
    </g>
  );
};

// 章节图标：1 S 形分隔灰白圆 / 2 橙色八角星 / 3 田字 / 4 红色中空三角。
// 位于竖线与本章第一关之间的右上方，不压住地图线条；本章全部通关后点亮（机制色）
const ChapterIcon: React.FC<{ ch: number; lit: boolean; x: number; y: number; size?: number }> = ({
  ch,
  lit,
  x,
  y,
  size = 56,
}) => {
  // 亮色主题：原白色线条/填充改深色，否则在浅色地图上看不见
  const theme = useTheme();
  const light = theme === 'light' ? '#0f172a' : '#f8fafc';
  const S = size;
  const R = S / 2;
  const gray = '#475569';
  const orange = '#f97316';
  let shape: React.ReactNode;
  if (ch === 1) {
    if (!lit) {
      // 未点亮：灰色圆环
      shape = <circle r={R} />;
    } else {
      // 点亮：仅外周线条——左半弧灰、右半弧白，上下各留 10° 缺口（每弧 160°）。
      // 每侧弧线自己的两端用一条 S 形线连起来（左灰、右白），
      // 两条 S 形朝向一致（上方都向右鼓、下方都向左鼓）。
      // 与 E-1 图标一致：弧与 S 线合并为一条闭合路径，斜接角——
      // 四个相接处呈尖锐角
      const t = (10 * Math.PI) / 180;
      const px = R * Math.sin(t);
      const py = R * Math.cos(t);
      const w = R * 0.25;
      shape = (
        <g fill="none" strokeWidth={4.5} strokeLinejoin="miter">
          {/* 左半弧（160°，下方起经左侧到上方）+ 左侧 S 线闭合 */}
          <path
            d={`M ${-px},${py} A ${R} ${R} 0 0 1 ${-px},${-py} C ${-px + w},${-py * 0.35} ${-px - w},${py * 0.35} ${-px},${py} Z`}
            stroke="#64748b"
          />
          {/* 右半弧（160°，上方起经右侧到下方）+ 右侧 S 线闭合 */}
          <path
            d={`M ${px},${-py} A ${R} ${R} 0 0 1 ${px},${py} C ${px - w},${py * 0.35} ${px + w},${-py * 0.35} ${px},${-py} Z`}
            stroke={light}
          />
        </g>
      );
    }
  } else if (ch === 2) {
    // 八角星：16 顶点内外交替（与题板八角星符号同比例），仅保留外圈描边
    const pts: string[] = [];
    const rOuter = R;
    const rInner = R * (0.17 / 0.26);
    for (let i = 0; i < 16; i++) {
      const angle = (i * Math.PI) / 8 - Math.PI / 2;
      const r = i % 2 === 0 ? rOuter : rInner;
      pts.push(`${(r * Math.cos(angle)).toFixed(1)},${(r * Math.sin(angle)).toFixed(1)}`);
    }
    // 孤单的八角星（无交织），直接斜接尖角
    shape = <polygon points={pts.join(' ')} strokeLinejoin="miter" />;
  } else if (ch === 3) {
    // 田字画小一些（后续与其他图标嵌套用）
    const r3 = R * 0.7;
    shape = (
      <g>
        <rect x={-r3} y={-r3} width={r3 * 2} height={r3 * 2} strokeLinejoin="miter" />
        <line x1={0} y1={-r3} x2={0} y2={r3} />
        <line x1={-r3} y1={0} x2={r3} y2={0} />
      </g>
    );
  } else {
    // 中空三角：普通描边，斜接角（覆盖外层 strokeLinejoin="round"）
    const pts = `0,${-R} ${(-R * 0.866).toFixed(1)},${(R * 0.5).toFixed(1)} ${(R * 0.866).toFixed(1)},${(R * 0.5).toFixed(1)}`;
    shape = <polygon points={pts} strokeLinejoin="miter" />;
  }
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      <g
        fill="none"
        stroke={lit ? (ch === 1 ? light : ch === 3 ? '#facc15' : ch === 4 ? '#ef4444' : orange) : gray}
        strokeWidth={4.5}
        strokeLinejoin="round"
      >
        {shape}
      </g>
    </g>
  );
};

// E-10 组合图标（原 E-9）：第三章「田字」+ 第四章「中空三角」叠放（80px）。
// 编织分层（自底向顶）：田字竖中线 → 三角左斜边下段 → 田字左边 →
// 三角底边 → 田字右边 → 田字横中线右半 → 三角右斜边 → 田字顶边 →
// 三角左斜边上段 → 田字横中线左半 → 田字底边。
// 横中线在中点断开成左右两半：左半压在三角左斜边之上、右半垫在
// 三角右斜边之下，满足两侧相反的分层要求。
// 三角边使用「斜接帽」填充多边形辅助（见上方 miterSeg）。
const CombinedIcon: React.FC<{ x: number; y: number; lit: boolean }> = ({ x, y, lit }) => {
  const R = 40; // 三角外接半径（size 80）
  const r3 = R * 0.7; // 田字半宽（与 ChapterIcon 的 70% 一致）
  const gray = '#475569';
  const triColor = lit ? '#ef4444' : gray;
  const tianColor = lit ? '#facc15' : gray;
  const sw = 4.5;

  const triTop = { x: 0, y: -R };
  const triBL = { x: -R * 0.866, y: R * 0.5 };
  const triBR = { x: R * 0.866, y: R * 0.5 };
  // 左斜边与田字水平中线的交点（上下两段的分界点）
  const split = { x: -R * 0.866 * (2 / 3), y: 0 };

  const triPiece = (v1: Pt, v2: Pt, otherV: Pt | null) => miterSeg(v1, v2, otherV, sw, triColor);

  const tianLine = (x1: number, y1: number, x2: number, y2: number) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={tianColor} strokeWidth={sw} strokeLinecap="square" />
  );

  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      {/* 田字竖中线（最底层） */}
      {tianLine(0, -r3, 0, r3)}
      {/* 三角左斜边下段（在田字左边之下，两端平切） */}
      {triPiece(split, triBL, null)}
      {/* 田字左边 */}
      {tianLine(-r3, -r3, -r3, r3)}
      {/* 三角底边（在田字左边之上、田字右边之下；左下角带斜接帽） */}
      {triPiece(triBR, triBL, split)}
      {/* 田字右边 */}
      {tianLine(r3, -r3, r3, r3)}
      {/* 田字横中线右半（垫在三角右斜边之下） */}
      {tianLine(0, 0, r3, 0)}
      {/* 三角右斜边（在田字右边之上、田字顶边之下、横中线右半之上；右下角带斜接帽） */}
      {triPiece(triTop, triBR, triBL)}
      {/* 田字顶边 */}
      {tianLine(-r3, -r3, r3, -r3)}
      {/* 三角左斜边上段（在田字顶边之上；顶点带斜接帽） */}
      {triPiece(split, triTop, triBR)}
      {/* 田字横中线左半（压在三角左斜边之上） */}
      {tianLine(-r3, 0, 0, 0)}
      {/* 田字底边（无交叉，顶层） */}
      {tianLine(-r3, r3, r3, r3)}
    </g>
  );
};

// E-1-1 图标：Pepsi 式 S 形分隔圆——左半「灰包白」、右半「白包黑」。
// 填充层与描边层分开绘制：先铺两片填充，再画完整描边，
// 线条不被填充盖住（描边层在后，完整线宽可见）
const E1Icon: React.FC<{ x: number; y: number }> = ({ x, y }) => {
  const theme = useTheme();
  const light = theme === 'light' ? '#0f172a' : '#f8fafc';
  const R = 40;
  const sw = 4.5;
  const t = (10 * Math.PI) / 180;
  const px = R * Math.sin(t);
  const py = R * Math.cos(t);
  const w = R * 0.25;

  const leftPath = `M ${-px},${py} A ${R} ${R} 0 0 1 ${-px},${-py} C ${-px + w},${-py * 0.35} ${-px - w},${py * 0.35} ${-px},${py} Z`;
  const rightPath = `M ${px},${-py} A ${R} ${R} 0 0 1 ${px},${py} C ${px - w},${py * 0.35} ${px + w},${-py * 0.35} ${px},${-py} Z`;

  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      {/* 填充层：左白、右灰（右侧后画，交错处灰压白） */}
      <path d={leftPath} fill={light} />
      <path d={rightPath} fill="#64748b" />
      {/* 描边层：左灰包白、右白包黑（后画，线条完整可见） */}
      <path d={leftPath} fill="none" stroke="#64748b" strokeWidth={sw} />
      <path d={rightPath} fill="none" stroke={light} strokeWidth={sw} />
    </g>
  );
};

// E-2-1 图标：八角星外轮廓 + 内圈八边形（橙色描边）
const E2Icon: React.FC<{ x: number; y: number }> = ({ x, y }) => {
  const R = 40;
  const rOuter = R;
  const rInner = R * (0.17 / 0.26);
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 16; i++) {
    const angle = (i * Math.PI) / 8 - Math.PI / 2;
    const r = i % 2 === 0 ? rOuter : rInner;
    pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
  }
  const innerPts: string[] = [];
  for (let i = 1; i < 16; i += 2) innerPts.push(`${pts[i].x.toFixed(2)},${pts[i].y.toFixed(2)}`);
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      {/* 星形外轮廓（与第二章八角星一致的 4.5px 描边） */}
      <polygon
        points={pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}
        fill="none"
        stroke="#f97316"
        strokeWidth={4.5}
        strokeLinejoin="round"
      />
      {/* 内圈八边形（优角顶点相连）：橙色描边 */}
      <polygon
        points={innerPts.join(' ')}
        fill="none"
        stroke="#f97316"
        strokeWidth={4.5}
        strokeLinejoin="round"
      />
    </g>
  );
};

// E-3 图标：Pepsi（S 形分隔圆，描边版，85%）+ 八角星交织。
// 八角星拆成 16 条线段，隔一条在上/下：偶数段在 Pepsi 之上、奇数段在之下
const E3Icon: React.FC<{ x: number; y: number }> = ({ x, y }) => {
  const theme = useTheme();
  const light = theme === 'light' ? '#0f172a' : '#f8fafc';
  const R = 40;
  const sw = 4.5;
  // Pepsi：左灰右白 160° 弧 + 各自闭合的 S 线（整体缩小）
  const pR = R * 0.85;
  const t = (10 * Math.PI) / 180;
  const px = pR * Math.sin(t);
  const py = pR * Math.cos(t);
  const w = pR * 0.25;
  // 八角星（与第二章图标同几何），拆成 16 条线段
  const rInner = R * (0.17 / 0.26);
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 16; i++) {
    const angle = (i * Math.PI) / 8 - Math.PI / 2;
    const r = i % 2 === 0 ? R : rInner;
    pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
  }
  const segs: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (let i = 0; i < 16; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 16];
    segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  const starLine = (s: { x1: number; y1: number; x2: number; y2: number }, i: number) => (
    <line
      key={i}
      x1={s.x1}
      y1={s.y1}
      x2={s.x2}
      y2={s.y2}
      stroke="#f97316"
      strokeWidth={sw}
      strokeLinecap="round"
    />
  );
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      {/* 星形下层：奇数段（Pepsi 之下） */}
      {segs.map((s, i) => (i % 2 === 1 ? starLine(s, i) : null))}
      {/* Pepsi（中层） */}
      <g fill="none" strokeWidth={sw} strokeLinecap="round">
        <path d={`M ${-px},${py} A ${pR} ${pR} 0 0 1 ${-px},${-py}`} stroke="#64748b" />
        <path d={`M ${px},${-py} A ${pR} ${pR} 0 0 1 ${px},${py}`} stroke={light} />
        <path
          d={`M ${-px},${-py} C ${-px + w},${-py * 0.35} ${-px - w},${py * 0.35} ${-px},${py}`}
          stroke="#64748b"
        />
        <path
          d={`M ${px},${-py} C ${px + w},${-py * 0.35} ${px - w},${py * 0.35} ${px},${py}`}
          stroke={light}
        />
      </g>
      {/* 星形上层：偶数段（Pepsi 之上） */}
      {segs.map((s, i) => (i % 2 === 0 ? starLine(s, i) : null))}
    </g>
  );
};

// E-4-1 图标：照搬第三章田字（黄色外框+十字），四个窗口涂成蓝色
// （黄框蓝窗，呼应题目「黄骨牌 + 蓝镂空」）
const E4Icon: React.FC<{ x: number; y: number }> = ({ x, y }) => {
  const R = 40;
  const r3 = R * 0.7;
  const sw = 4.5;
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      {/* 四个窗口：蓝色填充 */}
      <rect x={-r3} y={-r3} width={r3} height={r3} fill="#3b82f6" />
      <rect x={0} y={-r3} width={r3} height={r3} fill="#3b82f6" />
      <rect x={-r3} y={0} width={r3} height={r3} fill="#3b82f6" />
      <rect x={0} y={0} width={r3} height={r3} fill="#3b82f6" />
      {/* 田字外框 + 十字（黄色描边） */}
      <g fill="none" stroke="#facc15" strokeWidth={sw}>
        <rect x={-r3} y={-r3} width={r3 * 2} height={r3 * 2} />
        <line x1={0} y1={-r3} x2={0} y2={r3} />
        <line x1={-r3} y1={0} x2={r3} y2={0} />
      </g>
    </g>
  );
};

// E-5-1 图标（新）：Pepsi（描边版，左灰右白）与第三章「田字」叠放，整体 90%——
// 田字（82%，黄色描边）与 Pepsi 编织，左右半边的上下关系相反。
// 左半边（用户指定）：对左弧 0 下、7 上、6 下、5 上；对左 S 0 上、5 下。
//   左 S 在下层、左弧在上层，0 整画夹在中间；5 画在 x=−0.425R 拆开：
//   5a 外段在左弧之上、5b 内段在左 S 之下。
// 右半边（用户指定）：对右 S 1 下、9 下、4 上；对右弧 1 上、2 下、3 上、4 下。
//   右弧在下层、右 S 在上层，1 整画夹在中间；4 画在 x=0.325R 拆开：
//   4a 外段在右弧之下、4b 内段在右 S 之上；2 在右弧之下、3 在右弧之上、9 在右 S 之下。
// 其余（8 横中左、10 竖中上、11 竖中下）暂在 Pepsi 之上，待指定。
const PepsiTianIcon: React.FC<{ x: number; y: number }> = ({ x, y }) => {
  const theme = useTheme();
  const light = theme === 'light' ? '#0f172a' : '#f8fafc';
  const R = 36; // 整体 90%（其余 E 行图标为 40）
  const sw = 4.5;
  // Pepsi：左灰右白 160° 弧 + 各自闭合的 S 线
  const pR = R;
  const t = (10 * Math.PI) / 180;
  const px = pR * Math.sin(t);
  const py = pR * Math.cos(t);
  const w = pR * 0.25;
  // 田字（与旧 E-5 图标一致：82% 大小）
  const r3 = R * 0.82;
  // 5/4 画（底边左右半）拆开点：介于弧交点与 S 交点之间（按 R 比例，各向中心再移 2px）
  const split5X = R * -0.425 + 2;
  const split4X = R * 0.325 - 2;
  const tian = (x1: number, y1: number, x2: number, y2: number) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#facc15" strokeWidth={sw} strokeLinecap="square" />
  );
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      {/* 田字下下层（弧/S 之下）：6 左边下半、5b 底左内段、2 右上、4a 底右外段 */}
      <g fill="none">
        {tian(-r3, 0, -r3, r3)}
        {tian(split5X, r3, 0, r3)}
        {tian(r3, -r3, r3, 0)}
        {tian(split4X, r3, r3, r3)}
      </g>
      {/* Pepsi 下层：左 S（灰）、右弧（白） */}
      <g fill="none" strokeWidth={sw} strokeLinecap="round">
        <path
          d={`M ${-px},${-py} C ${-px + w},${-py * 0.35} ${-px - w},${py * 0.35} ${-px},${py}`}
          stroke="#64748b"
        />
        <path d={`M ${px},${-py} A ${pR} ${pR} 0 0 1 ${px},${py}`} stroke={light} />
      </g>
      {/* 田字中层（左 S/右弧之上、左弧/右 S 之下）：0 顶左、1 顶右、9 横中右 */}
      <g fill="none">
        {tian(-r3, -r3, 0, -r3)}
        {tian(0, -r3, r3, -r3)}
        {tian(0, 0, r3, 0)}
      </g>
      {/* Pepsi 上层：左弧（灰）、右 S（白） */}
      <g fill="none" strokeWidth={sw} strokeLinecap="round">
        <path d={`M ${-px},${py} A ${pR} ${pR} 0 0 1 ${-px},${-py}`} stroke="#64748b" />
        <path
          d={`M ${px},${-py} C ${px + w},${-py * 0.35} ${px - w},${py * 0.35} ${px},${py}`}
          stroke={light}
        />
      </g>
      {/* 田字上层（Pepsi 之上）：7 左边上半、5a 底左外段、3 右下、4b 底右内段、
          8 横中左、10 竖中上、11 竖中下 */}
      <g fill="none">
        {tian(-r3, -r3, -r3, 0)}
        {tian(-r3, r3, split5X, r3)}
        {tian(r3, 0, r3, r3)}
        {tian(0, r3, split4X, r3)}
        {tian(-r3, 0, 0, 0)}
        {tian(0, -r3, 0, 0)}
        {tian(0, 0, 0, r3)}
      </g>
    </g>
  );
};

// E-7-1 图标（原 E-6-1）：沿用第四章三角（尖朝上），中间一个较小的倒三角（边长 1/2），红色
const E6Icon: React.FC<{ x: number; y: number }> = ({ x, y }) => {
  const R = 40;
  const sw = 4.5;
  const outer = `0,${-R} ${(-R * 0.866).toFixed(2)},${(R * 0.5).toFixed(2)} ${(R * 0.866).toFixed(2)},${(R * 0.5).toFixed(2)}`;
  // 倒三角：边长 = 外三角边长的一半 = R·√3/2，形心与原点重合
  const s2 = R * 0.866;
  const inner = `${(-s2 / 2).toFixed(2)},${(-(s2 * Math.sqrt(3)) / 6).toFixed(2)} ${(s2 / 2).toFixed(2)},${(-(s2 * Math.sqrt(3)) / 6).toFixed(2)} 0,${((s2 * Math.sqrt(3)) / 3).toFixed(2)}`;
  return (
    <g
      transform={`translate(${x} ${y})`}
      pointerEvents="none"
      fill="none"
      stroke="#ef4444"
      strokeWidth={sw}
      strokeLinejoin="miter"
    >
      <polygon points={outer} />
      {/* 内倒三角：圆角（miter 尖角会向外凸出） */}
      <polygon points={inner} strokeLinejoin="round" />
    </g>
  );
};

// E-6-1 图标（原 E-5-1）：八角星与第三章「田字」交织——
// 星拆成 16 条线段隔一上下（奇数段在田字之下、偶数段在田字之上），田字在中层
const E5Icon: React.FC<{ x: number; y: number }> = ({ x, y }) => {
  const R = 40;
  const sw = 4.5;
  // 星：16 顶点（与第二章八角星同几何）
  const rInner = R * (0.17 / 0.26);
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 16; i++) {
    const angle = (i * Math.PI) / 8 - Math.PI / 2;
    const r = i % 2 === 0 ? R : rInner;
    pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
  }
  const segs: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (let i = 0; i < 16; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 16];
    segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  const starLine = (s: { x1: number; y1: number; x2: number; y2: number }, i: number) => (
    <line
      key={i}
      x1={s.x1}
      y1={s.y1}
      x2={s.x2}
      y2={s.y2}
      stroke="#f97316"
      strokeWidth={sw}
      strokeLinecap="round"
    />
  );
  // 田字（比第三章图标略大：82% 大小，黄色描边）
  const r3 = R * 0.82;
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      {/* 星形下层：奇数段（田字之下） */}
      {segs.map((s, i) => (i % 2 === 1 ? starLine(s, i) : null))}
      {/* 田字（中层） */}
      <g fill="none" stroke="#facc15" strokeWidth={sw} strokeLinecap="square">
        <rect x={-r3} y={-r3} width={r3 * 2} height={r3 * 2} />
        <line x1={0} y1={-r3} x2={0} y2={r3} />
        <line x1={-r3} y1={0} x2={r3} y2={0} />
      </g>
      {/* 星形上层：偶数段（田字之上） */}
      {segs.map((s, i) => (i % 2 === 0 ? starLine(s, i) : null))}
    </g>
  );
};

// E-9-1 图标（原 E-8-1）：八角星与第四章「中空三角」交织——
// 星拆成 16 条线段隔一上下（奇数段在三角之下、偶数段在三角之上），三角在中层
const E8Icon: React.FC<{ x: number; y: number }> = ({ x, y }) => {
  const R = 35.2; // 星外接半径（整体放大 10%）
  const Rtri = 45.54; // 三角外接半径（同步放大，比例不变）
  const sw = 4.5;
  // 星：16 顶点（与第二章八角星同几何）
  const rInner = R * (0.17 / 0.26);
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 16; i++) {
    const angle = (i * Math.PI) / 8 - Math.PI / 2;
    const r = i % 2 === 0 ? R : rInner;
    pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
  }
  const segs: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (let i = 0; i < 16; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 16];
    segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  const starLine = (s: { x1: number; y1: number; x2: number; y2: number }, i: number) => (
    <line
      key={i}
      x1={s.x1}
      y1={s.y1}
      x2={s.x2}
      y2={s.y2}
      stroke="#f97316"
      strokeWidth={sw}
      strokeLinecap="round"
    />
  );
  // 每条边与三角的上下关系（自 12 点方向顺时针，共 16 条边）：
  // 无所谓处不穿过三角，归入下层
  const edgeZ: Array<'up' | 'down'> = [
    'down', // 0 无所谓
    'down', // 1 下
    'up', // 2 上
    'up', // 3 上
    'down', // 4 下
    'up', // 5 上
    'up', // 6 上
    'up', // 7 上
    'down', // 8 下
    'down', // 9 下
    'down', // 10 下
    'up', // 11 上
    'down', // 12 下
    'down', // 13 下
    'up', // 14 上
    'down', // 15 无所谓
  ];
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      {/* 星形下层（三角之下） */}
      {segs.map((s, i) => (edgeZ[i] === 'down' ? starLine(s, i) : null))}
      {/* 中空三角（中层，红色描边斜接角，比星略大） */}
      <polygon
        points={`0,${-Rtri} ${(-Rtri * 0.866).toFixed(2)},${(Rtri * 0.5).toFixed(2)} ${(Rtri * 0.866).toFixed(2)},${(Rtri * 0.5).toFixed(2)}`}
        fill="none"
        stroke="#ef4444"
        strokeWidth={sw}
        strokeLinejoin="miter"
      />
      {/* 星形上层（三角之上） */}
      {segs.map((s, i) => (edgeZ[i] === 'up' ? starLine(s, i) : null))}
    </g>
  );
};

// E-8-1 图标（原 E-7-1）：红色中空三角与 Pepsi（灰白 S 分隔圆）交织。
// 左右对称、上下关系相反：
//   左半边：左斜边在左 S 之上、左弧之下；底边左半在左 S 之下、左弧之上。
//   右半边：右斜边在右 S 之下、右弧之上；底边右半在右 S 之上、右弧之下。
// 左 S/右弧在下层、左弧/右 S 在上层；左右斜边（各拆两半）夹在中间；
// 底边拆成四段：左内段（左 S 下）、右外段（右弧下）、左外段（左弧上）、右内段（右 S 上）。
// 三角边用与 E-9 同款的「斜接帽」填充边（miterSeg）。
const E7Icon: React.FC<{ x: number; y: number }> = ({ x, y }) => {
  const theme = useTheme();
  const light = theme === 'light' ? '#0f172a' : '#f8fafc';
  const R = 40;
  const sw = 4.5;
  // Pepsi（85%）
  const pR = R * 0.85;
  const t = (10 * Math.PI) / 180;
  const px = pR * Math.sin(t);
  const py = pR * Math.cos(t);
  const w = pR * 0.25;
  // 三角（尖朝上）
  const T = { x: 0, y: -R };
  const BL = { x: -R * 0.866, y: R * 0.5 };
  const BR = { x: R * 0.866, y: R * 0.5 };
  // 底边左半拆点（介于左弧交点 x≈−25.9 与左 S 交点 x≈−3.8 之间）
  const splitX = -15;
  // 左斜边中点（把左斜边拆成上下两半：上半含左 S 交点、下半含左弧交点）
  const M = { x: -R * 0.433, y: -R * 0.25 };
  // 右半拆点/中点（与左半对称）
  const splitXr = 15;
  const Mr = { x: R * 0.433, y: -R * 0.25 };
  // 拼缝重叠量：相邻段各多伸 0.75px，消除填充多边形抗锯齿细缝
  const ov = 0.75;
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      {/* 三角下层（+2）：底边左内段（左 S 之下）、底边右外段（右弧之下） */}
      <g transform="translate(0, 2)">
        {miterSeg({ x: splitX - ov, y: BL.y }, { x: ov, y: BL.y }, null, sw, '#ef4444')}
        {miterSeg({ x: splitXr - ov, y: BR.y }, BR, null, sw, '#ef4444')}
      </g>
      {/* Pepsi 下层（−2）：左 S（灰）、右弧（白） */}
      <g transform="translate(0, -2)" fill="none" strokeWidth={sw} strokeLinecap="round">
        <path
          d={`M ${-px},${-py} C ${-px + w},${-py * 0.35} ${-px - w},${py * 0.35} ${-px},${py}`}
          stroke="#64748b"
        />
        <path d={`M ${px},${-py} A ${pR} ${pR} 0 0 1 ${px},${py}`} stroke={light} />
      </g>
      {/* 三角中层（+2）：左右斜边各上下两半（夹在 Pepsi 上下层之间） */}
      <g transform="translate(0, 2)">
        {miterSeg({ x: M.x - ov * 0.5, y: M.y + ov * 0.866 }, T, BR, sw, '#ef4444')}
        {miterSeg({ x: M.x + ov * 0.5, y: M.y - ov * 0.866 }, BL, BR, sw, '#ef4444')}
        {miterSeg(T, { x: Mr.x + ov * 0.5, y: Mr.y + ov * 0.866 }, null, sw, '#ef4444')}
        {miterSeg({ x: Mr.x - ov * 0.5, y: Mr.y - ov * 0.866 }, BR, BL, sw, '#ef4444')}
      </g>
      {/* Pepsi 上层（−2）：左弧（灰）、右 S（白） */}
      <g transform="translate(0, -2)" fill="none" strokeWidth={sw} strokeLinecap="round">
        <path d={`M ${-px},${py} A ${pR} ${pR} 0 0 1 ${-px},${-py}`} stroke="#64748b" />
        <path
          d={`M ${px},${-py} C ${px + w},${-py * 0.35} ${px - w},${py * 0.35} ${px},${py}`}
          stroke={light}
        />
      </g>
      {/* 三角上层（+2）：底边左外段（左弧之上）、底边右内段（右 S 之上） */}
      <g transform="translate(0, 2)">
        {miterSeg(BL, { x: splitX + ov, y: BL.y }, null, sw, '#ef4444')}
        {miterSeg({ x: -ov, y: BR.y }, { x: splitXr + ov, y: BR.y }, null, sw, '#ef4444')}
      </g>
    </g>
  );
};

interface LevelMapProps {
  puzzles: PuzzleDefinition[];
  bestScores: Record<string, number>;
  savedAnswers: Record<string, string>;
  solvedTitles: string[];
  onSelect: (p: PuzzleDefinition) => void;
  onClose: () => void;
  focusTitle?: string; // 打开地图时视觉中心对准的关卡
  onOpenSettings: () => void;
  escDisabled?: boolean; // 设置界面打开时禁用本层的 Esc 关闭
}

export const LevelMap: React.FC<LevelMapProps> = ({
  puzzles,
  bestScores,
  savedAnswers,
  solvedTitles,
  onSelect,
  onClose,
  focusTitle,
  onOpenSettings,
  escDisabled = false,
}) => {
  useLang(); // 语言切换时重渲染（总分标签等文案）
  const theme = useTheme(); // 主题切换时重渲染（方块底板、状态边框配色）
  // 关卡方块底板色（玩家优化版方案）
  const wtTile = theme === 'light' ? '#e2e8f0' : '#0f172a';
  const { ch0, chapters, extras } = useMemo(() => groupChapters(puzzles), [puzzles]);

  // —— E 附加区几何（与门结构）——
  // 1&2 / 3&4 章配对竖线 x → 最终与门汇流竖线 x → E 区总线 x
  const extraLayout = useMemo(() => {
    const endEdges: number[] = [];
    chapters.forEach((row) => {
      let left = SPINE_X + NODE / 2 + GAP;
      for (const group of chapterGroups(row.ch, row.puzzles)) {
        left += group.length * NODE + GAP;
      }
      endEdges.push(left - GAP); // 本章行末关右边缘
    });
    const pairX = Math.max(...endEdges) + GAP;
    const andX = pairX + AND_SQ + GAP;
    const spineX = andX + AND_SQ + GAP;
    return { endEdges, pairX, andX, spineX };
  }, [chapters]);

  // 节点坐标：第 0 关在顶行最左；各章（含第一章）的行都自竖线向右接一段
  // 缝隙后开始排列（首关左边缘对齐，1-1 与 2-1 同竖直线）；组内方块紧贴、组间留缝
  const nodes = useMemo(() => {
    const list: Array<{ p: PuzzleDefinition; x: number; y: number }> = [];
    if (ch0) list.push({ p: ch0, x: L0_X, y: ROW0_Y });
    chapters.forEach((row, i) => {
      const y = ROW0_Y + i * ROW;
      let left = SPINE_X + NODE / 2 + GAP;
      for (const group of chapterGroups(row.ch, row.puzzles)) {
        for (const p of group) {
          list.push({ p, x: left + NODE / 2, y });
          left += NODE; // 组内紧贴
        }
        left += GAP; // 组间留缝
      }
    });
    // E 附加行：行 y 与主线章节行对齐；行内关卡间留缝（顺序解锁），与 segments 一致。
    // 首关与左边竖线的距离和主线各章一致（NODE/2 + GAP），留出的空隙放章节符号
    extras.forEach((row, i) => {
      const y = ROW0_Y + i * ROW;
      let left = extraLayout.spineX + NODE / 2 + GAP;
      for (const p of row.puzzles) {
        list.push({ p, x: left + NODE / 2, y });
        left += NODE + GAP;
      }
    });
    return list;
  }, [ch0, chapters, extras, extraLayout]);

  const mapW = Math.max(L0_X, ...nodes.map((n) => n.x)) + NODE / 2 + RIGHT_MARGIN;
  const mapH = Math.max(ROW0_Y, ...nodes.map((n) => n.y)) + NODE / 2 + MARGIN;

  // 方块中心位置集合（用于判断紧贴共边）
  const posSet = useMemo(() => new Set(nodes.map((n) => `${n.x},${n.y}`)), [nodes]);

  // 已解出题目集合（解锁判定用）
  const solvedSet = useMemo(() => new Set(solvedTitles), [solvedTitles]);

  // 连接线段：完成「need」中全部关卡后该段变黄（已接通）。第 0 关 → 各章第一关
  // （顶线缝隙 + 竖线分段 + 行首接缝）；章内组间缝隙（完成前一组最后一关后点亮）。
  // 组内紧贴处无线条，无需分段。E 区与门结构见下方「—— E 附加区与门结构 ——」
  const segments = useMemo(() => {
    const segs: Array<{ x1: number; y1: number; x2: number; y2: number; need: string[] }> = [];
    chapters.forEach((row, i) => {
      const y = ROW0_Y + i * ROW;
      const groups = chapterGroups(row.ch, row.puzzles);
      let left = SPINE_X + NODE / 2 + GAP; // 本章第一关的左边缘 x
      if (i === 0 && ch0) {
        // 第 0 关 → 1-1：顶线缝隙（竖线分叉点在其中点）
        segs.push({ x1: L0_X + NODE / 2, y1: y, x2: left, y2: y, need: ['0'] });
      } else {
        // 竖线 → 本章第一关左边缘的行首接缝
        segs.push({ x1: SPINE_X, y1: y, x2: left, y2: y, need: ['0'] });
      }
      for (let g = 0; g < groups.length - 1; g++) {
        const group = groups[g];
        const rightEdge = left + group.length * NODE; // 本组右边缘
        segs.push({
          x1: rightEdge,
          y1: y,
          x2: rightEdge + GAP,
          y2: y,
          need: [group[group.length - 1].title],
        });
        left = rightEdge + GAP;
      }
    });
    // 竖线分段（完成第 0 关后全部点亮）。
    // 顶端/底端（伸进空白的自由端）各收回半线宽 5px：square 线帽填回后
    // 与顶线/行线平齐、不外凸；其余拐角保持原样由线帽互相覆盖
    for (let i = 0; i < chapters.length - 1; i++) {
      segs.push({
        x1: SPINE_X,
        y1: ROW0_Y + i * ROW + (i === 0 ? 5 : 0),
        x2: SPINE_X,
        y2: ROW0_Y + (i + 1) * ROW - (i === chapters.length - 2 ? 5 : 0),
        need: ['0'],
      });
    }

    // —— E 附加区与门结构 ——
    // 1&2 章、3&4 章各用竖线相连，竖线中点放红色「&」方块；两个「&」方块
    // 向右汇入最终红色「&」方块（1&2 与 3&4 的中点高度），再向右连 E 区总线。
    // 输入线随各章行末关点亮；配对竖线/方块两关全通点亮；最终汇流需四关全通
    if (extras.length > 0) {
      const { endEdges, pairX, andX, spineX } = extraLayout;
      const topY = ROW0_Y;
      const bottomY = ROW0_Y + (chapters.length - 1) * ROW;
      const lastEY = topY + (extras.length - 1) * ROW;
      const yOf = (i: number) => ROW0_Y + i * ROW;
      const sy1 = (yOf(0) + yOf(1)) / 2; // 1&2 章与门方块 y（两行之间）
      const sy2 = (yOf(2) + yOf(3)) / 2; // 3&4 章与门方块 y
      const my = (sy1 + sy2) / 2; // 最终与门方块 y

      // 输入线：各章行末关右边缘 → 配对竖线（随该关通关点亮）
      chapters.forEach((row, i) => {
        segs.push({
          x1: endEdges[i],
          y1: yOf(i),
          x2: pairX,
          y2: yOf(i),
          need: [row.puzzles[row.puzzles.length - 1].title],
        });
      });

      // 配对竖线：1&2、3&4 —— 按方块中心拆成上下两段，
      // 上半段随第 a 章通关点亮、下半段随第 b 章通关点亮（与方块半块填充一致）
      for (const [a, b] of [
        [0, 1],
        [2, 3],
      ] as const) {
        if (a >= chapters.length || b >= chapters.length) continue;
        const mid = (yOf(a) + yOf(b)) / 2;
        segs.push({
          x1: pairX,
          y1: yOf(a),
          x2: pairX,
          y2: mid,
          need: [chapters[a].puzzles[chapters[a].puzzles.length - 1].title],
        });
        segs.push({
          x1: pairX,
          y1: mid,
          x2: pairX,
          y2: yOf(b),
          need: [chapters[b].puzzles[chapters[b].puzzles.length - 1].title],
        });
      }

      // 两个「&」方块 → 最终汇流竖线
      if (chapters.length >= 2) {
        segs.push({
          x1: pairX,
          y1: sy1,
          x2: andX,
          y2: sy1,
          need: [
            chapters[0].puzzles[chapters[0].puzzles.length - 1].title,
            chapters[1].puzzles[chapters[1].puzzles.length - 1].title,
          ],
        });
      }
      if (chapters.length >= 4) {
        segs.push({
          x1: pairX,
          y1: sy2,
          x2: andX,
          y2: sy2,
          need: [
            chapters[2].puzzles[chapters[2].puzzles.length - 1].title,
            chapters[3].puzzles[chapters[3].puzzles.length - 1].title,
          ],
        });
      }

      // 汇流竖线：按最终方块中心拆成上下两段，上半随 1&2 两章全通点亮、
      // 下半随 3&4 两章全通点亮（与最终方块半块填充一致）
      if (chapters.length >= 2) {
        segs.push({
          x1: andX,
          y1: sy1,
          x2: andX,
          y2: my,
          need: [
            chapters[0].puzzles[chapters[0].puzzles.length - 1].title,
            chapters[1].puzzles[chapters[1].puzzles.length - 1].title,
          ],
        });
      }
      if (chapters.length >= 4) {
        segs.push({
          x1: andX,
          y1: my,
          x2: andX,
          y2: sy2,
          need: [
            chapters[2].puzzles[chapters[2].puzzles.length - 1].title,
            chapters[3].puzzles[chapters[3].puzzles.length - 1].title,
          ],
        });
      }
      // 输出线 + E 区总线：四关全通才点亮
      segs.push({ x1: andX, y1: my, x2: spineX, y2: my, need: MAIN_END_TITLES });
      // E 区总线：顶端/底端各收回半线宽 5px（自由端不外凸）
      segs.push({
        x1: spineX,
        y1: topY + 5,
        x2: spineX,
        y2: Math.max(bottomY, lastEY) - 5,
        need: MAIN_END_TITLES,
      });

      // 各 E 行：总线接缝（四关全通点亮，长度与主线各章行首接缝一致 NODE/2 + GAP）
      // + 行内关卡间缝隙（顺序解锁）
      extras.forEach((row, i) => {
        const y = topY + i * ROW;
        segs.push({
          x1: spineX,
          y1: y,
          x2: spineX + NODE / 2 + GAP,
          y2: y,
          need: MAIN_END_TITLES,
        });
        let left = spineX + NODE / 2 + GAP;
        for (let idx = 0; idx < row.puzzles.length; idx++) {
          if (idx > 0) {
            segs.push({
              x1: left,
              y1: y,
              x2: left + GAP,
              y2: y,
              need: [row.puzzles[idx - 1].title],
            });
            left += GAP;
          }
          left += NODE;
        }
      });
    }
    return segs;
  }, [ch0, chapters, extras, extraLayout]);

  // 与门方块（黄色 &）：1&2、3&4 两个方块各分上下半，分别对应一对章节的两关；
  // 最终汇流方块四关全通整块点亮
  const andGates = useMemo(() => {
    if (extras.length === 0)
      return [] as Array<{ x: number; y: number; litTop: boolean; litBottom: boolean }>;
    const { pairX, andX } = extraLayout;
    const yOf = (i: number) => ROW0_Y + i * ROW;
    const sy1 = (yOf(0) + yOf(1)) / 2;
    const sy2 = (yOf(2) + yOf(3)) / 2;
    const my = (sy1 + sy2) / 2;
    const endSolved = (i: number) => {
      const title = chapters[i]?.puzzles[chapters[i].puzzles.length - 1]?.title ?? '';
      return solvedSet.has(title);
    };
    const gates: Array<{ x: number; y: number; litTop: boolean; litBottom: boolean }> = [];
    if (chapters.length >= 2) {
      gates.push({ x: pairX, y: sy1, litTop: endSolved(0), litBottom: endSolved(1) });
    }
    if (chapters.length >= 4) {
      gates.push({ x: pairX, y: sy2, litTop: endSolved(2), litBottom: endSolved(3) });
    }
    // 最终汇流方块：上半随 1&2 两章全通点亮、下半随 3&4 两章全通点亮
    const pair1Done = chapters.length >= 2 && endSolved(0) && endSolved(1);
    const pair2Done = chapters.length >= 4 && endSolved(2) && endSolved(3);
    gates.push({ x: andX, y: my, litTop: pair1Done, litBottom: pair2Done });
    return gates;
  }, [extras.length, chapters, extraLayout, solvedSet]);

  // —— 拖动平移 + 滚轮缩放 ——
  // 位移超过 5px 视为拖动（此时忽略关卡点击）；滚轮以光标为中心缩放（带限制）
  // 打开地图时视觉中心对准 focusTitle 对应的关卡（找不到则回到左上角）
  const [view, setView] = useState(() => {
    const focusNode = nodes.find((n) => n.p.title === focusTitle);
    if (!focusNode) return { x: MARGIN, y: TOP_MARGIN, zoom: 1 };
    return clampView(
      {
        x: window.innerWidth / 2 - focusNode.x,
        y: window.innerHeight / 2 - focusNode.y,
        zoom: 1,
      },
      mapW,
      mapH
    );
  });
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const movedRef = useRef(false);
  // 双指捏合缩放：活跃触点集合 + 上一次两指间距/中点
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; mx: number; my: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // 仅第一个触点开启平移记录；第二根手指不重置拖拽状态
    if (pointersRef.current.size === 0) {
      dragRef.current = { sx: e.clientX, sy: e.clientY, px: view.x, py: view.y };
      movedRef.current = false;
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pointersRef.current;
      if (!p.has(e.pointerId)) return;
      p.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // 双指捏合缩放：以两指中点为锚，缩放前后锚点下的地图坐标不变（与滚轮同款公式）
      if (p.size >= 2) {
        dragRef.current = null; // 捏合开始后放弃本段平移
        movedRef.current = true; // 松手时避免误触节点点击
        const [a, b] = [...p.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        if (pinchRef.current) {
          const ratio = dist / pinchRef.current.dist;
          setView((prev) => {
            const nextZoom = Math.min(
              MAX_ZOOM,
              Math.max(MIN_ZOOM, prev.zoom * ratio)
            );
            if (nextZoom === prev.zoom) return prev;
            const ax = (mx - prev.x) / prev.zoom;
            const ay = (my - prev.y) / prev.zoom;
            return clampView(
              { zoom: nextZoom, x: mx - ax * nextZoom, y: my - ay * nextZoom },
              mapW,
              mapH
            );
          });
        }
        pinchRef.current = { dist, mx, my };
        return;
      }
      pinchRef.current = null;

      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (!movedRef.current && Math.hypot(dx, dy) < 5) return;
      movedRef.current = true;
      setView((prev) =>
        clampView({ zoom: prev.zoom, x: d.px + dx, y: d.py + dy }, mapW, mapH)
      );
    };
    const up = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;
      if (pointersRef.current.size === 0) dragRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [mapW, mapH]);

  // 滚轮缩放：以光标下的地图点为锚（拖动过程中忽略）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (dragRef.current || pinchRef.current) return;
      setView((prev) => {
        const nextZoom = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, prev.zoom * Math.exp(-e.deltaY * 0.0015))
        );
        if (nextZoom === prev.zoom) return prev;
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        // 光标下的地图坐标，缩放前后保持不变
        const mx = (cx - prev.x) / prev.zoom;
        const my = (cy - prev.y) / prev.zoom;
        return clampView(
          { zoom: nextZoom, x: cx - mx * nextZoom, y: cy - my * nextZoom },
          mapW,
          mapH
        );
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [mapW, mapH]);

  const onClickNode = (p: PuzzleDefinition) => {
    if (movedRef.current) return;
    if (!isUnlocked(p.title, solvedSet)) return; // 未解锁关卡不可进入
    onSelect(p);
  };

  // 总分（与解题界面右上角一致：所有关卡历史最高分之和）
  const totalScore = Object.values(bestScores).reduce((sum, v) => sum + v, 0);

  // Esc 关闭地图（设置界面打开时交给设置层处理）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !escDisabled) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, escDisabled]);

  return (
    <div
      ref={wrapRef}
      className="fixed inset-0 z-[80] select-none bg-slate-950"
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
    >
      <div
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        <svg width={mapW} height={mapH}>
          {/* 地图连接线：完成「need」中全部关卡后该段变黄（已接通）。 */}
          {segments.map((s, i) => (
            <line
              key={i}
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              stroke={
                s.need.every((t) => solvedSet.has(t))
                  ? '#facc15'
                  : theme === 'light'
                    ? '#94a3b8'
                    : '#475569'
              }
              strokeWidth={10}
              strokeLinecap="square"
            />
          ))}

          {/* 与门方块（黄色 &）：上半/下半对应各章通关进度，条件满足时逐半点亮 */}
          {andGates.map((g, i) => (
            <AndGate key={i} x={g.x} y={g.y} litTop={g.litTop} litBottom={g.litBottom} />
          ))}

          {/* 章节图标：完成第 0 关后出现，并保持最终（点亮）状态，与章节进度无关 */}
          {solvedSet.has('0') &&
            chapters.map((row, i) => {
              const y = ROW0_Y + i * ROW;
              // 微调：第二章星形略上移、第四章三角略下移
              return (
                <ChapterIcon
                  key={row.ch}
                  ch={row.ch}
                  lit
                  x={SPINE_X + 60}
                  y={y - 48 + (row.ch === 2 ? -4 : row.ch === 4 ? 4 : 0)}
                  size={row.ch === 1 ? 72 : 80}
                />
              );
            })}

          {/* E 行图标：E 区解锁（四章行末关全通）后才出现。
              E-1 灰白 S 分隔圆；E-2 橙色八角星；E-3 Pepsi+八角星叠放；
              E-4 蓝窗田字；E-5 Pepsi+田字叠放；E-6 T 骨牌+八角星交织（原 E-5）；
              E-7 双重三角；E-8 三角+Pepsi 交织；E-9 三角+星交织；
              E-10 三角+田字组合 */}
          {MAIN_END_TITLES.every((t) => solvedSet.has(t)) &&
            extras.map((row, i) => {
              const y = ROW0_Y + i * ROW;
              if (row.key === 'E-1') {
                return <E1Icon key={row.key} x={extraLayout.spineX + 60} y={y - 48} />;
              }
              if (row.key === 'E-2') {
                return <E2Icon key={row.key} x={extraLayout.spineX + 60} y={y - 48} />;
              }
              if (row.key === 'E-3') {
                return <E3Icon key={row.key} x={extraLayout.spineX + 60} y={y - 48} />;
              }
              if (row.key === 'E-4') {
                return <E4Icon key={row.key} x={extraLayout.spineX + 60} y={y - 48} />;
              }
              if (row.key === 'E-5') {
                return <PepsiTianIcon key={row.key} x={extraLayout.spineX + 60} y={y - 48} />;
              }
              if (row.key === 'E-6') {
                return <E5Icon key={row.key} x={extraLayout.spineX + 60} y={y - 48} />;
              }
              if (row.key === 'E-7') {
                return <E6Icon key={row.key} x={extraLayout.spineX + 60} y={y - 48} />;
              }
              if (row.key === 'E-8') {
                return <E7Icon key={row.key} x={extraLayout.spineX + 60} y={y - 48} />;
              }
              if (row.key === 'E-9') {
                return <E8Icon key={row.key} x={extraLayout.spineX + 60} y={y - 48} />;
              }
              if (row.key === 'E-10') {
                return <CombinedIcon key={row.key} x={extraLayout.spineX + 60} y={y - 48} lit={true} />;
              }
              return null;
            })}

          {/* 关卡方块：底板 + 缩略图 + 得分 + 边框（未解锁只显示锁图标）。
              共边内缩后边框只落在自己方块范围内，后画的方块不再遮挡前者的边框，
              无需分步绘制 */}
          {nodes.map(({ p, x, y }) => {
            const unlocked = isUnlocked(p.title, solvedSet);
            const best = bestScores[p.title];
            const style = unlocked
              ? (theme === 'light' ? LIGHT_STATE_STYLE : STATE_STYLE)[nodeState(p, best)]
              : theme === 'light'
                ? LIGHT_LOCKED_STYLE
                : LOCKED_STYLE;
            const vw = p.width * CELL + TPAD * 2;
            const vh = p.height * CELL + TPAD * 2;
            // 最高分解法路径（拿到新纪录时与最高分一起保存为四方向序列）
            const dirs = savedAnswers[p.title];
            const start = p.starts[0] ?? { r: 0, c: 0 };
            const path = dirs ? directionsToPath(dirs, start, p.width, p.height) : [];

            // 四条边框线（局部坐标）：外沿居中整宽 2.5；紧贴共边向内缩 1.25（半个线宽），
            // 与邻居的完整边框并排共边（合计 5）、互不遮挡
            const half = NODE / 2;
            const shared = {
              top: posSet.has(`${x},${y - NODE}`),
              bottom: posSet.has(`${x},${y + NODE}`),
              left: posSet.has(`${x - NODE},${y}`),
              right: posSet.has(`${x + NODE},${y}`),
            };
            const ext = 1.25;
            // 四角全部由左右竖边的延伸覆盖：竖边在某端没有紧贴邻居时向外伸 1.25，
            // 共边端保持平切不侵入邻居；上下两条横边完全不做延伸
            const lines = [
              {
                x1: -half,
                y1: shared.top ? -half + ext : -half,
                x2: half,
                y2: shared.top ? -half + ext : -half,
                w: 2.5,
              },
              {
                x1: shared.right ? half - ext : half,
                y1: -half - (shared.top ? 0 : ext),
                x2: shared.right ? half - ext : half,
                y2: half + (shared.bottom ? 0 : ext),
                w: 2.5,
              },
              {
                x1: -half,
                y1: shared.bottom ? half - ext : half,
                x2: half,
                y2: shared.bottom ? half - ext : half,
                w: 2.5,
              },
              {
                x1: shared.left ? -half + ext : -half,
                y1: -half - (shared.top ? 0 : ext),
                x2: shared.left ? -half + ext : -half,
                y2: half + (shared.bottom ? 0 : ext),
                w: 2.5,
              },
            ];
            return (
              <g
                key={p.title}
                transform={`translate(${x} ${y})`}
                className={unlocked ? 'map-node cursor-pointer' : ''}
                onClick={() => onClickNode(p)}
              >
                <rect x={-half} y={-half} width={NODE} height={NODE} fill={wtTile} />
                {unlocked ? (
                  <svg
                    x={-half + THUMB_PAD}
                    y={-half + THUMB_PAD}
                    width={NODE - THUMB_PAD * 2}
                    height={NODE - THUMB_PAD * 2}
                    viewBox={`0 0 ${vw} ${vh}`}
                    preserveAspectRatio="xMidYMid meet"
                  >
                    <BoardThumbnail puzzle={p} path={path} />
                  </svg>
                ) : (
                  // 锁图标
                  <g pointerEvents="none" opacity={0.9}>
                    <path
                      d="M -13 -4 L -13 -16 A 13 13 0 0 1 13 -16 L 13 -4"
                      fill="none"
                      stroke="#94a3b8"
                      strokeWidth={4}
                    />
                    <rect x={-19} y={-4} width={38} height={30} rx={4} fill="#94a3b8" />
                  </g>
                )}
                {unlocked && (
                  <text
                    x={0}
                    y={half + 22}
                    textAnchor="middle"
                    fontSize={14}
                    fontWeight={700}
                    fill={style.text}
                  >
                    {scoreLabel(best)}
                  </text>
                )}
                <g pointerEvents="none">
                  {lines.map((l, i) => (
                    <line
                      key={i}
                      x1={l.x1}
                      y1={l.y1}
                      x2={l.x2}
                      y2={l.y2}
                      stroke={style.stroke}
                      strokeWidth={l.w}
                      strokeLinecap="butt"
                    />
                  ))}
                </g>
              </g>
            );
          })}
        </svg>
      </div>

      {/* 左上角：设置按钮（与解题界面地图按钮同款；计时器由 App 层固定在按钮右侧） */}
      <div className="fixed left-4 top-3 z-10 flex items-center gap-3">
        <button
          onClick={onOpenSettings}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="设置"
          className="flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-600 bg-slate-800/90 text-slate-200 shadow-lg backdrop-blur-sm transition-colors hover:border-amber-400 hover:text-amber-300 md:h-24 md:w-24"
        >
          <Settings className="h-8 w-8 md:h-14 md:w-14" />
        </button>
      </div>

      {/* 屏幕右上角总分（照搬解题界面） */}
      <div className="fixed top-3 right-4 z-10 flex items-baseline gap-2 rounded-xl border border-slate-800 bg-slate-900/90 px-2.5 py-1 text-slate-300 shadow-inner backdrop-blur-sm md:px-5 md:py-2">
        <span className="text-slate-500 text-xs md:text-lg">{t('total')}</span>
        <span className="text-amber-400 font-black text-2xl md:text-7xl leading-none">{totalScore}</span>
      </div>
    </div>
  );
};
