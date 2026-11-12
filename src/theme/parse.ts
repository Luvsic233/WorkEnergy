/*
 * theme.json 的解析与校验：唯一一份规则，内置主题与用户主题都走这里。
 *
 * 纪律：坏数据不许炸应用。任何一项颜色 / 字体 / 素材坏了都只回退那一项（issues 里留一条说明），
 * 只有"根本不是 JSON 对象"和"缺少 name"才算整条主题非法 —— 调用方忽略它并留一行日志。
 */
import {
  MASCOT_STATES,
  type MascotState,
  type Theme,
  type ThemeColorKey,
  type ThemeColors,
  type ThemeMascot,
  type ThemeSource,
} from "./types";

/** 字体族缺省值：与 v0.1.0 的 body 字体一致。 */
export const DEFAULT_FONT = 'ui-sans-serif, "Segoe UI", system-ui, sans-serif';

/** 九项颜色的缺省值：整体等于 v0.1.0 的深色外观，任何缺项都回落到这里。 */
export const DEFAULT_COLORS: ThemeColors = {
  bar: "rgba(14, 16, 22, 0.62)",
  border: "rgba(255, 255, 255, 0.1)",
  label: "rgba(226, 232, 240, 0.55)",
  int: "#f2f4f8",
  frac: "rgba(160, 220, 255, 0.92)",
  unit: "rgba(226, 232, 240, 0.5)",
  dot: "#f2f4f8",
  phase: "rgba(226, 232, 240, 0.45)",
  hint: "rgba(226, 232, 240, 0.45)",
};

/** 颜色键的遍历顺序（写 CSS 变量的顺序，也是单测断言的顺序）。 */
export const COLOR_KEYS: readonly ThemeColorKey[] = [
  "bar",
  "border",
  "label",
  "int",
  "frac",
  "unit",
  "dot",
  "phase",
  "hint",
];

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_COLOR = /^(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(\s*[0-9a-z.%+\-/\s,]*\)$/i;
const KEYWORD_COLOR = /^[a-z]{3,20}$/i;
/** 主题目录内的图片文件名：只允许单段文件名 + 图片扩展名，绝不带路径分隔符或 ".."。 */
const IMAGE_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9]+)+$/;
const IMAGE_EXTENSION = /\.(?:webp|png|jpe?g|gif|avif|bmp)$/i;
/** 字体值里不许出现 CSS 分隔符或外链函数：它会被直接写进 CSS 变量。 */
const UNSAFE_FONT = /[;{}]|url\(|expression|@import/i;

/** 颜色值白名单校验：hex / rgb()/hsl() 一类函数 / CSS 关键字（含 transparent、currentColor）。 */
export function isSafeColor(value: string): boolean {
  const text = value.trim();
  if (text === "" || text.length > 60) return false;
  return HEX_COLOR.test(text) || FUNC_COLOR.test(text) || KEYWORD_COLOR.test(text);
}

/** 素材文件名白名单校验：单段文件名 + 图片扩展名。 */
export function isSafeImageFile(value: string): boolean {
  const text = value.trim();
  if (text.length === 0 || text.length > 120) return false;
  return IMAGE_FILE.test(text) && IMAGE_EXTENSION.test(text);
}

export function isMascotState(key: string): key is MascotState {
  return (MASCOT_STATES as readonly string[]).includes(key);
}

/** 解析上下文：id / 来源 / 目录信息由调用方给（theme.json 自己不许声明这些）。 */
export interface ThemeMeta {
  id: string;
  source: ThemeSource;
  dirName?: string | null;
  baseDir?: string | null;
}

export interface ParsedTheme {
  /** null 表示这条主题非法，调用方忽略它。 */
  theme: Theme | null;
  /** 每一处回退 / 忽略的原因，调用方合成一行日志。 */
  issues: string[];
}

function parseColors(raw: unknown, issues: string[]): ThemeColors {
  const colors: ThemeColors = { ...DEFAULT_COLORS };
  if (raw === undefined) return colors;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    issues.push("colors 不是对象，整组颜色回退默认");
    return colors;
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(COLOR_KEYS as readonly string[]).includes(key)) issues.push(`忽略未知颜色 ${key}`);
  }
  for (const key of COLOR_KEYS) {
    const value = record[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !isSafeColor(value)) {
      issues.push(`颜色 ${key} 非法，回退默认`);
      continue;
    }
    colors[key] = value.trim();
  }
  return colors;
}

function parseFont(raw: unknown, issues: string[]): string {
  if (raw === undefined) return DEFAULT_FONT;
  if (typeof raw !== "string" || raw.trim() === "" || raw.length > 200 || UNSAFE_FONT.test(raw)) {
    issues.push("font 非法，回退默认字体");
    return DEFAULT_FONT;
  }
  return raw.trim();
}

function parseMascot(raw: unknown, issues: string[]): ThemeMascot | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    issues.push("mascot 不是对象，忽略吉祥物");
    return null;
  }
  const record = raw as Record<string, unknown>;
  const mascot: ThemeMascot = {};
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (!isMascotState(key)) {
      issues.push(`忽略未知吉祥物状态 ${key}`);
      continue;
    }
    if (typeof value !== "string" || !isSafeImageFile(value)) {
      issues.push(`吉祥物 ${key} 的文件名非法，忽略`);
      continue;
    }
    mascot[key] = value.trim();
  }
  return MASCOT_STATES.some((state) => mascot[state] !== undefined) ? mascot : null;
}

/**
 * 把一份 theme.json（对象）解析成 Theme。
 * name 是唯一必填项：缺它 / 不是字符串 / 空串 → 整条主题非法（返回 theme: null）。
 */
export function parseTheme(raw: unknown, meta: ThemeMeta): ParsedTheme {
  const issues: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { theme: null, issues: ["theme.json 不是 JSON 对象"] };
  }
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (name === "") return { theme: null, issues: ["缺少 name（显示名）"] };

  return {
    theme: {
      id: meta.id,
      name: name.slice(0, 40),
      source: meta.source,
      dirName: meta.dirName ?? null,
      baseDir: meta.baseDir ?? null,
      colors: parseColors(record.colors, issues),
      font: parseFont(record.font, issues),
      mascot: parseMascot(record.mascot, issues),
    },
    issues,
  };
}
