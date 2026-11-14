/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import {
  Point,
  PuzzleDefinition,
  ValidationResult,
  PlacementScoreResult,
  OutsideSymbol,
  OutsideGroup,
  ColorType,
  SymbolType,
  edgeKey,
  pointKey,
  getOutsideSymbolGroups,
} from '../types/puzzle';
import { PuzzleSymbol, HexagonDot } from './PuzzleSymbol';
import { getSymmetricPath } from '../engine/validator';
import { sound } from '../utils/audio';
import { getPuzzleMaxFinalScore } from '../utils/storage';
import { t, useLang } from '../utils/i18n';
import { useTheme, getBoardPalette } from '../utils/theme';
import { X, Plus, Trash2, Layers, Eye, ChevronLeft, ChevronRight } from 'lucide-react';

// 得分条的非线性映射（0~1，从下往上）：
// 锚点：基准线 40%、目标分 80%、最大分 100%，各锚点之间分段线性插值
function scoreToFraction(
  score: number,
  baseline: number,
  targetRaw: number | null,
  maxRaw: number | null
): number {
  if (score <= 0) return 0;

  const anchors: Array<{ score: number; frac: number }> = [];
  if (baseline > 0) anchors.push({ score: baseline, frac: 0.4 });
  if (targetRaw != null) anchors.push({ score: targetRaw, frac: 0.8 });
  if (maxRaw != null) anchors.push({ score: maxRaw, frac: 1 });

  if (anchors.length === 0) return 1; // 无锚点：有分即满

  if (anchors.length === 1) {
    const a = anchors[0];
    if (baseline > 0) {
      // 只有基准线：基准线以上继续延伸（2 倍基准线到顶）
      if (score <= a.score) return (a.frac * score) / Math.max(a.score, 1);
      return Math.min(1, a.frac + ((1 - a.frac) * (score - a.score)) / Math.max(a.score, 1));
    }
    return Math.min(a.frac, (a.frac * score) / Math.max(a.score, 1));
  }

  if (score <= anchors[0].score) {
    return (anchors[0].frac * score) / Math.max(anchors[0].score, 1);
  }
  for (let i = 1; i < anchors.length; i++) {
    const lo = anchors[i - 1];
    const hi = anchors[i];
    if (score <= hi.score) {
      return lo.frac + ((hi.frac - lo.frac) * (score - lo.score)) / Math.max(hi.score - lo.score, 1);
    }
  }
  return anchors[anchors.length - 1].frac; // 超过最高锚点 → 封顶
}

/** 点到线段的最短距离（线段两端点 a、b）：用于判定点击是否落在某条边上 */
function distToSegment(
  pt: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy));
}

/** 元素在视口中的布局 x 坐标（沿 offsetParent 链累加 offsetLeft，不含 transform） */
function offsetLeftInViewport(node: HTMLElement | null): number {
  let x = 0;
  let n: HTMLElement | null = node;
  while (n) {
    x += n.offsetLeft;
    n = n.offsetParent as HTMLElement | null;
  }
  return x;
}

interface PuzzleCanvasProps {
  puzzle: PuzzleDefinition;
  isEditMode: boolean;
  selectedTool: string;
  selectedColor: ColorType;
  polyominoShape: boolean[][];
  triangleCount: number;
  rotatablePoly: boolean;
  negativePoly: boolean;
  onUpdatePuzzle: (updated: PuzzleDefinition) => void;
  activePath: Point[];
  setActivePath: React.Dispatch<React.SetStateAction<Point[]>>;
  validationResult: ValidationResult | null;
  onValidatePath: (path: Point[]) => void;
  placementScore: PlacementScoreResult | null;
  selectedGroupId: string | null;
  onSelectGroupId: (gid: string | null) => void;
  selectedSymbolId: string | null;
  onSelectSymbolId: (id: string | null) => void;
  showResonanceHeatmap: boolean;
  setShowResonanceHeatmap: (val: boolean) => void;
  bestScore?: number; // 该题历史最高分（用于"最高分"标记是否揭示确切数值）
  maxEverReached?: boolean; // 曾达到过最大分（localStorage 持久化，揭示后永久显示数值）
}

