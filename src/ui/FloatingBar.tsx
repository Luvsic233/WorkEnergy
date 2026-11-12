import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { Settings } from "../core/earning";
import {
  DEFAULT_DECIMALS,
  formatMicro,
  type Decimals,
  type DigitColumn,
  type DigitColumns,
} from "../core/format";
import { DEFAULT_INPUT, type DisplayMode, type RefreshHz } from "../core/settings";
import { invoke } from "../settings/bridge";
import { DigitCell, FracCell, type DigitCellHandle, type FracCellHandle } from "./RollingDigit";
import { startTicker } from "./ticker";

/**
 * 整数位的格子池：整数部分最多 12 位（薪资输入上限 12 位整数），多出来的高位由池子覆盖；
 * 前导零的格子由 DigitCell 收起（display: none），所以池子固定也不会显示多余的空位。
 */
const INT_SLOTS = 12;

export interface RollingIntHandle {
  /** 逐帧把每一位推到它该停的整格；只碰 style，不进 React 状态。 */
  paint(columns: DigitColumns, nowMs: number): void;
}

export interface RollingFracHandle {
  /** 逐帧把每一位小数推到它该停的整格；只有 due 帧才检测变化并启动滚动。 */
  paint(columns: DigitColumn[], nowMs: number, due: boolean): void;
}

interface RollingIntProps {
  ref?: Ref<RollingIntHandle>;
}

/** 整数区：12 个一位格子，每一位常态精确停在整格上，只有数值变化时滚一格。 */
function RollingInt({ ref }: RollingIntProps) {
  const handles = useRef<(DigitCellHandle | null)[]>([]);

  useImperativeHandle(
    ref,
    () => ({
      paint(columns, nowMs) {
        // 池子按最高位对齐：左边多出来的格子收起，剩下的格子对应 columns.int 从高到低。
        const offset = INT_SLOTS - columns.int.length;
        for (let slot = 0; slot < INT_SLOTS; slot += 1) {
          const column = columns.int[slot - offset];
          handles.current[slot]?.paint(column?.digit ?? 0, nowMs, column !== undefined);
        }
      },
    }),
    [],
  );

  return (
    <span className="int-group">
      {Array.from({ length: INT_SLOTS }, (_, slot) => (
        <DigitCell
          key={slot}
          pos={INT_SLOTS - 1 - slot}
          ref={(handle) => {
            handles.current[slot] = handle;
          }}
        />
      ))}
    </span>
  );
}

interface RollingFracProps {
  /** 小数位数档位：格子数跟着档位走（18 / 12 / 6）。 */
  decimals: Decimals;
  ref?: Ref<RollingFracHandle>;
}

/** 小数区：每位一个滚条格子，向后代换的是"向上滚 d 格"而不是整片跳文本。 */
function RollingFrac({ decimals, ref }: RollingFracProps) {
  const handles = useRef<(FracCellHandle | null)[]>([]);

  useImperativeHandle(
    ref,
    () => ({
      paint(columns, nowMs, due) {
        for (let index = 0; index < handles.current.length; index += 1) {
          const column = columns[index];
          handles.current[index]?.paint(column?.digit ?? 0, nowMs, column !== undefined, due);
        }
      },
    }),
    [],
  );

  return (
    <span className="frac-group">
      {Array.from({ length: decimals }, (_, index) => (
        <FracCell
          key={index}
          fpos={index + 1}
          ref={(handle) => {
            handles.current[index] = handle;
          }}
        />
      ))}
    </span>
  );
}

interface FloatingBarProps {
  settings: Settings;
  decimals?: Decimals;
  /** 小数位的改期频率：roll / jump 两种模式都按它决定"哪一帧才允许检测数字变化"。 */
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
  const rollerRef = useRef<RollingIntHandle>(null);
  const fracRollerRef = useRef<RollingFracHandle>(null);
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
      ({ money, phase, columns, textDue, nowMs }) => {
        if (displayMode === "roll") {
          // 整数：每位推到整格，数值变化时由进位状态机自己滚一格。
          rollerRef.current?.paint(columns, nowMs);
          // 小数：同样是格子，但只在 textDue（refreshHz 到期）的帧上检测变化并启动一次向上滚动。
          fracRollerRef.current?.paint(columns.frac, nowMs, textDue);
        } else {
          // jump：整数与小数一起按 refreshHz 整片跳，没有任何动画。
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
        {displayMode === "roll" ? <RollingInt ref={rollerRef} /> : <span className="int" ref={intRef}>0</span>}
        <span className="dot">.</span>
        {displayMode === "roll" ? (
          <RollingFrac decimals={decimals} ref={fracRollerRef} />
        ) : (
          <span className="frac" ref={fracRef}>
            {"0".repeat(decimals)}
          </span>
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
