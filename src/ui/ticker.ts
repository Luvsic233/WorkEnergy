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
  /** 每一位的 {digit, progress}；roll 模式拿它写滚条位移，jump 模式只要 money。 */
  columns: DigitColumns;
}

export interface TickerOptions {
  /** DOM 重绘频率档位；省略时按每帧重绘（既有调用方的契约），产品默认档由设置面板传入。 */
  refreshHz?: RefreshHz;
  /** 小数位数档位，默认 12 位。 */
  decimals?: Decimals;
  /**
   * 显示方式，默认 roll：每帧都推进滚条，此时 refreshHz 不生效。
   * jump 时沿用 refreshHz 节流，整串数字按档位整跳。
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
export function computeFrame(settings: Settings, nowMs: number, decimals: Decimals = DEFAULT_DECIMALS): TickerFrame {
  const atoms = earnedAtoms(settings, paidMsOf(settings, nowMs));
  return {
    money: formatAtoms(atoms, decimals),
    phase: phaseOf(settings, nowMs),
    // 滚条位移的原料：同一份 atoms 用 BigInt 拆位，金额本身不经过浮点。
    columns: digitColumns(atoms, decimals),
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
  let lastMs: number | null = null;

  const step = () => {
    if (stopped) return;
    const nowMs = host.now();
    // roll：每帧都画（刷新档位不参与判断，丝滑来自 60fps 的逐帧位移）；jump：按档位整跳。
    if (displayMode === "roll" || shouldRender(nowMs, lastMs, refreshHz)) {
      lastMs = nowMs;
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
