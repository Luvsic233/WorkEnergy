/*
 * photo-left 版式的图片解析（纯函数，单测直接覆盖）。
 *
 * 内置主题没有自己的目录，所以图片固定取自用户目录 %APPDATA%\com.workenergy.shell\themes\maodie\。
 * 状态 → 候选文件名 沿用吉祥物那套映射（idle / offwork / overtime / milestone），
 * 每个状态先找同名 .png、再找同名 .webp；都没有就退到 idle 的那两个，再没有就取目录里
 * 按文件名排序的第一张图片；目录里一张图都没有 → null（左图退化成纯色块，不报错、不白屏）。
 */
import type { MascotState } from "./types";
import { joinPath, themesRoot } from "./paths";

/** 图片目录名：与用户主题目录同名（用户自己放图的那个目录）。 */
export const PHOTO_THEME_DIR = "maodie";

/** 扩展名优先级：先 .png 再 .webp。 */
export const PHOTO_EXTENSIONS: readonly string[] = [".png", ".webp"];

/** 四个吉祥物状态对应的文件名主干（沿用 mascot 映射：milestone = kitty-happy）。 */
export const PHOTO_STATE_BASENAMES: Readonly<Record<MascotState, string>> = {
  idle: "kitty-idle",
  offwork: "kitty-offwork",
  overtime: "kitty-overtime",
  milestone: "kitty-happy",
};

/** 真的算图片的扩展名（列目录时用：README.md 这类文件不许被当成图）。 */
const IMAGE_EXTENSION = /^\.(?:png|webp|jpe?g|gif|avif|bmp)$/i;

/** 应用数据目录 → 图片目录。 */
export function photoDirOf(appDataDir: string): string {
  return joinPath(themesRoot(appDataDir), PHOTO_THEME_DIR);
}

/**
 * 某状态的候选文件名（按优先级）：本状态 .png → 本状态 .webp → idle .png → idle .webp。
 * 顺序是契约的一部分，单测逐项断言。
 */
export function photoCandidateFiles(state: MascotState): string[] {
  const basenames = [PHOTO_STATE_BASENAMES[state]];
  if (state !== "idle") basenames.push(PHOTO_STATE_BASENAMES.idle);
  const files: string[] = [];
  for (const basename of basenames) {
    for (const extension of PHOTO_EXTENSIONS) files.push(`${basename}${extension}`);
  }
  return files;
}

/** 文件名的扩展名是不是图片（大小写无关）；没有主干名的 ".png" 不算图片。 */
export function isPhotoFile(name: string): boolean {
  const text = name.trim();
  const dot = text.lastIndexOf(".");
  if (dot <= 0) return false;
  return IMAGE_EXTENSION.test(text.slice(dot));
}

/** 文件名升序：code unit 比较，与区域设置无关，跨机器结果一致。 */
function byFileName(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * 从目录列表里挑出要显示的那张图。
 * 大小写不敏感匹配（Windows 上 Kitty-Idle.PNG 也算数），命中就返回目录里的真实文件名；
 * 一个候选都没有时退到"按文件名排序的第一张图片"；目录里没有图片 → null。
 */
export function pickPhotoFile(files: readonly string[], state: MascotState): string | null {
  const byLowerName = new Map<string, string>();
  for (const name of files) {
    const trimmed = name.trim();
    if (trimmed === "" || !isPhotoFile(trimmed)) continue;
    const key = trimmed.toLowerCase();
    if (!byLowerName.has(key)) byLowerName.set(key, trimmed);
  }

  for (const candidate of photoCandidateFiles(state)) {
    const hit = byLowerName.get(candidate.toLowerCase());
    if (hit !== undefined) return hit;
  }

  const sorted = [...new Set(byLowerName.values())].sort(byFileName);
  return sorted.length > 0 ? sorted[0] : null;
}

/**
 * 内置图的选择：有本状态的图就用本状态，否则退到 idle，都没有就是 null。
 * available 是"构建时真的打进包里"的状态集合（由 import.meta.glob 得出）。
 */
export function pickBundledState(
  state: MascotState,
  available: readonly MascotState[],
): MascotState | null {
  if (available.includes(state)) return state;
  if (available.includes("idle")) return "idle";
  return null;
}
