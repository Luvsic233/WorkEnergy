/*
 * 内置主题：写在代码里的两套，等于可直接使用的 theme.json。
 *
 * 内置与用户主题共用 parse.ts 的同一个解析器 —— 内置主题也要过一遍校验，
 * 于是"缺省回退"只有一份实现，不存在两套规则。
 */
import { DEFAULT_FONT, parseTheme } from "./parse";
import type { Theme } from "./types";

/** 默认主题 id：找不到已保存的主题时用它，也是首次启动的外观。 */
export const DEFAULT_THEME_ID = "default";

interface BuiltinSource {
  id: string;
  json: unknown;
}

/**
 * 两套内置主题的原文。
 * default = v0.1.0 的深色外观（颜色与旧样式表逐项相等，切主题之前之后看起来一模一样）；
 * minimal = 极简浅色，无吉祥物。
 */
export const BUILTIN_THEME_SOURCES: readonly BuiltinSource[] = [
  {
    id: DEFAULT_THEME_ID,
    json: {
      name: "深色（默认）",
      colors: {
        bar: "rgba(14, 16, 22, 0.62)",
        border: "rgba(255, 255, 255, 0.1)",
        label: "rgba(226, 232, 240, 0.55)",
        int: "#f2f4f8",
        frac: "rgba(160, 220, 255, 0.92)",
        unit: "rgba(226, 232, 240, 0.5)",
        dot: "#f2f4f8",
        phase: "rgba(226, 232, 240, 0.45)",
        hint: "rgba(226, 232, 240, 0.45)",
      },
      font: DEFAULT_FONT,
    },
  },
  {
    id: "minimal",
    json: {
      name: "极简",
      colors: {
        bar: "#f7f7f8",
        border: "rgba(15, 23, 42, 0.08)",
        label: "#8b8f98",
        int: "#111827",
        frac: "#6b7280",
        unit: "#9ca3af",
        dot: "#111827",
        phase: "#9aa0a6",
        hint: "#b0b4ba",
      },
      font: DEFAULT_FONT,
    },
  },
];

function build(source: BuiltinSource): Theme {
  const { theme } = parseTheme(source.json, { id: source.id, source: "builtin" });
  // 内置主题是代码里的常量：解析失败说明常量写坏了，应当被单测立刻抓住，不在运行时静默降级。
  if (!theme) throw new Error(`内置主题 ${source.id} 解析失败`);
  return theme;
}

export const BUILTIN_THEMES: readonly Theme[] = BUILTIN_THEME_SOURCES.map(build);

/** 按 id 取内置主题；没有就返回 undefined。 */
export function builtinTheme(id: string): Theme | undefined {
  return BUILTIN_THEMES.find((theme) => theme.id === id);
}

/** 兜底主题：任何"找不到"的路径都落到它上面。 */
export const FALLBACK_THEME: Theme = builtinTheme(DEFAULT_THEME_ID) ?? BUILTIN_THEMES[0];
