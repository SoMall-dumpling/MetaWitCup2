/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Point,
  PuzzleDefinition,
  ValidationResult,
  PlacementScoreResult,
  OutsideSymbol,
  ColorType,
} from './types/puzzle';
import { DEFAULT_BLANK_PUZZLE, PRESET_PUZZLES } from './presets';
import { validatePuzzle } from './engine/validator';
import { calculatePlacementScore } from './engine/metaScorer';
import { PuzzleCanvas } from './components/PuzzleCanvas';
import { LevelMap } from './components/LevelMap';
import { SettingsOverlay } from './components/SettingsOverlay';
import { EditorToolbar } from './components/EditorToolbar';
import { sound } from './utils/audio';
import { t, useLang } from './utils/i18n';
import { ChevronLeft, ChevronRight, Map } from 'lucide-react';
import {
  getCustomPuzzles,
  saveCustomPuzzle,
  deleteCustomPuzzle,
  decodePuzzleFromHash,
  getBestScores,
  saveBestScore,
  getSavedAnswers,
  saveAnswer,
  pathToDirections,
  directionsToPath,
  getRevealedMaxTitles,
  markMaxRevealed,
  getSolvedTitles,
  markSolved,
  getTimerStartMs,
  markTimerStart,
  getTimerStopMs,
  markTimerStop,
  appendSaveEntry,
} from './utils/storage';
// 关卡所属行的标识（与地图的分行一致）：'0' 自成一行；'C-N' → 'C'；'E-x-y' → 'E-x'
const rowKeyOf = (title: string): string => {
  if (title === '0') return '0';
  const m = /^(E-\d+|\d+)-/.exec(title);
  return m ? m[1] : title;
};

// 总分达到该值后比赛计时器停止（显示冻结在停止时刻）
const TIMER_STOP_SCORE = 675;

// 比赛计时器：自解出第 0 题的瞬间起计（首解时间存 localStorage），每秒自刷；
// 总分达到 675 后停止（停止时间存 localStorage），显示冻结在停止时刻。
// 固定在屏幕左上角（地图按钮右侧），解题与地图界面位置一致
const CompetitionTimer: React.FC = () => {
  const [now, setNow] = useState(() => Date.now());
  const [startMs, setStartMs] = useState<number | null>(() => getTimerStartMs());
  const [stopMs, setStopMs] = useState<number | null>(() => getTimerStopMs());
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
      // 起点/终点尚未记录时每 tick 复查一次（可能由 App 层写入 localStorage）
      if (startMs == null) setStartMs(getTimerStartMs());
      if (stopMs == null) setStopMs(getTimerStopMs());
    }, 1000);
    return () => window.clearInterval(id);
  }, [startMs, stopMs]);
  const elapsed = startMs == null ? 0 : Math.max(0, (stopMs ?? now) - startMs);
  const total = Math.floor(elapsed / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return (
    <span className="text-amber-400 font-black text-4xl md:text-7xl leading-none">
      {`${pad(h)}:${pad(m)}:${pad(s)}`}
    </span>
  );
};

