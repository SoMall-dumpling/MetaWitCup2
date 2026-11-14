/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { ChevronLeft, Download } from 'lucide-react';
import { getSaveLog, computeSaveChecksum } from '../utils/storage';
import { t, useLang, setLang, Lang, StringKey } from '../utils/i18n';
import { useTheme, setTheme, Theme } from '../utils/theme';

// 制作人员栏目：六个副标题，人名显示在副标题下方；namesEn 为该栏目在英文下的名字
// （未提供时沿用中文名单）。测试者按首字母排序（英文在前，中文按拼音）
const CREDIT_SECTIONS: Array<{ key: StringKey; names: string[]; namesEn?: string[] }> = [
  { key: 'creditsPlanning', names: ['小汤圆'], namesEn: ['SoMall-dumpling'] },
  { key: 'creditsDev', names: ['Deepseek'] },
  { key: 'creditsPuzzle', names: ['小汤圆'], namesEn: ['SoMall-dumpling'] },
  { key: 'creditsVisual', names: ['小汤圆'], namesEn: ['SoMall-dumpling'] },
  {
    key: 'creditsTesters',
    names: [
      'alith',
      'Alxv',
      'flâneur',
      'glass',
      'Lazy_Labs',
      'Lion Almighty',
      'Pioooooo',
      'Porridge',
      'seleclipse',
      'Smalive',
      '玻璃瓶里的猫',
      '小大圣',
      '御龙之影',
      '怎苏昂',
    ],
  },
  {
    key: 'creditsThanks',
    names: ['NOVA丶大头力 提供赞助', 'xxuurruuii 提供体验优化'],
    namesEn: ["NOVA丶大头力's sponsorship", "xxuurruuii's QoL optimization"],
  },
];

interface SettingsOverlayProps {
  soundEnabled: boolean;
  onToggleSound: () => void;
  onClose: () => void;
}

// 设置界面：覆盖在选关地图之上。左上角返回按钮（与设置按钮同款同尺寸）；
// 三个等高框（语言、音效、下载存档），其下为无边框的制作人员栏（标题 + 六个副标题）。
// 打开期间按下 Esc 只关闭本界面（地图层保持打开）
export const SettingsOverlay: React.FC<SettingsOverlayProps> = ({
  soundEnabled,
  onToggleSound,
  onClose,
}) => {
  const lang = useLang(); // 语言切换时重渲染本界面文案
  const theme = useTheme(); // 主题切换时重渲染切换按钮选中态
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleDownload = () => {
    const data = getSaveLog();
    // 存档末尾附加校验位（对日志内容做 FNV-1a 哈希）
    const content = `${data}${data ? '\n' : ''}校验位: ${computeSaveChecksum(data)}`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'savegame.save';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center overflow-y-auto bg-slate-950 select-none">
      {/* 返回按钮（左上角：与地图上的设置按钮同款同尺寸，仅符号；fixed 使滚动时保持可见） */}
      <button
        onClick={onClose}
        aria-label="返回"
        className="fixed left-4 top-3 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-600 bg-slate-800/90 text-slate-200 shadow-lg backdrop-blur-sm transition-colors hover:border-amber-400 hover:text-amber-300 md:h-24 md:w-24"
      >
        <ChevronLeft className="h-8 w-8 md:h-14 md:w-14" strokeWidth={2.5} />
      </button>

      <div className="mt-24 flex w-full max-w-md flex-col gap-3 px-6">
        {/* 中英切换 */}
        <div className="flex h-20 items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/90 px-6 shadow-lg">
          <span className="text-xl font-semibold text-slate-100">语言 / Language</span>
          <div className="flex gap-1 rounded-lg bg-slate-800 p-1">
            {(['zh', 'en'] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`rounded-md px-3 py-1 text-sm font-semibold transition-colors ${
                  lang === l
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {l === 'zh' ? '中文' : 'English'}
              </button>
            ))}
          </div>
        </div>

        {/* 暗色/亮色主题切换（玩家优化版方案：暗色为默认） */}
        <div className="flex h-20 items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/90 px-6 shadow-lg">
          <span className="text-xl font-semibold text-slate-100">{t('theme')}</span>
          <div className="flex gap-1 rounded-lg bg-slate-800 p-1">
            {(['dark', 'light'] as Theme[]).map((th) => (
              <button
                key={th}
                onClick={() => setTheme(th)}
                className={`rounded-md px-3 py-1 text-sm font-semibold transition-colors ${
                  theme === th
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t(th === 'dark' ? 'themeDark' : 'themeLight')}
              </button>
            ))}
          </div>
        </div>

        {/* 音效：勾/叉切换 */}
        <button
          onClick={onToggleSound}
          className="flex h-20 items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/90 px-6 text-left text-xl font-semibold text-slate-100 shadow-lg transition-colors hover:border-amber-400"
        >
          <span>{t('sound')}</span>
          <span
            className={`text-3xl font-black ${soundEnabled ? 'text-green-400' : 'text-red-400'}`}
          >
            {soundEnabled ? '✓' : '✗'}
          </span>
        </button>

        {/* 下载存档 */}
        <button
          onClick={handleDownload}
          className="flex h-20 items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/90 px-6 text-left text-xl font-semibold text-slate-100 shadow-lg transition-colors hover:border-amber-400"
        >
          <span>{t('exportSave')}</span>
          <Download className="h-6 w-6 text-slate-400" />
        </button>

        {/* 制作人员：不设边框，直接铺在背景上（下载存档下方）：标题 + 六个副标题 */}
        <div className="mt-10 flex flex-col items-center gap-5 pb-10">
          <div className="text-3xl font-black text-slate-100">{t('credits')}</div>
          {CREDIT_SECTIONS.map((s) => {
            const names = lang === 'en' && s.namesEn ? s.namesEn : s.names;
            return (
              <div key={s.key} className="flex flex-col items-center gap-1">
                <div className="text-lg font-bold text-slate-300">{t(s.key)}</div>
                {names.length > 0 && (
                  <div className="flex flex-col items-center gap-0.5 text-base text-slate-400">
                    {names.map((n) => (
                      <div key={n}>{n}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
