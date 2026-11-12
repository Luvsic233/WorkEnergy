/*
 * 主题 → CSS 变量。
 *
 * styles.css 只消费 --theme-* 变量，颜色值一律由这里写进 documentElement.style。
 * 单测不碰 DOM：applyTheme 的写入目标是一个 StyleTarget 接口，测试传假对象即可断言
 * "切换后每个变量拿到了什么值"。
 */
import { BUILTIN_THEMES, FALLBACK_THEME } from "./builtin";
import { readStoredThemeId } from "./storage";
import type { Theme } from "./types";
import { COLOR_VARIABLES, FONT_VARIABLE, themeCssVariables } from "./variables";

export { COLOR_VARIABLES, FONT_VARIABLE, themeCssVariables };

/** 全部主题变量的名字（切主题时逐个覆盖，顺序固定，便于断言）。 */
export const THEME_VARIABLES: readonly string[] = [...Object.values(COLOR_VARIABLES), FONT_VARIABLE];

/** 变量写入目标：documentElement.style 的最小接口（单测传假对象）。 */
export interface StyleTarget {
  setProperty(name: string, value: string): void;
  removeProperty(name: string): void;
}

/** 把一套主题写进目标样式表。 */
export function applyTheme(theme: Theme, style: StyleTarget): void {
  const variables = themeCssVariables(theme);
  for (const name of THEME_VARIABLES) {
    const value = variables[name];
    if (value === undefined) style.removeProperty(name);
    else style.setProperty(name, value);
  }
}

/** 写进真实 DOM（浏览器 / WebView）；非浏览器环境（单测、SSR）直接返回。 */
export function applyThemeToDocument(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  applyTheme(theme, root.style);
  root.dataset.theme = theme.id;
}

/**
 * 首帧兜底：React 挂载之前先把"已保存的主题"落到 CSS 变量上。
 * 此时用户主题还没扫（要等异步 IO），所以只认内置主题；保存的用户主题会在扫描完成后补上，
 * 这中间的一帧由 CSS 的 :root 兜底值（= default 主题）接住，不会闪一下别的配色。
 */
export function applyStoredTheme(): void {
  const stored = readStoredThemeId();
  const theme = BUILTIN_THEMES.find((candidate) => candidate.id === stored) ?? FALLBACK_THEME;
  applyThemeToDocument(theme);
}
