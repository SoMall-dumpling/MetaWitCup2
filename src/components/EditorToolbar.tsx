/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  PuzzleDefinition,
  SymmetryType,
  ColorType,
  normalizePuzzle,
} from '../types/puzzle';
import { sound } from '../utils/audio';
import { puzzleToTsLiteral, puzzlesToTsLiteral } from '../utils/tsLiteral';
import {
  RotateCcw,
  Download,
  Volume2,
  VolumeX,
  Trash2,
  Save,
  Plus,
  Share2,
  Check,
} from 'lucide-react';

interface EditorToolbarProps {
  puzzle: PuzzleDefinition;
  customPuzzles: PuzzleDefinition[];
  isEditMode: boolean;
  selectedTool: string;
  setSelectedTool: (tool: string) => void;
  selectedColor: ColorType;
  setSelectedColor: (col: ColorType) => void;
  polyominoShape: boolean[][];
  setPolyominoShape: React.Dispatch<React.SetStateAction<boolean[][]>>;
  rotatablePoly: boolean;
  setRotatablePoly: (val: boolean) => void;
  negativePoly: boolean;
  setNegativePoly: (val: boolean) => void;
  triangleCount: number;
  setTriangleCount: (count: number) => void;
  onUpdatePuzzle: (updated: PuzzleDefinition) => void;
  onResetPath: () => void;
  onLoadPreset: (preset: PuzzleDefinition) => void;
  onSaveCustomPuzzle: (name: string) => void;
  onDeleteCustomPuzzle: (title: string) => void;
  onNewEmptyPuzzle: () => void;
  soundEnabled: boolean;
  setSoundEnabled: (val: boolean) => void;
}

const SYMMETRY_LABELS: Record<SymmetryType, string> = {
  none: '无对称',
  horizontal: '水平镜像',
  vertical: '垂直镜像',
  rotational: '中心旋转',
};

