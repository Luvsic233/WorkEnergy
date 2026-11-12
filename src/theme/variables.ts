/* 主题变量名映射：颜色键 → CSS 变量名，以及"一套主题要写的全部变量"。 */
import { COLOR_KEYS } from "./parse";
import type { Theme, ThemeColorKey } from "./types";

/** 颜色键 → CSS 变量名。改这里的名字就必须同步 styles.css 的用法。 */
export const COLOR_VARIABLES: Readonly<Record<ThemeColorKey, string>> = {
  bar: "--theme-bar-bg",
  border: "--theme-bar-border",
  label: "--theme-label",
  int: "--theme-int",
  frac: "--theme-frac",
  unit: "--theme-unit",
  dot: "--theme-dot",
  phase: "--theme-phase",
  hint: "--theme-hint",
};

/** 字体族变量。 */
export const FONT_VARIABLE = "--theme-font";

/** 一套主题要写进 DOM 的全部变量（纯函数，单测直接比对这张表）。 */
export function themeCssVariables(theme: Theme): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const key of COLOR_KEYS) variables[COLOR_VARIABLES[key]] = theme.colors[key];
  variables[FONT_VARIABLE] = theme.font;
  return variables;
}
