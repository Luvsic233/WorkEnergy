/*
 * 打进包里的内置猫图（构建时由 Vite 的 import.meta.glob 静态收集）。
 *
 * 为什么要有这一层：图片放在用户目录（%APPDATA%）时，别人下载安装后目录是空的、
 * 主题只会显示一个纯色块。把图放进 src/assets/maodie/ 后，它们会被打进 exe / 前端产物，
 * 于是"下载即用"；用户目录里的同名图仍然优先（用户想换随时可以覆盖）。
 *
 * 命名规则与用户目录完全一致：kitty-idle / kitty-offwork / kitty-overtime / kitty-happy，
 * 扩展名 .png 或 .webp。
 */
import { PHOTO_STATE_BASENAMES, pickBundledState } from "./photoLeft";
import type { MascotState } from "./types";

const modules = import.meta.glob("../assets/maodie/*.{png,webp}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const stateByBasename = new Map<string, MascotState>(
  (Object.entries(PHOTO_STATE_BASENAMES) as [MascotState, string][]).map(([state, basename]) => [
    basename,
    state,
  ]),
);

const urlByState = new Map<MascotState, string>();
for (const [path, url] of Object.entries(modules)) {
  const fileName = path.split("/").pop() ?? "";
  const basename = fileName.replace(/\.[^.]+$/, "").toLowerCase();
  const state = stateByBasename.get(basename);
  if (state !== undefined && !urlByState.has(state)) urlByState.set(state, url);
}

/** 包里真的带了哪些状态的内置图。 */
export function bundledPhotoStates(): MascotState[] {
  return [...urlByState.keys()];
}

/** 某状态可用的内置图地址；没有本状态就退到 idle；一张都没有 → null。 */
export function bundledPhotoUrl(state: MascotState): string | null {
  const picked = pickBundledState(state, bundledPhotoStates());
  return picked === null ? null : urlByState.get(picked) ?? null;
}
