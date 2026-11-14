/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Point,
  PuzzleDefinition,
  ValidationResult,
  SymmetryType,
  CellSymbol,
  edgeKey,
  pointKey,
} from '../types/puzzle';

export function getSymmetricPoint(
  p: Point,
  symmetry: SymmetryType,
  width: number,
  height: number
): Point {
  switch (symmetry) {
    case 'horizontal':
      return { r: height - p.r, c: p.c };
    case 'vertical':
      return { r: p.r, c: width - p.c };
    case 'rotational':
      return { r: height - p.r, c: width - p.c };
    case 'none':
    default:
      return { ...p };
  }
}

export function getSymmetricPath(
  path: Point[],
  symmetry: SymmetryType,
  width: number,
  height: number
): Point[] {
  if (symmetry === 'none') return [];
  return path.map((p) => getSymmetricPoint(p, symmetry, width, height));
}

// Bounding edges for cell (r, c):
// Top: (r, c) - (r, c+1)
// Bottom: (r+1, c) - (r+1, c+1)
// Left: (r, c) - (r+1, c)
// Right: (r, c+1) - (r+1, c+1)
export function getCellBoundingEdges(r: number, c: number): string[] {
  return [
    edgeKey({ r, c }, { r, c: c + 1 }),
    edgeKey({ r: r + 1, c }, { r: r + 1, c: c + 1 }),
    edgeKey({ r, c }, { r: r + 1, c }),
    edgeKey({ r, c: c + 1 }, { r: r + 1, c: c + 1 }),
  ];
}

interface RegionInfo {
  id: number;
  cells: Point[];
  symbols: Array<{ key: string; symbol: CellSymbol }>;
}

export function partitionGridIntoRegions(
  width: number,
  height: number,
  traversedEdges: Set<string>,
  cellSymbols: Record<string, CellSymbol>
): RegionInfo[] {
  const visited: boolean[][] = Array.from({ length: height }, () =>
    Array(width).fill(false)
  );
  const regions: RegionInfo[] = [];
  let regionCounter = 0;

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (visited[r][c]) continue;

      const queue: Point[] = [{ r, c }];
      visited[r][c] = true;
      const cells: Point[] = [];
      const symbols: Array<{ key: string; symbol: CellSymbol }> = [];
      let queueHead = 0;

      while (queueHead < queue.length) {
        const curr = queue[queueHead++];
        cells.push(curr);

        const key = `${curr.r},${curr.c}`;
        if (cellSymbols[key]) {
          symbols.push({ key, symbol: cellSymbols[key] });
        }

        // Neighbors: Up, Down, Left, Right
        // 1. Up: (r-1, c) separated by edge between (r, c) and (r, c+1)
        if (curr.r > 0 && !visited[curr.r - 1][curr.c]) {
          const upEdge = edgeKey({ r: curr.r, c: curr.c }, { r: curr.r, c: curr.c + 1 });
          if (!traversedEdges.has(upEdge)) {
            visited[curr.r - 1][curr.c] = true;
            queue.push({ r: curr.r - 1, c: curr.c });
          }
        }
        // 2. Down: (r+1, c) separated by edge between (r+1, c) and (r+1, c+1)
        if (curr.r < height - 1 && !visited[curr.r + 1][curr.c]) {
          const downEdge = edgeKey({ r: curr.r + 1, c: curr.c }, { r: curr.r + 1, c: curr.c + 1 });
          if (!traversedEdges.has(downEdge)) {
            visited[curr.r + 1][curr.c] = true;
            queue.push({ r: curr.r + 1, c: curr.c });
          }
        }
        // 3. Left: (r, c-1) separated by edge between (r, c) and (r+1, c)
        if (curr.c > 0 && !visited[curr.r][curr.c - 1]) {
          const leftEdge = edgeKey({ r: curr.r, c: curr.c }, { r: curr.r + 1, c: curr.c });
          if (!traversedEdges.has(leftEdge)) {
            visited[curr.r][curr.c - 1] = true;
            queue.push({ r: curr.r, c: curr.c - 1 });
          }
        }
        // 4. Right: (r, c+1) separated by edge between (r, c+1) and (r+1, c+1)
        if (curr.c < width - 1 && !visited[curr.r][curr.c + 1]) {
          const rightEdge = edgeKey({ r: curr.r, c: curr.c + 1 }, { r: curr.r + 1, c: curr.c + 1 });
          if (!traversedEdges.has(rightEdge)) {
            visited[curr.r][curr.c + 1] = true;
            queue.push({ r: curr.r, c: curr.c + 1 });
          }
        }
      }

      regions.push({
        id: regionCounter++,
        cells,
        symbols,
      });
    }
  }

  return regions;
}

