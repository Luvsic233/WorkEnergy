import { describe, expect, it } from "vitest";
import { parseSettings } from "../core/earning";
import { startTicker, type TickerFrame, type TickerHost } from "./ticker";

const settings = parseSettings({ salary: "10000" });

function at(hours: number, minutes = 0, seconds = 0, ms = 0): number {
  return new Date(2026, 0, 6, hours, minutes, seconds, ms).getTime();
}

interface Harness {
  host: TickerHost;
  frames: TickerFrame[];
  run(count: number): void;
  pending(): number;
  cancelled: number[];
}

function harness(startMs: number, stepMs: number): Harness {
  let nowMs = startMs;
  const queue: (() => void)[] = [];
  const frames: TickerFrame[] = [];
  const cancelled: number[] = [];
  let handle = 0;

  const host: TickerHost = {
    now: () => nowMs,
    schedule: (callback) => {
      queue.push(callback);
      handle += 1;
      return handle;
    },
    cancel: (value) => {
      cancelled.push(value);
    },
  };

  return {
    host,
    frames,
    cancelled,
    pending: () => queue.length,
    run(count: number) {
      for (let index = 0; index < count; index += 1) {
        const callback = queue.shift();
        if (!callback) throw new Error("no frame scheduled");
        nowMs += stepMs;
        callback();
      }
    },
  };
}

describe("startTicker", () => {
  it("schedules exactly one frame per animation frame and rewrites the digits every frame", () => {
    const bench = harness(at(10, 0), 16);
    startTicker(bench.host, settings, (frame) => bench.frames.push(frame));

    bench.run(600);

    expect(bench.frames).toHaveLength(600);
    expect(bench.pending()).toBe(1);
    const fracs = bench.frames.map((frame) => frame.money.frac);
    expect(new Set(fracs).size).toBe(600);
    for (let index = 1; index < fracs.length; index += 1) {
      expect(fracs[index]).not.toBe(fracs[index - 1]);
    }
    expect(bench.frames[599].money.int).toBe("57");
    expect(bench.frames.every((frame) => frame.phase === "在岗")).toBe(true);
  });

  it("freezes the digits after the workday ends", () => {
    const bench = harness(at(17, 59, 55), 1000);
    startTicker(bench.host, settings, (frame) => bench.frames.push(frame));

    bench.run(60);

    const tail = bench.frames.slice(-10);
    expect(new Set(tail.map((frame) => frame.money.frac)).size).toBe(1);
    expect(tail.every((frame) => frame.phase === "已下班")).toBe(true);
    expect(bench.frames[0].phase).toBe("在岗");
  });

  it("stops scheduling once the returned disposer runs", () => {
    const bench = harness(at(10, 0), 16);
    const stop = startTicker(bench.host, settings, (frame) => bench.frames.push(frame));

    bench.run(5);
    expect(bench.frames).toHaveLength(5);
    stop();
    expect(bench.cancelled).toHaveLength(1);

    bench.run(1);
    expect(bench.frames).toHaveLength(5);
    expect(bench.pending()).toBe(0);
  });
});
