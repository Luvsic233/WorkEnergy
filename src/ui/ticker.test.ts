import { describe, expect, it } from "vitest";
import { parseSettings } from "../core/earning";
import { DEFAULT_INPUT } from "../core/settings";
import { fracOffsetEm, motionAt, motionIndexAt, type DigitMotion } from "./RollingDigit";
import { intervalMsOf, nextDeadline, shouldRender, startTicker, type TickerFrame, type TickerHost } from "./ticker";

const settings = parseSettings({ salary: "10000" });

function at(hours: number, minutes = 0, seconds = 0, ms = 0): number {
  return new Date(2026, 0, 6, hours, minutes, seconds, ms).getTime();
}

interface Harness {
  host: TickerHost;
  frames: TickerFrame[];
  stamps: number[];
  run(count: number): void;
  pending(): number;
  cancelled: number[];
}

function harness(startMs: number, stepMs: number): Harness {
  let nowMs = startMs;
  const queue: (() => void)[] = [];
  const frames: TickerFrame[] = [];
  const stamps: number[] = [];
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
    stamps,
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

function record(bench: Harness) {
  return (frame: TickerFrame) => {
    bench.frames.push(frame);
    bench.stamps.push(bench.host.now());
  };
}

/** 一帧里每一位小数的位移（em）：连续滚动下每帧都会变，不存在"整格静止"。 */
function fracOffsets(frame: TickerFrame): number[] {
  return frame.columns.frac.map((column) => fracOffsetEm(column));
}

/** 以 16ms 的帧步长录一段 roll 模式的帧。 */
function rollFrames(refreshHz: 1 | 10 | 60, count: number): TickerFrame[] {
  const bench = harness(at(10, 0), 16);
  startTicker(bench.host, settings, record(bench), { refreshHz, decimals: 18, displayMode: "roll" });
  bench.run(count);
  return bench.frames;
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

  it("keeps ticking every frame but only paints at 10Hz in jump mode", () => {
    const bench = harness(at(10, 0), 16);
    startTicker(bench.host, settings, record(bench), { refreshHz: 10, displayMode: "jump" });

    bench.run(600); // 600 帧 × 16ms = 9600ms 的挂钟时间

    expect(bench.pending()).toBe(1); // rAF 循环没有被节流拖死
    for (let index = 1; index < bench.stamps.length; index += 1) {
      expect(bench.stamps[index] - bench.stamps[index - 1]).toBeGreaterThanOrEqual(100);
    }
    expect(bench.frames.length).toBeGreaterThanOrEqual(80);
    expect(bench.frames.length).toBeLessThanOrEqual(100);
  });

  it("paints at 1Hz in jump mode when the slowest tier is chosen", () => {
    const bench = harness(at(10, 0), 16);
    startTicker(bench.host, settings, record(bench), { refreshHz: 1, displayMode: "jump" });

    bench.run(750); // 12000ms

    for (let index = 1; index < bench.stamps.length; index += 1) {
      expect(bench.stamps[index] - bench.stamps[index - 1]).toBeGreaterThanOrEqual(1000);
    }
    expect(bench.frames.length).toBeGreaterThanOrEqual(11);
    expect(bench.frames.length).toBeLessThanOrEqual(13);
  });

  it("formats the money at the configured decimal tier", () => {
    const bench = harness(at(10, 0), 1000);
    startTicker(bench.host, settings, record(bench), { refreshHz: 1, decimals: 18 });

    bench.run(3);

    expect(bench.frames).toHaveLength(3);
    expect(bench.frames.every((frame) => frame.money.frac.length === 18)).toBe(true);
    expect(bench.frames.every((frame) => /^\d{18}$/.test(frame.money.frac))).toBe(true);
    expect(bench.frames.every((frame) => frame.money.int === "57")).toBe(true);
  });

  it("advances every animation frame in roll mode, ignoring the refresh tier", () => {
    const bench = harness(at(10, 0), 16);
    startTicker(bench.host, settings, record(bench), { refreshHz: 1, displayMode: "roll" });

    bench.run(180); // 2880ms，1Hz 档位在 jump 模式下这里只会画 3 帧

    expect(bench.frames).toHaveLength(180);
    expect(bench.pending()).toBe(1);
    for (let index = 1; index < bench.stamps.length; index += 1) {
      expect(bench.stamps[index] - bench.stamps[index - 1]).toBe(16);
    }
  });

  it("keeps roll smooth and jump stepped at the very same refresh tier", () => {
    const roll = harness(at(10, 0), 16);
    startTicker(roll.host, settings, record(roll), { refreshHz: 1, displayMode: "roll" });

    const jump = harness(at(10, 0), 16);
    startTicker(jump.host, settings, record(jump), { refreshHz: 1, displayMode: "jump" });

    roll.run(750);
    jump.run(750);

    expect(roll.frames).toHaveLength(750);
    expect(jump.frames.length).toBeLessThan(20);
  });

  it("hands the per-digit roll state to every frame", () => {
    const bench = harness(at(10, 0), 16);
    startTicker(bench.host, settings, record(bench), { decimals: 18 });

    bench.run(3);

    for (const frame of bench.frames) {
      expect(frame.columns.frac).toHaveLength(18);
      expect(frame.columns.int).toHaveLength(2); // 10:00 时是 57 元
      expect(frame.columns.int.map((column) => column.digit).join("")).toBe("57");
      expect(frame.columns.frac.map((column) => column.digit).join("")).toBe(frame.money.frac);
    }
    // 逐帧 progress 在变：这就是小数连续位移的来源
    expect(bench.frames[2].columns.frac[1].progress).not.toBe(bench.frames[0].columns.frac[1].progress);
  });

  it("pads 6-digit frames to six characters", () => {
    const bench = harness(at(10, 0), 1000);
    startTicker(bench.host, settings, record(bench), { refreshHz: 1, decimals: 6 });

    bench.run(2);

    expect(bench.frames.every((frame) => frame.money.frac.length === 6)).toBe(true);
  });
});