// Check polyomino tiling in a region
function rotateShape(shape: boolean[][]): boolean[][] {
  const h = shape.length;
  const w = shape[0].length;
  const res: boolean[][] = Array.from({ length: w }, () => Array(h).fill(false));
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      res[c][h - 1 - r] = shape[r][c];
    }
  }
  return res;
}

function getPolyominoOrientations(shape: boolean[][], rotatable: boolean): boolean[][][] {
  const orientations: boolean[][][] = [shape];
  if (!rotatable) return orientations;

  let current = shape;
  for (let i = 0; i < 3; i++) {
    current = rotateShape(current);
    // deduplicate
    const exists = orientations.some(
      (o) =>
        o.length === current.length &&
        o[0].length === current[0].length &&
        o.every((row, r) => row.every((val, c) => val === current[r][c]))
    );
    if (!exists) {
      orientations.push(current);
    }
  }
  return orientations;
}

function getShapeCells(shape: boolean[][]): Point[] {
  const points: Point[] = [];
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[0].length; c++) {
      if (shape[r][c]) {
        points.push({ r, c });
      }
    }
  }
  return points;
}

/** 多联骨牌形状的格子数（面积） */
export function getPolyominoArea(shape: boolean[][]): number {
  let n = 0;
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c]) n++;
    }
  }
  return n;
}

