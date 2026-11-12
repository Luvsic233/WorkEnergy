/*
 * 庆祝动图的来源（构建时由 Vite 的 import.meta.glob 静态收集）。
 *
 * 仓库里可以放多张：celebrate.gif / celebrate-1.webp / celebrate-2.webp …
 * 每次触发弹窗时随机挑一张播，避免老是同一个。
 * 一张都没有就返回 null，由调用方回退到已内置的静态猫图 —— 不缺图白屏。
 *
 * 注：这些素材是动画 WebP（由 GIF 压缩转换而来，体积约为原 GIF 的 1/5，
 * Chromium / WebView2 都原生支持动画 WebP）。
 */
const modules = import.meta.glob("../assets/maodie/celebrate*.{gif,webp,png}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** 只认 celebrate.<ext> 与 celebrate-<后缀>.<ext>，避免把别的图混进庆祝池。 */
const NAME_PATTERN = /^celebrate(?:-[a-z0-9]+)?\.(?:gif|webp|png)$/i;

/** 所有可用的庆祝动图地址，按路径排序（结果与文件系统枚举顺序无关）。 */
export function celebrationGifUrls(): string[] {
  return Object.entries(modules)
    .filter(([path]) => NAME_PATTERN.test(path.split("/").pop() ?? ""))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, url]) => url);
}

/** 第一张庆祝动图（保留给"只要一张"的调用方与旧测试）。 */
export function celebrationGifUrl(): string | null {
  return celebrationGifUrls()[0] ?? null;
}

/**
 * 随机挑一张庆祝动图。random 可注入，便于单测。
 * 只有一张时结果固定；没有图时返回 null。
 */
export function pickCelebrationUrl(random: () => number = Math.random): string | null {
  const urls = celebrationGifUrls();
  if (urls.length === 0) return null;
  const raw = Math.floor(random() * urls.length);
  const index = Math.min(urls.length - 1, Math.max(0, raw));
  return urls[index];
}