describe("intervalMsOf", () => {
  it("maps the three tiers onto a redraw interval", () => {
    expect(intervalMsOf(60)).toBe(0); // 每帧
    expect(intervalMsOf(10)).toBe(100);
    expect(intervalMsOf(1)).toBe(1000);
  });
});

describe("shouldRender", () => {
  it("paints the very first frame without any elapsed time", () => {
    expect(shouldRender(0, null, 10)).toBe(true);
    expect(shouldRender(1_700_000_000_000, null, 1)).toBe(true);
  });

  it("gates the 10Hz tier on a 100ms interval", () => {
    expect(shouldRender(99, 0, 10)).toBe(false);
    expect(shouldRender(100, 0, 10)).toBe(true);
    expect(shouldRender(116, 16, 10)).toBe(true);
    expect(shouldRender(108, 16, 10)).toBe(false);
  });

  it("gates the 1Hz tier on a 1000ms interval", () => {
    expect(shouldRender(999, 0, 1)).toBe(false);
    expect(shouldRender(1_000, 0, 1)).toBe(true);
  });

  it("never gates the 60Hz tier: every animation frame is due", () => {
    expect(shouldRender(16, 0, 60)).toBe(true);
    expect(shouldRender(17, 16, 60)).toBe(true);
  });

  it("does not paint when the clock jumps backwards", () => {
    expect(shouldRender(50, 200, 10)).toBe(false);
  });

  it("exposes the next allowed paint moment", () => {
    expect(nextDeadline(1_000, 10)).toBe(1_100);
    expect(nextDeadline(1_000, 1)).toBe(2_000);
    expect(nextDeadline(1_000, 60)).toBe(1_000);
  });
});

