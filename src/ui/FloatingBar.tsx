import { useEffect, useRef } from "react";
import type { Settings } from "../core/earning";
import { startTicker } from "./ticker";

interface FloatingBarProps {
  settings: Settings;
  now?: () => number;
}

export function FloatingBar({ settings, now }: FloatingBarProps) {
  const intRef = useRef<HTMLSpanElement>(null);
  const fracRef = useRef<HTMLSpanElement>(null);
  const phaseRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const host = {
      now: now ?? Date.now,
      schedule: (callback: () => void) => requestAnimationFrame(callback),
      cancel: (handle: number) => cancelAnimationFrame(handle),
    };
    return startTicker(host, settings, ({ money, phase }) => {
      if (intRef.current) intRef.current.textContent = money.int;
      if (fracRef.current) fracRef.current.textContent = money.frac;
      if (phaseRef.current) phaseRef.current.textContent = phase;
    });
  }, [settings, now]);

  return (
    <div className="bar">
      <div className="bar-label">今日实时工资</div>
      <div className="bar-value">
        <span className="int" ref={intRef}>
          0
        </span>
        <span className="dot">.</span>
        <span className="frac" ref={fracRef}>
          000000000000
        </span>
        <span className="unit">元</span>
      </div>
      <div className="bar-foot">
        <span className="phase" ref={phaseRef}>
          —
        </span>
        <span className="hint">10000 元 / 21.75 天 / 8 小时</span>
      </div>
    </div>
  );
}
