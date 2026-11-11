import { earnedAtoms, paidMsOf, phaseOf, type Phase, type Settings } from "../core/earning";
import { formatAtoms, type MoneyParts } from "../core/format";

export interface TickerHost {
  now(): number;
  schedule(callback: () => void): number;
  cancel(handle: number): void;
}

export interface TickerFrame {
  money: MoneyParts;
  phase: Phase;
}

export function computeFrame(settings: Settings, nowMs: number): TickerFrame {
  return {
    money: formatAtoms(earnedAtoms(settings, paidMsOf(settings, nowMs))),
    phase: phaseOf(settings, nowMs),
  };
}

export function startTicker(host: TickerHost, settings: Settings, onFrame: (frame: TickerFrame) => void): () => void {
  let handle = 0;
  let stopped = false;

  const step = () => {
    if (stopped) return;
    onFrame(computeFrame(settings, host.now()));
    handle = host.schedule(step);
  };

  handle = host.schedule(step);

  return () => {
    stopped = true;
    host.cancel(handle);
  };
}
