import { useImperativeHandle, useRef, type Ref } from "react";

/** 0–9 之后补一个 0：滚到 9 的尽头时下一格正好是 0，机械计数器的回绕才不断条。 */
const STRIP = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

/** 一格的步长（em），必须与 styles.css 里 .bar-value .wheel / .wheel-glyph 的 0.8em 一致。 */
const PITCH_EM = 0.8;

export interface RollingDigitHandle {
  /** 写入这一位的位移；visible=false 时整列收起（前导零不显示）。 */
  paint(digit: number, progress: number, visible: boolean): void;
}

interface RollingDigitProps {
  ref?: Ref<RollingDigitHandle>;
}

/**
 * 机械计数器的一位：一条竖向 0–9 滚条，位移 = (digit + progress) × 一格（PITCH_EM）。
 * 位移用 em 表达，格子高度也就是 PITCH_EM 个 em，因此整数区（大字）和小数区（小字）共用同一份逻辑，
 * 不需要测量像素高度，也不需要 CSS transition 插值——插值由 rAF 逐帧算出的 progress 承担。
 * 全组件没有 useState/setState：paint 只写两个 ref 的 style。
 */
export function RollingDigit({ ref }: RollingDigitProps) {
  const wheelRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const shownRef = useRef(true);

  useImperativeHandle(
    ref,
    () => ({
      paint(digit, progress, visible) {
        if (visible !== shownRef.current) {
          shownRef.current = visible;
          if (wheelRef.current) wheelRef.current.style.display = visible ? "" : "none";
        }
        if (!visible) return;
        // 只有一次 transform 写：不碰 layout，不进 React，合成层直接位移。
        const offset = ((digit + progress) * PITCH_EM).toFixed(5);
        if (trackRef.current) trackRef.current.style.transform = `translate3d(0, -${offset}em, 0)`;
      },
    }),
    [],
  );

  return (
    <span className="wheel" ref={wheelRef} aria-hidden="true">
      <span className="wheel-track" ref={trackRef}>
        {STRIP.map((glyph, index) => (
          <span className="wheel-glyph" key={index}>
            {glyph}
          </span>
        ))}
      </span>
    </span>
  );
}
