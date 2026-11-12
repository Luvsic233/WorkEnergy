import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { Settings } from "../core/earning";
import { DEFAULT_DECIMALS, formatMicro, type Decimals, type DigitColumns } from "../core/format";
import { DEFAULT_INPUT, type DisplayMode, type RefreshHz } from "../core/settings";
import { invoke } from "../settings/bridge";
import { RollingDigit, type RollingDigitHandle } from "./RollingDigit";
import { startTicker } from "./ticker";

/**
 * 整数位的滚条池：整数部分最多 12 位（薪资输入上限 12 位整数），多出来的低位由 pool 覆盖；
 * 前导零的列由 RollingDigit 收起（display: none），所以池子固定也不会显示多余的空位。
 */
const INT_SLOTS = 12;

export interface RollingMoneyHandle {
  /** 逐帧写全部滚条的位移；只碰 style，不进 React 状态。 */
  paint(columns: DigitColumns): void;
}

interface RollingMoneyProps {
  decimals: Decimals;
  ref?: Ref<RollingMoneyHandle>;
}

/** 金额区的机械计数器版式：整数滚条池 + 小数点 + 小数滚条。结构随 decimals 重建，位移随 paint 逐帧变。 */
function RollingMoney({ decimals, ref }: RollingMoneyProps) {
  const intHandles = useRef<(RollingDigitHandle | null)[]>([]);
  const fracHandles = useRef<(RollingDigitHandle | null)[]>([]);

  useImperativeHandle(
    ref,
    () => ({
      paint(columns) {
        // 池子按最高位对齐：左边多出来的列收起，剩下的列对应 columns.int 从高到低。
        const offset = INT_SLOTS - columns.int.length;
        for (let slot = 0; slot < INT_SLOTS; slot += 1) {
          const column = columns.int[slot - offset];
          intHandles.current[slot]?.paint(column?.digit ?? 0, column?.progress ?? 0, column !== undefined);
        }
        for (let index = 0; index < decimals; index += 1) {
          const column = columns.frac[index];
          fracHandles.current[index]?.paint(column?.digit ?? 0, column?.progress ?? 0, true);
        }
      },
    }),
    [decimals],
  );

  return (
    <>
      <span className="int-group">
        {Array.from({ length: INT_SLOTS }, (_, slot) => (
          <RollingDigit
            key={slot}
            ref={(handle) => {
              intHandles.current[slot] = handle;
            }}
          />
        ))}
      </span>
      <span className="dot">.</span>
      <span className="frac-group">
        {Array.from({ length: decimals }, (_, index) => (
          <RollingDigit
            key={index}
            ref={(handle) => {
              fracHandles.current[index] = handle;
            }}
          />
        ))}
      </span>
    </>
  );
}

interface FloatingBarProps {
  settings: Settings;
  decimals?: Decimals;
  /** 只在 displayMode 为 jump 时生效。 */
  refreshHz?: RefreshHz;
  displayMode?: DisplayMode;
  now?: () => number;
}

export function FloatingBar({
  settings,
  decimals = DEFAULT_DECIMALS,
  refreshHz = DEFAULT_INPUT.refreshHz,
  displayMode = DEFAULT_INPUT.displayMode,
  now,
}: FloatingBarProps) {
  const rollerRef = useRef<RollingMoneyHandle>(null);
  const intRef = useRef<HTMLSpanElement>(null);
  const fracRef = useRef<HTMLSpanElement>(null);
  const phaseRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const host = {
      now: now ?? Date.now,
      schedule: (callback: () => void) => requestAnimationFrame(callback),
      cancel: (handle: number) => cancelAnimationFrame(handle),
    };
    let lastPhase = "";
    // 每帧只写 ref 的 style.transform / textContent，绝不 setState：60fps 下 React 完全不参与。
    return startTicker(
      host,
      settings,
      ({ money, phase, columns }) => {
        if (displayMode === "roll") {
          rollerRef.current?.paint(columns);
        } else {
          if (intRef.current) intRef.current.textContent = money.int;
          if (fracRef.current) fracRef.current.textContent = money.frac;
        }
        if (phase !== lastPhase) {
          lastPhase = phase;
          if (phaseRef.current) phaseRef.current.textContent = phase;
        }
      },
      { refreshHz, decimals, displayMode },
    );
  }, [settings, decimals, refreshHz, displayMode, now]);

  return (
    <div
      className="bar"
      // deep：整条（含标签与阶段文字）都能按住拖动；button/input 这类可点击元素
      // 仍然吞掉拖拽，所以 × 点得动，数字区也不会被拖拽吃掉点击。
      data-tauri-drag-region="deep"
      onContextMenu={(event) => {
        // 关掉 WebView2 默认右键菜单，换成 Rust 侧弹出的原生菜单。
        event.preventDefault();
        void invoke("show_bar_menu");
      }}
    >
      <button
        type="button"
        className="bar-close"
        aria-label="隐藏到托盘"
        title="隐藏到托盘"
        onClick={() => {
          void invoke("hide_main");
        }}
      >
        ×
      </button>
      <div className="bar-label">今日实时工资</div>
      {/* data-decimals / data-mode 给 CSS 用：按档位收窄字号、按显示方式切换对齐，保证 400px 条内不溢出。 */}
      <div className="bar-value" data-decimals={decimals} data-mode={displayMode}>
        {displayMode === "roll" ? (
          <RollingMoney decimals={decimals} ref={rollerRef} />
        ) : (
          <>
            <span className="int" ref={intRef}>
              0
            </span>
            <span className="dot">.</span>
            <span className="frac" ref={fracRef}>
              {"0".repeat(decimals)}
            </span>
          </>
        )}
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
