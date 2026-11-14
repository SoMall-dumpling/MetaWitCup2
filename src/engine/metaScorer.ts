/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Point,
  PuzzleDefinition,
  OutsideSymbol,
  PlacementScoreResult,
  SymbolPlacementDetail,
  GroupPlacementDetail,
  ValidationResult,
  getOutsideSymbolGroups,
  pointKey,
  parsePointKey,
} from '../types/puzzle';
import { validatePuzzle, getPolyominoArea } from './validator';

// 计分规则（自上而下）：
// 1. 基准线：原始分 < baselineScore 时记 0 分（无奖励）；恰好等于基准线照常计分
// 2. 目标分：恰好达到 targetScore → 满分额外加分；超过 targetScore → 0 分；
//    目标以下 → 真实得分 − 基准线（无基准线即为真实得分）
// 3. 最大分：恰好达到 maxScore → 满分额外加分；否则 真实得分 − 基准线
function applyScoreRules(
  puzzle: PuzzleDefinition,
  totalScore: number,
  activeScore: number,
  groupScores: Record<string, number>,
  symbolScores: Record<string, number>
) {
  const targetScore = puzzle.targetScore;
  const maxScore = puzzle.maxScore;
  const baseline = puzzle.baselineScore ?? 0;
  const rawTotalScore = totalScore;
  const targetMet = targetScore == null ? undefined : totalScore === targetScore;
  const maxReached = maxScore == null ? undefined : totalScore === maxScore;
  const belowBaseline = baseline > 0 && totalScore < baseline;

  let finalTotal = totalScore;
  const finalActive = activeScore;
  const finalGroupScores = groupScores;
  const finalSymbolScores = symbolScores;
  let bonus = 0;

  // 只把最终总分归 0：组/符号角标仍展示各自的原始贡献分
  const zeroAll = () => {
    finalTotal = 0;
  };

  if (belowBaseline) {
    zeroAll(); // < 基准线 → 0 分（无奖励）
  } else if (targetScore != null) {
    if (targetMet) {
      // 恰好达到目标 → 满分额外加分
      bonus = puzzle.extraBonus ?? 0;
      finalTotal = totalScore - baseline + bonus;
    } else if (totalScore < targetScore) {
      // 目标以下：真实得分 − 基准线（无基准线即为真实得分）
      finalTotal = totalScore - baseline;
    } else {
      // 超过目标 → 0 分
      zeroAll();
    }
  } else {
    if (maxScore != null && maxReached) {
      bonus = puzzle.extraBonus ?? 0;
    }
    finalTotal = totalScore - baseline + bonus;
  }

  return {
    totalScore: finalTotal,
    score: finalActive,
    groupScores: finalGroupScores,
    symbolScores: finalSymbolScores,
    rawTotalScore,
    targetScore,
    targetMet,
    maxScore,
    maxReached,
    belowBaseline,
    bonus,
  };
}

// —— 2-9 特判快速通道 ——
// 2-9（及同结构的关卡）：题板上恰好有三个不同色方块，外部符号恰好是三个
// 与色块一一对应的不同色星（同组）。星只能落入同色色块所在区域：放同色区
// 同色计数为 2 ✓；放其他区或无色区计数为 1 ✗；不同色星入区也会让该区出现
// 计数为 1 的颜色 ✗。因此合法摆放数 = Π(各色块区域面积 − 1)。
// 通用枚举在该题上是 P(33,3) = 32736 次完整校验（每次重做区域划分），
// 导致解出路径与切换题目时数分钟的卡顿。
function isStarProductPuzzle(puzzle: PuzzleDefinition): boolean {
  const syms = puzzle.outsideSymbols;
  if (syms.length !== 3) return false;
  if (!syms.every((s) => s.type === 'star')) return false;
  const starColors = syms.map((s) => s.color || 'black');
  if (new Set(starColors).size !== 3) return false;
  // 三个星必须同组：多组时各组独立计分，不适用本公式
  if (new Set(syms.map((s) => s.groupId || s.id)).size !== 1) return false;
  const fixed = Object.values(puzzle.cellSymbols);
  if (fixed.length !== 3 || !fixed.every((s) => s.type === 'square')) return false;
  const squareColors = fixed.map((s) => s.color || 'black');
  return (
    new Set(squareColors).size === 3 &&
    starColors.every((c) => squareColors.includes(c))
  );
}

