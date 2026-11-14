/**
 * 计算某关卡的放置共鸣最高得分。
 *
 * 原理：枚举从任一起点到任一终点的全部合法简单路径（自避、不穿缺口），
 * 对每条路径先用"区域面积可行性"快速预筛（大多数路径可直接跳过），
 * 再用与游戏引擎相同的骨牌判定（canTileRegionWithPolyominoes）精确计数。
 * 若关卡包含非骨牌符号（方块/星等），则退回调用游戏引擎 calculatePlacementScore。
 *
 * 用法：
 *   npm run max-score 4-5            # 按预设关卡标题查找
 *   npm run max-score ./a.json       # 或传入关卡 JSON 文件路径
 *
 * 注意：路径总数随网格增大爆炸式增长，设置了 500 万条上限，
 * 超出会截断并提示（此时结果可能不是全局最大值）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { PuzzleDefinition, Point, edgeKey } from '../src/types/puzzle';
import {
  partitionGridIntoRegions,
  canTileRegionWithPolyominoes,
} from '../src/engine/validator';
import { calculatePlacementScore } from '../src/engine/metaScorer';
import { PRESET_PUZZLES } from '../src/presets';

const MAX_PATHS = 5_000_000;

function loadPuzzle(arg: string): PuzzleDefinition {
  if (arg.endsWith('.json')) {
    if (!existsSync(arg)) throw new Error(`文件不存在: ${arg}`);
    return JSON.parse(readFileSync(arg, 'utf8')) as PuzzleDefinition;
  }
  const found = PRESET_PUZZLES.find((p) => p.title === arg);
  if (found) return found;
  const titles = PRESET_PUZZLES.map((p) => p.title).join('、');
  throw new Error(`未找到关卡「${arg}」。可用预设：${titles}\n或传入 JSON 文件路径。`);
}

/**
 * 区域面积可行性预筛：骨牌面积能否恰好分配到各区域
 * （有骨牌的区域必须填满，没有的不受约束）。
 * 返回"可能放下骨牌的区域下标集合"；完全不可行返回 null。
 */
function usableRegions(regionAreas: number[], pieceAreas: number[]): Set<number> | null {
  const r = regionAreas.length;
  const p = pieceAreas.length;
  const bins: number[] = new Array(r).fill(0);
  const usable = new Set<number>();
  let any = false;
  function assign(i: number) {
    if (i === p) {
      if (bins.every((sum, idx) => sum === 0 || sum === regionAreas[idx])) {
        any = true;
        bins.forEach((sum, idx) => {
          if (sum > 0) usable.add(idx);
        });
      }
      return;
    }
    for (let b = 0; b < r; b++) {
      bins[b] += pieceAreas[i];
      if (bins[b] <= regionAreas[b]) assign(i + 1);
      bins[b] -= pieceAreas[i];
    }
  }
  assign(0);
  return any ? usable : null;
}

function pieceArea(shape: boolean[][]): number {
  let n = 0;
  shape.forEach((row) => row.forEach((v) => v && n++));
  return n;
}

function sig(s: PuzzleDefinition['outsideSymbols'][number]): string {
  return `${s.type}:${s.color}:${s.count}:${s.rotatable}:${s.negative}:${JSON.stringify(s.shape)}`;
}

interface RegionIdx {
  id: number;
  cells: Point[];
}

