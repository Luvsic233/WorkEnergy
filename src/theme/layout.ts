/*
 * 版式 / 固定窗口尺寸的取值口（纯函数）。
 *
 * 主题对象上的 layout / windowSize 只有内置主题会填；用户主题解析出来没有这两个键，
 * 于是这里的两行 ?? 就是"用户主题永远是扁横条 + 跟随尺寸预设"的唯一实现点。
 */
import type { BarLayout, Theme, ThemeWindow } from "./types";

/** 当前主题的版式；没有主题（首帧 / 扫描中）按经典扁横条。 */
export function layoutOf(theme: Theme | null): BarLayout {
  return theme?.layout ?? "classic";
}

/** 当前主题的固定窗口尺寸；null = 跟随设置里的三档预设。 */
export function windowSizeOf(theme: Theme | null): ThemeWindow | null {
  return theme?.windowSize ?? null;
}
