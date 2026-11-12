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
  /**
   * 每一位的 {digit, progress}：整数区只用 digit（精确落位），
   * 小数区用 digit + progress 算连续位移，于是小数每一帧都在滚，不靠任何门限。
   */
  columns: DigitColumns;
  /** 这一帧的挂钟时刻（ms）：整数位的进位动画以它为时钟，组件不自己读 Date.now。 */
  nowMs: number;
}

export interface TickerOptions {
  /** 跳动频率档位：只作用于 jump 模式（roll 模式每帧都画，与它无关）。 */
  refreshHz?: RefreshHz;
  /** 小数位数档位，默认 18 位。 */
  decimals?: Decimals;
  /**
   * 显示方式，默认 roll：
   * - roll：每一帧都把整数推到整格、把小数推到它自己的连续位置（digit + progress），
   *   小数连续滚动，不看 refreshHz。
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
): TickerFrame {
  const atoms = earnedAtoms(settings, paidMsOf(settings, nowMs));
  return {
    money: formatAtoms(atoms, decimals),
    phase: phaseOf(settings, nowMs),
    // 数字原料：同一份 atoms 用 BigInt 拆位，金额本身不经过浮点。
    columns: digitColumns(atoms, decimals),
    nowMs,
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
  // 只有 jump 模式需要门限：refreshHz 是它的节拍。roll 模式每帧都要画（小数连续滚动）。
  let lastFrameMs: number | null = null;

  const step = () => {
    if (stopped) return;
    const nowMs = host.now();
    if (displayMode !== "jump" || shouldRender(nowMs, lastFrameMs, refreshHz)) {
      if (displayMode === "jump") lastFrameMs = nowMs;
      onFrame(computeFrame(settings, nowMs, decimals));
    }
    handle = host.schedule(step);
  };

  handle = host.schedule(step);

  return () => {
    stopped = true;
    host.cancel(handle);
  };
}