function calculateStarProductScore(
  puzzle: PuzzleDefinition,
  baseResult: ValidationResult,
  candidateGroupId: string | null,
  candidateSymbolId: string | null,
  candidateSymbol: OutsideSymbol | null
): PlacementScoreResult {
  const symbols = puzzle.outsideSymbols;
  const groupId = symbols[0].groupId || symbols[0].id;

  // 每个色块所在区域（baseResult 已通过校验：三个异色方块必然分处三个区域）
  const regionByColor = new Map<string, { squareKey: string; cells: Point[] }>();
  for (const region of baseResult.regions ?? []) {
    for (const { key, symbol } of region.symbols) {
      if (symbol.type === 'square') {
        regionByColor.set(symbol.color || 'black', { squareKey: key, cells: region.cells });
      }
    }
  }

  // 每个星的可放空格 = 同色色块区域去掉色块自身所在格
  const starCells = new Map<string, Point[]>(); // symId → 可放空格
  const cellCounts: number[] = [];
  for (const s of symbols) {
    const info = regionByColor.get(s.color || 'black');
    const cells = info ? info.cells.filter((p) => pointKey(p) !== info.squareKey) : [];
    starCells.set(s.id, cells);
    cellCounts.push(cells.length);
  }

  const totalCount = cellCounts.reduce((a, b) => a * b, 1);

  // 符号/组的格子得分：某色星的每个可放格参与 Π(其余两色数量) 种合法摆放
  const symbolCellScores: Record<string, Record<string, number>> = {};
  const groupCellScores: Record<string, number> = {};
  symbols.forEach((s, i) => {
    const perCell = totalCount / Math.max(1, cellCounts[i]);
    const map: Record<string, number> = {};
    for (const p of starCells.get(s.id)!) {
      const key = pointKey(p);
      map[key] = perCell;
      groupCellScores[key] = perCell;
    }
    symbolCellScores[s.id] = map;
  });

  // 摆放方法示例（最多 50 个，按混合进制枚举互不相同的组合）
  const examplePlacements: Record<string, OutsideSymbol>[] = [];
  const max = Math.min(50, totalCount);
  for (let i = 0; i < max; i++) {
    const placement: Record<string, OutsideSymbol> = {};
    let n = i;
    for (let j = 0; j < symbols.length; j++) {
      const cells = starCells.get(symbols[j].id)!;
      const idx = n % cells.length;
      n = Math.floor(n / cells.length);
      placement[pointKey(cells[idx])] = symbols[j];
    }
    examplePlacements.push(placement);
  }

  const symbolDetails: Record<string, SymbolPlacementDetail> = {};
  const symbolScores: Record<string, number> = {};
  for (const s of symbols) {
    symbolScores[s.id] = totalCount;
    symbolDetails[s.id] = {
      symbolId: s.id,
      symbol: s,
      score: totalCount,
      validPositions: starCells.get(s.id)!,
      cellScores: symbolCellScores[s.id],
    };
  }

  const groupDetails: Record<string, GroupPlacementDetail> = {
    [groupId]: {
      groupId,
      symbols,
      score: totalCount,
      validPositions: symbols.flatMap((s) => starCells.get(s.id)!),
      validConfigurationsCount: totalCount,
      symbolCellScores,
      groupCellScores,
      examplePlacements,
    },
  };
  const groupScores: Record<string, number> = { [groupId]: totalCount };

  // 选中过滤（与通用路径一致：默认展示组内第一个符号的格子得分）
  let activePositions: Point[] = [];
  let activeCellScores: Record<string, number> = {};
  let activeScore = totalCount;
  if (candidateSymbolId && symbolDetails[candidateSymbolId]) {
    const d = symbolDetails[candidateSymbolId];
    activePositions = d.validPositions;
    activeCellScores = d.cellScores;
    activeScore = d.score;
  } else if (candidateGroupId && groupDetails[candidateGroupId]) {
    const d = groupDetails[candidateGroupId];
    const firstScores = d.symbolCellScores[d.symbols[0].id] || {};
    activePositions = Object.keys(firstScores).map(parsePointKey);
    activeCellScores = firstScores;
    activeScore = d.score;
  } else {
    const d = groupDetails[groupId];
    const firstScores = d.symbolCellScores[d.symbols[0].id] || {};
    activePositions = Object.keys(firstScores).map(parsePointKey);
    activeCellScores = firstScores;
  }

  const rules = applyScoreRules(puzzle, totalCount, activeScore, groupScores, symbolScores);

  return {
    puzzleTitle: puzzle.title,
    totalScore: rules.totalScore,
    score: rules.score,
    totalEmptyCells: puzzle.width * puzzle.height - Object.keys(puzzle.cellSymbols).length,
    validPositions: activePositions,
    cellScores: activeCellScores,
    groupScores: rules.groupScores,
    groupDetails,
    symbolScores: rules.symbolScores,
    symbolDetails,
    candidateGroupId: candidateGroupId || null,
    candidateSymbolId: candidateSymbolId || null,
    candidateSymbol: candidateSymbol || null,
    targetScore: rules.targetScore,
    targetMet: rules.targetMet,
    rawTotalScore: rules.rawTotalScore,
    maxScore: rules.maxScore,
    maxReached: rules.maxReached,
    baselineScore: puzzle.baselineScore,
    belowBaseline: rules.belowBaseline,
    bonus: rules.bonus,
  };
}