/** 快速精确计数（仅限全部为骨牌的符号组），返回 null 表示无法快速处理 */
function countGroupFast(
  regions: RegionIdx[],
  cellToRegion: Map<string, number>,
  candidateCells: Point[],
  groupSymbols: PuzzleDefinition['outsideSymbols']
): number {
  const k = groupSymbols.length;
  if (candidateCells.length < k) return 0;

  const syms = [...groupSymbols].sort((a, b) => sig(a).localeCompare(sig(b)));
  const chosen = new Array<number>(k).fill(0);
  let count = 0;

  function backtrack(sIdx: number) {
    if (sIdx === k) {
      // 按锚点所在区域分发骨牌，各区域必须恰好可拼合
      const byRegion = new Map<
        number,
        Array<{ shape: boolean[][]; rotatable?: boolean; negative?: boolean }>
      >();
      for (let i = 0; i < k; i++) {
        const cell = candidateCells[chosen[i]];
        const regId = cellToRegion.get(`${cell.r},${cell.c}`)!;
        if (!byRegion.has(regId)) byRegion.set(regId, []);
        byRegion.get(regId)!.push({
          shape: syms[i].shape!,
          rotatable: syms[i].rotatable,
          negative: syms[i].negative,
        });
      }
      for (const [regId, pieces] of byRegion) {
        if (!canTileRegionWithPolyominoes(regions[regId].cells, pieces)) return;
      }
      count++;
      return;
    }
    const start =
      sIdx > 0 && sig(syms[sIdx]) === sig(syms[sIdx - 1]) ? chosen[sIdx - 1] + 1 : 0;
    for (let ci = start; ci < candidateCells.length; ci++) {
      chosen[sIdx] = ci;
      backtrack(sIdx + 1);
    }
  }
  backtrack(0);
  return count;
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('用法: npm run max-score <关卡标题 | JSON文件路径>');
    process.exit(1);
  }
  const puzzle = loadPuzzle(arg);
  console.error(`题目: ${puzzle.title} (${puzzle.width}x${puzzle.height})`);

  const H = puzzle.height;
  const W = puzzle.width;
  const endKeys = new Set(puzzle.ends.map((e) => `${e.r},${e.c}`));
  const brokenSet = new Set(puzzle.brokenEdges);

  // 按组聚合外部符号（与 metaScorer 相同的分组方式）
  const groupMap = new Map<string, PuzzleDefinition['outsideSymbols']>();
  for (const s of puzzle.outsideSymbols) {
    const key = s.groupId || s.id;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(s);
  }
  const groups = [...groupMap.values()];
  const fastable = groups.every((g) => g.every((s) => s.type === 'polyomino' && s.shape));
  const groupAreas = groups.map((g) => g.map((s) => pieceArea(s.shape!)));

  const visited = new Set<string>();
  const path: Point[] = [];
  let pathCount = 0;
  let truncated = false;
  let best = -1;
  let bestPaths: string[] = [];
  const histogram = new Map<number, number>();

  function scoreOf(finalPath: Point[]): number {
    const tEdges = new Set<string>();
    for (let i = 0; i < finalPath.length - 1; i++) {
      tEdges.add(edgeKey(finalPath[i], finalPath[i + 1]));
    }
    const regions = partitionGridIntoRegions(W, H, tEdges, puzzle.cellSymbols);
    const regionAreas = regions.map((rg) => rg.cells.length);

    if (fastable) {
      const cellToRegion = new Map<string, number>();
      regions.forEach((rg) =>
        rg.cells.forEach((cell) => cellToRegion.set(`${cell.r},${cell.c}`, rg.id))
      );
      let total = 0;
      for (let gi = 0; gi < groups.length; gi++) {
        const usable = usableRegions(regionAreas, groupAreas[gi]);
        if (!usable) continue; // 该组在此路径下必然 0 分
        // 候选格子：只可能是"可用区域"内的空格
        const candidateCells: Point[] = [];
        for (const rg of regions) {
          if (!usable.has(rg.id)) continue;
          for (const cell of rg.cells) {
            if (!puzzle.cellSymbols[`${cell.r},${cell.c}`]) candidateCells.push(cell);
          }
        }
        total += countGroupFast(regions, cellToRegion, candidateCells, groups[gi]);
      }
      return total;
    }

    // 兜底：调用游戏引擎精算
    return calculatePlacementScore(puzzle, finalPath).totalScore;
  }

  function dfs(r: number, c: number) {
    const key = `${r},${c}`;
    if (visited.has(key)) return;
    if (pathCount >= MAX_PATHS) {
      truncated = true;
      return;
    }
    visited.add(key);
    path.push({ r, c });

    if (endKeys.has(key)) {
      pathCount++;
      if (pathCount % 200000 === 0) {
        console.error(`  已遍历 ${pathCount} 条路径，当前最高 ${best} 分`);
      }
      const score = scoreOf(path);
      histogram.set(score, (histogram.get(score) || 0) + 1);
      if (score > best) {
        best = score;
        bestPaths = [path.map((p) => `(${p.r},${p.c})`).join(' ')];
      } else if (score === best && bestPaths.length < 5) {
        bestPaths.push(path.map((p) => `(${p.r},${p.c})`).join(' '));
      }
    } else {
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr > H || nc < 0 || nc > W) continue;
        if (brokenSet.has(edgeKey({ r, c }, { r: nr, c: nc }))) continue;
        dfs(nr, nc);
      }
    }

    visited.delete(key);
    path.pop();
  }

  for (const s of puzzle.starts) {
    dfs(s.r, s.c);
  }

  console.log(`题目: ${puzzle.title}`);
  console.log(`合法路径总数: ${pathCount}${truncated ? `（已达上限 ${MAX_PATHS}，结果可能非全局最优）` : ''}`);
  console.log(`最高得分: ${best}`);
  console.log('样例最优路径:');
  bestPaths.forEach((p) => console.log(' ', p));
  console.log('分数分布（得分 → 路径数）:');
  const sorted = [...histogram.entries()].sort((a, b) => b[0] - a[0]);
  sorted.forEach(([score, cnt]) => console.log(`  ${score} 分: ${cnt} 条`));
}

main();
