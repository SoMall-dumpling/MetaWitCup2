/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Point {
  r: number;
  c: number;
}

export type ExitDirection = 'up' | 'down' | 'left' | 'right';

export interface EndPoint {
  r: number;
  c: number;
  dir: ExitDirection;
}

export type ColorType = 'black' | 'white' | 'orange' | 'magenta' | 'cyan' | 'green' | 'yellow';

export type SymbolType =
  | 'square'
  | 'dot'
  | 'star'
  | 'polyomino'
  | 'triangle'
  | 'eraser';

export interface CellSymbol {
  type: SymbolType;
  color?: ColorType;
  count?: number; // For triangles (1, 2, 3)
  shape?: boolean[][]; // For polyominoes (e.g. 2x2, 3x1, L-shape)
  rotatable?: boolean; // Tilted polyomino can be rotated
  negative?: boolean; // Blue hollow subtraction shape
  blockRatio?: number; // For polyominoes: block size as fraction of cell size (default 0.16); render-only
}

export interface OutsideSymbol extends CellSymbol {
  id: string;
  groupId?: string;
}

export interface OutsideGroup {
  id: string;
  symbols: OutsideSymbol[];
}

export type SymmetryType = 'none' | 'horizontal' | 'vertical' | 'rotational';

export interface PuzzleDefinition {
  title: string; // 题号/标题同时作为关卡唯一标识
  description?: string;
  targetScore?: number; // 目标分数：设置后总得分必须恰好等于该值才得分，否则记 0 分
  maxScore?: number; // 最大可能得分：恰好达到该值时奖励 +10 分（与 targetScore 互斥，设目标分的题不设最大分）
  showMaxScore?: boolean; // 是否一开始就向玩家显示最高分标记（默认不显示，达到后才揭示）
  baselineScore?: number; // 基准线：原始解法分低于此值得 0 分，否则得 原始分 − 基准线
  extraBonus?: number; // 满分额外加分：达到最大分或完成目标分时奖励的分数（默认 0，无则不给满分奖励）
  width: number; // Columns (e.g. 4)
  height: number; // Rows (e.g. 4)
  starts: Point[];
  ends: EndPoint[];
  brokenEdges: string[]; // Set of edge keys that cannot be traversed
  vertexDots: Record<string, ColorType>; // Key: "r,c"
  edgeDots: Record<string, ColorType>; // Key: "r1,c1-r2,c2"
  cellSymbols: Record<string, CellSymbol>; // Key: "r,c"
  outsideSymbols: OutsideSymbol[];
  symmetry: SymmetryType;
  panelColor?: string;
}

/** 预设 / 导入用的轻量谜题定义：省略的字段由 normalizePuzzle 补默认值。
 * 运行期各组件拿到的都是补齐后的 PuzzleDefinition，读字段无需判空 */
export type PuzzleSeed = Omit<
  PuzzleDefinition,
  'brokenEdges' | 'vertexDots' | 'edgeDots' | 'cellSymbols' | 'outsideSymbols' | 'symmetry'
> &
  Partial<
    Pick<PuzzleDefinition, 'brokenEdges' | 'vertexDots' | 'edgeDots' | 'cellSymbols' | 'outsideSymbols' | 'symmetry'>
  >;

/** 用默认值补齐可省略字段：预设 / 导入的谜题无需重复书写从未用过的字段 */
export function normalizePuzzle(p: PuzzleSeed): PuzzleDefinition {
  return {
    ...p,
    brokenEdges: p.brokenEdges ?? [],
    vertexDots: p.vertexDots ?? {},
    edgeDots: p.edgeDots ?? {},
    cellSymbols: p.cellSymbols ?? {},
    outsideSymbols: p.outsideSymbols ?? [],
    symmetry: p.symmetry ?? 'none',
    panelColor: p.panelColor ?? '#1e293b',
  };
}

export interface ValidationResult {
  valid: boolean;
  invalidSymbols: string[]; // Keys of symbols that caused violations
  reasons: string[];
  regions?: Array<{
    id: number;
    cells: Point[];
    symbols: Array<{ key: string; symbol: CellSymbol }>;
  }>;
}

export interface GroupPlacementDetail {
  groupId: string;
  symbols: OutsideSymbol[];
  score: number;
  validPositions: Point[];
  validConfigurationsCount: number;
  symbolCellScores: Record<string, Record<string, number>>;
  groupCellScores: Record<string, number>;
  examplePlacements?: Record<string, OutsideSymbol>[]; // 示例摆放（最多 50 个合法放置方案，cellKey → 符号），供"摆放方法"直接画入题板
}

export interface SymbolPlacementDetail {
  symbolId: string;
  symbol: OutsideSymbol;
  score: number;
  validPositions: Point[];
  cellScores: Record<string, number>;
}

export interface PlacementScoreResult {
  puzzleTitle: string; // 该结果对应的谜题标题（切换题目时用来忽略旧结果）
  totalScore: number;
  score: number;
  totalEmptyCells: number;
  validPositions: Point[];
  cellScores: Record<string, number>;
  groupScores: Record<string, number>;
  groupDetails: Record<string, GroupPlacementDetail>;
  symbolScores: Record<string, number>;
  symbolDetails: Record<string, SymbolPlacementDetail>;
  candidateGroupId: string | null;
  candidateSymbolId: string | null;
  candidateSymbol: OutsideSymbol | null;
  targetScore?: number; // 题目设定的目标分数（无则 undefined）
  targetMet?: boolean; // 是否恰好达成目标分数（无目标分数时为 undefined）
  rawTotalScore?: number; // 应用目标分数/基准线/奖励规则前的原始总分
  maxScore?: number; // 题目设定的最大可能得分（无则 undefined）
  maxReached?: boolean; // 是否恰好达到最大可能得分（无最大分时为 undefined）
  baselineScore?: number; // 题目设定的基准线（无则 undefined）
  belowBaseline?: boolean; // 是否低于基准线而被记 0 分
  bonus: number; // 满分额外加分：达到最大分或完成得分目标时等于该题的满分额外加分，否则 0
}

export function getOutsideSymbolGroups(outsideSymbols: OutsideSymbol[]): OutsideGroup[] {
  const groupMap = new Map<string, OutsideSymbol[]>();
  const groupOrder: string[] = [];

  for (const sym of outsideSymbols) {
    const gid = sym.groupId || sym.id;
    if (!groupMap.has(gid)) {
      groupMap.set(gid, []);
      groupOrder.push(gid);
    }
    groupMap.get(gid)!.push({ ...sym, groupId: gid });
  }

  return groupOrder.map((id) => ({
    id,
    symbols: groupMap.get(id)!,
  }));
}

export function edgeKey(p1: Point, p2: Point): string {
  if (p1.r < p2.r || (p1.r === p2.r && p1.c < p2.c)) {
    return `${p1.r},${p1.c}-${p2.r},${p2.c}`;
  }
  return `${p2.r},${p2.c}-${p1.r},${p1.c}`;
}

export function pointKey(p: Point): string {
  return `${p.r},${p.c}`;
}

export function parsePointKey(key: string): Point {
  const [r, c] = key.split(',').map(Number);
  return { r, c };
}