function areSymbolsIdentical(a: OutsideSymbol, b: OutsideSymbol): boolean {
  if (
    a.type !== b.type ||
    a.color !== b.color ||
    a.count !== b.count ||
    a.rotatable !== b.rotatable ||
    a.negative !== b.negative
  ) {
    return false;
  }
  if (a.type === 'polyomino') {
    return JSON.stringify(a.shape) === JSON.stringify(b.shape);
  }
  return true;
}

export function calculatePlacementScore(
  puzzle: PuzzleDefinition,
  path: Point[],
  candidateFilter?: string | OutsideSymbol | null
): PlacementScoreResult {
  const symbols = puzzle.outsideSymbols;

  let candidateGroupId: string | null = null;
  let candidateSymbolId: string | null = null;
  let candidateSymbol: OutsideSymbol | null = null;

  if (typeof candidateFilter === 'string') {
    // Could be symbolId or groupId
    const matchedSym = symbols.find((s) => s.id === candidateFilter);
    if (matchedSym) {
      candidateSymbolId = matchedSym.id;
      candidateGroupId = matchedSym.groupId || matchedSym.id;
      candidateSymbol = matchedSym;
    } else {
      candidateGroupId = candidateFilter;
    }
  } else if (candidateFilter && typeof candidateFilter === 'object') {
    candidateSymbol = candidateFilter;
    candidateSymbolId = candidateFilter.id;
    candidateGroupId = candidateFilter.groupId || candidateFilter.id;
  }

  if (path.length === 0) {
    return {
      puzzleTitle: puzzle.title,
      totalScore: 0,
      score: 0,
      totalEmptyCells: 0,
      validPositions: [],
      cellScores: {},
      groupScores: {},
      groupDetails: {},
      symbolScores: {},
      symbolDetails: {},
      candidateGroupId: null,
      candidateSymbolId: null,
      candidateSymbol: null,
      bonus: 0,
    };
  }

  // 无外部符号的题（如第 0 关）：分数恒为 0，但仍需套用计分规则，
  // 使 maxScore: 0 时 maxReached 正确为 true（得分条黄柱、解出即揭示上限）
  if (symbols.length === 0) {
    const rules = applyScoreRules(puzzle, 0, 0, {}, {});
    return {
      puzzleTitle: puzzle.title,
      totalScore: rules.totalScore,
      score: 0,
      totalEmptyCells: 0,
      validPositions: [],
      cellScores: {},
      groupScores: {},
      groupDetails: {},
      symbolScores: {},
      symbolDetails: {},
      candidateGroupId: candidateGroupId || null,
      candidateSymbolId: candidateSymbolId || null,
      candidateSymbol: candidateSymbol || null,
      targetScore: rules.targetScore,
      targetMet: rules.targetMet,
      rawTotalScore: rules.rawTotalScore,
      maxScore: rules.maxScore,
      maxReached: rules.maxReached,
      baselineScore: puzzle.baselineScore,
      belowBaseline: rules.belowBaseline,
      bonus: rules.bonus,
    };
  }

  // Verify baseline puzzle validity with the current path
  const baseResult = validatePuzzle(puzzle, path);
  if (!baseResult.valid) {
    return {
      puzzleTitle: puzzle.title,
      totalScore: 0,
      score: 0,
      totalEmptyCells: 0,
      validPositions: [],
      cellScores: {},
      groupScores: {},
      groupDetails: {},
      symbolScores: {},
      symbolDetails: {},
      candidateGroupId,
      candidateSymbolId,
      candidateSymbol,
      bonus: 0,
    };
  }

  // 2-9 特判快速通道：三个不同色星 + 三个一一对应的同色方块 → 乘积公式
  if (isStarProductPuzzle(puzzle)) {
    return calculateStarProductScore(
      puzzle,
      baseResult,
      candidateGroupId,
      candidateSymbolId,
      candidateSymbol
    );
  }

  // Gather all empty cells on the grid
  const emptyCells: Point[] = [];
  for (let r = 0; r < puzzle.height; r++) {
    for (let c = 0; c < puzzle.width; c++) {
      if (!puzzle.cellSymbols[`${r},${c}`]) {
        emptyCells.push({ r, c });
      }
    }
  }

  // —— 面积守恒剪枝预计算 ——
  // 区域形状只由路径决定（候选摆放只改格内符号、不改边），因此各区域的
  // 格子数与区域内固有骨牌面积和可一次性算好；候选摆放若让某区域
  // 「骨牌面积和 ≠ 区域面积」，拼合必不成立，可跳过完整的棋盘判定
  const regionIndexByCell = new Map<string, number>();
  const regionSizes: number[] = [];
  const regionFixedAreas: number[] = [];
  for (const region of baseResult.regions ?? []) {
    const idx = regionSizes.length;
    let fixedArea = 0;
    for (const { symbol } of region.symbols) {
      if (symbol.type === 'polyomino' && symbol.shape) {
        fixedArea += getPolyominoArea(symbol.shape) * (symbol.negative ? -1 : 1);
      }
    }
    regionSizes.push(region.cells.length);
    regionFixedAreas.push(fixedArea);
    for (const cell of region.cells) {
      regionIndexByCell.set(pointKey(cell), idx);
    }
  }

  const groups = getOutsideSymbolGroups(symbols);
  const groupScores: Record<string, number> = {};
  const groupDetails: Record<string, GroupPlacementDetail> = {};
  const symbolScores: Record<string, number> = {};
  const symbolDetails: Record<string, SymbolPlacementDetail> = {};
  let totalScore = 0;

  for (const group of groups) {
    const k = group.symbols.length;
    if (k === 0) continue;

    const symCellScores: Record<string, Record<string, number>> = {};
    for (const s of group.symbols) {
      symCellScores[s.id] = {};
    }
    const groupCellScores: Record<string, number> = {};

    // If not enough empty cells to hold all group symbols simultaneously:
    if (emptyCells.length < k) {
      groupScores[group.id] = 0;
      groupDetails[group.id] = {
        groupId: group.id,
        symbols: group.symbols,
        score: 0,
        validPositions: [],
        validConfigurationsCount: 0,
        symbolCellScores: symCellScores,
        groupCellScores: {},
        examplePlacements: [],
      };
      for (const sym of group.symbols) {
        symbolScores[sym.id] = 0;
        symbolDetails[sym.id] = {
          symbolId: sym.id,
          symbol: sym,
          score: 0,
          validPositions: [],
          cellScores: {},
        };
      }
      continue;
    }

    // Sort symbols so identical symbols are consecutive, enabling multiset permutation search
    const syms = [...group.symbols].sort((a, b) => {
      const sa = `${a.type}:${a.color}:${a.count}:${a.rotatable}:${a.negative}:${JSON.stringify(a.shape)}`;
      const sb = `${b.type}:${b.color}:${b.count}:${b.rotatable}:${b.negative}:${JSON.stringify(b.shape)}`;
      return sa.localeCompare(sb);
    });

    // 组内骨牌符号面积（按 negative 取正负号）：候选面积剪枝用
    const symAreas = syms.map((s) =>
      s.type === 'polyomino' && s.shape
        ? getPolyominoArea(s.shape) * (s.negative ? -1 : 1)
        : null
    );
    const groupHasPoly = symAreas.some((a) => a !== null);

    const chosenIndices = new Array<number>(k);
    const usedCellIndices = new Uint8Array(emptyCells.length);
    const participatingCellIndices = new Set<number>();
    let validConfigurationsCount = 0;
    const examplePlacements: Record<string, OutsideSymbol>[] = [];

    function backtrack(sIdx: number) {
      // 相同符号交换位置算作同一个解：相同符号按格子索引递增，直接去重枚举
      const start =
        sIdx > 0 && areSymbolsIdentical(syms[sIdx], syms[sIdx - 1])
          ? chosenIndices[sIdx - 1] + 1
          : 0;

      for (let cIdx = start; cIdx < emptyCells.length; cIdx++) {
        if (usedCellIndices[cIdx]) continue;

        usedCellIndices[cIdx] = 1;
        chosenIndices[sIdx] = cIdx;

        if (sIdx === k - 1) {
          // —— 面积守恒剪枝 ——
          // 某区域的骨牌面积和（固有 + 本次摆放）与区域面积不符时，
          // 拼合必不成立：直接跳过完整判定（不计分、不进示例）
          let areaOk = true;
          if (groupHasPoly) {
            const delta = new Array<number>(regionSizes.length).fill(0);
            for (let i = 0; i < k; i++) {
              const a = symAreas[i];
              if (a === null) continue;
              const cell = emptyCells[chosenIndices[i]];
              const rIdx = regionIndexByCell.get(`${cell.r},${cell.c}`);
              if (rIdx === undefined) continue;
              delta[rIdx] += a;
            }
            for (let ri = 0; ri < regionSizes.length; ri++) {
              if (delta[ri] !== 0 && regionFixedAreas[ri] + delta[ri] !== regionSizes[ri]) {
                areaOk = false;
                break;
              }
            }
          }
          if (!areaOk) {
            // 面积对不上：该候选必不合法
          } else {
            // All k symbols placed in distinct empty cells simultaneously
            const testCellSymbols = { ...puzzle.cellSymbols };
            for (let i = 0; i < k; i++) {
              const cell = emptyCells[chosenIndices[i]];
              const s = syms[i];
              testCellSymbols[`${cell.r},${cell.c}`] = {
                type: s.type,
                color: s.color,
                count: s.count,
                shape: s.shape,
                rotatable: s.rotatable,
                negative: s.negative,
              };
            }

            const testPuzzle: PuzzleDefinition = {
              ...puzzle,
              cellSymbols: testCellSymbols,
            };

            const testResult = validatePuzzle(testPuzzle, path);
            if (testResult.valid) {
              validConfigurationsCount++;

              // 捕获合法放置方案作为"摆放方法"示例（最多 50 个）
              if (examplePlacements.length < 50) {
                const placement: Record<string, OutsideSymbol> = {};
                for (let i = 0; i < k; i++) {
                  const cell = emptyCells[chosenIndices[i]];
                  placement[`${cell.r},${cell.c}`] = syms[i];
                }
                examplePlacements.push(placement);
              }

              // 每个合法配置只累计一次：格子参与 +1；每个符号 +1 到所有
              // 放有与其相同符号的格子（相同符号的格子视图一致）
              for (let i = 0; i < k; i++) {
                const cell = emptyCells[chosenIndices[i]];
                const cKey = `${cell.r},${cell.c}`;
                groupCellScores[cKey] = (groupCellScores[cKey] || 0) + 1;
                participatingCellIndices.add(chosenIndices[i]);
              }
              for (const sym of group.symbols) {
                for (let i = 0; i < k; i++) {
                  if (areSymbolsIdentical(syms[i], sym)) {
                    const cell = emptyCells[chosenIndices[i]];
                    const cKey = `${cell.r},${cell.c}`;
                    symCellScores[sym.id][cKey] = (symCellScores[sym.id][cKey] || 0) + 1;
                  }
                }
              }
            }
          }
        } else {
          backtrack(sIdx + 1);
        }

        usedCellIndices[cIdx] = 0;
      }
    }

    backtrack(0);

    const validPositions: Point[] = Array.from(participatingCellIndices).map(
      (idx) => emptyCells[idx]
    );

    groupScores[group.id] = validConfigurationsCount;
    groupDetails[group.id] = {
      groupId: group.id,
      symbols: group.symbols,
      score: validConfigurationsCount,
      validPositions,
      validConfigurationsCount,
      symbolCellScores: symCellScores,
      groupCellScores,
      examplePlacements,
    };
    totalScore += validConfigurationsCount;

    // Populate individual symbol details and cell scores
    for (const sym of group.symbols) {
      const symValidPos = Object.keys(symCellScores[sym.id] || {}).map(parsePointKey);
      symbolScores[sym.id] = validConfigurationsCount;
      symbolDetails[sym.id] = {
        symbolId: sym.id,
        symbol: sym,
        score: validConfigurationsCount,
        validPositions: symValidPos,
        cellScores: symCellScores[sym.id] || {},
      };
    }
  }

  // Active positions & active score resolution
  let activePositions: Point[] = [];
  let activeCellScores: Record<string, number> = {};
  let activeScore = totalScore;

  if (candidateSymbolId && symbolDetails[candidateSymbolId]) {
    // A specific symbol is independently selected by the player!
    activePositions = symbolDetails[candidateSymbolId].validPositions;
    activeCellScores = symbolDetails[candidateSymbolId].cellScores;
    activeScore = symbolDetails[candidateSymbolId].score;
  } else if (candidateGroupId && groupDetails[candidateGroupId]) {
    // A group is selected：默认只展示组内第一个符号提供的分数（避免同组符号分数叠加）
    const detail = groupDetails[candidateGroupId];
    const firstSymbol = detail.symbols[0];
    const firstScores =
      (firstSymbol && detail.symbolCellScores[firstSymbol.id]) || {};
    activePositions = Object.keys(firstScores).map(parsePointKey);
    activeCellScores = firstScores;
    activeScore = detail.score;
  } else {
    // General overview: 默认展示每组第一个符号的放置得分。
    // 同组分数只计一次，若把所有符号的格子得分全部叠加，看起来会像获得多倍分数。
    const seen = new Set<string>();
    for (const detail of Object.values(groupDetails)) {
      const firstSymbol = detail.symbols[0];
      const firstScores =
        (firstSymbol && detail.symbolCellScores[firstSymbol.id]) || {};
      for (const key of Object.keys(firstScores)) {
        if (!seen.has(key)) {
          seen.add(key);
          activePositions.push(parsePointKey(key));
        }
        activeCellScores[key] =
          (activeCellScores[key] || 0) + (firstScores[key] || 0);
      }
    }
  }

  const rules = applyScoreRules(puzzle, totalScore, activeScore, groupScores, symbolScores);

  return {
    puzzleTitle: puzzle.title,
    totalScore: rules.totalScore,
    score: rules.score,
    totalEmptyCells: emptyCells.length,
    validPositions: activePositions,
    cellScores: activeCellScores,
    groupScores: rules.groupScores,
    groupDetails,
    symbolScores: rules.symbolScores,
    symbolDetails,
    candidateGroupId: candidateGroupId || null,
    candidateSymbolId: candidateSymbolId || null,
    candidateSymbol: candidateSymbol || null,
    targetScore: rules.targetScore,
    targetMet: rules.targetMet,
    rawTotalScore: rules.rawTotalScore,
    maxScore: rules.maxScore,
    maxReached: rules.maxReached,
    baselineScore: puzzle.baselineScore,
    belowBaseline: rules.belowBaseline,
    bonus: rules.bonus,
  };
}