describe("小数位连续滚动：refreshHz 只管 jump，不再管 roll", () => {
  it("paints all 60 animation frames at each of the three tiers", () => {
    const stamps = rollFrames(60, 60).map((frame) => frame.nowMs);
    for (const tier of [1, 10, 60] as const) {
      const frames = rollFrames(tier, 60);
      expect(frames).toHaveLength(60);
      expect(frames.map((frame) => frame.nowMs)).toEqual(stamps);
    }
  });

  it("keeps every one of the 18 fractional digits moving on every single frame: 0 static frames", () => {
    for (const tier of [1, 10, 60] as const) {
      const frames = rollFrames(tier, 60);
      const offsets = frames.map(fracOffsets);
      for (let index = 0; index < 18; index += 1) {
        let staticFrames = 0;
        for (let frame = 1; frame < offsets.length; frame += 1) {
          if (offsets[frame][index] === offsets[frame - 1][index]) staticFrames += 1;
        }
        expect(staticFrames).toBe(0);
      }
    }
  });

  it("produces the identical fractional sequence at 1Hz, 10Hz and 60Hz", () => {
    const one = rollFrames(1, 60).map(fracOffsets);
    expect(rollFrames(10, 60).map(fracOffsets)).toEqual(one);
    expect(rollFrames(60, 60).map(fracOffsets)).toEqual(one);
  });

  it("advances the leading fractional digits monotonically at a nearly constant step", () => {
    const frames = rollFrames(10, 60);
    for (const index of [0, 1]) {
      const offsets = frames.map((frame) => fracOffsets(frame)[index]);
      const deltas: number[] = [];
      for (let frame = 1; frame < offsets.length; frame += 1) {
        expect(offsets[frame]).toBeLessThan(offsets[frame - 1]); // 单调：只会一直往下走
        deltas.push(offsets[frame] - offsets[frame - 1]);
      }
      const mean = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
      expect(mean).toBeLessThan(0);
      const variance = deltas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / deltas.length;
      // 抖动不到均值的 5%：匀速推进，不是"一段快滚 + 一段完全不变"
      expect(Math.sqrt(variance)).toBeLessThan(Math.abs(mean) * 0.05);
    }
  });

  it("leaves the integer carries untouched: on a grid or inside one single-grid carry", () => {
    const frames = rollFrames(1, 60);
    const motions = new Map<number, DigitMotion | null>();
    for (const frame of frames) {
      for (let column = 0; column < frame.columns.int.length; column += 1) {
        const pos = frame.columns.int.length - 1 - column;
        const digit = frame.columns.int[column].digit;
        const motion = motionAt(motions.get(pos) ?? null, digit, frame.nowMs);
        motions.set(pos, motion);
        const index = motionIndexAt(motion, frame.nowMs);
        if (motion.from === motion.to) {
          expect(index).toBe(digit); // 精确落位，没有半格残差
        } else {
          expect(motion.to - motion.from).toBe(1); // 只滚一格
          expect(index).toBeGreaterThanOrEqual(motion.from);
          expect(index).toBeLessThanOrEqual(motion.to);
        }
      }
    }
  });

  it("keeps the fractions continuous at the 12- and 6-digit tiers too", () => {
    for (const decimals of [12, 6] as const) {
      const bench = harness(at(10, 0), 16);
      startTicker(bench.host, settings, record(bench), { refreshHz: 10, decimals, displayMode: "roll" });
      bench.run(30);

      const offsets = bench.frames.map(fracOffsets);
      expect(offsets[0]).toHaveLength(decimals);
      for (let index = 0; index < decimals; index += 1) {
        for (let frame = 1; frame < offsets.length; frame += 1) {
          expect(offsets[frame][index]).not.toBe(offsets[frame - 1][index]);
        }
      }
    }
  });

  it("stops the fractions together with the clock after the workday ends", () => {
    const bench = harness(at(17, 59, 55), 1000);
    startTicker(bench.host, settings, record(bench), { refreshHz: 10, decimals: 18, displayMode: "roll" });

    bench.run(60);

    const tail = bench.frames.slice(-10).map(fracOffsets);
    for (const offsets of tail) expect(offsets).toEqual(tail[0]);
  });

  it("differs from jump on the very same tier: 750 frames vs 12", () => {
    const roll = harness(at(10, 0), 16);
    startTicker(roll.host, settings, record(roll), { refreshHz: 1, displayMode: "roll" });
    const jump = harness(at(10, 0), 16);
    startTicker(jump.host, settings, record(jump), { refreshHz: 1, displayMode: "jump" });

    roll.run(750);
    jump.run(750);

    expect(roll.frames).toHaveLength(750);
    expect(jump.frames).toHaveLength(12);
  });

  it("runs the default install end to end: roll at 10Hz paints every frame", () => {
    expect(DEFAULT_INPUT.refreshHz).toBe(10);
    expect(DEFAULT_INPUT.displayMode).toBe("roll");

    const bench = harness(at(10, 0), 16);
    startTicker(bench.host, settings, record(bench), {
      refreshHz: DEFAULT_INPUT.refreshHz,
      decimals: DEFAULT_INPUT.decimals,
      displayMode: DEFAULT_INPUT.displayMode,
    });

    bench.run(60);

    expect(bench.frames).toHaveLength(60);
    expect(bench.frames.map(fracOffsets).every((offsets) => offsets.some((value) => value < 0))).toBe(true);
  });
});
