/*
 * photo-left 版式左侧的那块图（内置 maodie 主题）。
 *
 * 三种"没有图"（没有磁盘能力 / 目录里一张图都没有 / asset 协议不可用）的表现都一样：
 * 容器保留、不加 img —— 纯 CSS 的纯色块，不白屏、不报错、不影响右侧排版。
 */
import { useState } from "react";
import { usePhotoArt } from "./usePhotoArt";
import type { MascotState } from "./types";

interface PhotoArtProps {
  state: MascotState;
}

export function PhotoArt({ state }: PhotoArtProps) {
  const src = usePhotoArt(state);
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const shown = src !== null && src !== brokenSrc ? src : null;

  return (
    <div className="bar-photo-art" data-photo={shown === null ? "fallback" : "image"} aria-hidden="true">
      {shown === null ? null : (
        <img
          className="bar-photo-img"
          src={shown}
          alt=""
          draggable={false}
          onError={() => setBrokenSrc(shown)}
        />
      )}
    </div>
  );
}
