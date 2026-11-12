import { describe, expect, it } from "vitest";
import { parseSettings } from "../core/earning";
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

  it("writes the DOM every animation frame only when 60Hz is asked for", () => {
    const bench = harness(at(10, 0), 16);
    startTicker(bench.host, settings, record(bench), { refreshHz: 60 });

    bench.run(120);

    expect(bench.frames).toHaveLength(120);
    expect(bench.pending()).toBe(1);
    expect(bench.stamps[1] - bench.stamps[0]).toBe(16);
  });

  it("keeps ticking every frame but only paints at 10Hz", () => {
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

  it("paints at 1Hz when the slowest tier is chosen", () => {
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
    // 逐帧 progress 在变：这就是滚条位移的来源
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

describe("textDue：小数文本的跳变门限", () => {
  it("pushes every frame in roll mode but only marks the text due at 1Hz", () => {
    const bench = harness(at(10, 0), 16);
    startTicker(bench.host, settings, record(bench), { refreshHz: 1, displayMode: "roll" });

    bench.run(750); // 12000ms

    expect(bench.frames).toHaveLength(750); // 整数位的进位动画每帧都要能推进
    const dues = bench.frames.filter((frame) => frame.textDue);
    expect(dues).toHaveLength(12); // 12000ms / 1000ms，不是每帧
    const stamps = dues.map((frame) => frame.nowMs);
    for (let index = 1; index < stamps.length; index += 1) {
      expect(stamps[index] - stamps[index - 1]).toBeGreaterThanOrEqual(1000);
    }
  });

  it("repaints the text three times in three seconds at 1Hz", () => {
    const bench = harness(at(10, 0), 16);
    startTicker(bench.host, settings, record(bench), { refreshHz: 1, displayMode: "roll" });

    bench.run(188); // 3008ms

    expect(bench.frames.filter((frame) => frame.textDue)).toHaveLength(3);
  });

  it("hands every frame the wall clock for the carry animation", () => {
    const bench = harness(at(10, 0), 16);
    startTicker(bench.host, settings, record(bench), { displayMode: "roll" });

    bench.run(5);

    for (let index = 0; index < bench.frames.length; index += 1) {
      expect(bench.frames[index].nowMs).toBe(bench.stamps[index]);
    }
  });

  it("makes every painted jump frame text-due and keeps the frame count at the tier", () => {
    const bench = harness(at(10, 0), 16);
    startTicker(bench.host, settings, record(bench), { refreshHz: 1, displayMode: "jump" });

    bench.run(750);

    expect(bench.frames).toHaveLength(12);
    expect(bench.frames.every((frame) => frame.textDue)).toBe(true);
  });

  it("differs between roll and jump on the very same tier: 750 frames vs 12", () => {
    const roll = harness(at(10, 0), 16);
    startTicker(roll.host, settings, record(roll), { refreshHz: 1, displayMode: "roll" });
    const jump = harness(at(10, 0), 16);
    startTicker(jump.host, settings, record(jump), { refreshHz: 1, displayMode: "jump" });

    roll.run(750);
    jump.run(750);

    expect(roll.frames).toHaveLength(750);
    expect(jump.frames).toHaveLength(12);
    expect(roll.frames.filter((frame) => frame.textDue)).toHaveLength(12);
    // 两种模式看到的小数文本序列一致：roll 只是把跳变包在每帧推进的整数位移里
    expect(roll.frames.filter((frame) => frame.textDue).map((frame) => frame.money)).toEqual(
      jump.frames.map((frame) => frame.money),
    );
  });
});
