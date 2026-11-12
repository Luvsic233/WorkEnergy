/*
 * 固定尺寸主题（内置 maodie = 340x96）的窗口尺寸下发。
 *
 * 默认 / 极简主题一个字都没改：仍然走 settings/bridge.ts 的 applySizePreset /
 * applyStartupSizePreset（CSS 缩放 + 窗口尺寸 + 首帧藏显），行为与原版逐项相同。
 * 只有带 windowSize 的内置主题才用这里的另一个分支：缩放系数固定 1、窗口按主题给定的尺寸。
 *
 * 关于下面这段 setWindowSize 的重复：bridge.ts 里的同名函数是模块私有的（未导出），
 * 而 src/settings/bridge.ts 不在本次改动边界内，所以这里按同一份实现重写了一遍
 * （两条路径：先 window.setSize，再退回原始命令 plugin:window|set_size）。任何失败都静默。
 */
import { sizePresetSpec, type SizePreset } from "../core/settings";
import { applySizePreset, applyStartupSizePreset } from "../settings/bridge";
import { windowSizeOf } from "./layout";
import type { Theme } from "./types";

/** 固定尺寸主题的内容缩放系数：版式按像素写死，不跟随三档预设。 */
export const FIXED_THEME_SCALE = 1;

/** 启动兜底：窗口尺寸 IPC 最长等这么久就照常显示（与 bridge.ts 的同一常数一致）。 */
const STARTUP_REVEAL_MS = 150;

/** 一份窗口规格：逻辑尺寸 + 内容缩放系数（纯函数算出来的唯一事实）。 */
export interface WindowSpec {
  width: number;
  height: number;
  scale: number;
}

/**
 * 主题 + 用户预设 → 实际窗口规格。
 * 有固定尺寸的主题（内置 maodie）优先；否则就是用户选的三档预设。
 */
export function windowSpecOf(theme: Theme | null, preset: SizePreset): WindowSpec {
  const fixed = windowSizeOf(theme);
  if (fixed) return { width: fixed.width, height: fixed.height, scale: FIXED_THEME_SCALE };
  const spec = sizePresetSpec(preset);
  return { width: spec.width, height: spec.height, scale: spec.scale };
}

/** 运行期切主题 / 切档：固定尺寸主题只改窗口，其余主题原样走旧路径。 */
export function applyThemeWindowSize(theme: Theme | null, preset: SizePreset): void {
  const fixed = windowSizeOf(theme);
  if (!fixed) {
    applySizePreset(preset);
    return;
  }
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--bar-scale", String(FIXED_THEME_SCALE));
  void setWindowSize(fixed.width, fixed.height);
}

/** 启动时（React 挂载之前）：与 applyThemeWindowSize 同样的分工，带着"先藏后显"。 */
export function applyStartupThemeWindowSize(theme: Theme | null, preset: SizePreset): void {
  const fixed = windowSizeOf(theme);
  if (!fixed) {
    applyStartupSizePreset(preset);
    return;
  }
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.visibility = "hidden";
  root.style.setProperty("--bar-scale", String(FIXED_THEME_SCALE));

  const reveal = () => {
    root.style.visibility = "";
  };
  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, STARTUP_REVEAL_MS);
  });
  void Promise.race([setWindowSize(fixed.width, fixed.height), timeout]).then(reveal, reveal);
}

/* ---- 原生侧：与 bridge.ts 的 setWindowSize 同一份实现（见文件头注释） ---- */

type InvokeFn = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

interface LogicalSizeCtor {
  new (width: number, height: number): unknown;
}

interface AppWindow {
  label?: string;
  setSize?: (size: unknown) => Promise<unknown>;
}

interface WindowApi {
  getCurrentWindow?: () => AppWindow;
  LogicalSize?: LogicalSizeCtor;
  appWindow?: AppWindow;
}

interface TauriGlobal {
  core?: { invoke?: InvokeFn };
  dpi?: { LogicalSize?: LogicalSizeCtor };
  window?: WindowApi;
}

function runtime(): TauriGlobal | undefined {
  return (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
}

async function setWindowSize(width: number, height: number): Promise<void> {
  const api = runtime()?.window;
  if (!api) return;
  const current = api.getCurrentWindow?.() ?? api.appWindow;
  const LogicalSize = api.LogicalSize ?? runtime()?.dpi?.LogicalSize;

  if (current?.setSize && LogicalSize) {
    try {
      await current.setSize(new LogicalSize(width, height));
      return;
    } catch {
      // 落到下面的原始命令兜底。
    }
  }

  const invokeFn = runtime()?.core?.invoke;
  if (!invokeFn || !current?.label) return;
  try {
    await invokeFn("plugin:window|set_size", {
      label: current.label,
      value: { Logical: { width, height } },
    });
  } catch {
    // 权限未开 / 纯网页预览：不打扰用户。
  }
}
