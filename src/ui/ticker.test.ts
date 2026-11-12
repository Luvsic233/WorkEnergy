import { describe, expect, it } from "vitest";
import { parseSettings } from "../core/earning";
import { DEFAULT_INPUT } from "../core/settings";
import { fracDurationMs, fracFrame, fracIndexAt, fracProgress, type FracMotion } from "./RollingDigit";
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

describe("小数位滚动：refreshHz 门限", () => {
  it("starts at most one roll per due frame — three in three seconds, not sixty", () => {
    const bench = harness(at(10, 0), 16);
    startTicker(bench.host, settings, record(bench), { refreshHz: 1, decimals: 18, displayMode: "roll" });

    bench.run(188); // 3008ms，1Hz 档位

    // 用与组件完全相同的状态机回放：任何时刻的滚动段都只能起始于一个 textDue 帧
    const motions: (FracMotion | null)[] = Array.from({ length: 18 }, () => null);
    const epochs = new Set<number>();
    const startsPerDigit = Array.from({ length: 18 }, () => 0);
    const dueStamps = new Set<number>();
    for (const frame of bench.frames) {
      if (frame.textDue) dueStamps.add(frame.nowMs);
      for (let index = 0; index < 18; index += 1) {
        const prev = motions[index];
        const next = fracFrame(prev, frame.columns.frac[index].digit, frame.nowMs, frame.textDue, 1);
        if (next.from !== next.to && (prev === null || prev.from === prev.to)) {
          epochs.add(next.startMs);
          startsPerDigit[index] += 1;
        }
        motions[index] = next;
      }
    }

    expect(dueStamps.size).toBe(3); // 3008ms 里只有 3 个到期帧
    // 3 秒内整排小数最多启动 3 段滚动（首帧是"直接落位"，不算滚动），绝不是每帧一段
    expect(epochs.size).toBeLessThanOrEqual(dueStamps.size);
    expect(epochs.size).toBeGreaterThanOrEqual(1);
    expect([...epochs].every((stamp) => dueStamps.has(stamp))).toBe(true);
    for (const starts of startsPerDigit) expect(starts).toBeLessThanOrEqual(3);
    expect(startsPerDigit.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(0); // 确实滚了
  });

  it("leaves no residual: every frame is either an exact grid or strictly inside one roll", () => {
    const bench = harness(at(10, 0), 16);
    startTicker(bench.host, settings, record(bench), { refreshHz: 1, decimals: 18, displayMode: "roll" });

    bench.run(188);

    const motions: (FracMotion | null)[] = Array.from({ length: 18 }, () => null);
    let rolling = 0;
    for (const frame of bench.frames) {
      for (let index = 0; index < 18; index += 1) {
        const motion = fracFrame(motions[index], frame.columns.frac[index].digit, frame.nowMs, frame.textDue, 1);
        motions[index] = motion;
        const position = fracIndexAt(motion, frame.nowMs, 1);
        const progress = fracProgress(motion, frame.nowMs, 1);
        if (progress === 0 || progress === 1) {
          // 静止 / 起点 / 落点：位移格号必须精确是整数，没有半格残差
          expect(Number.isInteger(position)).toBe(true);
        } else {
          rolling += 1;
          expect(position).toBeGreaterThan(motion.from);
          expect(position).toBeLessThan(motion.to);
        }
      }
    }
    // 3 秒里滚动只占 215–335ms 的少数片段，绝大多数帧都停在整格上
    expect(rolling).toBeGreaterThan(0);
    expect(rolling / (bench.frames.length * 18)).toBeLessThan(0.5);
  });
});

describe("小数滚动节拍：跟随 refreshHz（默认 10Hz）", () => {
  /** 等距 100fps 帧：让"门限就是 1000/refreshHz"这件事本身可测，不掺帧粒度漂移。 */
  const step = 10;
  const THREE_SECONDS = 300; // 300 帧 × 10ms

  it("starts a roll about 30 times in 3s at 10Hz — not 3 times, not every frame", () => {
    const bench = harness(at(10, 0), step);
    startTicker(bench.host, settings, record(bench), { refreshHz: 10, decimals: 18, displayMode: "roll" });

    bench.run(THREE_SECONDS);

    expect(bench.frames).toHaveLength(THREE_SECONDS); // 动画仍然每帧推进，被门限挡住的只是"检测变化"
    const dues = bench.frames.filter((frame) => frame.textDue);
    expect(dues).toHaveLength(30); // 3000ms / 100ms
    expect(dues.length).toBeLessThan(THREE_SECONDS / 5);
    const stamps = dues.map((frame) => frame.nowMs);
    for (let index = 1; index < stamps.length; index += 1) {
      expect(stamps[index] - stamps[index - 1]).toBe(100);
    }
  });

  it("still starts about 3 rolls in 3s at the 1Hz tier", () => {
    const bench = harness(at(10, 0), step);
    startTicker(bench.host, settings, record(bench), { refreshHz: 1, decimals: 18, displayMode: "roll" });

    bench.run(THREE_SECONDS);

    const dues = bench.frames.filter((frame) => frame.textDue);
    expect(dues).toHaveLength(3); // 3000ms / 1000ms
    const stamps = dues.map((frame) => frame.nowMs);
    for (let index = 1; index < stamps.length; index += 1) {
      expect(stamps[index] - stamps[index - 1]).toBe(1_000);
    }
  });

  it("marks every frame due at the 60Hz tier: 300 in 3 seconds", () => {
    const bench = harness(at(10, 0), step);
    startTicker(bench.host, settings, record(bench), { refreshHz: 60, decimals: 18, displayMode: "roll" });

    bench.run(THREE_SECONDS);

    expect(bench.frames.filter((frame) => frame.textDue)).toHaveLength(THREE_SECONDS);
  });

  it("runs the default tier end to end: 10Hz roll on a fresh install is 30 beats in 3s", () => {
    expect(DEFAULT_INPUT.refreshHz).toBe(10);
    expect(DEFAULT_INPUT.displayMode).toBe("roll");

    const bench = harness(at(10, 0), step);
    startTicker(bench.host, settings, record(bench), {
      refreshHz: DEFAULT_INPUT.refreshHz,
      decimals: DEFAULT_INPUT.decimals,
      displayMode: DEFAULT_INPUT.displayMode,
    });

    bench.run(THREE_SECONDS);

    expect(bench.frames.filter((frame) => frame.textDue)).toHaveLength(30);
  });

  it("lands every 10Hz roll before the next beat: one epoch per due frame, no residual", () => {
    const bench = harness(at(10, 0), step);
    startTicker(bench.host, settings, record(bench), { refreshHz: 10, decimals: 18, displayMode: "roll" });

    bench.run(THREE_SECONDS);

    const motions: (FracMotion | null)[] = Array.from({ length: 18 }, () => null);
    const epochs = new Set<number>();
    let longest = 0;
    let rollingFrames = 0;
    for (const frame of bench.frames) {
      for (let index = 0; index < 18; index += 1) {
        const prev = motions[index];
        const next = fracFrame(prev, frame.columns.frac[index].digit, frame.nowMs, frame.textDue, 10);
        if (next.from !== next.to && (prev === null || prev.from === prev.to)) {
          epochs.add(next.startMs);
          longest = Math.max(longest, next.to - next.from);
        }
        motions[index] = next;
        const position = fracIndexAt(next, frame.nowMs, 10);
        const progress = fracProgress(next, frame.nowMs, 10);
        if (progress > 0 && progress < 1) {
          rollingFrames += 1;
          // 正在两格之间推进（浮点值可能恰好落在整数上，所以只断言"严格在两点之间"）
          expect(position).toBeGreaterThan(next.from);
          expect(position).toBeLessThan(next.to);
        } else {
          expect(Number.isInteger(position)).toBe(true); // 落位精确，无残差
        }
      }
    }
    // 首帧是"直接落位"不算滚动，之后每个到期帧一段（每段都在下一拍之前落地）
    expect(epochs.size).toBe(29);
    expect(longest).toBeGreaterThan(0);
    expect(fracDurationMs(longest, 10)).toBe(90); // 本档位任何一段都不超过 90ms
    expect(rollingFrames).toBeGreaterThan(0);
  });
});
