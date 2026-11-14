/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

export type Lang = 'zh' | 'en';

const LANG_KEY = 'witness_lang';

let current: Lang = 'zh';
try {
  if (typeof window !== 'undefined' && localStorage.getItem(LANG_KEY) === 'en') {
    current = 'en';
  }
} catch {
  /* ignore */
}

const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (current === lang) return;
  current = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* ignore */
  }
  listeners.forEach((f) => f());
}

/** 订阅语言变化：语言切换时触发所在组件重渲染 */
export function useLang(): Lang {
  const [lang, setLangState] = useState<Lang>(current);
  useEffect(() => {
    const f = () => setLangState(current);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  return lang;
}

const STRINGS = {
  max: { zh: '最大', en: 'Max' },
  bonusPrefix: { zh: '奖励+', en: 'Bonus +' },
  threshold: { zh: '计分下限', en: 'Threshold' },
  target: { zh: '计分上限', en: 'Target' },
  total: { zh: '总分：', en: 'Total: ' },
  sound: { zh: '音效', en: 'Sound Effects' },
  theme: { zh: '主题', en: 'Theme' },
  themeDark: { zh: '暗色', en: 'Dark' },
  themeLight: { zh: '亮色', en: 'Light' },
  exportSave: { zh: '下载存档', en: 'Download Save' },
  credits: { zh: '制作人员', en: 'Credits' },
  creditsPlanning: { zh: '策划', en: 'Director' },
  creditsDev: { zh: '开发', en: 'Development' },
  creditsPuzzle: { zh: '谜题设计', en: 'Puzzle Design' },
  creditsVisual: { zh: '视觉设计', en: 'Visual Design' },
  creditsTesters: { zh: '测试者（按名字排序）', en: 'Testers (sorted by name)' },
  creditsThanks: { zh: '特别感谢', en: 'Special Thanks' },
} as const;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey): string {
  return STRINGS[key][current];
}
