import { earnedAtoms, paidMsOf, phaseOf, type Phase, type Settings } from "../core/earning";
import { DEFAULT_DECIMALS, formatAtoms, type Decimals, type MoneyParts } from "../core/format";
import type { RefreshHz } from "../core/settings";

export interface TickerHost {
  now(): number;
  schedule(callback: () => void): number;
  cancel(handle: number): void;
}

export interface TickerFrame {
  money: MoneyParts;
  phase: Phase;
}

export interface TickerOptions {
  /** DOM 重绘频率档位；省略时按每帧重绘（既有调用方的契约），产品默认档由设置面板传入。 */
  refreshHz?: RefreshHz;
  /** 小数位数档位，默认 12 位。 */
  decimals?: Decimals;
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
  return {
    money: formatAtoms(earnedAtoms(settings, paidMsOf(settings, nowMs)), decimals),
    phase: phaseOf(settings, nowMs),
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
  let handle = 0;
  let stopped = false;
  let lastMs: number | null = null;

  const step = () => {
    if (stopped) return;
    const nowMs = host.now();
    if (shouldRender(nowMs, lastMs, refreshHz)) {
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
