/*
 * 吉祥物的状态判定（纯函数，单测直接覆盖）。
 *
 * 金额纪律：milestone 只看"整数元"的 BigInt 比较，浮点一律不参与 ——
 * 入参是 ticker 给的整数部分文本（已经向下截断的整数元），这里只做 BigInt 解析与比较。
 */
import type { Phase } from "../core/earning";
import { toAssetUrl } from "./io";
import { themeAssetPath } from "./paths";
import type { MascotState, Theme } from "./types";

/** milestone 显示的时长（毫秒）：约 1.5 秒后回到当前状态。 */
export const MILESTONE_VISIBLE_MS = 1500;

/** 整数元文本 → BigInt（"1,234" → 1234n）；不是纯整数就返回 null。 */
export function integerYuanOf(moneyInt: string): bigint | null {
  const digits = moneyInt.replace(/,/g, "").trim();
  if (!/^-?[0-9]+$/.test(digits)) return null;
  try {
    return BigInt(digits);
  } catch {
    return null;
  }
}

/**
 * 是否跨过了整数元：只看 BigInt 比较。
 * 一次跨多格（3 → 7）同样只算一次跨越 —— 这一帧触发一次 milestone，再显示约 1.5 秒。
 * previous 为 null 表示第一帧只建立基线，不触发（否则一打开应用就庆祝一次）。
 */
export function crossedYuan(previous: bigint | null, current: bigint): boolean {
  if (previous === null) return false;
  return current > previous;
}

/** 阶段 → 吉祥物状态：已下班冻结、加班加班脸，其余（在岗 / 午休 / 未上班 / 配置错误）都用 idle。 */
export function mascotStateOf(phase: Phase): MascotState {
  if (phase === "已下班") return "offwork";
  if (phase === "加班") return "overtime";
  return "idle";
}

/** 某状态对应的素材文件名：缺当前状态就退到 idle，再没有就当没有吉祥物。 */
export function mascotFileOf(theme: Theme | null, state: MascotState): string | null {
  const mascot = theme?.mascot ?? null;
  if (!mascot) return null;
  return mascot[state] ?? mascot.idle ?? null;
}

/**
 * 某状态要用哪张图（asset:// 地址）。
 * 内置主题没有目录、浏览器里没有 asset 协议、状态没有素材 —— 三种情况都返回 null，
 * 调用方据此整块不渲染吉祥物（这是"缺文件时优雅不显示"的唯一实现点）。
 */
export function mascotUrlOf(theme: Theme | null, state: MascotState): string | null {
  const file = mascotFileOf(theme, state);
  if (!theme || !file || !theme.baseDir) return null;
  return toAssetUrl(themeAssetPath(theme.baseDir, file));
}
