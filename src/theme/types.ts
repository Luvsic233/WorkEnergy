/*
 * 主题系统的类型契约。
 *
 * 一套主题的全部可换项都在这里：颜色（映射到 styles.css 的 --theme-* 变量）、字体族、
 * 可选的吉祥物素材。吉祥物素材只允许是"主题目录内的图片文件名"，绝不接受绝对路径或
 * 目录穿越，前端拼 asset:// 地址时只信任这一份校验结果。
 */

/** 主题颜色键：每一个都对应 styles.css 里的一个 --theme-* CSS 变量（见 css.ts 的映射表）。 */
export type ThemeColorKey =
  | "bar"
  | "border"
  | "label"
  | "int"
  | "frac"
  | "unit"
  | "dot"
  | "phase"
  | "hint";

/** 一整套颜色：九项都必有值（缺失 / 非法的那一项在解析时回落到默认值，不会留空）。 */
export type ThemeColors = Record<ThemeColorKey, string>;

/** 吉祥物状态：在岗 / 已下班（冻结）/ 加班 / 金额跨过整数元时的短暂庆祝。 */
export type MascotState = "idle" | "offwork" | "overtime" | "milestone";

/** 四个状态的白名单：theme.json 里出现别的键一律忽略（只留一行日志）。 */
export const MASCOT_STATES: readonly MascotState[] = ["idle", "offwork", "overtime", "milestone"];

/** theme.json 的 mascot 字段：状态 → 主题目录内的图片文件名。四项都可选。 */
export type ThemeMascot = Partial<Record<MascotState, string>>;

/** 主题来源：内置（写在前端代码里）/ 用户目录（%APPDATA%\com.workenergy.shell\themes）。 */
export type ThemeSource = "builtin" | "user";

/**
 * 悬浮条版式：classic = 现在的扁横条（默认 / 极简 / 全部用户主题），
 * photo-left = 左侧一张按条高缩放的图片 + 右侧标签/金额/阶段（只有内置 maodie 用）。
 */
export type BarLayout = "classic" | "photo-left";

/** 主题固定的窗口逻辑尺寸（只有内置主题会带）。 */
export interface ThemeWindow {
  width: number;
  height: number;
}

export interface Theme {
  /** 稳定 id：内置是 default / minimal，用户主题是 user:<目录名>。 */
  id: string;
  /** 显示名（theme.json 的 name，也是重名去重的依据）。 */
  name: string;
  source: ThemeSource;
  /** 用户主题的目录名；内置主题没有目录，为 null。 */
  dirName: string | null;
  /**
   * 主题目录的绝对路径：只有用户主题有它，也只有它能拼出 asset:// 图片地址。
   * 内置主题不带任何素材（仓库里不分发第三方图片）。
   */
  baseDir: string | null;
  colors: ThemeColors;
  font: string;
  /** 没有任何一项可用素材时是 null：此时吉祥物区域整块不渲染。 */
  mascot: ThemeMascot | null;
  /*
   * 下面两个字段**只有内置主题**会填（见 builtin.ts）：它们不是 theme.json 的一部分，
   * parse.ts 从不读 theme.json 里的这两个键，用户主题因此永远落在 undefined →
   * 版式 classic、窗口尺寸跟随用户选的三档预设。
   */
  layout?: BarLayout;
  /** 固定窗口尺寸：有值时窗口按它走，设置面板里的三档预设置灰。 */
  windowSize?: ThemeWindow | null;
}
