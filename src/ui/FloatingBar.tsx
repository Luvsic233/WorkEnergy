import { useEffect, useRef } from "react";
import type { Settings } from "../core/earning";
import { DEFAULT_DECIMALS, formatMicro, type Decimals } from "../core/format";
import { DEFAULT_INPUT, type RefreshHz } from "../core/settings";
import { startTicker } from "./ticker";

/** 前 6 位小数正常显示，多出来的位数弱化——本组件与 ticker 共用的拆分点。 */
const STRONG_FRAC_DIGITS = 6;

interface FloatingBarProps {
  settings: Settings;
  decimals?: Decimals;
  refreshHz?: RefreshHz;
  now?: () => number;
}

export function FloatingBar({
  settings,
  decimals = DEFAULT_DECIMALS,
  refreshHz = DEFAULT_INPUT.refreshHz,
  now,
}: FloatingBarProps) {
  const intRef = useRef<HTMLSpanElement>(null);
  const fracRef = useRef<HTMLSpanElement>(null);
  const weakRef = useRef<HTMLSpanElement>(null);
  const phaseRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const host = {
      now: now ?? Date.now,
      schedule: (callback: () => void) => requestAnimationFrame(callback),
      cancel: (handle: number) => cancelAnimationFrame(handle),
    };
    // 每帧只写 textContent，不 setState：节流判断在 ticker 里（shouldRender）。
    return startTicker(
      host,
      settings,
      ({ money, phase }) => {
        if (intRef.current) intRef.current.textContent = money.int;
        if (fracRef.current) fracRef.current.textContent = money.frac.slice(0, STRONG_FRAC_DIGITS);
        if (weakRef.current) weakRef.current.textContent = money.frac.slice(STRONG_FRAC_DIGITS);
        if (phaseRef.current) phaseRef.current.textContent = phase;
      },
      { refreshHz, decimals },
    );
  }, [settings, decimals, refreshHz, now]);

  const strongDigits = Math.min(decimals, STRONG_FRAC_DIGITS);

  return (
    <div className="bar">
      <div className="bar-label">今日实时工资</div>
      <div className="bar-value">
        <span className="int" ref={intRef}>
          0
        </span>
        <span className="dot">.</span>
        <span className="frac" ref={fracRef}>
          {"0".repeat(strongDigits)}
        </span>
        {decimals > STRONG_FRAC_DIGITS ? (
          <span className="frac frac-weak" ref={weakRef}>
            {"0".repeat(decimals - STRONG_FRAC_DIGITS)}
          </span>
        ) : null}
        <span className="unit">元</span>
      </div>
      <div className="bar-foot">
        <span className="phase" ref={phaseRef}>
          —
        </span>
        <span className="hint">
          {formatMicro(settings.salaryMicro)} 元 / {formatMicro(settings.payDaysMicro)} 天 / {formatMicro(settings.hoursMicro)} 小时
        </span>
      </div>
    </div>
  );
}
