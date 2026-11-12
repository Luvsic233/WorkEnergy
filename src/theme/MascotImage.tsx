/*
 * 悬浮条右下角的吉祥物。
 *
 * 三种"没有图"（主题没配 mascot / 主题目录里没有那个文件 / 浏览器里没有 asset 协议）
 * 的最终表现都一样：整块不渲染。吉祥物是可选的装饰，缺图不许影响数字区排版。
 */
import { useState } from "react";
import { mascotUrlOf } from "./mascot";
import type { MascotState, Theme } from "./types";

interface MascotProps {
  theme: Theme | null;
  state: MascotState;
}

export function MascotImage({ theme, state }: MascotProps) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const src = mascotUrlOf(theme, state);

  if (src === null || src === brokenSrc) return null;

  return (
    <img
      className={`bar-mascot is-${state}`}
      src={src}
      alt=""
      draggable={false}
      onError={() => setBrokenSrc(src)}
    />
  );
}