export function canTileRegionWithPolyominoes(
  regionCells: Point[],
  polyominoes: Array<{ shape: boolean[][]; rotatable?: boolean; negative?: boolean }>,
  width: number,
  height: number
): boolean {
  // 层数减法语义（规则确认版）：
  // 1. 黄色骨牌在题板内摆放，允许互相重叠（叠层），也允许覆盖区域之外的格子；
  // 2. 蓝色镂空骨牌必须完整压在黄覆盖之上（不能压空，蓝块之间不重叠），
  //    每个蓝格抵消一层黄；
  // 3. 最终净层数（黄层数 − 蓝层数）区域内恰为 1、区域外恰为 0。
  // 4. 摆放过程中任何骨牌超出题板边界即非法（即使最终能拼出也不成立）。
  // 骨牌在区域内可任意平移/旋转，画定位置只作提示、不锁定判定。
  if (polyominoes.length === 0) return true;
  // Degenerate (empty) shapes can never tile anything
  if (polyominoes.some((p) => getShapeCells(p.shape).length === 0)) {
    return false;
  }

  const regionSet = new Set(regionCells.map((p) => pointKey(p)));
  const positives = polyominoes.filter((p) => !p.negative);
  const negatives = polyominoes.filter((p) => p.negative);
  // 没有黄色骨牌时，蓝色无处可减，区域无法被覆盖
  if (positives.length === 0) return false;

  const posPieces = positives.map((p) => ({
    orients: getPolyominoOrientations(p.shape, !!p.rotatable).map(getShapeCells),
  }));
  const negPieces = negatives.map((p) => ({
    orients: getPolyominoOrientations(p.shape, !!p.rotatable).map(getShapeCells),
  }));

  // —— 面积守恒剪枝 ——
  // 最终「黄覆盖 − 蓝覆盖」必须恰好等于区域：黄块/蓝块各自互不重叠，
  // 且蓝块全部压在黄块上，故 |黄| = Σ黄块面积、|蓝| = Σ蓝块面积、
  // |区域| = Σ黄块面积 − Σ蓝块面积。面积和对不上时不可能拼出，直接返回
  let posArea = 0;
  for (const p of posPieces) posArea += p.orients[0].length;
  let negArea = 0;
  for (const p of negPieces) negArea += p.orients[0].length;
  if (posArea - negArea !== regionCells.length) return false;

  // 无蓝色镂空骨牌：黄块必须恰好铺满区域——以「首个未覆盖的区域格」为锚点
  // 做精确覆盖式搜索：该格必须由某一未使用的块覆盖（块间不重叠、不伸出区域），
  // 分支从「全棋盘 × 朝向」降到「覆盖该格的位置数」
  if (negPieces.length === 0) {
    const covered = new Set<string>();

    const tryCover = (remaining: number[]): boolean => {
      let anchor: Point | null = null;
      for (const cell of regionCells) {
        if (!covered.has(pointKey(cell))) {
          anchor = cell;
          break;
        }
      }
      if (anchor === null) return true; // 区域已全部覆盖（面积守恒保证恰好用完全部块）
      for (let pi = 0; pi < remaining.length; pi++) {
        const piece = posPieces[remaining[pi]];
        for (const shapeCells of piece.orients) {
          for (let ci = 0; ci < shapeCells.length; ci++) {
            const anchorCell = shapeCells[ci];
            const dr = anchor.r - anchorCell.r;
            const dc = anchor.c - anchorCell.c;
            let ok = true;
            for (const sc of shapeCells) {
              const rr = sc.r + dr;
              const cc = sc.c + dc;
              if (rr < 0 || rr >= height || cc < 0 || cc >= width) {
                ok = false;
                break;
              }
              const k = `${rr},${cc}`;
              if (!regionSet.has(k) || covered.has(k)) {
                ok = false;
                break;
              }
            }
            if (!ok) continue;
            const placed: string[] = [];
            for (const sc of shapeCells) {
              const k = `${sc.r + dr},${sc.c + dc}`;
              placed.push(k);
              covered.add(k);
            }
            const nextRemaining = remaining.filter((x) => x !== remaining[pi]);
            if (nextRemaining.length === 0) {
              if (covered.size === regionCells.length) return true;
            } else if (tryCover(nextRemaining)) {
              return true;
            }
            for (const k of placed) covered.delete(k);
          }
        }
      }
      return false;
    };

    return tryCover(posPieces.map((_, i) => i));
  }

  // 题板所有格子（摆放枚举范围）
  const boardCells: Point[] = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) boardCells.push({ r, c });
  }

  // 黄覆盖按层数记录（允许叠层）；蓝覆盖为集合（蓝块之间不重叠）。
  // 每格黄层数上界 = 2：净层数至多 1 且每格蓝层数至多 1（蓝不叠放），
  // 超过 2 层的黄没有任何蓝能把净层数拉回 ≤1，必然非法，可安全剪掉
  const yellowLayers = new Map<string, number>();
  const blueCover = new Set<string>();
  const yellowCap = negPieces.length > 0 ? 2 : 1;

  function tryPlace(
    idx: number,
    pieces: Array<{ orients: Point[][] }>,
    isBlue: boolean,
    cont: () => boolean
  ): boolean {
    if (idx >= pieces.length) return cont();
    const piece = pieces[idx];
    for (const anchor of boardCells) {
      const ak = pointKey(anchor);
      if (isBlue) {
        // 蓝块必须压在黄上，且蓝块之间不重叠
        if ((yellowLayers.get(ak) ?? 0) === 0 || blueCover.has(ak)) continue;
      }
      for (const shapeCells of piece.orients) {
        const anchorCell = shapeCells[0];
        const dr = anchor.r - anchorCell.r;
        const dc = anchor.c - anchorCell.c;
        const placed: string[] = [];
        let ok = true;
        for (const sc of shapeCells) {
          const rr = sc.r + dr;
          const cc = sc.c + dc;
          if (rr < 0 || rr >= height || cc < 0 || cc >= width) {
            ok = false;
            break; // 超出题板边界 → 非法
          }
          const k = `${rr},${cc}`;
          if (isBlue) {
            // 蓝：必须有黄可消，且蓝块之间不重叠
            if ((yellowLayers.get(k) ?? 0) === 0 || blueCover.has(k)) {
              ok = false;
              break;
            }
          } else if ((yellowLayers.get(k) ?? 0) >= yellowCap) {
            // 黄：允许叠层，但不超过上界
            ok = false;
            break;
          }
          placed.push(k);
        }
        if (!ok) continue;
        if (isBlue) {
          placed.forEach((k) => blueCover.add(k));
        } else {
          placed.forEach((k) => yellowLayers.set(k, (yellowLayers.get(k) ?? 0) + 1));
        }
        if (tryPlace(idx + 1, pieces, isBlue, cont)) return true;
        if (isBlue) {
          placed.forEach((k) => blueCover.delete(k));
        } else {
          placed.forEach((k) => {
            const v = (yellowLayers.get(k) ?? 0) - 1;
            if (v <= 0) yellowLayers.delete(k);
            else yellowLayers.set(k, v);
          });
        }
      }
    }
    return false;
  }

  const checkFinal = (): boolean => {
    // 净层数（黄 − 蓝）：区域内恰为 1，区域外恰为 0
    for (const cell of regionCells) {
      const k = pointKey(cell);
      if ((yellowLayers.get(k) ?? 0) - (blueCover.has(k) ? 1 : 0) !== 1) return false;
    }
    for (const [k, yl] of yellowLayers) {
      if (yl - (blueCover.has(k) ? 1 : 0) > 0 && !regionSet.has(k)) return false;
    }
    return true;
  };

  return tryPlace(0, posPieces, false, () => tryPlace(0, negPieces, true, checkFinal));
}