// 存档条目：时间戳（按比赛计时器，计时停止后冻结）+ 谜题 + 谜题解法 + 当前分数（当时的总分）
const makeSaveEntry = (title: string, dirs: string, totalScore: number): string => {
  const start = getTimerStartMs();
  const stop = getTimerStopMs();
  const elapsed = start == null ? 0 : Math.max(0, (stop ?? Date.now()) - start);
  const total = Math.floor(elapsed / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `[${pad(h)}:${pad(m)}:${pad(s)}] ${title} ${dirs} ${totalScore}`;
};

export default function App() {
  useLang(); // 语言切换时重渲染（总分标签等文案）
  const [puzzle, setPuzzle] = useState<PuzzleDefinition>(() => {
    // Check if URL hash has a shared puzzle
    if (typeof window !== 'undefined' && window.location.hash) {
      const match = window.location.hash.match(/#puzzle=([^&]+)/);
      if (match) {
        const decoded = decodePuzzleFromHash(match[1]);
        if (decoded) return decoded;
      }
    }
    if (PRESET_PUZZLES.length > 0) return PRESET_PUZZLES[0];
    const customs = getCustomPuzzles();
    if (customs.length > 0) return customs[0];
    return DEFAULT_BLANK_PUZZLE;
  });

  const [isEditMode, setIsEditMode] = useState<boolean>(false); // 编辑模式开关（Ctrl+E 切换）
  const [showMap, setShowMap] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [activePath, setActivePath] = useState<Point[]>([]);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [placementScore, setPlacementScore] = useState<PlacementScoreResult | null>(null);
  const [bestScores, setBestScores] = useState<Record<string, number>>(() => getBestScores());
  const [savedAnswers, setSavedAnswers] = useState<Record<string, string>>(() => getSavedAnswers());
  const [revealedMaxTitles, setRevealedMaxTitles] = useState<string[]>(() => getRevealedMaxTitles());
  const [solvedTitles, setSolvedTitles] = useState<string[]>(() => getSolvedTitles());
  const [isNewRecord, setIsNewRecord] = useState<boolean>(false);

  // Editor states
  const [selectedTool, setSelectedTool] = useState<string>('square');
  const [selectedColor, setSelectedColor] = useState<ColorType>('black');
  const [triangleCount, setTriangleCount] = useState<number>(1);
  const [polyominoShape, setPolyominoShape] = useState<boolean[][]>([
    [false, true, false, false],
    [true, true, true, false],
    [false, false, false, false],
    [false, false, false, false],
  ]);
  const [rotatablePoly, setRotatablePoly] = useState<boolean>(false);
  const [negativePoly, setNegativePoly] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [customPuzzles, setCustomPuzzles] = useState<PuzzleDefinition[]>(() =>
    getCustomPuzzles()
  );

  // Meta-rule state: selected symbol group ID and independently selected symbol ID
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedSymbolId, setSelectedSymbolId] = useState<string | null>(null);
  const [showResonanceHeatmap, setShowResonanceHeatmap] = useState<boolean>(true);

  // Sync selected group and symbol when puzzle changes
  useEffect(() => {
    setSelectedGroupId(null);
    setSelectedSymbolId(null);
    setActivePath([]);
    setValidationResult(null);
    setPlacementScore(null);
  }, [puzzle.title]);

  // 做过的题默认显示保存的解法
  useEffect(() => {
    if (!isEditMode) showSavedAnswer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.title]);

  // Whenever the player starts drawing a new line (or aborts/resets), clear
  // the previous validation state so error symbols revert to their original
  // colors. Note: must NOT clear on every path change — reaching an exit
  // vertex updates the path and triggers validation in the same event.
  useEffect(() => {
    if (activePath.length <= 1) {
      setValidationResult(null);
      setPlacementScore(null);
      setSelectedGroupId(null);
      setSelectedSymbolId(null);
    }
  }, [activePath]);

  // Handle path validation when an exit node is reached
  const handleValidatePath = useCallback(
    (path: Point[]) => {
      const res = validatePuzzle(puzzle, path);
      setValidationResult(res);

      if (res.valid) {
        sound.playSuccess();
        // 解出即记录：只要路径合法（题板符号全对），无论得分多少都解锁下一关
        const newlySolved = !solvedTitles.includes(puzzle.title);
        setSolvedTitles(markSolved(puzzle.title));
        // 解出第 0 题：记录比赛计时起点（仅首次），存档时间戳自此起算
        if (puzzle.title === '0') markTimerStart(Date.now());
        const activeFilter = selectedSymbolId || selectedGroupId;
        const scoreRes = calculatePlacementScore(puzzle, path, activeFilter);
        setPlacementScore(scoreRes);
        // 曾达到过最大分 → 永久揭示该题的最高分数值
        if (scoreRes.maxReached) {
          setRevealedMaxTitles(markMaxRevealed(puzzle.title));
        }
        // 有分、达到计分上限/完成计分目标（含上限为 0 的题），或该题尚无任何
        // 纪录时（首个解法即最高分——包括低于下限、超上限、无下限的 0 分解），
        // 保存最优解与最高分
        const dirs = pathToDirections(path);
        let scoreImproved = false;
        let newBestScores: Record<string, number> | null = null;
        if (
          scoreRes.totalScore > 0 ||
          scoreRes.maxReached === true ||
          scoreRes.targetMet === true ||
          bestScores[puzzle.title] == null
        ) {
          // 刷新纪录时写入 localStorage 并同步 state
          const updated = saveBestScore(puzzle.title, scoreRes.totalScore);
          scoreImproved = updated != null;
          newBestScores = updated;
          setIsNewRecord(scoreImproved);
          if (updated) {
            setBestScores(updated);
            // 同步保存这条最优解（四方向序列）
            if (dirs) setSavedAnswers(saveAnswer(puzzle.title, dirs));
          }
        } else {
          setIsNewRecord(false);
        }
        // 存档日志：分数变化或解出未解出的题目时追加一条（分数记当时的总分）
        if (scoreImproved || newlySolved) {
          const totals = newBestScores ?? bestScores;
          const total = Object.values(totals).reduce((sum, v) => sum + v, 0);
          appendSaveEntry(makeSaveEntry(puzzle.title, dirs || '', total));
        }
      } else {
        sound.playFailure();
        setPlacementScore(null);
        setIsNewRecord(false);
      }
    },
    [puzzle, selectedSymbolId, selectedGroupId, bestScores, solvedTitles]
  );

  // Recalculate score if selected symbol or group changes and puzzle is already solved
  useEffect(() => {
    // 只对真正的解法路径（>1 点）重算：点击起点重新划线时路径只剩 1 个点，
    // 若此时仍用旧的 valid 结果重算，会把 placementScore 重新写回，
    // 导致题板边框（白/黄）在重划时不消失
    if (validationResult?.valid && activePath.length > 1) {
      const activeFilter = selectedSymbolId || selectedGroupId;
      const scoreRes = calculatePlacementScore(puzzle, activePath, activeFilter);
      setPlacementScore(scoreRes);
    }
  }, [selectedSymbolId, selectedGroupId, validationResult?.valid, activePath, puzzle]);

  // Reset path
  const handleResetPath = useCallback(() => {
    setActivePath([]);
    setValidationResult(null);
    setPlacementScore(null);
    setIsNewRecord(false);
  }, []);

  // 切换题目：换题 + 清空旧状态 + 恢复新题的保存解法全部同批提交，
  // 避免"旧解法残留"与"先清空再重画"的两帧闪烁
  const loadPuzzle = useCallback(
    (p: PuzzleDefinition) => {
      setPuzzle(p);
      setIsNewRecord(false);
      if (isEditMode) {
        setActivePath([]);
        setValidationResult(null);
        setPlacementScore(null);
        return;
      }
      const dirs = savedAnswers[p.title];
      const start = p.starts[0] ?? { r: 0, c: 0 };
      const path = dirs ? directionsToPath(dirs, start, p.width, p.height) : [];
      if (path.length > 1) {
        const res = validatePuzzle(p, path);
        if (res.valid) {
          setActivePath(path);
          setValidationResult(res);
          setPlacementScore(calculatePlacementScore(p, path));
        } else {
          setActivePath([]);
          setValidationResult(null);
          setPlacementScore(null);
        }
      } else {
        setActivePath([]);
        setValidationResult(null);
        setPlacementScore(null);
      }
    },
    [savedAnswers, isEditMode]
  );

  // 打开选关地图：先清空划线状态，再显示地图覆盖层
  const handleOpenMap = useCallback(() => {
    handleResetPath();
    setShowMap(true);
  }, [handleResetPath]);

  // 地图点选关卡：载入并关闭地图（无音效）
  const handleMapSelect = useCallback(
    (p: PuzzleDefinition) => {
      loadPuzzle(p);
      setShowMap(false);
    },
    [loadPuzzle]
  );

  // —— 编辑器（谜题工坊）操作 ——
  const handleLoadPreset = useCallback(
    (preset: PuzzleDefinition) => {
      loadPuzzle(preset);
    },
    [loadPuzzle]
  );

  const handleSaveCustomPuzzle = useCallback(
    (name: string) => {
      setCustomPuzzles(saveCustomPuzzle({ ...puzzle, title: name }));
    },
    [puzzle]
  );

  const handleDeleteCustomPuzzle = useCallback((title: string) => {
    setCustomPuzzles(deleteCustomPuzzle(title));
  }, []);

  const handleNewEmptyPuzzle = useCallback(() => {
    setPuzzle({ ...DEFAULT_BLANK_PUZZLE });
    handleResetPath();
  }, [handleResetPath]);

  // 设置界面切换音效（与编辑工具栏的音效开关一致）
  const handleToggleSound = useCallback(() => {
    setSoundEnabled((prev) => !prev);
    sound.enabled = !soundEnabled;
  }, [soundEnabled]);

  // 默认显示保存的解法：解码成路径画到题板，并判定其得分展示给玩家（无声音）
  const showSavedAnswer = useCallback(() => {
    const dirs = savedAnswers[puzzle.title];
    if (!dirs) return;
    const start = puzzle.starts[0] ?? { r: 0, c: 0 };
    const path = directionsToPath(dirs, start, puzzle.width, puzzle.height);
    if (path.length <= 1) return;
    setActivePath(path);
    setIsNewRecord(false);
    const res = validatePuzzle(puzzle, path);
    if (res.valid) {
      const scoreRes = calculatePlacementScore(puzzle, path);
      setValidationResult(res);
      setPlacementScore(scoreRes);
    } else {
      setValidationResult(null);
      setPlacementScore(null);
    }
  }, [savedAnswers, puzzle]);

  // Whenever entering edit mode, always clear any drawn line;
  // 回到解谜模式时恢复显示保存的解法
  useEffect(() => {
    if (isEditMode) {
      handleResetPath();
    } else {
      showSavedAnswer();
    }
  }, [isEditMode, handleResetPath, showSavedAnswer]);

  // 全局快捷键（Escape / r 重置划线；Ctrl+E 切换编辑模式）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      // 地图覆盖层打开时按键交给地图处理（Esc 关闭地图）
      if (showMap) return;

      // 编辑模式入口：Ctrl+E（macOS 为 Cmd+E）在解谜与编辑之间切换
      if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        setIsEditMode((v) => !v);
        return;
      }

      if (e.code === 'Escape' || e.key === 'r') {
        handleResetPath();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleResetPath, showMap]);

  // 所有题目历史最高分之和（屏幕右上角总分）
  const totalBestScore = Object.values(bestScores).reduce((sum, v) => sum + v, 0);

  // 总分达到 675：记录比赛计时终点（只记首次），计时器显示自此冻结
  useEffect(() => {
    if (totalBestScore >= TIMER_STOP_SCORE) {
      markTimerStop(Date.now());
    }
  }, [totalBestScore]);

  // 当前题在预设题库中的位置（用于屏幕左右边缘的切关按钮）
  const presetIdx = PRESET_PUZZLES.findIndex((p) => p.title === puzzle.title);

  // 行首关无左按钮；右按钮在本关解出（题板符号全对）后才出现，行末关的右按钮进入地图。
  // 行首/行末按预设顺序中相邻题的所属行判断，自动适配 E 附加行
  const rowKey = rowKeyOf(puzzle.title);
  const isRowStart =
    presetIdx !== -1 &&
    (presetIdx === 0 || rowKeyOf(PRESET_PUZZLES[presetIdx - 1].title) !== rowKey);
  const isRowEnd =
    presetIdx !== -1 &&
    (presetIdx === PRESET_PUZZLES.length - 1 ||
      rowKeyOf(PRESET_PUZZLES[presetIdx + 1].title) !== rowKey);
  const showPrevButton = presetIdx !== -1 && !isRowStart;
  const showNextButton = presetIdx !== -1 && solvedTitles.includes(puzzle.title);

  return (
    <div className="min-h-screen bg-slate-800 text-slate-100 flex flex-col selection:bg-amber-400 selection:text-slate-950">
      {/* 屏幕左上角：返回选关地图（大按钮方便点击，高度与右上角总分框一致） */}
      <button
        onClick={handleOpenMap}
        aria-label="返回地图"
        className="fixed left-4 top-3 z-50 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-600 bg-slate-800/90 text-slate-200 shadow-lg backdrop-blur-sm transition-colors hover:border-amber-400 hover:text-amber-300 md:h-24 md:w-24"
      >
        <Map className="h-8 w-8 md:h-14 md:w-14" />
      </button>

      {/* 比赛计时器：地图按钮右侧，解题与地图界面位置一致（z 高于地图层） */}
      <div className="pointer-events-none fixed left-[92px] top-3 z-[85] flex h-16 items-center md:left-[124px] md:h-24">
        <CompetitionTimer />
      </div>

      {/* 屏幕右上角总分 */}
      <div className="fixed top-3 right-4 z-50 flex items-baseline gap-2 rounded-xl border border-slate-800 bg-slate-800/90 px-2.5 py-1 text-slate-300 shadow-inner backdrop-blur-sm md:px-5 md:py-2">
        <span className="text-slate-500 text-xs md:text-lg">{t('total')}</span>
        <span className="text-amber-400 font-black text-2xl md:text-7xl leading-none">{totalBestScore}</span>
      </div>

      {/* 屏幕最左/最右侧切关按钮：行首关无左按钮；右按钮在本关解出后才出现，
          行末关的右按钮改为进入地图 */}
      {showPrevButton && (
        <button
          aria-label="上一关"
          onClick={() => {
            loadPuzzle(PRESET_PUZZLES[presetIdx - 1]);
          }}
          className="fixed left-3 top-1/2 z-40 -translate-y-1/2 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-600 bg-slate-800/90 text-slate-200 shadow-lg backdrop-blur-sm transition-colors hover:border-amber-400 hover:text-amber-300 md:h-24 md:w-24"
        >
          <ChevronLeft className="h-8 w-8 md:h-14 md:w-14" strokeWidth={2.5} />
        </button>
      )}
      {showNextButton && (
        <button
          aria-label={isRowEnd ? '返回地图' : '下一关'}
          onClick={() => {
            if (isRowEnd) {
              handleOpenMap();
            } else {
              loadPuzzle(PRESET_PUZZLES[presetIdx + 1]);
            }
          }}
          className="fixed right-3 top-1/2 z-40 -translate-y-1/2 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-600 bg-slate-800/90 text-slate-200 shadow-lg backdrop-blur-sm transition-colors hover:border-amber-400 hover:text-amber-300 md:h-24 md:w-24"
        >
          <ChevronRight className="h-8 w-8 md:h-14 md:w-14" strokeWidth={2.5} />
        </button>
      )}

      {/* Main Workspace */}
      <main className="relative flex-1 flex flex-col items-center justify-start p-3 md:p-5 max-w-6xl w-full mx-auto">
        {/* 编辑器工具栏（谜题工坊）：仅编辑模式渲染 */}
        {isEditMode && (
          <EditorToolbar
            puzzle={puzzle}
            customPuzzles={customPuzzles}
            isEditMode={isEditMode}
            selectedTool={selectedTool}
            setSelectedTool={setSelectedTool}
            selectedColor={selectedColor}
            setSelectedColor={setSelectedColor}
            polyominoShape={polyominoShape}
            setPolyominoShape={setPolyominoShape}
            rotatablePoly={rotatablePoly}
            setRotatablePoly={setRotatablePoly}
            negativePoly={negativePoly}
            setNegativePoly={setNegativePoly}
            triangleCount={triangleCount}
            setTriangleCount={setTriangleCount}
            onUpdatePuzzle={setPuzzle}
            onResetPath={handleResetPath}
            onLoadPreset={handleLoadPreset}
            onSaveCustomPuzzle={handleSaveCustomPuzzle}
            onDeleteCustomPuzzle={handleDeleteCustomPuzzle}
            onNewEmptyPuzzle={handleNewEmptyPuzzle}
            soundEnabled={soundEnabled}
            setSoundEnabled={setSoundEnabled}
          />
        )}

        {/* The Clean Puzzle Canvas：解谜模式在可用空间内垂直+水平居中（题板中心 = 屏幕中心） */}
        <div className={`w-full flex justify-center ${isEditMode ? 'mt-3' : 'my-auto'}`}>
          <PuzzleCanvas
            puzzle={puzzle}
            isEditMode={isEditMode}
            selectedTool={selectedTool}
            selectedColor={selectedColor}
            polyominoShape={polyominoShape}
            triangleCount={triangleCount}
            rotatablePoly={rotatablePoly}
            negativePoly={negativePoly}
            onUpdatePuzzle={setPuzzle}
            activePath={activePath}
            setActivePath={setActivePath}
            validationResult={validationResult}
            onValidatePath={handleValidatePath}
            placementScore={placementScore}
            selectedGroupId={selectedGroupId}
            onSelectGroupId={setSelectedGroupId}
            selectedSymbolId={selectedSymbolId}
            onSelectSymbolId={setSelectedSymbolId}
            showResonanceHeatmap={showResonanceHeatmap}
            setShowResonanceHeatmap={setShowResonanceHeatmap}
            bestScore={bestScores[puzzle.title]}
            maxEverReached={revealedMaxTitles.includes(puzzle.title)}
          />
        </div>
      </main>

      {/* 选关地图覆盖层 */}
      {showMap && (
        <LevelMap
          puzzles={PRESET_PUZZLES}
          bestScores={bestScores}
          savedAnswers={savedAnswers}
          solvedTitles={solvedTitles}
          onSelect={handleMapSelect}
          onClose={() => setShowMap(false)}
          focusTitle={puzzle.title}
          onOpenSettings={() => setShowSettings(true)}
          escDisabled={showSettings}
        />
      )}

      {/* 设置界面覆盖层（地图之上） */}
      {showSettings && (
        <SettingsOverlay
          soundEnabled={soundEnabled}
          onToggleSound={handleToggleSound}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
