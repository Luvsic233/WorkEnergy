import { earnedAtoms, paidMsOf, phaseOf, type Phase, type Settings } from "../core/earning";
import {
  DEFAULT_DECIMALS,
  digitColumns,
  formatAtoms,
  type Decimals,
  type DigitColumns,
  type MoneyParts,
} from "../core/format";
import type { DisplayMode, RefreshHz } from "../core/settings";

export interface TickerHost {
  now(): number;
  schedule(callback: () => void): number;
  cancel(handle: number): void;
}

export interface TickerFrame {
  money: MoneyParts;
  phase: Phase;
  /** 每一位的 {digit, progress}；整数区只用 digit（滚轮已取消），progress 仍是引擎契约的一部分。 */
  columns: DigitColumns;
  /** 这一帧的挂钟时刻（ms）：整数位的进位动画以它为时钟，组件不自己读 Date.now。 */
  nowMs: number;
  /** 文本改期门限：为 true 时这一帧才允许写小数文本（roll 模式）或整串文本（jump 模式）。 */
  textDue: boolean;
}

export interface TickerOptions {
  /** 文本改期的档位（小数跳变频率）；省略时每帧都到期（既有调用方的契约）。 */
  refreshHz?: RefreshHz;
  /** 小数位数档位，默认 18 位。 */
  decimals?: Decimals;
  /**
   * 显示方式，默认 roll：
   * - roll：整数位每帧都会被推到整格（数值变化时自己滚一格）；小数不是滚轮，只按 refreshHz 整片跳变。
   * - jump：没有动画，整数与小数一起按 refreshHz 整片跳变，此时 onFrame 只在到期的帧上被调用。
   */
  displayMode?: DisplayMode;
}

/** 两次重绘之间的最小间隔（ms）。60Hz 返回 0，表示每帧都写。 */
export function intervalMsOf(refreshHz: RefreshHz): number {
  return refreshHz >= 60 ? 0 : Math.round(1000 / refreshHz);
}

/** 下一次允许重绘的时刻；60Hz 恒等于 lastMs（每帧都允许）。 */
export function nextDeadline(lastMs: number, refreshHz: RefreshHz): number {
  return lastMs + intervalMsOf(refreshHz);
}

/** 节流门限：lastMs 为 null 表示还没画过，第一帧立刻画。纯整数比较，不累加浮点时间。 */
export function shouldRender(nowMs: number, lastMs: number | null, refreshHz: RefreshHz): boolean {
  if (lastMs === null) return true;
  const interval = intervalMsOf(refreshHz);
  return interval === 0 ? true : nowMs >= nextDeadline(lastMs, refreshHz);
}

/** 数值按毫秒精确计算（不受节流影响），只有 DOM 写入被 startTicker 控制节奏。 */
export function computeFrame(
  settings: Settings,
  nowMs: number,
  decimals: Decimals = DEFAULT_DECIMALS,
  textDue = true,
): TickerFrame {
  const atoms = earnedAtoms(settings, paidMsOf(settings, nowMs));
  return {
    money: formatAtoms(atoms, decimals),
    phase: phaseOf(settings, nowMs),
    // 数字原料：同一份 atoms 用 BigInt 拆位，金额本身不经过浮点。
    columns: digitColumns(atoms, decimals),
    nowMs,
    textDue,
  };
}

export function startTicker(
  host: TickerHost,
  settings: Settings,
  onFrame: (frame: TickerFrame) => void,
  options: TickerOptions = {},
): () => void {
  const refreshHz = options.refreshHz ?? 60;
  const decimals = options.decimals ?? DEFAULT_DECIMALS;
  const displayMode = options.displayMode ?? "roll";
  let handle = 0;
  let stopped = false;
  // jump：整帧门限；roll：只门限文本（整数进位动画必须每帧都能推进）。
  let lastFrameMs: number | null = null;
  let lastTextMs: number | null = null;

  const step = () => {
    if (stopped) return;
    const nowMs = host.now();
    if (displayMode === "jump") {
      if (shouldRender(nowMs, lastFrameMs, refreshHz)) {
        lastFrameMs = nowMs;
        onFrame(computeFrame(settings, nowMs, decimals, true));
      }
    } else {
      // 小数文本走同一套 shouldRender 门限：1Hz 档位下 18 位小数每秒只重写一次。
      const textDue = shouldRender(nowMs, lastTextMs, refreshHz);
      if (textDue) lastTextMs = nowMs;
      onFrame(computeFrame(settings, nowMs, decimals, textDue));
    }
    handle = host.schedule(step);
  };

  handle = host.schedule(step);

  return () => {
    stopped = true;
    host.cancel(handle);
  };
}