export const PuzzleCanvas: React.FC<PuzzleCanvasProps> = ({
  puzzle,
  isEditMode,
  selectedTool,
  selectedColor,
  polyominoShape,
  triangleCount,
  rotatablePoly,
  negativePoly,
  onUpdatePuzzle,
  activePath,
  setActivePath,
  validationResult,
  onValidatePath,
  placementScore,
  selectedGroupId,
  onSelectGroupId,
  selectedSymbolId,
  onSelectSymbolId,
  showResonanceHeatmap,
  setShowResonanceHeatmap,
  bestScore,
  maxEverReached,
}) => {
  useLang(); // 语言切换时重渲染（得分条标签等文案）
  const theme = useTheme(); // 主题切换时重渲染（题板配色、得分柱）
  const boardColors = getBoardPalette(theme);
  const [isDrawing, setIsDrawing] = useState(false);
  const [dragHead, setDragHead] = useState<{ x: number; y: number } | null>(null);
  const [demoGroupId, setDemoGroupId] = useState<string | null>(null);
  const [demoIndex, setDemoIndex] = useState(0);
  // 玩家格子标记（做题笔记，不保存）："r,c" 键的集合
  const [markedCells, setMarkedCells] = useState<Set<string>>(new Set());
  // 玩家边标记（做题笔记，不保存）：edgeKey 键的集合
  const [markedEdges, setMarkedEdges] = useState<Set<string>>(new Set());

  // 切换题目时在渲染阶段同步清除摆放方法演示与格子/边标记，避免旧题状态在新题板上闪现一帧
  const [prevPuzzleTitle, setPrevPuzzleTitle] = useState(puzzle.title);
  if (prevPuzzleTitle !== puzzle.title) {
    setPrevPuzzleTitle(puzzle.title);
    setDemoGroupId(null);
    setDemoIndex(0);
    setMarkedCells(new Set());
    setMarkedEdges(new Set());
  }

  useEffect(() => {
    if (activePath.length <= 1) {
      setDemoGroupId(null);
      setDemoIndex(0);
    }
  }, [activePath]);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Layout metrics
  // 题板长宽过大时按需缩小格子（目标网格 ≤ 560×440 px），
  // 避免大关（6×6、7×7、8×N 等）挤出屏幕
  const cellSize = Math.max(
    48,
    Math.min(80, Math.floor(Math.min(560 / puzzle.width, 440 / puzzle.height)))
  );
  // 网格四周留白：容纳终点圆弧外伸 ~25px、起点圆 22px、底板 48px 边距与点击容差
  const paddingX = 80;
  const paddingY = 80;
  const gridWidth = puzzle.width * cellSize;
  const gridHeight = puzzle.height * cellSize;
  const totalSvgWidth = gridWidth + paddingX * 2;
  const totalSvgHeight = gridHeight + paddingY * 2;

  const lineWidth = 18;
  const startRadius = 22;
  const endRadius = lineWidth / 2; // 终点半圆半径 = 线条圆头半径
  const endStemLength = 16; // 终点半圆先沿出口方向外延的长度（圆弧从顶点外 7px 处开始）
  const gapHalf = 11; // 阻断缺口半宽（缺口两侧各让出的宽度）
  const headRadius = lineWidth / 2 - 1; // 拖拽头圆半径（比线宽略细）

  // 玩家格子标记（右下角小直角三角形）：直角顶点藏进 18px 宽网格线之下（线侵入格内 9px），
  // 标记从线内缘钻出、与格线无缝相接；颜色随主题反相——亮色题板用中深灰、深色题板用中浅灰
  const markInset = 5;
  const markSize = 30;
  const markColor = theme === 'light' ? '#64748b' : '#94a3b8';

  const vertexCoords = useCallback(
    (p: Point) => ({
      x: paddingX + p.c * cellSize,
      y: paddingY + p.r * cellSize,
    }),
    [cellSize, paddingX, paddingY]
  );

  const cellCoords = useCallback(
    (r: number, c: number) => ({
      cx: paddingX + c * cellSize + cellSize / 2,
      cy: paddingY + r * cellSize + cellSize / 2,
    }),
    [cellSize, paddingX, paddingY]
  );

  // Compute symmetric secondary path
  const symmetricPath = useMemo(() => {
    return getSymmetricPath(
      activePath,
      puzzle.symmetry,
      puzzle.width,
      puzzle.height
    );
  }, [activePath, puzzle.symmetry, puzzle.width, puzzle.height]);

  // Broken edge set
  const brokenEdgesSet = useMemo(
    () => new Set(puzzle.brokenEdges),
    [puzzle.brokenEdges]
  );

  // Start point set
  const startKeys = useMemo(
    () => new Set(puzzle.starts.map(pointKey)),
    [puzzle.starts]
  );

  // End point map
  const endPointsMap = useMemo(() => {
    const map = new Map<string, Point & { dir: string }>();
    puzzle.ends.forEach((e) => map.set(pointKey(e), e));
    return map;
  }, [puzzle.ends]);

  // 报错符号闪红 3 下（0.6s × 3 周期 = 1.8s）后恢复原本颜色：
  // 动画 0%/100% 都是本色相位，结束时无缝恢复
  const [showInvalidFlash, setShowInvalidFlash] = useState(false);
  useEffect(() => {
    if (validationResult && !validationResult.valid) {
      setShowInvalidFlash(true);
      const t = setTimeout(() => setShowInvalidFlash(false), 1800);
      return () => clearTimeout(t);
    }
    setShowInvalidFlash(false);
  }, [validationResult]);

  // Set of invalid symbol keys for animation
  const invalidKeysSet = useMemo(() => {
    if (!showInvalidFlash) return new Set<string>();
    if (!validationResult || validationResult.valid) return new Set<string>();
    return new Set(validationResult.invalidSymbols);
  }, [validationResult, showInvalidFlash]);

  // Heatmap valid position keys
  const resonanceValidKeys = useMemo(() => {
    if (!placementScore || !placementScore.validPositions) return new Set<string>();
    return new Set(placementScore.validPositions.map(pointKey));
  }, [placementScore]);

  // Symbol groups extracted from outsideSymbols
  const groups: OutsideGroup[] = useMemo(
    () => getOutsideSymbolGroups(puzzle.outsideSymbols),
    [puzzle.outsideSymbols]
  );

  // 左侧符号组卡片总高度超过题板高度时，整体缩放以放进题板高度内
  const groupListRef = useRef<HTMLDivElement | null>(null);
  const [groupScale, setGroupScale] = useState(1);
  useLayoutEffect(() => {
    const el = groupListRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const avail = parent.clientHeight;
    const natural = el.scrollHeight;
    if (natural > 0 && avail > 0 && natural > avail) {
      setGroupScale(Math.max(0.5, avail / natural));
    } else {
      setGroupScale(1);
    }
  }, [groups, puzzle.width, puzzle.height]);

  const createSymbolFromTool = useCallback(
    (groupId?: string): OutsideSymbol => {
      const baseId = `out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      if (selectedTool === 'cancellation') {
        return {
          id: baseId,
          groupId,
          type: 'eraser',
          color: 'white',
        };
      } else if (selectedTool === 'polyomino') {
        return {
          id: baseId,
          groupId,
          type: 'polyomino',
          color: negativePoly ? 'cyan' : 'yellow',
          shape: polyominoShape,
          rotatable: rotatablePoly,
          negative: negativePoly,
        };
      } else if (selectedTool === 'triangle') {
        return {
          id: baseId,
          groupId,
          type: 'triangle',
          color: 'orange',
          count: triangleCount,
        };
      } else if (selectedTool === 'star') {
        return {
          id: baseId,
          groupId,
          type: 'star',
          color: selectedColor,
        };
      } else {
        return {
          id: baseId,
          groupId,
          type: 'square',
          color: selectedColor,
        };
      }
    },
    [selectedTool, selectedColor, polyominoShape, rotatablePoly, negativePoly, triangleCount]
  );

  const handleCreateGroup = useCallback(() => {
    const newGid = `group-${Date.now()}`;
    const newSym = createSymbolFromTool(newGid);
    onUpdatePuzzle({
      ...puzzle,
      outsideSymbols: [...puzzle.outsideSymbols, newSym],
    });
    sound.playTick(1.2);
  }, [puzzle, createSymbolFromTool, onUpdatePuzzle]);

  const handleAddSymbolToGroup = useCallback(
    (groupId: string) => {
      const group = groups.find((g) => g.id === groupId);
      if (!group || group.symbols.length >= 3) return;
      const newSym = createSymbolFromTool(groupId);
      const updatedSymbols = puzzle.outsideSymbols.map((s) =>
        (s.groupId || s.id) === groupId ? { ...s, groupId } : s
      );
      onUpdatePuzzle({
        ...puzzle,
        outsideSymbols: [...updatedSymbols, newSym],
      });
      sound.playTick(1.1);
    },
    [groups, createSymbolFromTool, puzzle, onUpdatePuzzle]
  );

  const handleDeleteSymbol = useCallback(
    (symId: string) => {
      const updatedSymbols = puzzle.outsideSymbols.filter((s) => s.id !== symId);
      onUpdatePuzzle({
        ...puzzle,
        outsideSymbols: updatedSymbols,
      });
      sound.playTick(0.8);
    },
    [puzzle, onUpdatePuzzle]
  );

  const handleDeleteGroup = useCallback(
    (groupId: string) => {
      const updatedSymbols = puzzle.outsideSymbols.filter(
        (s) => (s.groupId || s.id) !== groupId
      );
      onUpdatePuzzle({
        ...puzzle,
        outsideSymbols: updatedSymbols,
      });
      if (selectedGroupId === groupId) {
        onSelectGroupId(null);
      }
      sound.playTick(0.8);
    },
    [puzzle, onUpdatePuzzle, selectedGroupId, onSelectGroupId]
  );

  // Convert mouse/touch event to SVG coordinate
  const getSvgPoint = useCallback(
    (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent): { x: number; y: number } | null => {
      if (!svgRef.current) return null;
      const svg = svgRef.current;
      const rect = svg.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0]?.clientY ?? e.changedTouches[0]?.clientY : e.clientY;
      if (clientX === undefined || clientY === undefined) return null;

      // Scale to SVG viewBox
      const scaleX = totalSvgWidth / rect.width;
      const scaleY = totalSvgHeight / rect.height;

      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    },
    [totalSvgWidth, totalSvgHeight]
  );

  // Find closest grid vertex
  const getClosestVertex = useCallback(
    (pt: { x: number; y: number }): { point: Point; dist: number } => {
      let closest: Point = { r: 0, c: 0 };
      let minDist = Infinity;

      for (let r = 0; r <= puzzle.height; r++) {
        for (let c = 0; c <= puzzle.width; c++) {
          const coords = vertexCoords({ r, c });
          const dx = pt.x - coords.x;
          const dy = pt.y - coords.y;
          const dist = Math.hypot(dx, dy);
          if (dist < minDist) {
            minDist = dist;
            closest = { r, c };
          }
        }
      }
      return { point: closest, dist: minDist };
    },
    [puzzle.height, puzzle.width, vertexCoords]
  );

  // 点击格子切换该格的标记（做题笔记，不保存、切换题目即清除）
  const handleToggleMark = useCallback(
    (pt: { x: number; y: number }) => {
      const c = Math.floor((pt.x - paddingX) / cellSize);
      const r = Math.floor((pt.y - paddingY) / cellSize);
      if (r < 0 || r >= puzzle.height || c < 0 || c >= puzzle.width) return;
      const key = `${r},${c}`;
      const adding = !markedCells.has(key);
      setMarkedCells((prev) => {
        const next = new Set(prev);
        if (adding) next.add(key);
        else next.delete(key);
        return next;
      });
    },
    [markedCells, paddingX, paddingY, cellSize, puzzle.width, puzzle.height]
  );

  // 点击边切换该边的标记（做题笔记，不保存、切换题目即清除）。
  // 命中判定：点击点距最近边线段 ≤ 网格线半宽 + 4px 容差即算点中该边；
  // 返回是否命中（未命中则交回格子标记判定）
  const markEdgeTolerance = lineWidth / 2 + 4;
  const handleToggleEdgeMark = useCallback(
    (pt: { x: number; y: number }): boolean => {
      let bestKey: string | null = null;
      let bestDist = Infinity;
      const consider = (p1: Point, p2: Point) => {
        const a = vertexCoords(p1);
        const b = vertexCoords(p2);
        const d = distToSegment(pt, a, b);
        if (d < bestDist) {
          bestDist = d;
          bestKey = edgeKey(p1, p2);
        }
      };
      for (let r = 0; r <= puzzle.height; r++) {
        for (let c = 0; c < puzzle.width; c++) {
          consider({ r, c }, { r, c: c + 1 });
        }
      }
      for (let r = 0; r < puzzle.height; r++) {
        for (let c = 0; c <= puzzle.width; c++) {
          consider({ r, c }, { r: r + 1, c });
        }
      }
      if (!bestKey || bestDist > markEdgeTolerance) return false;
      const key = bestKey;
      const adding = !markedEdges.has(key);
      setMarkedEdges((prev) => {
        const next = new Set(prev);
        if (adding) next.add(key);
        else next.delete(key);
        return next;
      });
      return true;
    },
    [markedEdges, vertexCoords, puzzle.width, puzzle.height, markEdgeTolerance]
  );

  // Clear drag head when active path is cleared externally or entering edit mode
  useEffect(() => {
    if (activePath.length === 0 || isEditMode) {
      setDragHead(null);
      setIsDrawing(false);
    }
  }, [activePath.length, isEditMode]);

  // 线头是否已推进到终点圆弧（沿出口方向越过终点顶点并抵达圆弧近缘）。
  // 「点击判定」与「抵达圆弧闪烁动画」共用此条件
  const isHeadInArc = (): boolean => {
    if (!isDrawing || activePath.length === 0 || !dragHead) return false;
    const curr = activePath[activePath.length - 1];
    const endInfo = endPointsMap.get(pointKey(curr));
    if (!endInfo) return false;
    const c = vertexCoords(curr);
    const reach = endStemLength - endRadius; // 圆弧近缘到终点顶点的距离
    if (endInfo.dir === 'up') return c.y - dragHead.y >= reach;
    if (endInfo.dir === 'down') return dragHead.y - c.y >= reach;
    if (endInfo.dir === 'left') return c.x - dragHead.x >= reach;
    return dragHead.x - c.x >= reach;
  };

  // Handle pointer down (Click to start, move freely, click to submit/cancel)
  const handlePointerDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 2) {
      // Right-click always cancels/resets active drawing
      if (isDrawing) {
        sound.playBacktrack();
        setIsDrawing(false);
        setDragHead(null);
        setActivePath([]);
      }
      return;
    }
    if (e.button !== 0) return; // Left click only

    const pt = getSvgPoint(e);
    if (!pt) return;

    if (!isEditMode) {
      if (!isDrawing) {
        // First click: start drawing from start circle
        const { point, dist } = getClosestVertex(pt);
        if (dist < startRadius + 18 && startKeys.has(pointKey(point))) {
          sound.playStart();
          setIsDrawing(true);
          setActivePath([point]);
          setDragHead(vertexCoords(point));
        } else {
          // 未点中起点：先试点击边（切换边标记），未命中边再切换点击格子的标记（做笔记用）
          if (!handleToggleEdgeMark(pt)) {
            handleToggleMark(pt);
          }
        }
      } else {
        // Second click while drawing:
        // 线头已推进到终点圆弧 → 判定交给 window 级监听器（视窗任意位置左键均可触发）；
        // 已在终点顶点但尚未抵达圆弧时点击不中止（继续推进圆弧，或右键取消）；
        // 其余位置点击中止划线（The Witness 同款行为）
        if (!isHeadInArc()) {
          const endInfo = endPointsMap.get(pointKey(activePath[activePath.length - 1]));
          if (!endInfo) {
            sound.playBacktrack();
            setIsDrawing(false);
            setDragHead(null);
            setActivePath([]);
          }
        }
      }
    }
  };

  // 划线抵达终点圆弧后：视窗内任意位置（包括分数条、题板外）按左键都触发判定。
  // 监听 window 级 mousedown：题板内的点击先经 svg 处理器（此时不再判定），
  // 事件冒泡到 window 后统一在这里提交，避免重复判定
  useEffect(() => {
    const onWindowMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (!isDrawing || !isHeadInArc()) return;
      e.preventDefault();
      setIsDrawing(false);
      setDragHead(null);
      onValidatePath(activePath);
    };
    window.addEventListener('mousedown', onWindowMouseDown);
    return () => window.removeEventListener('mousedown', onWindowMouseDown);
  }, [isDrawing, isHeadInArc, onValidatePath]);

  // Handle pointer move with smooth continuous edge tracking
  // 划线手感方案（玩家优化版）：贪心寻路式跟随。每次指针移动时，
  // 路径沿网格逐格向指针位置贪心逼近（允许沿紧邻来路回退），
  // 线头按阻挡规则压线。路径只能一格一格正交推进，结构上不可能
  // 跳过拐角顶点，因此不再需要 popped 名单式的拐角保护
  const handlePointerMove = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!isDrawing || isEditMode || activePath.length === 0) return;
      const pt = getSvgPoint(e);
      if (!pt) return;

      // 贪心逼近：P 从当前路径副本出发，每步取离指针最近、可合法进入的相邻顶点
      //（只允许回到紧邻来路顶点，其余已走过的顶点不可进入——结构上禁止穿拐角），
      // 至多走 (宽+1)×(高+1) 步（覆盖全图最长路径），一步也走不动则停
      const dirs = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ];
      const P = activePath.slice();

      // 从某顶点朝某相邻顶点压线的最大可视距离（按贪心更新后的路径 P 判定已走过顶点）：
      // 出界 → 0（不允许画出边界）；直撞阻断缺口 → 缺口边缘；
      // 撞向已走过（非紧邻来路）的顶点 → 格边长减缺口半宽/线头圆半径/终点圆半径
      // （线头停在该顶点近前，画不进已走过的格子）；其余 → 半格
      const pressDistance = (from: Point, to: Point): number => {
        if (to.r < 0 || to.r > puzzle.height || to.c < 0 || to.c > puzzle.width) return 0;
        // 直撞缺口：线头圆与缺口平头相切时停住（缺口半宽 + 线头圆半径）
        if (brokenEdgesSet.has(edgeKey(from, to))) return cellSize / 2 - gapHalf - headRadius;
        if (
          P.some((q) => q.r === to.r && q.c === to.c) &&
          !(P[P.length - 2] && P[P.length - 2].r === to.r && P[P.length - 2].c === to.c)
        ) {
          return cellSize - gapHalf - headRadius - endRadius;
        }
        return cellSize / 2;
      };

      const distTo = (n: Point): number => {
        const q = vertexCoords(n);
        return Math.hypot(pt.x - q.x, pt.y - q.y);
      };

      let changed = false;
      for (let step = 0; step < (puzzle.width + 1) * (puzzle.height + 1); step++) {
        const cur = P[P.length - 1];
        let best: Point | null = null;
        let bestD = distTo(cur);
        let back = false;
        for (const dir of dirs) {
          const nb = { r: cur.r + dir[0], c: cur.c + dir[1] };
          if (nb.r < 0 || nb.r > puzzle.height || nb.c < 0 || nb.c > puzzle.width) continue;
          if (brokenEdgesSet.has(edgeKey(cur, nb))) continue;
          // 对称谜题：镜像边被阻断同样不可走
          if (puzzle.symmetry !== 'none') {
            const symCur = getSymmetricPath([cur], puzzle.symmetry, puzzle.width, puzzle.height)[0];
            const symNb = getSymmetricPath([nb], puzzle.symmetry, puzzle.width, puzzle.height)[0];
            if (brokenEdgesSet.has(edgeKey(symCur, symNb))) continue;
          }
          const prev = P[P.length - 2];
          const isPrev = !!prev && prev.r === nb.r && prev.c === nb.c;
          if (!isPrev && P.some((q) => q.r === nb.r && q.c === nb.c)) continue;
          const d = distTo(nb);
          if (d < bestD) {
            bestD = d;
            best = nb;
            back = isPrev;
          }
        }
        if (!best) break;
        if (back) P.pop();
        else P.push(best);
        changed = true;
      }
      if (changed) setActivePath(P);

      const last = P[P.length - 1];
      const lp = vertexCoords(last);

      // Check exit extension：到达终点顶点后不再自动判定；
      // 继续沿出口方向拖动时线头伸入终点圆弧（终点半圆的圆心处），
      // 之后的判定由「在圆弧内再点击一次」触发（见 handlePointerDown）
      if (endPointsMap.has(pointKey(last))) {
        const endInfo = endPointsMap.get(pointKey(last))!;
        const rx = pt.x - lp.x;
        const ry = pt.y - lp.y;
        if (
          (endInfo.dir === 'up' && ry < -4) ||
          (endInfo.dir === 'down' && ry > 4) ||
          (endInfo.dir === 'left' && rx < -4) ||
          (endInfo.dir === 'right' && rx > 4)
        ) {
          let exX = lp.x;
          let exY = lp.y;
          if (endInfo.dir === 'up') exY -= Math.min(endStemLength, Math.abs(ry));
          else if (endInfo.dir === 'down') exY += Math.min(endStemLength, Math.abs(ry));
          else if (endInfo.dir === 'left') exX -= Math.min(endStemLength, Math.abs(rx));
          else if (endInfo.dir === 'right') exX += Math.min(endStemLength, Math.abs(rx));
          setDragHead({ x: exX, y: exY });
          return;
        }
      }

      // 线头压线：指针钳制在题板网格范围内，向主导方向压线，
      // 撞向已走过顶点/阻断缺口时停在允许的最远距离
      const dx = Math.min(paddingX + puzzle.width * cellSize, Math.max(paddingX, pt.x)) - lp.x;
      const dy = Math.min(paddingY + puzzle.height * cellSize, Math.max(paddingY, pt.y)) - lp.y;
      if (Math.abs(dx) >= Math.abs(dy)) {
        const nb = { r: last.r, c: last.c + (dx > 0 ? 1 : -1) };
        const lim = pressDistance(last, nb);
        setDragHead({ x: lp.x + (dx > 0 ? 1 : -1) * Math.min(lim, Math.abs(dx)), y: lp.y });
      } else {
        const nb = { r: last.r + (dy > 0 ? 1 : -1), c: last.c };
        const lim = pressDistance(last, nb);
        setDragHead({ x: lp.x, y: lp.y + (dy > 0 ? 1 : -1) * Math.min(lim, Math.abs(dy)) });
      }
    },
    [
      isDrawing,
      isEditMode,
      activePath,
      getSvgPoint,
      vertexCoords,
      endPointsMap,
      endStemLength,
      cellSize,
      puzzle.width,
      puzzle.height,
      brokenEdgesSet,
      puzzle.symmetry,
      setActivePath,
    ]
  );

  useEffect(() => {
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('touchmove', handlePointerMove);
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('touchmove', handlePointerMove);
    };
  }, [handlePointerMove]);

  // Editor click handlers
  const handleCellClick = (r: number, c: number) => {
    if (!isEditMode) return;

    const key = `${r},${c}`;
    const updated = { ...puzzle, cellSymbols: { ...puzzle.cellSymbols } };

    if (selectedTool === 'eraser') {
      delete updated.cellSymbols[key];
      onUpdatePuzzle(updated);
      sound.playTick(0.8);
      return;
    }

    if (selectedTool === 'square') {
      updated.cellSymbols[key] = {
        type: 'square',
        color: selectedColor as any,
      };
    } else if (selectedTool === 'star') {
      updated.cellSymbols[key] = {
        type: 'star',
        color: selectedColor as any,
      };
    } else if (selectedTool === 'triangle') {
      updated.cellSymbols[key] = {
        type: 'triangle',
        count: triangleCount,
        color: 'orange',
      };
    } else if (selectedTool === 'polyomino') {
      updated.cellSymbols[key] = {
        type: 'polyomino',
        color: negativePoly ? 'cyan' : 'yellow',
        shape: polyominoShape,
        rotatable: rotatablePoly,
        negative: negativePoly,
      };
    } else if (selectedTool === 'cancellation') {
      updated.cellSymbols[key] = {
        type: 'eraser',
        color: 'white',
      };
    }

    onUpdatePuzzle(updated);
    sound.playTick(1.2);
  };

  const handleVertexClick = (r: number, c: number) => {
    if (!isEditMode) return;
    const pk = `${r},${c}`;
    const updated = {
      ...puzzle,
      starts: [...puzzle.starts],
      ends: [...puzzle.ends],
      vertexDots: { ...puzzle.vertexDots },
    };

    if (selectedTool === 'eraser') {
      delete updated.vertexDots[pk];
      onUpdatePuzzle(updated);
      sound.playTick(0.8);
      return;
    }

    if (selectedTool === 'start_end') {
      // Cycle: Normal -> Start -> End -> Normal
      const isStart = updated.starts.some((s) => s.r === r && s.c === c);
      const isEnd = updated.ends.some((e) => e.r === r && e.c === c);

      if (isStart) {
        // Switch to End
        updated.starts = updated.starts.filter((s) => !(s.r === r && s.c === c));
        // Default exit direction based on perimeter
        let dir: any = 'up';
        if (r === 0) dir = 'up';
        else if (r === puzzle.height) dir = 'down';
        else if (c === 0) dir = 'left';
        else if (c === puzzle.width) dir = 'right';
        updated.ends.push({ r, c, dir });
      } else if (isEnd) {
        // Remove End
        updated.ends = updated.ends.filter((e) => !(e.r === r && e.c === c));
      } else {
        // Add Start
        updated.starts.push({ r, c });
      }
    } else if (selectedTool === 'dot') {
      if (updated.vertexDots[pk]) {
        delete updated.vertexDots[pk];
      } else {
        updated.vertexDots[pk] = (selectedColor as any) || 'black';
      }
    }

    onUpdatePuzzle(updated);
    sound.playTick(1.1);
  };

  const handleEdgeClick = (p1: Point, p2: Point) => {
    if (!isEditMode) return;
    const key = edgeKey(p1, p2);
    const updated = {
      ...puzzle,
      brokenEdges: [...puzzle.brokenEdges],
      edgeDots: { ...puzzle.edgeDots },
    };

    if (selectedTool === 'eraser') {
      delete updated.edgeDots[key];
      updated.brokenEdges = updated.brokenEdges.filter((k) => k !== key);
      onUpdatePuzzle(updated);
      sound.playTick(0.8);
      return;
    }

    if (selectedTool === 'broken_edge') {
      if (updated.brokenEdges.includes(key)) {
        updated.brokenEdges = updated.brokenEdges.filter((k) => k !== key);
      } else {
        updated.brokenEdges.push(key);
      }
    } else if (selectedTool === 'dot') {
      if (updated.edgeDots[key]) {
        delete updated.edgeDots[key];
      } else {
        updated.edgeDots[key] = (selectedColor as any) || 'black';
      }
    }

    onUpdatePuzzle(updated);
    sound.playTick(1.0);
  };

  // Map an arbitrary SVG point to its symmetric SVG point
  const getSymmetricSvgPoint = useCallback(
    (pt: { x: number; y: number }): { x: number; y: number } => {
      switch (puzzle.symmetry) {
        case 'horizontal':
          return { x: pt.x, y: paddingY + (gridHeight - (pt.y - paddingY)) };
        case 'vertical':
          return { x: paddingX + (gridWidth - (pt.x - paddingX)), y: pt.y };
        case 'rotational':
          return {
            x: paddingX + (gridWidth - (pt.x - paddingX)),
            y: paddingY + (gridHeight - (pt.y - paddingY)),
          };
        case 'none':
        default:
          return pt;
      }
    },
    [puzzle.symmetry, paddingX, paddingY, gridWidth, gridHeight]
  );

  // Build SVG path data for a list of Points plus optional moving head
  const getPathData = (path: Point[], head: { x: number; y: number } | null): string => {
    if (path.length === 0) return '';
    const start = vertexCoords(path[0]);
    let d = `M ${start.x} ${start.y}`;
    // 回溯时拖拽头落在最后一段线段内部（末顶点后方）：渲染跳过末顶点，
    // 最后一段只画到拖拽头，线段随鼠标连续收缩，弹段动作不可见
    let skipLast = false;
    if (head && isDrawing && path.length >= 2) {
      const last = vertexCoords(path[path.length - 1]);
      const prev = vertexCoords(path[path.length - 2]);
      const segX = last.x - prev.x;
      const segY = last.y - prev.y;
      const hx = head.x - prev.x;
      const hy = head.y - prev.y;
      const segLen2 = segX * segX + segY * segY;
      if (segLen2 > 0 && (hx * segX + hy * segY) / segLen2 < 1) skipLast = true;
    }
    for (let i = 1; i < path.length - (skipLast ? 1 : 0); i++) {
      const pt = vertexCoords(path[i]);
      d += ` L ${pt.x} ${pt.y}`;
    }
    if (head && isDrawing) {
      d += ` L ${head.x} ${head.y}`;
    } else if (path.length >= 2) {
      // 若终点是出口：把线延伸到终点半圆内
      const last = path[path.length - 1];
      const endInfo = endPointsMap.get(pointKey(last));
      if (endInfo) {
        const ext = vertexCoords(last);
        if (endInfo.dir === 'up') ext.y -= endStemLength;
        else if (endInfo.dir === 'down') ext.y += endStemLength;
        else if (endInfo.dir === 'left') ext.x -= endStemLength;
        else if (endInfo.dir === 'right') ext.x += endStemLength;
        d += ` L ${ext.x} ${ext.y}`;
      }
    }
    return d;
  };

  const primaryPathD = getPathData(activePath, dragHead);
  const symmetricDragHead = dragHead ? getSymmetricSvgPoint(dragHead) : null;
  const symmetricPathD = getPathData(symmetricPath, symmetricDragHead);

  // Active solve state
  const isSolved = validationResult?.valid === true;

  // —— 右侧得分条 ——
  // 切换题目后的旧 placementScore 残留（清理 effect 生效前的一两帧）不得参与展示
  const curPlacement =
    placementScore && placementScore.puzzleTitle === puzzle.title ? placementScore : null;
  const barBaseline = puzzle.baselineScore ?? 0;
  const barMarks: Array<{
    value: string;
    label: string;
    frac: number;
    color: string;
    dashColor: string;
    badge?: string; // 满分额外加分徽标：挂在该线文字右侧，随行垂直居中
  }> = [];
  if (barBaseline > 0) {
    barMarks.push({
      value: String(barBaseline),
      label: t('threshold'),
      frac: 0.4,
      color: 'text-cyan-300',
      dashColor: 'bg-cyan-400/70',
    });
  }
  if (puzzle.targetScore != null) {
    barMarks.push({
      value: String(puzzle.targetScore),
      label: t('target'),
      frac: 0.8,
      color: 'text-amber-300',
      dashColor: 'bg-amber-400/70',
      // 目标分题目的额外加分徽标挂在目标线上
      badge:
        puzzle.extraBonus != null && puzzle.extraBonus > 0
          ? `${t('bonusPrefix')}${puzzle.extraBonus}`
          : undefined,
    });
  }
  // "最大"线一直显示；showMaxScore 为 false 时数值显示问号，
  // 只有真正达到最大值后才揭示（本题达到 或 历史达成过），保留探索内容。
  // 有计分上限的题不能用"最高分≥满分"推断——上限优先时达到最大原始分记 0 分。
  if (puzzle.maxScore != null) {
    const maxFinal = getPuzzleMaxFinalScore(puzzle);
    const maxRevealed =
      puzzle.showMaxScore === true ||
      maxEverReached === true ||
      curPlacement?.maxReached === true ||
      (puzzle.targetScore == null &&
        bestScore != null &&
        maxFinal != null &&
        bestScore >= maxFinal);
    barMarks.push({
      value: maxRevealed ? String(puzzle.maxScore) : '?',
      label: t('max'),
      frac: 1,
      color: 'text-red-400',
      dashColor: 'bg-red-400/70',
      // 无目标分的题目，额外加分徽标挂在最大线上
      badge:
        puzzle.targetScore == null &&
        puzzle.extraBonus != null &&
        puzzle.extraBonus > 0
          ? `${t('bonusPrefix')}${puzzle.extraBonus}`
          : undefined,
    });
  }
  const barScore = curPlacement?.rawTotalScore ?? 0;
  // 恰好达到 0 分上限（maxScore: 0）时柱满并点亮
  const barFrac =
    curPlacement != null
      ? curPlacement.maxReached === true && barScore === 0
        ? 1
        : scoreToFraction(barScore, barBaseline, puzzle.targetScore ?? null, puzzle.maxScore ?? null)
      : 0;
  const showPillar = isSolved && curPlacement != null && barFrac > 0;
  // 得分条颜色：达成 → 黄（无目标题达到最大分 / 达到目标）；超过计分上限 → 红；
  // ≤ 基准或 0 分 → 灰；其余 → 白。目标分优先级最高 —— 有上限的题打到最大分也记 0 分
  const barYellow =
    isSolved &&
    curPlacement != null &&
    ((puzzle.maxScore != null && puzzle.targetScore == null && curPlacement.maxReached === true) ||
      (puzzle.targetScore != null && curPlacement.targetMet === true));
  const barRed =
    isSolved &&
    curPlacement != null &&
    !barYellow &&
    puzzle.targetScore != null &&
    (curPlacement.rawTotalScore ?? 0) > puzzle.targetScore;
  // 未达计分下限（严格小于基准线才判灰；恰好等于基准线 → 白柱）
  const barGray =
    isSolved &&
    curPlacement != null &&
    !barYellow &&
    !barRed &&
    curPlacement.belowBaseline === true;
  // 题板最外层框与得分条状态联动：灰 → 默认；白柱 → 白框；超上限 → 红框；完美 → 黄色边框
  const panelRingClass = barYellow
    ? 'ring-2 ring-amber-400'
    : barRed
      ? 'ring-red-500'
      : !barGray && showPillar
        ? 'ring-white'
        : 'ring-white/10';

  // 摆放方法演示：眼睛按钮开/关，左右三角切换示例方案
  const handleToggleDemo = (groupId: string) => {
    // 预览开关：无音效
    if (demoGroupId === groupId) {
      setDemoGroupId(null);
      setDemoIndex(0);
      onSelectGroupId(null);
    } else {
      setDemoGroupId(groupId);
      setDemoIndex(0);
      onSelectSymbolId(null);
      onSelectGroupId(groupId);
    }
  };

  const handleCycleDemo = (delta: number) => {
    if (!demoGroupId) return;
    const count = curPlacement?.groupDetails[demoGroupId]?.examplePlacements?.length ?? 0;
    if (count === 0) return;
    setDemoIndex((prev) => ((prev + delta) % count + count) % count);
  };

  // —— 小屏适配：谜题组合（题板+得分条+符号组）按视口宽度整体等比缩放 ——
  // 侧边元素绝对定位于题板两侧，只缩题板会让它们被挤出屏幕；整体 scale 后
  // 物理尺寸同比缩小。内容整体中心与视口中心对齐——左侧符号组比右侧得分条
  // 宽，只按题板中心缩放会让内容向左溢出屏幕。transform 不参与布局，且
  // getBoundingClientRect 已包含 transform，划线坐标换算自动正确。
  // 只在挂载/换题/符号组变化/窗口缩放时量一次，不随指针事件触发
  const puzzleAreaRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scoreBarRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<{ scale: number; shift: number }>({ scale: 1, shift: 0 });
  useLayoutEffect(() => {
    const el = puzzleAreaRef.current;
    if (!el) return;
    const update = () => {
      // 用 offsetLeft/offsetWidth 测量（纯布局值、不含 transform）：
      // getBoundingClientRect 会把已应用的缩放一并量进去，缩放后再次测量
      // （手机上地址栏收放等 resize 事件频繁）会误判「不需要缩放」把比例
      // 重置回 1，导致题板反复弹回原始大小
      const panel = panelRef.current;
      if (!panel) return;
      let minX = 0;
      let maxX = panel.offsetWidth;
      const bar = scoreBarRef.current;
      if (bar) maxX = Math.max(maxX, bar.offsetLeft + bar.offsetWidth);
      const groupsEl = groupListRef.current;
      if (groupsEl) minX = Math.min(minX, groupsEl.offsetLeft);
      const avail = window.innerWidth - 24; // 两侧各留 12px 呼吸空间
      const natural = maxX - minX;
      if (natural <= avail) {
        setFit({ scale: 1, shift: 0 });
        return;
      }
      const s = Math.max(0.25, avail / natural);
      // 整体内容居中：内容中心与视口中心对齐（补偿左右侧边元素的不对称），
      // 否则左侧符号组会被切出屏幕
      const wrapperLeft = offsetLeftInViewport(el);
      const panelW = panel.offsetWidth;
      const center = (minX + maxX) / 2;
      const origin = wrapperLeft + panelW / 2;
      const shift = window.innerWidth / 2 - origin - s * (center - panelW / 2);
      setFit({ scale: s, shift });
    };
    update();
    window.addEventListener('resize', update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      window.removeEventListener('resize', update);
      ro.disconnect();
    };
  }, [puzzle.title, groups.length]);

  return (
    <div className="relative flex flex-col items-center justify-center p-4">
      {/* 题板居中（题板中心 = 屏幕中心）；符号组与计分条分别绝对定位于题板左右两侧 */}
      <div
        ref={puzzleAreaRef}
        className="relative"
        style={{
          transform:
            fit.scale < 1 ? `translateX(${fit.shift}px) scale(${fit.scale})` : undefined,
          transformOrigin: 'center center',
        }}
      >
      {/* Puzzle SVG Panel */}
      <div ref={panelRef} className={`relative wt-board rounded-2xl bg-slate-900/90 p-4 shadow-2xl ring-1 backdrop-blur-md ${panelRingClass}`}>
        <svg
          ref={svgRef}
          width={totalSvgWidth}
          height={totalSvgHeight}
          viewBox={`0 0 ${totalSvgWidth} ${totalSvgHeight}`}
          className="cursor-crosshair select-none"
          onMouseDown={handlePointerDown}
          onContextMenu={(e) => {
            e.preventDefault();
            if (isDrawing) {
              sound.playBacktrack();
              setIsDrawing(false);
              setDragHead(null);
              setActivePath([]);
            }
          }}
          style={{ touchAction: 'none' }}
        >
          {/* Subtle panel shadow */}
          <defs>
            <filter id="panel-bevel" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="8" stdDeviation="12" floodColor="#000000" floodOpacity={theme === 'light' ? 0.18 : 0.5} />
            </filter>
          </defs>

          {/* Background Board Plate */}
          <rect
            x={paddingX - 48}
            y={paddingY - 48}
            width={gridWidth + 96}
            height={gridHeight + 96}
            rx={20}
            fill={boardColors.bg}
            stroke={boardColors.bd}
            strokeWidth={4}
            filter="url(#panel-bevel)"
          />

          {/* Cell Backgrounds & Interactive Click Target */}
          {Array.from({ length: puzzle.height }).map((_, r) =>
            Array.from({ length: puzzle.width }).map((_, c) => {
              const { cx, cy } = cellCoords(r, c);
              const cellKey = `${r},${c}`;
              const isResonant = resonanceValidKeys.has(cellKey);
              const shouldShowGreen =
                isResonant &&
                (isSolved || (isEditMode && showResonanceHeatmap)) &&
                !puzzle.cellSymbols[cellKey] &&
                !demoGroupId; // 预览摆放模式下不显示每格得分（绿色光环 + 分值）
              const cellScoreValue = placementScore?.cellScores?.[cellKey];
              const cellScoreLabel = cellScoreValue == null ? '+1' : `+${cellScoreValue}`;

              return (
                <g key={cellKey}>
                  {isEditMode && (
                    <rect
                      x={cx - cellSize / 2}
                      y={cy - cellSize / 2}
                      width={cellSize}
                      height={cellSize}
                      fill={shouldShowGreen ? 'rgba(16, 185, 129, 0.22)' : 'transparent'}
                      className="cursor-pointer transition-colors duration-200"
                      onClick={() => handleCellClick(r, c)}
                    />
                  )}

                  {/* Resonance Aura Indicator: Displays when puzzle is solved to show valid placement positions */}
                  {shouldShowGreen && (
                    <g className="pointer-events-none">
                      {/* 绿色底（无外框） */}
                      <rect
                        x={cx - cellSize / 2 + 6}
                        y={cy - cellSize / 2 + 6}
                        width={cellSize - 12}
                        height={cellSize - 12}
                        rx={8}
                        fill="rgba(16, 185, 129, 0.22)"
                      />
                      <text
                        x={cx + cellSize / 2 - 10}
                        y={cy - cellSize / 2 + 24}
                        textAnchor="end"
                        fontSize={18}
                        fill="#10b981"
                        fontWeight={800}
                      >
                        {cellScoreLabel}
                      </text>
                    </g>
                  )}
                </g>
              );
            })
          )}

          {/* 玩家格子标记（做题笔记）：右下角小直角三角形，不保存、切换题目即清除。
              渲染在网格线之下——格线压在标记上，标记与格线无缝相接 */}
          {!isEditMode && markedCells.size > 0 && (
            <g className="pointer-events-none">
              {Array.from(markedCells).map((key) => {
                const [r, c] = key.split(',').map(Number);
                const { cx, cy } = cellCoords(r, c);
                const bx = cx + cellSize / 2 - markInset;
                const by = cy + cellSize / 2 - markInset;
                return (
                  <polygon
                    key={key}
                    points={`${bx},${by} ${bx - markSize},${by} ${bx},${by - markSize}`}
                    fill={markColor}
                  />
                );
              })}
            </g>
          )}

          {/* Grid Edges (Base Grid Tracks) */}
          {/* Horizontal edges */}
          {Array.from({ length: puzzle.height + 1 }).map((_, r) =>
            Array.from({ length: puzzle.width }).map((_, c) => {
              const p1 = { r, c };
              const p2 = { r, c: c + 1 };
              const key = edgeKey(p1, p2);
              const isBroken = brokenEdgesSet.has(key);
              const c1 = vertexCoords(p1);
              const c2 = vertexCoords(p2);

              if (isBroken) {
                // Render with gap in the center
                const midX = (c1.x + c2.x) / 2;
                return (
                  <g key={key} onClick={() => handleEdgeClick(p1, p2)}>
                    <line
                      x1={c1.x}
                      y1={c1.y}
                      x2={midX - gapHalf}
                      y2={c1.y}
                      stroke={boardColors.grid}
                      strokeWidth={lineWidth}
                      strokeLinecap="butt"
                    />
                    <line
                      x1={midX + gapHalf}
                      y1={c1.y}
                      x2={c2.x}
                      y2={c1.y}
                      stroke={boardColors.grid}
                      strokeWidth={lineWidth}
                      strokeLinecap="butt"
                    />
                  </g>
                );
              }

              return (
                <line
                  key={key}
                  x1={c1.x}
                  y1={c1.y}
                  x2={c2.x}
                  y2={c2.y}
                  stroke={boardColors.grid}
                  strokeWidth={lineWidth}
                  strokeLinecap="round"
                  className={isEditMode ? 'hover:stroke-slate-700 cursor-pointer' : ''}
                  onClick={() => handleEdgeClick(p1, p2)}
                />
              );
            })
          )}

          {/* Vertical edges */}
          {Array.from({ length: puzzle.height }).map((_, r) =>
            Array.from({ length: puzzle.width + 1 }).map((_, c) => {
              const p1 = { r, c };
              const p2 = { r: r + 1, c };
              const key = edgeKey(p1, p2);
              const isBroken = brokenEdgesSet.has(key);
              const c1 = vertexCoords(p1);
              const c2 = vertexCoords(p2);

              if (isBroken) {
                const midY = (c1.y + c2.y) / 2;
                return (
                  <g key={key} onClick={() => handleEdgeClick(p1, p2)}>
                    <line
                      x1={c1.x}
                      y1={c1.y}
                      x2={c1.x}
                      y2={midY - gapHalf}
                      stroke={boardColors.grid}
                      strokeWidth={lineWidth}
                      strokeLinecap="butt"
                    />
                    <line
                      x1={c1.x}
                      y1={midY + gapHalf}
                      x2={c1.x}
                      y2={c2.y}
                      stroke={boardColors.grid}
                      strokeWidth={lineWidth}
                      strokeLinecap="butt"
                    />
                  </g>
                );
              }

              return (
                <line
                  key={key}
                  x1={c1.x}
                  y1={c1.y}
                  x2={c2.x}
                  y2={c2.y}
                  stroke={boardColors.grid}
                  strokeWidth={lineWidth}
                  strokeLinecap="round"
                  className={isEditMode ? 'hover:stroke-slate-700 cursor-pointer' : ''}
                  onClick={() => handleEdgeClick(p1, p2)}
                />
              );
            })
          )}

          {/* 玩家边标记（做题笔记）：沿边的细线（宽度约为划线一半），颜色同格子标记；
              渲染在网格线之上、划线路径之下——玩家绘制的路径会覆盖这个标记 */}
          {!isEditMode && markedEdges.size > 0 && (
            <g className="pointer-events-none">
              {Array.from(markedEdges).map((key) => {
                const [p1Key, p2Key] = key.split('-');
                const [r1, c1] = p1Key.split(',').map(Number);
                const [r2, c2] = p2Key.split(',').map(Number);
                const a = vertexCoords({ r: r1, c: c1 });
                const b = vertexCoords({ r: r2, c: c2 });
                return (
                  <line
                    key={key}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={markColor}
                    strokeWidth={lineWidth / 2}
                    strokeLinecap="round"
                  />
                );
              })}
            </g>
          )}

          {/* 摆放方法示例：点眼睛后把该组的示例摆放画入题板，三角按钮切换方案。
              每个示例符号所在格子一个绿色底（无边框），与题板原有符号区分 */}
          {!isEditMode &&
            demoGroupId &&
            (() => {
              const detail = curPlacement?.groupDetails[demoGroupId];
              const examples = detail?.examplePlacements ?? [];
              const placement = examples[demoIndex % examples.length];
              if (!placement) return null;
              return (
                <g className="pointer-events-none">
                  {Object.entries(placement).map(([key, sym]) => {
                    const [r, c] = key.split(',').map(Number);
                    const { cx, cy } = cellCoords(r, c);
                    return (
                      <g key={key} opacity={0.92}>
                        {/* 每个示例符号所在格子一个绿色底：内缩 9px，与划线沿网格线
                            侵入格内的 9px 走廊平齐——绿色底与网格线无缝相接，
                            同时不覆盖网格线与路径 */}
                        <rect
                          x={cx - cellSize / 2 + 9}
                          y={cy - cellSize / 2 + 9}
                          width={cellSize - 18}
                          height={cellSize - 18}
                          fill="rgba(16, 185, 129, 0.25)"
                        />
                        <PuzzleSymbol symbol={sym} cx={cx} cy={cy} size={cellSize} />
                      </g>
                    );
                  })}
                </g>
              );
            })()}

          {/* Exit Semicircles (终点半圆形出口：沿出口方向先外延一段，末端接半圆) */}
          {puzzle.ends.map((end, idx) => {
            const coords = vertexCoords(end);
            const R = endRadius;
            let cx = coords.x;
            let cy = coords.y;
            if (end.dir === 'up') cy -= endStemLength;
            else if (end.dir === 'down') cy += endStemLength;
            else if (end.dir === 'left') cx -= endStemLength;
            else cx += endStemLength;

            let d = '';
            if (end.dir === 'up') {
              d = `M ${cx - R} ${cy} A ${R} ${R} 0 0 0 ${cx + R} ${cy} Z`;
            } else if (end.dir === 'down') {
              d = `M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy} Z`;
            } else if (end.dir === 'left') {
              d = `M ${cx} ${cy - R} A ${R} ${R} 0 0 0 ${cx} ${cy + R} Z`;
            } else {
              d = `M ${cx} ${cy - R} A ${R} ${R} 0 0 1 ${cx} ${cy + R} Z`;
            }

            return (
              <g key={`exit-${idx}`}>
                <line
                  x1={coords.x}
                  y1={coords.y}
                  x2={cx}
                  y2={cy}
                  stroke={boardColors.grid}
                  strokeWidth={lineWidth}
                  strokeLinecap="round"
                />
                <path d={d} fill={boardColors.grid} />
              </g>
            );
          })}

          {/* Start Nodules (Base Circles on Grid) */}
          {puzzle.starts.map((start, idx) => {
            const coords = vertexCoords(start);
            return (
              <circle
                key={`start-base-${idx}`}
                cx={coords.x}
                cy={coords.y}
                r={startRadius}
                fill={boardColors.grid}
                className="cursor-pointer"
                onClick={() => handleVertexClick(start.r, start.c)}
              />
            );
          })}

          {/* Hexagon Dots on Edges */}
          {Object.entries(puzzle.edgeDots).map(([key, col]) => {
            const [p1Key, p2Key] = key.split('-');
            const [r1, c1] = p1Key.split(',').map(Number);
            const [r2, c2] = p2Key.split(',').map(Number);
            const cA = vertexCoords({ r: r1, c: c1 });
            const cB = vertexCoords({ r: r2, c: c2 });
            const mx = (cA.x + cB.x) / 2;
            const my = (cA.y + cB.y) / 2;
            const isInvalid = invalidKeysSet.has(`edot:${key}`);

            return (
              <HexagonDot
                key={`edot-${key}`}
                cx={mx}
                cy={my}
                radius={7}
                color={col === 'cyan' ? '#06b6d4' : col === 'yellow' ? '#eab308' : '#0f172a'}
                isInvalid={isInvalid}
              />
            );
          })}

          {/* Hexagon Dots on Vertices */}
          {Object.entries(puzzle.vertexDots).map(([key, col]) => {
            const [r, c] = key.split(',').map(Number);
            const coords = vertexCoords({ r, c });
            const isInvalid = invalidKeysSet.has(`vdot:${key}`);

            return (
              <HexagonDot
                key={`vdot-${key}`}
                cx={coords.x}
                cy={coords.y}
                radius={7}
                color={col === 'cyan' ? '#06b6d4' : col === 'yellow' ? '#eab308' : '#0f172a'}
                isInvalid={isInvalid}
              />
            );
          })}

          {/* Symmetric Traced Path (Solid Cyan) */}
          {(symmetricPath.length > 0 || (isDrawing && symmetricDragHead)) && (
            <g>
              <path
                d={symmetricPathD}
                fill="none"
                stroke="#06b6d4"
                strokeWidth={lineWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {symmetricPath.length > 0 && (
                <circle
                  cx={vertexCoords(symmetricPath[0]).x}
                  cy={vertexCoords(symmetricPath[0]).y}
                  r={startRadius}
                  fill="#06b6d4"
                />
              )}
              {isDrawing && (symmetricDragHead || symmetricPath.length > 0) && (
                <circle
                  cx={symmetricDragHead ? symmetricDragHead.x : vertexCoords(symmetricPath[symmetricPath.length - 1]).x}
                  cy={symmetricDragHead ? symmetricDragHead.y : vertexCoords(symmetricPath[symmetricPath.length - 1]).y}
                  r={headRadius}
                  fill={boardColors.line}
                />
              )}
            </g>
          )}

          {/* Primary Traced Path：划线中白色；解出（符号全对）黄色；抵达终点但存在报错符号时黑色 */}
          {activePath.length > 0 &&
            (() => {
              const lineColor = isDrawing
                ? boardColors.line
                : validationResult?.valid
                  ? '#facc15'
                  : validationResult
                    ? '#b91c1c'
                    : boardColors.line;
              return (
            <g>
              <path
                d={primaryPathD}
                fill="none"
                stroke={lineColor}
                strokeWidth={lineWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={isDrawing && isHeadInArc() ? 'animate-flash-line' : undefined}
              />
              <circle
                cx={vertexCoords(activePath[0]).x}
                cy={vertexCoords(activePath[0]).y}
                r={startRadius}
                fill={lineColor}
                className={isDrawing && isHeadInArc() ? 'animate-flash-fill' : undefined}
              />
              {/* Active head nodule */}
              {isDrawing && (
                <circle
                  cx={dragHead ? dragHead.x : vertexCoords(activePath[activePath.length - 1]).x}
                  cy={dragHead ? dragHead.y : vertexCoords(activePath[activePath.length - 1]).y}
                  r={headRadius}
                  fill={boardColors.line}
                  className={isHeadInArc() ? 'animate-flash-fill' : undefined}
                />
              )}
            </g>
              );
            })()}

          {/* Interactive Vertex Target for Editing */}
          {isEditMode &&
            Array.from({ length: puzzle.height + 1 }).map((_, r) =>
              Array.from({ length: puzzle.width + 1 }).map((_, c) => {
                const coords = vertexCoords({ r, c });
                const isStart = startKeys.has(`${r},${c}`);
                const isEnd = endPointsMap.has(`${r},${c}`);

                return (
                  <circle
                    key={`v-edit-${r}-${c}`}
                    cx={coords.x}
                    cy={coords.y}
                    r={14}
                    fill={isStart ? '#22c55e' : isEnd ? '#f97316' : 'rgba(255,255,255,0.08)'}
                    className="hover:fill-amber-400 cursor-pointer transition-colors"
                    onClick={() => handleVertexClick(r, c)}
                  />
                );
              })
            )}

          {/* Cell Symbols (Squares, Stars, Triangles, Polyominoes, Erasers) */}
          {Object.entries(puzzle.cellSymbols).map(([key, symbol]) => {
            const [r, c] = key.split(',').map(Number);
            const { cx, cy } = cellCoords(r, c);
            const isInvalid = invalidKeysSet.has(key);

            return (
              <PuzzleSymbol
                key={key}
                symbol={symbol}
                cx={cx}
                cy={cy}
                size={cellSize}
                isInvalid={isInvalid}
              />
            );
          })}


        </svg>
      </div>

      {/* Score Bar (右侧非线性得分条：白柱 + 中心黑字 + 基准/目标/最大虚线标记)：绝对定位于题板右侧、与题板同高 */}
      {!isEditMode && (
        <div ref={scoreBarRef} className="absolute top-0 bottom-0 left-full ml-8 w-[184px]">
          <style>{`@keyframes pillarRise { from { transform: scaleY(0); } to { transform: scaleY(1); } } @keyframes scoreFade { from { opacity: 0; transform: translateY(calc(50% + 10px)); } to { opacity: 1; transform: translateY(50%); } }`}</style>
          {/* 轨道（长方形，仅背景） */}
          <div className="absolute inset-y-2 left-[44px] w-12 bg-slate-800/90 ring-1 ring-slate-600/60" />
          {/* 标记线：左边数字、中间虚线（横穿得分条）、右边含义；渲染在得分柱之前，虚线不压柱子 */}
          <div className="absolute inset-y-2 -left-4 -right-2">
          {barMarks.map((m) => (
            <div
              key={m.label}
              className="absolute left-0 right-0 flex items-center gap-2"
              style={{ top: `${(1 - m.frac) * 100}%`, transform: 'translateY(-50%)' }}
            >
              <span className={`w-10 text-right text-lg font-bold ${m.color}`}>{m.value}</span>
              <span className="flex flex-1 items-center justify-between gap-[3px]">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span key={i} className={`h-0.5 w-3 ${m.dashColor}`} />
                ))}
              </span>
              <span className={`w-20 text-left text-lg font-semibold ${m.color}`}>{m.label}</span>
              {/* 满分额外加分徽标：绝对定位于行尾（不占 flex 空间，虚线定位不变），垂直居中对齐行文字 */}
              {m.badge && (
                <span
                  className={`absolute inset-y-0 left-full ${
                    m.label.length === 2 ? '-ml-[30px]' : 'ml-1.5'
                  } flex items-center whitespace-nowrap text-lg font-semibold ${m.color}`}
                >
                  {m.badge}
                </span>
              )}
            </div>
          ))}
          </div>

          {/* 得分柱 + 数字：渲染在标记虚线之后，虚线被柱子遮住 */}
          <div className="absolute inset-y-2 left-[44px] w-12">
            {/* 得分柱（长方形）：达成黄 / 超上限红 / 未达标灰 / 其余白 */}
            {showPillar && (
              <div
                key={`pillar-${puzzle.title}-${curPlacement?.rawTotalScore}`}
                className={`absolute inset-x-0 bottom-0 ${
                  barYellow
                    ? 'bg-amber-400'
                    : barRed
                      ? 'bg-red-500'
                      : barGray
                        ? theme === 'light'
                          ? 'bg-slate-600'
                          : 'bg-slate-500'
                        : 'score-pillar bg-white'
                }`}
                style={{
                  height: `${barFrac * 100}%`,
                  transformOrigin: 'bottom',
                  animation: 'pillarRise 0.2s ease-out',
                }}
              />
            )}
            {/* 得分数字（柱子中心，黑色，原始分） */}
            {showPillar && (
              <div
                className="score-pillar-num absolute inset-x-0 z-10 text-center text-lg font-black text-black"
                style={{
                  bottom: `${barFrac * 50}%`,
                  transform: 'translateY(50%)',
                  animation: 'scoreFade 0.2s ease-out 0.05s backwards',
                }}
              >
                {curPlacement?.rawTotalScore ?? 0}
              </div>
            )}
          </div>

        </div>
      )}

      {/* Outside Symbol Groups (题板外符号组 - 解谜模式，位于题板左侧，每组一行) */}
      {!isEditMode && groups.length > 0 && (
        <div
          ref={groupListRef}
          className="absolute top-0 right-full mr-7 flex flex-col gap-3"
          style={{
            transform: `scale(${groupScale})`,
            transformOrigin: 'top right',
          }}
        >
          {groups.map((group) => {
            const hasSymSelected = group.symbols.some((s) => s.id === selectedSymbolId);
            const isGroupSelected = selectedGroupId === group.id && !selectedSymbolId;
            const groupScore = curPlacement?.groupScores[group.id] ?? 0;
            const demoCount = curPlacement?.groupDetails[group.id]?.examplePlacements?.length ?? 0;

            return (
              <div
                key={group.id}
                className={`relative flex min-w-[240px] items-center justify-between gap-3 rounded-2xl border p-3 select-none ${
                  (isGroupSelected || hasSymSelected || demoGroupId === group.id) &&
                  isSolved &&
                  !isDrawing
                    ? 'border-amber-400/80 bg-amber-500/10 shadow-md shadow-amber-500/10 ring-1 ring-amber-400/30'
                    : 'border-slate-500/70 bg-slate-700/80'
                }`}
              >
                {/* 左侧（约 80%）：符号 */}
                <div className="flex flex-1 items-center gap-2">
                  {group.symbols.map((sym) => {
                    const isSymSelected = selectedSymbolId === sym.id;
                    return (
                      <button
                        key={sym.id}
                        type="button"
                        disabled={!isSolved || isDrawing}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isSolved || isDrawing) return;
                          setDemoGroupId(null);
                          setDemoIndex(0);
                          if (isSymSelected) {
                            onSelectSymbolId(null);
                            onSelectGroupId(null);
                          } else {
                            onSelectSymbolId(sym.id);
                            onSelectGroupId(sym.groupId || group.id);
                          }
                        }}
                        className={`flex items-center justify-center rounded-xl transition-colors ${
                          isSymSelected && isSolved && !isDrawing
                            ? 'border-2 border-amber-400 bg-amber-500/25 ring-2 ring-amber-400/50 shadow-md'
                            : isSolved && !isDrawing
                              ? `border border-slate-500 ${theme === 'light' ? 'bg-slate-800' : 'bg-slate-600/80'} cursor-pointer hover:border-slate-400 ${
                                  theme === 'light' ? 'hover:bg-slate-700' : 'hover:bg-slate-500'
                                }`
                              : `border border-slate-500 ${theme === 'light' ? 'bg-slate-800' : 'bg-slate-600/80'}`
                        }`}
                        style={{ width: cellSize + 8, height: cellSize + 8 }}
                      >
                        <svg width={cellSize} height={cellSize} viewBox={`0 0 ${cellSize} ${cellSize}`}>
                          <PuzzleSymbol symbol={sym} cx={cellSize / 2} cy={cellSize / 2} size={cellSize} />
                        </svg>
                      </button>
                    );
                  })}
                </div>

                {/* 右侧：得分 + 摆放方法演示控制（眼睛开/关；点击眼睛后两侧才出现切换方案的箭头） */}
                <div className="flex w-24 flex-col items-center gap-2">
                  <span
                    className={`whitespace-nowrap text-lg font-extrabold ${
                      groupScore > 0 ? 'text-emerald-500' : 'text-slate-500'
                    }`}
                  >
                    +{groupScore}
                  </span>
                  <div className="flex w-full items-center justify-center gap-1.5">
                    {/* 切换方案的箭头：仅点击眼睛按钮开启演示后出现 */}
                    {demoGroupId === group.id && demoCount > 1 && (
                      <button
                        type="button"
                        onClick={() => handleCycleDemo(-1)}
                        className="cursor-pointer rounded p-0.5 text-slate-300 hover:text-white transition-colors"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {/* 预览按钮：未解出前不可点击、无悬浮效果；解出后可点击（手指光标） */}
                    <button
                      type="button"
                      disabled={!isSolved || isDrawing}
                      onClick={() => handleToggleDemo(group.id)}
                      className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-colors disabled:opacity-40 ${
                        demoGroupId === group.id
                          ? 'cursor-pointer border-2 border-amber-400 bg-amber-500/25 text-amber-300 ring-2 ring-amber-400/50 shadow-md'
                          : `border-slate-600 bg-slate-800 text-slate-300 enabled:cursor-pointer enabled:hover:border-slate-400 enabled:${
                              theme === 'light' ? 'hover:bg-slate-700' : 'hover:bg-slate-500'
                            }`
                      }`}
                    >
                      <Eye className="h-5 w-5" />
                    </button>
                    {demoGroupId === group.id && demoCount > 1 && (
                      <button
                        type="button"
                        onClick={() => handleCycleDemo(1)}
                        className="cursor-pointer rounded p-0.5 text-slate-300 hover:text-white transition-colors"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 玩家得分（大号，题板正下方，与地图一致）：绝对定位、不占布局空间，
          题板保持视觉中心。颜色：超上限红 0pts / 恰好等于下限白 0pts /
          严格低于下限灰 / 有分未达目标白 / 达成黄 */}
      {!isEditMode && curPlacement != null && (
        <div className="absolute top-full left-1/2 mt-4 -translate-x-1/2">
          <span
            className={`whitespace-nowrap font-black text-7xl leading-none ${
              barYellow
                ? 'text-amber-400'
                : barRed
                  ? 'text-red-500'
                  : curPlacement.belowBaseline === true
                    ? theme === 'light'
                      ? 'text-slate-600'
                      : 'text-slate-500'
                    : curPlacement.totalScore > 0 || (puzzle.baselineScore ?? 0) > 0
                      ? 'text-slate-100'
                      : theme === 'light'
                        ? 'text-slate-600'
                        : 'text-slate-500'
            }`}
          >
            {curPlacement.totalScore} pt{curPlacement.totalScore === 1 ? '' : 's'}
          </span>
        </div>
      )}
      </div>


      {/* Edit Mode: Symbol Groups Configuration */}
      {isEditMode && (
        <div className="mt-4 flex flex-col items-center gap-3 w-full max-w-3xl">
          <div className="flex items-center justify-between w-full px-1">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-amber-400" />
              <span>题板外符号组（判定加分时将同组符号同时放入题板）</span>
            </span>
            <button
              onClick={handleCreateGroup}
              className="flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition-colors shadow-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新建符号组</span>
            </button>
          </div>

          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-5 border border-dashed border-slate-800 rounded-2xl w-full text-center text-xs text-slate-500 bg-slate-900/30">
              <span>当前暂无题板外符号。在上方工具栏中选择符号后，点击右上角「新建符号组」即可添加！</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-stretch justify-center gap-3 w-full">
              {groups.map((group, gIdx) => (
                <div
                  key={group.id}
                  className="relative rounded-2xl border border-slate-500/70 bg-slate-700/80 p-2 flex flex-col gap-2 min-w-[150px]"
                >
                  {/* Group Card Header */}
                  <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-1.5">
                    <span className="text-xs font-bold text-slate-300">
                      组 {gIdx + 1}
                      <span className="text-[10px] text-slate-500 font-normal ml-1">
                        ({group.symbols.length}/3)
                      </span>
                    </span>
                    <button
                      onClick={() => handleDeleteGroup(group.id)}
                      className="text-slate-500 hover:text-red-400 transition-colors p-0.5 rounded hover:bg-red-950/40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Symbols row inside Group */}
                  <div className="flex items-center gap-2">
                    {group.symbols.map((sym) => (
                      <div key={sym.id} className="relative group">
                        <div
                          className="flex items-center justify-center rounded-xl bg-slate-600/80 border border-slate-500"
                          style={{ width: cellSize + 8, height: cellSize + 8 }}
                        >
                          <svg width={cellSize} height={cellSize} viewBox={`0 0 ${cellSize} ${cellSize}`}>
                            <PuzzleSymbol symbol={sym} cx={cellSize / 2} cy={cellSize / 2} size={cellSize} />
                          </svg>
                        </div>
                        {/* Remove single symbol */}
                        <button
                          onClick={() => handleDeleteSymbol(sym.id)}
                          className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-500 shadow-xs"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}

                    {/* Add to group slot (if < 3 symbols) */}
                    {group.symbols.length < 3 && (
                      <button
                        onClick={() => handleAddSymbolToGroup(group.id)}
                        className="flex items-center justify-center rounded-xl border border-dashed border-slate-700 hover:border-amber-400 hover:text-amber-400 text-slate-500 transition-colors group"
                        style={{ width: cellSize + 8, height: cellSize + 8 }}
                      >
                        <Plus className="h-5 w-5 group-hover:scale-110 transition-transform" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
};