// Evaluate validity of a single region without erasers
function evaluateRegionDirect(
  region: RegionInfo,
  ignoredSymbolKeys: Set<string>,
  width: number,
  height: number
): { valid: boolean; invalidKeys: string[]; reason?: string } {
  const activeSymbols = region.symbols.filter((s) => !ignoredSymbolKeys.has(s.key));
  const invalidKeys: string[] = [];

  // 1. 多数色规则：各色方块分别计数，数量未达到（唯一）最多的颜色报错；
  //    并列最多时全体报错。例：2 白 2 黑 → 全部报错；2 白 1 黑 → 只有黑报错
  const squares = activeSymbols.filter((s) => s.symbol.type === 'square');
  if (squares.length > 0) {
    const colorCounts = new Map<string, number>();
    for (const s of squares) {
      const col = s.symbol.color || 'black';
      colorCounts.set(col, (colorCounts.get(col) || 0) + 1);
    }
    if (colorCounts.size > 1) {
      const maxCount = Math.max(...colorCounts.values());
      const maxColors = [...colorCounts.entries()]
        .filter(([, n]) => n === maxCount)
        .map(([col]) => col);
      if (maxColors.length === 1) {
        // 唯一多数色：其余颜色的方块报错
        const majority = maxColors[0];
        squares.forEach((s) => {
          if ((s.symbol.color || 'black') !== majority) invalidKeys.push(s.key);
        });
      } else {
        // 并列最多：没有唯一多数色，全部报错
        squares.forEach((s) => invalidKeys.push(s.key));
      }
      return {
        valid: false,
        invalidKeys,
        reason: '区域内方块以多数颜色为准：非多数颜色的方块成为违例（并列最多时全部违例）',
      };
    }
  }

  // 2. Stars: Must be paired with exactly 2 of their color in the region
  const stars = activeSymbols.filter((s) => s.symbol.type === 'star');
  if (stars.length > 0) {
    // Count all symbols of each color in this region
    const colorCounts: Record<string, number> = {};
    activeSymbols.forEach((s) => {
      const col = s.symbol.color || 'black';
      colorCounts[col] = (colorCounts[col] || 0) + 1;
    });

    for (const star of stars) {
      const col = star.symbol.color || 'black';
      if (colorCounts[col] !== 2) {
        invalidKeys.push(star.key);
      }
    }

    if (invalidKeys.length > 0) {
      return {
        valid: false,
        invalidKeys,
        reason: '相同颜色的八角星必须且只能与另一个同色符号成对出现',
      };
    }
  }

  // 3. Polyominoes
  const polyominoes = activeSymbols
    .filter((s) => s.symbol.type === 'polyomino' && s.symbol.shape)
    .map((s) => ({
      shape: s.symbol.shape!,
      rotatable: s.symbol.rotatable,
      negative: s.symbol.negative,
      key: s.key,
    }));

  if (polyominoes.length > 0) {
    const canTile = canTileRegionWithPolyominoes(region.cells, polyominoes, width, height);
    if (!canTile) {
      polyominoes.forEach((p) => invalidKeys.push(p.key));
      return {
        valid: false,
        invalidKeys,
        reason: '区域形状与格子数量不符合多联骨牌的拼合要求',
      };
    }
  }

  return { valid: true, invalidKeys: [] };
}

