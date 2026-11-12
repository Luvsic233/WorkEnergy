/*
 * 庆祝弹窗的页面（独立窗口 label=celebrate 里加载 #/celebrate）。
 *
 * 只做两件事：画一张图、露出 4 秒后把自己收起来。
 * 图来源分两级：仓库里的 celebrate.gif（见 celebrationAsset.ts）优先；没有就回退到
 * 已内置的静态猫图（kitty-happy，缺图自动退到 kitty-idle），保证功能先能验证。
 * 非 Tauri 环境（浏览器预览、单测）里 invoke 是 no-op，组件照样渲染。
 *
 * 重新计时：露出期间又跨过台阶时，Rust 侧会对同一个窗口再 show 一次并 eval
 * __WE_CELEBRATE_PING__ 进来 —— 这里把 4 秒重新数一遍，窗口不重建、也不提前收。
 */
import { useEffect, useState } from "react";
import { invoke } from "../settings/bridge";
import { bundledPhotoUrl } from "./bundledPhotos";
import { createCelebrationTimer } from "./celebration";
import { celebrationGifUrl } from "./celebrationAsset";

declare global {
  interface Window {
    /** Rust 侧每次 show 都会调它：露出计时重新开始（不重建窗口、不叠第二个）。 */
    __WE_CELEBRATE_PING__?: () => void;
  }
}

/** 要显示的图：内置 GIF → 内置静态猫图 → null（整块不渲染，不白屏、不破图）。 */
export function celebrationSrc(): string | null {
  const gif = celebrationGifUrl();
  if (gif !== null) return gif;
  return bundledPhotoUrl("milestone");
}

export function CelebrationOverlay() {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);

  useEffect(() => {
    // 到点让 Rust 侧把窗口隐藏（不销毁）：下一次跨越直接复用同一个 webview。
    const timer = createCelebrationTimer(() => {
      void invoke("hide_celebration");
    });
    timer.arm();
    // 露出期间再次触发（第二个 20 元台阶在 4 秒内跨过）：重新计时，保持显示。
    window.__WE_CELEBRATE_PING__ = () => {
      timer.arm();
    };
    return () => {
      timer.disarm();
      delete window.__WE_CELEBRATE_PING__;
    };
  }, []);

  const gif = celebrationGifUrl();
  const fallback = bundledPhotoUrl("milestone");
  // GIF 加载失败（占位文件 / 格式不支持）时退到静态猫图，而不是留一个破图。
  const src =
    gif !== null && gif !== brokenSrc
      ? gif
      : fallback !== null && fallback !== brokenSrc
        ? fallback
        : null;

  return (
    <div className="celebrate" data-celebrate={src === null ? "none" : "image"} aria-hidden="true">
      {src === null ? null : (
        <img
          className="celebrate-img"
          src={src}
          alt=""
          draggable={false}
          onError={() => setBrokenSrc(src)}
        />
      )}
    </div>
  );
}
