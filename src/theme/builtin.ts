/*
 * 内置主题：写在代码里的两套，等于可直接使用的 theme.json。
 *
 * 内置与用户主题共用 parse.ts 的同一个解析器 —— 内置主题也要过一遍校验，
 * 于是"缺省回退"只有一份实现，不存在两套规则。
 */
import { DEFAULT_FONT, parseTheme } from "./parse";
import type { BarLayout, Theme, ThemeWindow } from "./types";

/** 默认主题 id：找不到已保存的主题时用它，也是首次启动的外观。 */
export const DEFAULT_THEME_ID = "default";

/** 内置「耄耋猫」主题 id：photo-left 版式 + 固定 340x96 窗口。 */
export const MAODIE_THEME_ID = "maodie";

/** 内置 maodie 的窗口尺寸（与 FloatingBar 的 photo-left 版式配套，写死在这里）。 */
export const MAODIE_WINDOW: ThemeWindow = { width: 340, height: 96 };

interface BuiltinSource {
  id: string;
  json: unknown;
  /**
   * 版式与固定窗口尺寸**只在代码里给内置主题**，绝不进 theme.json 的解析路径：
   * parse.ts 不读这两个键，用户目录里的 theme.json 写它们也不会生效（见 types.ts 的注释）。
   */
  layout?: BarLayout;
  windowSize?: ThemeWindow | null;
}

/**
 * 三套内置主题的原文。
 * default = v0.1.0 的深色外观（颜色与旧样式表逐项相等，切主题之前之后看起来一模一样）；
 * minimal = 极简浅色，无吉祥物；
 * maodie = 「耄耋猫」，奶油底 + 橙色数字，photo-left 版式（左图右数字），窗口固定 340x96。
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
  {
    id: MAODIE_THEME_ID,
    layout: "photo-left",
    windowSize: MAODIE_WINDOW,
    json: {
      name: "耄耋猫",
      // 与 themes/maodie/theme.json 的配色逐项相同（用户先前预览选定的那一套）。
      colors: {
        bar: "rgba(247, 240, 227, 0.92)",
        border: "rgba(120, 72, 30, 0.18)",
        label: "rgba(138, 107, 79, 0.9)",
        int: "#c2601f",
        frac: "#d98a3f",
        unit: "rgba(176, 138, 99, 0.92)",
        dot: "#c2601f",
        phase: "rgba(122, 91, 63, 0.85)",
        hint: "rgba(160, 132, 100, 0.8)",
      },
      font: '"Segoe UI", system-ui, sans-serif',
      /*
       * 状态机开关：useMascot 只在 theme.mascot 非空时才推状态（idle / offwork /
       * overtime / milestone），photo-left 的左图跟着这个状态换图 —— 所以这里必须给出映射。
       * 内置主题没有目录（baseDir = null），mascotUrlOf 永远返回 null，因此这套文件名
       * 不会去拼任何 asset 地址；真正的文件由 photoLeft.ts 到用户目录里按同一套状态名找。
       */
      mascot: {
        idle: "kitty-idle.webp",
        offwork: "kitty-offwork.webp",
        overtime: "kitty-overtime.webp",
        milestone: "kitty-happy.webp",
      },
    },
  },
];

function build(source: BuiltinSource): Theme {
  const { theme } = parseTheme(source.json, { id: source.id, source: "builtin" });
  // 内置主题是代码里的常量：解析失败说明常量写坏了，应当被单测立刻抓住，不在运行时静默降级。
  if (!theme) throw new Error(`内置主题 ${source.id} 解析失败`);
  // 两个内置专属字段永远显式给出：其它主题读到时是 undefined，一律按经典版式处理。
  return {
    ...theme,
    layout: source.layout ?? "classic",
    windowSize: source.windowSize ?? null,
  };
}

export const BUILTIN_THEMES: readonly Theme[] = BUILTIN_THEME_SOURCES.map(build);

/** 按 id 取内置主题；没有就返回 undefined。 */
export function builtinTheme(id: string): Theme | undefined {
  return BUILTIN_THEMES.find((theme) => theme.id === id);
}

/** 兜底主题：任何"找不到"的路径都落到它上面。 */
export const FALLBACK_THEME: Theme = builtinTheme(DEFAULT_THEME_ID) ?? BUILTIN_THEMES[0];
