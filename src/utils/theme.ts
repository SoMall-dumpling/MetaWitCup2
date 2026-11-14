/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const THEME_KEY = 'witness_theme';

let current: Theme = 'dark';
try {
  if (typeof window !== 'undefined' && localStorage.getItem(THEME_KEY) === 'light') {
    current = 'light';
  }
} catch {
  /* ignore */
}

try {
  // 首帧渲染前就把主题挂到 <html data-theme>，避免亮色主题闪黑
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = current;
  }
} catch {
  /* ignore */
}

const listeners = new Set<() => void>();

export function getTheme(): Theme {
  return current;
}

export function setTheme(theme: Theme): void {
  if (current === theme) return;
  current = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
  try {
    const root = document.documentElement;
    // 切换主题瞬间禁用所有过渡动画（如设置界面按钮的 transition-colors），
    // 配色立刻生效、不残留渐变——否则大面积元素 150ms 渐变换色显得「慢半拍」。
    // 双重 rAF：第一帧带着禁用标记渲染新配色，第二帧恢复过渡（悬停效果不受影响）；
    // setTimeout 兜底（隐藏标签页等 rAF 不触发的场景）
    root.classList.add('wt-theme-switching');
    root.dataset.theme = theme;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => root.classList.remove('wt-theme-switching'));
    });
    window.setTimeout(() => root.classList.remove('wt-theme-switching'), 100);
  } catch {
    /* ignore */
  }
  listeners.forEach((f) => f());
}

/** 订阅主题变化：切换主题时触发所在组件重渲染 */
export function useTheme(): Theme {
  const [theme, setThemeState] = useState<Theme>(current);
  useEffect(() => {
    const f = () => setThemeState(current);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  return theme;
}

export interface BoardPalette {
  bg: string; // 题板底板
  bd: string; // 底板描边
  grid: string; // 网格线 / 起点圆 / 终点圆弧
  line: string; // 玩家划线 / 线头
}

/** 题板配色（玩家优化版亮色主题方案）。
 *  亮色划线用 slate-600 而非近黑：抵达终点圆弧的闪烁动画在「线色 ↔ 黄」间交替，
 *  基色浅一些时跳变更柔和 */
export function getBoardPalette(theme: Theme): BoardPalette {
  return theme === 'light'
    ? { bg: '#f1f5f9', bd: '#cbd5e1', grid: '#cbd5e1', line: '#475569' }
    : { bg: '#1e293b', bd: '#334155', grid: '#0f172a', line: '#ffffff' };
}