export function validatePuzzle(
  puzzle: PuzzleDefinition,
  path: Point[]
): ValidationResult {
  const invalidSymbols: string[] = [];
  const reasons: string[] = [];

  if (path.length === 0) {
    return { valid: false, invalidSymbols: [], reasons: ['尚未划出路径'] };
  }

  // 1. Start point validation
  const startPoint = path[0];
  const isValidStart = puzzle.starts.some(
    (s) => s.r === startPoint.r && s.c === startPoint.c
  );
  if (!isValidStart) {
    return {
      valid: false,
      invalidSymbols: [],
      reasons: ['路径必须从指定的起点圆点开始'],
    };
  }

  // 2. End point validation
  const endPoint = path[path.length - 1];
  const isValidEnd = puzzle.ends.some(
    (e) => e.r === endPoint.r && e.c === endPoint.c
  );
  if (!isValidEnd) {
    return {
      valid: false,
      invalidSymbols: [],
      reasons: ['路径必须终结于合法的出口端点'],
    };
  }

  // Compute symmetric path
  const symmetricPath = getSymmetricPath(
    path,
    puzzle.symmetry,
    puzzle.width,
    puzzle.height
  );

  // Collect all traversed edges and vertices
  const traversedEdges = new Set<string>();
  const traversedVertices = new Set<string>();
  const brokenEdgesSet = new Set(puzzle.brokenEdges);

  // Check primary path edges
  traversedVertices.add(pointKey(path[0]));
  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];
    const eKey = edgeKey(p1, p2);

    // Path continuity: consecutive vertices must be orthogonally adjacent
    if (Math.abs(p1.r - p2.r) + Math.abs(p1.c - p2.c) !== 1) {
      return {
        valid: false,
        invalidSymbols: [],
        reasons: ['路径必须沿网格逐格移动，不能跳格'],
      };
    }

    // Self-intersection: no vertex may be visited twice
    if (traversedVertices.has(pointKey(p2))) {
      return {
        valid: false,
        invalidSymbols: [],
        reasons: ['路径不能重复经过同一顶点（自我交叉）'],
      };
    }

    if (brokenEdgesSet.has(eKey)) {
      return {
        valid: false,
        invalidSymbols: [eKey],
        reasons: ['路径穿越了破损的阻断边缘'],
      };
    }
    traversedEdges.add(eKey);
    traversedVertices.add(pointKey(p2));
  }

  // Check symmetric path edges
  if (symmetricPath.length > 0) {
    traversedVertices.add(pointKey(symmetricPath[0]));
    for (let i = 0; i < symmetricPath.length - 1; i++) {
      const p1 = symmetricPath[i];
      const p2 = symmetricPath[i + 1];
      const eKey = edgeKey(p1, p2);

      if (brokenEdgesSet.has(eKey)) {
        return {
          valid: false,
          invalidSymbols: [eKey],
          reasons: ['对称路径穿越了破损的阻断边缘'],
        };
      }
      traversedEdges.add(eKey);
      traversedVertices.add(pointKey(p2));
    }
  }

  // 3. Hexagon Dots Validation
  // Vertex dots
  for (const [vKey] of Object.entries(puzzle.vertexDots)) {
    if (!traversedVertices.has(vKey)) {
      invalidSymbols.push(`vdot:${vKey}`);
      reasons.push(`未穿过顶点处的六边形点 (${vKey})`);
    }
  }
  // Edge dots
  for (const [eKey] of Object.entries(puzzle.edgeDots)) {
    if (!traversedEdges.has(eKey)) {
      invalidSymbols.push(`edot:${eKey}`);
      reasons.push(`未穿过线段上的六边形点`);
    }
  }

  // 4. Triangle Markers Validation
  for (const [cellKey, sym] of Object.entries(puzzle.cellSymbols)) {
    if (sym.type === 'triangle' && sym.count) {
      const [r, c] = cellKey.split(',').map(Number);
      const boundingEdges = getCellBoundingEdges(r, c);
      let count = 0;
      for (const e of boundingEdges) {
        if (traversedEdges.has(e)) count++;
      }
      if (count !== sym.count) {
        invalidSymbols.push(cellKey);
        reasons.push(
          `位置 (${r},${c}) 的三角形数量不满足：要求 ${sym.count} 边，实际接触 ${count} 边`
        );
      }
    }
  }

  // 5. Partition into Regions
  const regions = partitionGridIntoRegions(
    puzzle.width,
    puzzle.height,
    traversedEdges,
    puzzle.cellSymbols
  );

  // 6. Region-level symbol validation with Elimination Symbols (Erasers)
  for (const region of regions) {
    const erasers = region.symbols.filter((s) => s.symbol.type === 'eraser');

    if (erasers.length === 0) {
      // Standard region evaluation
      const evalRes = evaluateRegionDirect(region, new Set(), puzzle.width, puzzle.height);
      if (!evalRes.valid) {
        invalidSymbols.push(...evalRes.invalidKeys);
        if (evalRes.reason) reasons.push(evalRes.reason);
      }
      continue;
    }

    // 抗体（消除符号）逻辑：
    // 1. 先忽略区域内全部抗体，判定其他符号是否有报错
    const eraserKeys = new Set(erasers.map((e) => e.key));
    const othersOnly = evaluateRegionDirect(region, eraserKeys, puzzle.width, puzzle.height);

    if (othersOnly.valid) {
      // 其他符号全部合法 → 抗体无处生效，自身成为违例
      erasers.forEach((e) => invalidSymbols.push(e.key));
      reasons.push('区域内其他符号均满足规则，消除符号自身成为违例');
      continue;
    }

    // 2. 其他符号有报错：每个抗体恰好消除一个其他符号，枚举所有组合
    const nonEraserSymbols = region.symbols.filter((s) => s.symbol.type !== 'eraser');
    const numErasers = erasers.length;
    const ignored = new Set<string>(eraserKeys);
    let foundValidCombination = false;

    function tryCombination(depth: number, start: number): boolean {
      if (depth === numErasers) {
        return evaluateRegionDirect(region, ignored, puzzle.width, puzzle.height).valid;
      }
      for (let i = start; i < nonEraserSymbols.length; i++) {
        ignored.add(nonEraserSymbols[i].key);
        if (tryCombination(depth + 1, i + 1)) return true;
        ignored.delete(nonEraserSymbols[i].key);
      }
      return false;
    }

    foundValidCombination = tryCombination(0, 0);

    if (!foundValidCombination) {
      erasers.forEach((e) => invalidSymbols.push(e.key));
      invalidSymbols.push(...othersOnly.invalidKeys);
      reasons.push('消除符号无法消除该区域内的规则违例');
    }
  }

  return {
    valid: invalidSymbols.length === 0,
    invalidSymbols: Array.from(new Set(invalidSymbols)),
    reasons,
    regions,
  };
}
