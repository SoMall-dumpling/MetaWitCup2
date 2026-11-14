/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { CellSymbol, ColorType } from '../types/puzzle';
import { useTheme } from '../utils/theme';

interface PuzzleSymbolProps {
  symbol: CellSymbol;
  cx: number;
  cy: number;
  size: number;
  isInvalid?: boolean;
}

export const COLOR_MAP: Record<ColorType, { fill: string; stroke?: string }> = {
  black: { fill: '#0f172a', stroke: '#334155' },
  white: { fill: '#f8fafc', stroke: '#94a3b8' },
  orange: { fill: '#f97316' },
  magenta: { fill: '#d946ef' },
  cyan: { fill: '#06b6d4' },
  green: { fill: '#22c55e' },
  yellow: { fill: '#eab308' },
};

export const PuzzleSymbol: React.FC<PuzzleSymbolProps> = ({
  symbol,
  cx,
  cy,
  size,
  isInvalid = false,
}) => {
  const theme = useTheme();
  // 亮色主题：白色符号（方块/星形）改用深灰描边——白色填充在浅色题板上
  // 需要更深的边框才能看清轮廓；其余颜色不变
  const colorDef: { fill: string; stroke?: string } =
    symbol.color === 'white' && theme === 'light'
      ? { fill: '#f8fafc', stroke: '#64748b' }
      : COLOR_MAP[symbol.color || 'black'] || COLOR_MAP.black;
  // 亮色主题：消除符号（抗体）原白色三叉在浅色题板上不可见，改深色
  const eraserColor = theme === 'light' ? '#0f172a' : '#f8fafc';
  const shakeClass = `pointer-events-none`;

  // 报错闪烁：动画在「原色 ↔ 红」之间交替（原色经 CSS 变量注入），
  // 而不是透明度脉动（那样会闪成「空白 ↔ 红」）
  const flashClass = isInvalid ? 'animate-flash-symbol' : '';
  const flashVars = (originalFill: string, originalStroke?: string) =>
    isInvalid
      ? ({
          '--flash-original-fill': originalFill,
          '--flash-original-stroke': originalStroke,
        } as React.CSSProperties)
      : undefined;

  switch (symbol.type) {
    case 'square': {
      const s = size * 0.42;
      return (
        <g className={shakeClass}>
          <rect
            x={cx - s / 2}
            y={cy - s / 2}
            width={s}
            height={s}
            rx={4}
            fill={isInvalid ? '#ef4444' : colorDef.fill}
            stroke={
              isInvalid
                ? '#ef4444'
                : colorDef.stroke || (symbol.color === 'white' ? '#64748b' : 'none')
            }
            strokeWidth={1.5}
            className={`transition-colors duration-200 ${flashClass}`}
            style={flashVars(
              colorDef.fill,
              colorDef.stroke || (symbol.color === 'white' ? '#64748b' : undefined)
            )}
          />
        </g>
      );
    }

    case 'star': {
      // 8-pointed star with rounded lobes
      const rOuter = size * 0.26;
      const rInner = size * 0.17;
      const points: string[] = [];
      for (let i = 0; i < 16; i++) {
        const angle = (i * Math.PI) / 8 - Math.PI / 2;
        const r = i % 2 === 0 ? rOuter : rInner;
        points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
      }
      return (
        <g className={shakeClass}>
          <polygon
            points={points.join(' ')}
            fill={isInvalid ? '#ef4444' : colorDef.fill}
            stroke={isInvalid ? '#ef4444' : colorDef.stroke || 'none'}
            strokeWidth={1}
            strokeLinejoin="round"
            className={flashClass}
            style={flashVars(colorDef.fill, colorDef.stroke)}
          />
        </g>
      );
    }

    case 'triangle': {
      const count = symbol.count || 1;
      const triH = size * 0.18;
      const triW = size * 0.2;
      const fillColor = isInvalid ? '#ef4444' : '#f97316';

      const renderSingleTriangle = (x: number, y: number, key: string) => {
        const p1 = `${x},${y - triH / 2}`;
        const p2 = `${x - triW / 2},${y + triH / 2}`;
        const p3 = `${x + triW / 2},${y + triH / 2}`;
        return (
          <polygon
            key={key}
            points={`${p1} ${p2} ${p3}`}
            fill={fillColor}
            stroke={isInvalid ? '#ef4444' : '#ea580c'}
            strokeWidth={1}
            strokeLinejoin="round"
            className={flashClass}
            style={flashVars('#f97316', '#ea580c')}
          />
        );
      };

      return (
        <g className={shakeClass}>
          {count === 1 && renderSingleTriangle(cx, cy, 't1')}
          {count === 2 && (
            <>
              {/* 两两间距与三个三角形一致：中心距 1.15 × 三角宽，即各偏移一半 */}
              {renderSingleTriangle(cx - triW * 0.575, cy, 't1')}
              {renderSingleTriangle(cx + triW * 0.575, cy, 't2')}
            </>
          )}
          {count === 3 && (
            <>
              {/* 三个三角形横向排成一排 */}
              {renderSingleTriangle(cx - triW * 1.15, cy, 't1')}
              {renderSingleTriangle(cx, cy, 't2')}
              {renderSingleTriangle(cx + triW * 1.15, cy, 't3')}
            </>
          )}
        </g>
      );
    }

    case 'polyomino': {
      const shape = symbol.shape || [[true]];
      // 单格块边长默认格子尺寸的 0.16；个别符号可用 blockRatio 单独缩小
      const blockSize = size * (symbol.blockRatio ?? 0.16);
      const gap = 2;

      // 按实际填充格的紧致包围盒确定视觉中心，
      // 而不是按构造时的完整框架（如 3x3 / 4x4）居中
      let minR = shape.length;
      let maxR = -1;
      let minC = shape[0].length;
      let maxC = -1;
      shape.forEach((row, r) =>
        row.forEach((val, c) => {
          if (val) {
            if (r < minR) minR = r;
            if (r > maxR) maxR = r;
            if (c < minC) minC = c;
            if (c > maxC) maxC = c;
          }
        })
      );
      // 全空形状时按框架居中兜底
      if (maxR < 0) {
        minR = 0;
        minC = 0;
        maxR = shape.length - 1;
        maxC = shape[0].length - 1;
      }

      const usedCols = maxC - minC + 1;
      const usedRows = maxR - minR + 1;
      const totalW = usedCols * blockSize + (usedCols - 1) * gap;
      const totalH = usedRows * blockSize + (usedRows - 1) * gap;
      const startX = cx - totalW / 2;
      const startY = cy - totalH / 2;
      const rot = symbol.rotatable ? 20 : 0;
      const isNeg = !!symbol.negative;
      // 所有骨牌每格略小（90%），相邻格边界分离更清晰
      const drawSize = blockSize * 0.9;
      const polyFill = isInvalid
        ? '#ef4444'
        : isNeg
        ? 'none' // 蓝色镂空骨牌：无填充
        : '#eab308';
      const polyStroke = isInvalid
        ? '#ef4444'
        : isNeg
        ? '#1e40af' // 蓝色镂空（减法）骨牌：深蓝色边界
        : '#ca8a04';

      return (
        <g
          transform={`rotate(${rot} ${cx} ${cy})`}
          className={shakeClass}
        >
          {shape.map((row, r) =>
            row.map((val, c) => {
              if (!val) return null;
              const bx = startX + (c - minC) * (blockSize + gap) + (blockSize - drawSize) / 2;
              const by = startY + (r - minR) * (blockSize + gap) + (blockSize - drawSize) / 2;
              return (
                <rect
                  key={`${r}-${c}`}
                  x={bx}
                  y={by}
                  width={drawSize}
                  height={drawSize}
                  rx={0} // 所有骨牌：直角正方形
                  fill={polyFill}
                  stroke={polyStroke}
                  strokeWidth={isNeg ? 2 : 1}
                  className={flashClass}
                  style={flashVars(
                    isNeg ? 'none' : '#eab308',
                    isNeg ? '#1e40af' : '#ca8a04'
                  )}
                />
              );
            })
          )}
        </g>
      );
    }

    case 'eraser': {
      // 3-prong Witness Y-cancellation symbol（抗体）：三个尖角长方形组成
      // （不用圆头线段），整体下移 2px 校正视觉中心
      const armW = size * 0.08;
      const armLen = size * 0.2;
      const angles = [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6];
      return (
        <g className={shakeClass} transform={`translate(0, ${size * 0.025})`}>
          {angles.map((a, i) => (
            <g key={i} transform={`rotate(${(a * 180) / Math.PI + 90} ${cx} ${cy})`}>
              <rect
                x={cx - armW / 2}
                y={cy - armLen}
                width={armW}
                height={armLen}
                fill={isInvalid ? '#ef4444' : eraserColor}
                className={flashClass}
                style={flashVars(eraserColor)}
              />
            </g>
          ))}
        </g>
      );
    }

    default:
      return null;
  }
};

export const HexagonDot: React.FC<{
  cx: number;
  cy: number;
  radius: number;
  color?: string;
  isInvalid?: boolean;
}> = ({ cx, cy, radius, color = '#0f172a', isInvalid = false }) => {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    points.push(`${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`);
  }

  return (
    <g className="pointer-events-none">
      <polygon
        points={points.join(' ')}
        fill={isInvalid ? '#ef4444' : color}
        stroke={isInvalid ? '#ef4444' : '#475569'}
        strokeWidth={1}
        className={isInvalid ? 'animate-flash-symbol' : ''}
        style={
          isInvalid
            ? ({
                '--flash-original-fill': color,
                '--flash-original-stroke': '#475569',
              } as React.CSSProperties)
            : undefined
        }
      />
    </g>
  );
};