const COLOR_NAMES: Record<ColorType, string> = {
  black: '黑色',
  white: '白色',
  orange: '橙色',
  magenta: '品红',
  cyan: '青色',
  green: '绿色',
  yellow: '黄色',
};

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  puzzle,
  customPuzzles,
  isEditMode,
  selectedTool,
  setSelectedTool,
  selectedColor,
  setSelectedColor,
  polyominoShape,
  setPolyominoShape,
  rotatablePoly,
  setRotatablePoly,
  negativePoly,
  setNegativePoly,
  triangleCount,
  setTriangleCount,
  onUpdatePuzzle,
  onResetPath,
  onLoadPreset,
  onSaveCustomPuzzle,
  onDeleteCustomPuzzle,
  onNewEmptyPuzzle,
  soundEnabled,
  setSoundEnabled,
}) => {
  const [showJsonModal, setShowJsonModal] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [exportFormat, setExportFormat] = useState<'json' | 'ts'>('ts');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [puzzleNameInput, setPuzzleNameInput] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const colors: ColorType[] = ['black', 'white', 'orange', 'magenta', 'cyan', 'green', 'yellow'];


  // Toggle grid dimension (allow 1 to 8)
  const handleResize = (deltaW: number, deltaH: number) => {
    const newW = Math.max(1, Math.min(8, puzzle.width + deltaW));
    const newH = Math.max(1, Math.min(8, puzzle.height + deltaH));
    if (newW === puzzle.width && newH === puzzle.height) return;

    const newStarts = puzzle.starts.filter((s) => s.r <= newH && s.c <= newW);
    if (newStarts.length === 0) newStarts.push({ r: newH, c: 0 });

    const newEnds = puzzle.ends.filter((e) => e.r <= newH && e.c <= newW);
    if (newEnds.length === 0) newEnds.push({ r: 0, c: newW, dir: 'up' });

    const newCellSymbols: any = {};
    Object.entries(puzzle.cellSymbols).forEach(([k, v]) => {
      const [r, c] = k.split(',').map(Number);
      if (r < newH && c < newW) newCellSymbols[k] = v;
    });

    onUpdatePuzzle({
      ...puzzle,
      width: newW,
      height: newH,
      starts: newStarts,
      ends: newEnds,
      cellSymbols: newCellSymbols,
    });
    onResetPath();
  };

  const handleSymmetryChange = (sym: SymmetryType) => {
    onUpdatePuzzle({ ...puzzle, symmetry: sym });
    onResetPath();
  };

  const togglePolyCell = (r: number, c: number) => {
    const next = polyominoShape.map((row, ri) =>
      row.map((val, ci) => (ri === r && ci === c ? !val : val))
    );
    setPolyominoShape(next);
  };

  const handleCopyShareLink = () => {
    try {
      const encoded = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(puzzle)))));
      const url = `${window.location.origin}${window.location.pathname}#puzzle=${encoded}`;
      navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
      sound.playTick(1.2);
    } catch {
      alert('分享链接生成失败');
    }
  };

  const isCurrentCustom = customPuzzles.some((p) => p.title === puzzle.title);

  return (
    <div className="flex flex-col gap-3 w-full max-w-4xl mx-auto px-4">
      {/* Top Header Bar（仅编辑模式可见）：左侧留出固定「地图」按钮的位置 */}
      {isEditMode && (
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3 pl-36">
        {/* Left Side: New/Save Quick Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* New Empty Puzzle（仅编辑模式可见） */}
          {isEditMode && (
            <button
              onClick={() => {
                onNewEmptyPuzzle();
                sound.playTick(1.2);
              }}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新建</span>
            </button>
          )}

          {/* Quick Save Puzzle（仅编辑模式可见） */}
          {isEditMode && (
            <button
              onClick={() => {
                setPuzzleNameInput(puzzle.title || '我的自制关卡');
                setShowSaveModal(true);
              }}
              className="flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition-colors shadow-xs"
            >
              <Save className="h-3.5 w-3.5" />
              <span>保存关卡</span>
            </button>
          )}

          {/* Delete if custom puzzle（仅编辑模式可见） */}
          {isEditMode && isCurrentCustom && (
            <button
              onClick={() => {
                if (confirm(`确定删除自制关卡「${puzzle.title}」吗？`)) {
                  onDeleteCustomPuzzle(puzzle.title);
                  sound.playTick(0.8);
                }
              }}
              className="rounded-lg border border-slate-800 bg-slate-900/60 p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-950/30 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Right Side: Actions（仅编辑模式可见） */}
        {isEditMode && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={onResetPath}
              className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>重置线</span>
            </button>

            <button
              onClick={handleCopyShareLink}
              className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
            >
              {copiedLink ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-400">已复制链接</span>
                </>
              ) : (
                <>
                  <Share2 className="h-3.5 w-3.5" />
                  <span>分享</span>
                </>
              )}
            </button>

            <button
              onClick={() => setShowJsonModal(true)}
              className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              <span>JSON</span>
            </button>

            <button
              onClick={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                sound.enabled = next;
              }}
              className="rounded-lg border border-slate-800 bg-slate-900/80 p-1.5 text-slate-300 hover:bg-slate-800 transition-colors"
            >
              {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-red-400" />}
            </button>
          </div>
        )}
      </div>
      )}

      {/* Editor Controls Palette (Visible when isEditMode is true) */}
      {isEditMode && (
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3.5 backdrop-blur-sm animate-in fade-in duration-200">
          {/* Top Row: Grid Dimension & Symmetry */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-2.5">
            {/* Grid Size */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                网格尺寸：
              </span>
              <div className="flex items-center gap-1.5 font-mono text-sm text-slate-200">
                <span className="font-bold">{puzzle.width}</span> × <span className="font-bold">{puzzle.height}</span>
              </div>
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => handleResize(-1, 0)}
                  disabled={puzzle.width <= 1}
                  className="rounded bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                >
                  -宽
                </button>
                <button
                  onClick={() => handleResize(1, 0)}
                  disabled={puzzle.width >= 8}
                  className="rounded bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                >
                  +宽
                </button>
                <button
                  onClick={() => handleResize(0, -1)}
                  disabled={puzzle.height <= 1}
                  className="rounded bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-300 hover:bg-slate-700 disabled:opacity-40 ml-1"
                >
                  -高
                </button>
                <button
                  onClick={() => handleResize(0, 1)}
                  disabled={puzzle.height >= 8}
                  className="rounded bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                >
                  +高
                </button>
              </div>
            </div>

            {/* Symmetry Mode */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                对称模式：
              </span>
              {(['none', 'horizontal', 'vertical', 'rotational'] as SymmetryType[]).map((sym) => (
                <button
                  key={sym}
                  onClick={() => handleSymmetryChange(sym)}
                  className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                    puzzle.symmetry === sym
                      ? 'bg-amber-400/20 text-amber-300 border border-amber-400/50'
                      : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {SYMMETRY_LABELS[sym]}
                </button>
              ))}
            </div>

            {/* Target Score (计分上限) */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                计分上限：
              </span>
              <input
                type="number"
                min={0}
                step={1}
                value={puzzle.targetScore ?? ''}
                placeholder="无"
                onChange={(e) => {
                  const raw = e.target.value;
                  const n = Number(raw);
                  const val =
                    raw === '' || !Number.isFinite(n)
                      ? undefined
                      : Math.max(0, Math.floor(n));
                  // 目标分与最大分互斥：设置目标分时清空最大分
                  onUpdatePuzzle({
                    ...puzzle,
                    targetScore: val,
                    maxScore: val != null ? undefined : puzzle.maxScore,
                  });
                }}
                className="w-16 rounded-md bg-slate-800/80 border border-slate-700 px-2 py-0.5 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>

            {/* Max Score (最大可能得分) */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                最大可能得分：
              </span>
              <input
                type="number"
                min={0}
                step={1}
                value={puzzle.maxScore ?? ''}
                placeholder="无"
                disabled={puzzle.targetScore != null}
                onChange={(e) => {
                  const raw = e.target.value;
                  const n = Number(raw);
                  const val =
                    raw === '' || !Number.isFinite(n)
                      ? undefined
                      : Math.max(0, Math.floor(n));
                  onUpdatePuzzle({ ...puzzle, maxScore: val });
                }}
                className="w-16 rounded-md bg-slate-800/80 border border-slate-700 px-2 py-0.5 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
              />
              {puzzle.targetScore != null && (
                <span className="text-[10px] text-slate-500">
                  与计分上限互斥，请先清空计分上限
                </span>
              )}
              {puzzle.maxScore != null && (
                <label className="flex items-center gap-1.5 text-xs text-slate-400 select-none">
                  <input
                    type="checkbox"
                    checked={puzzle.showMaxScore === true}
                    onChange={(e) =>
                      onUpdatePuzzle({ ...puzzle, showMaxScore: e.target.checked })
                    }
                    className="accent-amber-400"
                  />
                  向玩家显示最高分
                </label>
              )}
            </div>

            {/* Baseline Score (计分下限，青色) */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                计分下限：
              </span>
              <input
                type="number"
                min={0}
                step={1}
                value={puzzle.baselineScore ?? ''}
                placeholder="无"
                onChange={(e) => {
                  const raw = e.target.value;
                  const n = Number(raw);
                  const val =
                    raw === '' || !Number.isFinite(n)
                      ? undefined
                      : Math.max(0, Math.floor(n));
                  onUpdatePuzzle({ ...puzzle, baselineScore: val });
                }}
                className="w-16 rounded-md bg-slate-800/80 border border-cyan-700 px-2 py-0.5 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-400"
              />
            </div>

            {/* Extra Bonus (满分奖励加分) */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                满分奖励加分：
              </span>
              <input
                type="number"
                min={0}
                step={1}
                value={puzzle.extraBonus ?? ''}
                placeholder="无"
                onChange={(e) => {
                  const raw = e.target.value;
                  const n = Number(raw);
                  const val =
                    raw === '' || !Number.isFinite(n)
                      ? undefined
                      : Math.max(0, Math.floor(n));
                  onUpdatePuzzle({ ...puzzle, extraBonus: val });
                }}
                className="w-16 rounded-md bg-slate-800/80 border border-emerald-700 px-2 py-0.5 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-400"
              />
            </div>
          </div>

          {/* Tools Palette */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-1">
              绘制工具：
            </span>

            {[
              { id: 'start_end', label: '起点 / 出口' },
              { id: 'broken_edge', label: '阻断缺口' },
              { id: 'dot', label: '六边形点' },
              { id: 'square', label: '黑白/彩色方块' },
              { id: 'star', label: '八角星配对' },
              { id: 'triangle', label: '三角形边数' },
              { id: 'polyomino', label: '多联骨牌' },
              { id: 'cancellation', label: 'Y形消除' },
              { id: 'eraser', label: '清空/删除' },
            ].map((tool) => (
              <button
                key={tool.id}
                onClick={() => setSelectedTool(tool.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                  selectedTool === tool.id
                    ? 'bg-amber-400 text-slate-950 font-bold shadow-sm'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {tool.label}
              </button>
            ))}
          </div>

          {/* Contextual Options Row (Colors, Counts, Polyomino Builder) */}
          <div className="flex flex-wrap items-center gap-4 rounded-xl bg-slate-950/60 p-2.5 border border-slate-800/80">
            {/* Color Selector for Square, Star, Dot */}
            {(selectedTool === 'square' || selectedTool === 'star' || selectedTool === 'dot') && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-medium">颜色：</span>
                <div className="flex items-center gap-1.5">
                  {colors.map((c) => (
                    <button
                      key={c}
                      onClick={() => setSelectedColor(c)}
                      className={`h-5 w-5 rounded-full border transition-all ${
                        selectedColor === c ? 'scale-125 border-white ring-2 ring-amber-400' : 'border-transparent opacity-80 hover:opacity-100'
                      }`}
                      style={{
                        backgroundColor:
                          c === 'black'
                            ? '#0f172a'
                            : c === 'white'
                            ? '#f8fafc'
                            : c === 'orange'
                            ? '#f97316'
                            : c === 'magenta'
                            ? '#d946ef'
                            : c === 'cyan'
                            ? '#06b6d4'
                            : c === 'green'
                            ? '#22c55e'
                            : '#eab308',
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Triangle Count Selector */}
            {selectedTool === 'triangle' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-medium">要求接触边数：</span>
                {[1, 2, 3].map((cnt) => (
                  <button
                    key={cnt}
                    onClick={() => setTriangleCount(cnt)}
                    className={`rounded px-2.5 py-0.5 text-xs font-bold transition-colors ${
                      triangleCount === cnt
                        ? 'bg-orange-500 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {cnt} ▲
                  </button>
                ))}
              </div>
            )}

            {/* Polyomino Mini Builder */}
            {selectedTool === 'polyomino' && (
              <div className="flex items-center gap-4">
                <span className="text-xs text-slate-400 font-medium">骨牌形状：</span>
                <div className="grid grid-cols-4 gap-0.5 rounded bg-slate-900 p-1 border border-slate-800">
                  {polyominoShape.map((row, ri) =>
                    row.map((val, ci) => (
                      <button
                        key={`${ri}-${ci}`}
                        onClick={() => togglePolyCell(ri, ci)}
                        className={`h-4 w-4 rounded-xs transition-colors ${
                          val ? (negativePoly ? 'bg-cyan-500' : 'bg-yellow-400') : 'bg-slate-800'
                        }`}
                      />
                    ))
                  )}
                </div>

                <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rotatablePoly}
                    onChange={(e) => setRotatablePoly(e.target.checked)}
                    className="rounded border-slate-700 text-amber-500"
                  />
                  <span>允许任意旋转（倾斜标志）</span>
                </label>

                <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={negativePoly}
                    onChange={(e) => setNegativePoly(e.target.checked)}
                    className="rounded border-slate-700 text-cyan-500"
                  />
                  <span>蓝色镂空（减法骨牌）</span>
                </label>
              </div>
            )}

            {/* Clear Board Shortcut */}
            <div className="ml-auto">
              <button
                onClick={() => {
                  if (!confirmClear) {
                    setConfirmClear(true);
                    setTimeout(() => setConfirmClear(false), 4000);
                  } else {
                    onUpdatePuzzle({
                      ...puzzle,
                      cellSymbols: {},
                      edgeDots: {},
                      vertexDots: {},
                      brokenEdges: [],
                    });
                    onResetPath();
                    setConfirmClear(false);
                  }
                }}
                className={`flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-semibold transition-all ${
                  confirmClear
                    ? 'bg-red-600 text-white border-red-500 shadow-md animate-pulse'
                    : 'bg-red-950/40 border-red-900/50 text-red-400 hover:bg-red-900/60'
                }`}
              >
                <Trash2 className="h-3 w-3" />
                <span>{confirmClear ? '再次点击确认清空！' : '清空所有符号'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Puzzle Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-1.5 flex items-center gap-2">
              <Save className="h-4 w-4 text-amber-400" />
              <span>保存到本地关卡库</span>
            </h3>
            <p className="text-xs text-slate-400 mb-3">
              为你的自制关卡起一个名字，保存后将长期存留在浏览器中，随时可在下拉菜单中选择！
            </p>
            <input
              type="text"
              autoFocus
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-400"
              value={puzzleNameInput}
              onChange={(e) => setPuzzleNameInput(e.target.value)}
              placeholder="例如：我的双星谜题 01"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && puzzleNameInput.trim()) {
                  onSaveCustomPuzzle(puzzleNameInput.trim());
                  setShowSaveModal(false);
                }
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowSaveModal(false)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (puzzleNameInput.trim()) {
                    onSaveCustomPuzzle(puzzleNameInput.trim());
                    setShowSaveModal(false);
                  }
                }}
                className="rounded-lg bg-amber-400 px-4 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-300"
              >
                确认保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JSON Import/Export Modal */}
      {showJsonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-2 flex items-center justify-between">
              <span>谜题数据导入 / 导出</span>
              <span className="text-xs font-normal text-slate-400">
                本地自制关卡：{customPuzzles.length} 个
              </span>
            </h3>
            <div className="mb-3 flex w-fit gap-1 rounded-lg bg-slate-800 p-1">
              <button
                onClick={() => setExportFormat('json')}
                className={`rounded-md px-3 py-1 text-xs font-semibold ${
                  exportFormat === 'json'
                    ? 'bg-slate-950 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                JSON
              </button>
              <button
                onClick={() => setExportFormat('ts')}
                className={`rounded-md px-3 py-1 text-xs font-semibold ${
                  exportFormat === 'ts'
                    ? 'bg-slate-950 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                index.ts
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              {exportFormat === 'ts'
                ? '下方代码可直接粘贴到 src/presets/index.ts 的 PRESET_PUZZLES 数组中；也可以点击「导出全部自制关卡」一键打包复制。'
                : '可直接复制下方代码保存或分享；也可以点击下方「导出全部自制关卡」将当前设计的全部关卡一键打包复制。'}
            </p>
            <textarea
              rows={9}
              readOnly={exportFormat === 'ts'}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-amber-400"
              value={
                exportFormat === 'ts'
                  ? puzzleToTsLiteral(puzzle)
                  : jsonInput || JSON.stringify(puzzle, null, 2)
              }
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder="粘贴单个关卡或关卡数组 JSON 数据..."
            />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      exportFormat === 'ts'
                        ? puzzleToTsLiteral(puzzle)
                        : JSON.stringify(puzzle, null, 2)
                    );
                    alert(
                      exportFormat === 'ts'
                        ? '已复制当前关卡（index.ts 格式）到剪贴板！'
                        : '已复制当前关卡 JSON 到剪贴板！'
                    );
                  }}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
                >
                  复制当前关卡
                </button>
                {customPuzzles.length > 0 && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(
                        exportFormat === 'ts'
                          ? puzzlesToTsLiteral(customPuzzles)
                          : JSON.stringify(customPuzzles, null, 2)
                      );
                      alert(`已成功将全部 ${customPuzzles.length} 个自制关卡打包复制到剪贴板！`);
                    }}
                    className="rounded-lg bg-amber-400/20 border border-amber-400/40 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-400/30"
                  >
                    导出全部关卡 ({customPuzzles.length})
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {exportFormat === 'json' && (
                  <button
                    onClick={() => {
                      try {
                        const parsed = JSON.parse(jsonInput);
                        if (Array.isArray(parsed)) {
                          parsed.forEach((p) => {
                            if (p && p.title) {
                              onSaveCustomPuzzle(p.title || '导入关卡');
                            }
                          });
                          if (parsed.length > 0) {
                            onLoadPreset(parsed[0]);
                          }
                          alert(`成功导入 ${parsed.length} 个关卡！`);
                        } else {
                          onUpdatePuzzle(normalizePuzzle(parsed));
                          onResetPath();
                          alert('成功导入当前关卡！');
                        }
                        setShowJsonModal(false);
                        setJsonInput('');
                      } catch (err) {
                        alert('JSON 数据格式有误，请检查后重试！');
                      }
                    }}
                    className="rounded-lg bg-amber-400 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-300"
                  >
                    确认导入
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowJsonModal(false);
                    setJsonInput('');
                  }}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
