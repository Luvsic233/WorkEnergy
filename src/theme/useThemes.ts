/*
 * 主题清单 + 当前主题（React 侧唯一的入口）。
 *
 * 一、启动顺序：先把已保存的主题落到 CSS 变量（App.tsx 模块求值阶段调用 applyStoredTheme），
 *     React 挂载后再扫用户主题目录；扫完如果保存的是用户主题，就补上。
 * 二、切换：写入 localStorage → 立刻改 CSS 变量（不用重启）→ 广播 theme-changed，
 *     另一个窗口（悬浮条 / 设置窗口是两个独立 webview）收到后重新读 localStorage 并重绘。
 * 三、浏览器预览没有磁盘能力：只拿内置主题，选主题照旧生效（配色 / 字体都能看到效果）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { emit, listen } from "../settings/bridge";
import { BUILTIN_THEMES, DEFAULT_THEME_ID, FALLBACK_THEME } from "./builtin";
import { applyThemeToDocument } from "./css";
import { appDataDirOf, createThemeIo, logTheme, openThemeFolder as openThemeFolderInShell } from "./io";
import { loadThemeCatalog } from "./load";
import { themesRoot } from "./paths";
import { seedThemesIfEmpty } from "./seed";
import { readStoredThemeId, saveThemeId } from "./storage";
import type { Theme } from "./types";

/** 跨窗口广播的事件名（设置窗口切主题 → 悬浮条立刻换皮）。 */
export const THEME_EVENT = "theme-changed";

export interface ThemesApi {
  themes: Theme[];
  currentId: string;
  current: Theme;
  selectTheme(id: string): void;
  openThemeFolder(): void;
}

export function useThemes(): ThemesApi {
  const [themes, setThemes] = useState<Theme[]>(() => [...BUILTIN_THEMES]);
  const [currentId, setCurrentId] = useState<string>(() => readStoredThemeId() ?? DEFAULT_THEME_ID);
  const themesRef = useRef<Theme[]>(themes);
  const rootRef = useRef<string | null>(null);

  /** 把某个 id 落到 DOM；id 不存在（用户删了目录 / 存了坏值）就回落默认主题，并返回真正生效的 id。 */
  const apply = useCallback((id: string, list: Theme[]): string => {
    const theme = list.find((candidate) => candidate.id === id) ?? FALLBACK_THEME;
    applyThemeToDocument(theme);
    return theme.id;
  }, []);

  // 挂载：扫描用户主题目录（可注入的 IO），并补上空壳与已保存的选择。
  useEffect(() => {
    let alive = true;
    void (async () => {
      const appData = await appDataDirOf();
      const root = appData === null ? null : themesRoot(appData);
      rootRef.current = root;
      if (root === null) {
        logTheme("没有磁盘能力（浏览器预览），只加载内置主题", "no-root");
        return;
      }
      const io = createThemeIo();
      const seed = await seedThemesIfEmpty(io, root);
      for (const line of seed.logs) logTheme(line);
      if (seed.seeded) logTheme(`已写入空壳主题 maodie/${root}`, "seeded");
      const catalog = await loadThemeCatalog(io, root);
      for (const line of catalog.logs) logTheme(line);
      if (!alive) return;
      themesRef.current = catalog.themes;
      setThemes(catalog.themes);
      setCurrentId(apply(readStoredThemeId() ?? DEFAULT_THEME_ID, catalog.themes));
    })();
    return () => {
      alive = false;
    };
  }, [apply]);

  // 另一个窗口切了主题：重新读存下来的 id 再画一遍。
  useEffect(() => {
    let stop: (() => void) | null = null;
    void listen(THEME_EVENT, () => {
      setCurrentId(apply(readStoredThemeId() ?? DEFAULT_THEME_ID, themesRef.current));
    }).then((off) => {
      stop = off;
    });
    return () => {
      stop?.();
    };
  }, [apply]);

  const selectTheme = useCallback(
    (id: string) => {
      saveThemeId(id);
      setCurrentId(apply(id, themesRef.current));
      void emit(THEME_EVENT);
    },
    [apply],
  );

  const openFolder = useCallback(() => {
    void openThemeFolderInShell(rootRef.current);
  }, []);

  const current = themes.find((candidate) => candidate.id === currentId) ?? FALLBACK_THEME;

  return { themes, currentId: current.id, current, selectTheme, openThemeFolder: openFolder };
}
