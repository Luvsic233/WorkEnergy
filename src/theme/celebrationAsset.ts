/*
 * 庆祝 GIF 的来源（构建时由 Vite 的 import.meta.glob 静态收集）。
 *
 * 仓库里放了 src/assets/maodie/celebrate.gif（或同名的 .webp / .png）就直接用它；
 * 一张都没有就返回 null，由调用方回退到已内置的静态猫图 —— 功能先能验证，不缺图白屏。
 * 命名与内置猫图同一套：文件名主干固定为 celebrate。
 */
const GIF_BASENAMES = ["celebrate"] as const;

const modules = import.meta.glob("../assets/maodie/celebrate.{gif,webp,png}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** 内置庆祝图的地址；仓库里没有就 null。取名字排序第一张，结果与文件系统顺序无关。 */
export function celebrationGifUrl(): string | null {
  const entries = Object.entries(modules)
    .filter(([path]) => {
      const basename = (path.split("/").pop() ?? "").replace(/\.[^.]+$/, "").toLowerCase();
      return (GIF_BASENAMES as readonly string[]).includes(basename);
    })
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const first = entries[0];
  return first === undefined ? null : first[1];
}
