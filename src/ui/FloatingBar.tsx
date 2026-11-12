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
import { MascotImage } from "../theme/MascotImage";
import { PhotoArt } from "../theme/PhotoArt";
import { layoutOf } from "../theme/layout";
import { useAdaptiveCardWidth } from "../theme/adaptiveWidth";
import type { Theme } from "../theme/types";
import { useMascot } from "../theme/useMascot";
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
  /** 逐帧把每一位小数推到它的连续位置（digit + progress）：没有门限，每帧都推进。 */
  paint(columns: DigitColumn[]): void;
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

/**
 * 小数区：每位一个滚条格子，位移由 {digit, progress} 连续算出。
 * 一圈滚条后面永远是下一格，所以这一排读起来是一条不停向下流的尾巴，而不是"滚一段停一拍"。
 */
function RollingFrac({ decimals, ref }: RollingFracProps) {
  const handles = useRef<(FracCellHandle | null)[]>([]);

  useImperativeHandle(
    ref,
    () => ({
      paint(columns) {
        for (let index = 0; index < handles.current.length; index += 1) {
          const column = columns[index];
          handles.current[index]?.paint(column ?? { digit: 0, progress: 0 }, column !== undefined);
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
  /** 跳动频率档位（默认 10Hz）：只决定 jump 模式整串跳变的频率，roll 模式不看它。 */
  refreshHz?: RefreshHz;
  displayMode?: DisplayMode;
  /**
   * 当前主题：配色与字体由 CSS 变量决定（见 src/theme/css.ts）；
   * 另外内置 maodie 主题带 layout = photo-left，按它切换整条版式。
   */
  theme?: Theme | null;
  now?: () => number;
}

export function FloatingBar({
  settings,
  decimals = DEFAULT_DECIMALS,
  refreshHz = DEFAULT_INPUT.refreshHz,
  displayMode = DEFAULT_INPUT.displayMode,
  theme = null,
  now,
}: FloatingBarProps) {
  const rollerRef = useRef<RollingIntHandle>(null);
  const fracRollerRef = useRef<RollingFracHandle>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const intRef = useRef<HTMLSpanElement>(null);
  const fracRef = useRef<HTMLSpanElement>(null);
  const phaseRef = useRef<HTMLSpanElement>(null);
  // 吉祥物状态机：notify 只写 ref，状态真的变化时才 setState 一次（无吉祥物的主题整条链路空转）。
  const mascot = useMascot(theme);
  const mascotNotify = mascot.notify;
  // photo-left 版式的窗口宽度跟着内容走（其余版式整条链路空转）。
  const isPhotoLeft = layoutOf(theme) === "photo-left";
  const adaptive = useAdaptiveCardWidth(isPhotoLeft, { bar: barRef, main: mainRef });
  const adaptiveNote = adaptive.note;

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
      ({ money, phase, columns, nowMs }) => {
        if (displayMode === "roll") {
          // 整数：每位推到整格，数值变化时由进位状态机自己滚一格。
          rollerRef.current?.paint(columns, nowMs);
          // 小数：每帧都按 atoms 的真实连续进度（digit + progress）推进，没有任何门限。
          fracRollerRef.current?.paint(columns.frac);
        } else {
          // jump：整数与小数一起按 refreshHz 整片跳，没有任何动画。
          if (intRef.current) intRef.current.textContent = money.int;
          if (fracRef.current) fracRef.current.textContent = money.frac;
        }
        if (phase !== lastPhase) {
          lastPhase = phase;
          if (phaseRef.current) phaseRef.current.textContent = phase;
        }
        // 吉祥物：只把整数元文本与阶段交给状态机，滚轮与引擎一行没动。
        mascotNotify(money.int, phase);
        // 自适应宽度：只在整数位数变化（并稳定若干帧）时才下发一次窗口尺寸。
        adaptiveNote(money.int);
      },
      { refreshHz, decimals, displayMode },
    );
  }, [settings, decimals, refreshHz, displayMode, now, mascotNotify, adaptiveNote]);

  // 两个版式共用的两块：数字区与阶段文字（滚轮 / ticker / 每帧 paint 一行都没动）。
  const valueBlock = (
    /* data-decimals / data-mode 给 CSS 用：按档位收窄字号、按显示方式切换对齐，保证条宽内不溢出。 */
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
  );
  const phaseBlock = (
    <span className="phase" ref={phaseRef}>
      —
    </span>
  );

  const handleContextMenu = (event: { preventDefault(): void }) => {
    // 关掉 WebView2 默认右键菜单，换成 Rust 侧弹出的原生菜单。
    event.preventDefault();
    void invoke("show_bar_menu");
  };

  const closeButton = (
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
  );

  // photo-left（内置 maodie）：左侧一张按条高缩放的图（右缘渐变淡出），右侧只有标签 + 金额 + 阶段。
  if (layoutOf(theme) === "photo-left") {
    return (
      <div
        ref={barRef}
        className="bar"
        data-layout="photo-left"
        // deep：整条（含标签与阶段文字）都能按住拖动；button/input 这类可点击元素
        // 仍然吞掉拖拽，所以 × 点得动，数字区也不会被拖拽吃掉点击。
        data-tauri-drag-region="deep"
        onContextMenu={handleContextMenu}
      >
        {closeButton}
        <PhotoArt state={mascot.state} />
        <div className="bar-photo-main" ref={mainRef}>
          <div className="bar-label">今日实时工资</div>
          {valueBlock}
          <div className="bar-foot">{phaseBlock}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="bar"
      // deep：整条（含标签与阶段文字）都能按住拖动；button/input 这类可点击元素
      // 仍然吞掉拖拽，所以 × 点得动，数字区也不会被拖拽吃掉点击。
      data-tauri-drag-region="deep"
      onContextMenu={handleContextMenu}
    >
      {closeButton}
      <div className="bar-label">今日实时工资</div>
      {valueBlock}
      <div className="bar-foot">
        {phaseBlock}
        <div className="bar-foot-meta">
          <span className="hint">
            {formatMicro(settings.salaryMicro)} 元 / {formatMicro(settings.payDaysMicro)} 天 / {formatMicro(settings.hoursMicro)} 小时
          </span>
          <MascotImage theme={theme} state={mascot.state} />
        </div>
      </div>
    </div>
  );
}
