import { describe, expect, it } from "vitest";
import { earnedAtoms, paidMsOf, parseSettings, phaseOf, type Settings } from "../core/earning";
import { formatAtoms } from "../core/format";
import {
  advanceSlowStop,
  atomsOfMoney,
  createSlowStopState,
  GLIDE_MS,
  SLOW_MS,
  stallDeadlineMs,
  type SlowStopState,
} from "./slowStop";

/** 默认班表：09:00 上班 / 12:00–13:00 午休 / 18:00 下班，月薪 3 万（每秒约 0.0479 元）。 */
const BASE = parseSettings({ salary: "30000" });

/** 本地时区的「今天 hh:mm:ss」绝对 ms（2026-11-18 是周三）。 */
function at(hour: number, minute: number, second = 0, ms = 0): number {
  return new Date(2026, 10, 18, hour, minute, second, ms).getTime();
}

/** 引擎算出的真实值：测试里它就是「真实金额」，显示层一个字都不许改它。 */
function targetAt(settings: Settings, nowMs: number): bigint {
  return earnedAtoms(settings, paidMsOf(settings, nowMs));
}

/** 60fps 量级的固定步长（16ms/帧）：帧抖动会掩盖可测的减速斜率，所以确定性测试用固定步长。 */
const DT = 16;

interface Row {
  nowMs: number;
  target: bigint;
  display: bigint;
  /** 这一帧显示值推进了多少 atom（「渐慢」= 这个序列单调递减）。 */
  advance: bigint;
  /** 这一帧剩下的差值（真实值 − 显示值）。 */
  gap: bigint;
}

/** 跑一段帧：完全按 ticker 的节拍（先算真实值，再推进显示值），返回逐帧序列。 */
function run(
  settings: Settings,
  startMs: number,
  frames: number,
  opts: { dt?: number; deadline?: (nowMs: number) => number | null; target?: (nowMs: number) => bigint } = {},
): Row[] {
  const dt = opts.dt ?? DT;
  const deadlineOf = opts.deadline ?? ((nowMs: number) => stallDeadlineMs(settings, nowMs));
  const targetOf = opts.target ?? ((nowMs: number) => targetAt(settings, nowMs));
  let state: SlowStopState = createSlowStopState();
  const rows: Row[] = [];
  for (let i = 0; i < frames; i += 1) {
    const nowMs = startMs + i * dt;
    const target = targetOf(nowMs);
    const before = state;
    state = advanceSlowStop(state, { targetAtoms: target, nowMs, deadlineMs: deadlineOf(nowMs) });
    rows.push({
      nowMs,
      target,
      display: state.display,
      advance: state.display - before.display,
      gap: target - state.display,
    });
  }
  return rows;
}

/** 每帧真实值的生长量（atoms）——「一帧的钱」，用来给滞后定阈值。 */
function growthPerFrame(settings: Settings, nowMs: number, dt = DT): bigint {
  return targetAt(settings, nowMs + dt) - targetAt(settings, nowMs);
}

describe("slowStop：远离停顿点时紧跟真实值", () => {
  it("最后 10 秒之外滞后恒为 0：显示值就是真实值（零滞后，不累积、不发散）", () => {
    const rows = run(BASE, at(10, 0), 200);
    // 第一帧是开机落位（同样等于真实值），之后每一帧都必须精确相等。
    for (const row of rows) {
      expect(row.gap).toBe(0n);
      expect(row.display).toBe(row.target);
    }
  });

  it("真实值不减时显示值单调不减，且永不超过真实值", () => {
    const rows = run(BASE, at(10, 0), 400);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].advance).toBeGreaterThanOrEqual(0n);
      expect(rows[i].display).toBeGreaterThanOrEqual(rows[i - 1].display);
      expect(rows[i].display).toBeLessThanOrEqual(rows[i].target);
    }
  });
});

describe("slowStop：最后 10 秒「渐慢」（每帧推进量单调递减）", () => {
  const start = at(17, 59, 50); // 正好是减速窗口的起点（离 18:00 还有 SLOW_MS）
  // 跑到 18:00:02：减速窗口 10s + 滑停窗口 1.2s + 余量。
  const rows = run(BASE, start, Math.ceil((SLOW_MS + GLIDE_MS) / DT) + 40);

  it("窗口起点确实在最后 10 秒之前，窗口长度就是 SLOW_MS", () => {
    expect(stallDeadlineMs(BASE, start)).toBe(at(18, 0));
    expect(at(18, 0) - start).toBe(SLOW_MS);
    expect(stallDeadlineMs(BASE, start - 1)).toBe(at(18, 0));
  });

  it("每帧推进量逐帧不增（从进入减速窗口一直到滑停结束，这就是「渐慢」的可测定义）", () => {
    const advances = rows.slice(1).map((row) => row.advance);
    for (let i = 1; i < advances.length; i += 1) {
      expect(advances[i]).toBeLessThanOrEqual(advances[i - 1]);
    }
  });

  it("减速幅度可测：窗口末端每帧推进量比开头少 10% 左右，且始终 > 0（还在走，只是慢了）", () => {
    const first = rows[1].advance;
    const windowEnd = rows[Math.floor(SLOW_MS / DT)].advance;
    expect(windowEnd).toBeGreaterThan(0n);
    expect(windowEnd * 100n).toBeLessThanOrEqual(first * 92n); // ≤ 0.92 × 开头
    expect(windowEnd * 100n).toBeGreaterThan(first * 86n); // ≥ 0.86 × 开头
  });

  it("渐慢来自显示层：同一段时间里真实值一帧都没减速", () => {
    const firstTargetAdvance = rows[1].target - rows[0].target;
    const lastTargetAdvance = rows[Math.floor(SLOW_MS / DT)].target - rows[Math.floor(SLOW_MS / DT) - 1].target;
    expect(lastTargetAdvance).toBe(firstTargetAdvance);
    expect(firstTargetAdvance).toBeGreaterThan(0n);
  });

  it("滞后在窗口里单调变大（显示值相对真实值一点点退后），到点那一刻最大", () => {
    const gaps = rows.slice(1, Math.floor(SLOW_MS / DT) + 1).map((row) => row.gap);
    for (let i = 1; i < gaps.length; i += 1) expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1]);
    // 最大滞后 ≈ RESERVE_MS 的钱
    const reserve = (growthPerFrame(BASE, start) * 536n) / BigInt(DT);
    expect(gaps[gaps.length - 1]).toBeGreaterThan((reserve * 9n) / 10n);
    expect(gaps[gaps.length - 1]).toBeLessThan((reserve * 11n) / 10n);
  });
});

describe("slowStop：到点后滑停，1.2 秒内精确等于真实值", () => {
  const start = at(17, 59, 55);
  const rows = run(BASE, start, 500); // 跑到 18:00:03，滑停窗口早就走完
  const stopIndex = rows.findIndex((row, i) => i > 0 && row.target === rows[i - 1].target);
  const after = rows.slice(stopIndex);

  it("到点那一帧确实还留着差值（否则滑停没有内容可走）", () => {
    expect(stopIndex).toBeGreaterThan(0);
    expect(rows[stopIndex].target).toBe(targetAt(BASE, at(18, 0)));
    expect(rows[stopIndex].gap).toBeGreaterThan(0n);
  });

  it("差值单调收敛到 0，并在 1.2 秒（76 帧上限）内精确相等", () => {
    for (let i = 1; i < after.length; i += 1) {
      expect(after[i].gap).toBeGreaterThanOrEqual(0n);
      expect(after[i].gap).toBeLessThanOrEqual(after[i - 1].gap); // 单调收敛
    }
    const limitFrames = Math.ceil(GLIDE_MS / DT) + 1; // 75 + 1：窗口末帧 + 一帧打卡
    const firstEqual = after.findIndex((row) => row.gap === 0n);
    expect(firstEqual).toBeGreaterThan(0);
    expect(firstEqual).toBeLessThanOrEqual(limitFrames);
    for (const row of after.slice(firstEqual)) {
      expect(row.display).toBe(row.target);
      expect(row.gap).toBe(0n);
    }
  });

  it("滑停期间显示值单调不减，逐帧推进量也单调递减（渐慢看得见）", () => {
    const parts = after
      .slice(0, Math.ceil(GLIDE_MS / DT))
      .map((row) => row.advance)
      .filter((_, i) => i > 0);
    for (const value of parts) expect(value).toBeGreaterThanOrEqual(0n);
    for (let i = 1; i < parts.length; i += 1) expect(parts[i]).toBeLessThanOrEqual(parts[i - 1]);
    expect(parts[0]).toBeGreaterThan(0n);
    expect(parts[parts.length - 1]).toBeLessThan(parts[0]);
  });

  it("整段过程显示值单调不减（滚轮不倒退、不闪烁）", () => {
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].display).toBeGreaterThanOrEqual(rows[i - 1].display);
      expect(rows[i].display).toBeLessThanOrEqual(rows[i].target);
    }
  });
});

describe("slowStop：停顿点落在两帧之间（真实帧网格不是整毫秒）", () => {
  // 起点故意偏 7ms：18:00:00.000 落在两帧之间，滑停窗口的第一帧只有 9ms 长。
  const start = at(17, 59, 50, 7);
  const rows = run(BASE, start, Math.ceil((SLOW_MS + GLIDE_MS) / DT) + 40);

  it("到点那一帧不往前跳（推进量不超过一帧的钱），显示值也绝不越过真实值", () => {
    const stopIndex = rows.findIndex((row, i) => i > 0 && row.target === rows[i - 1].target);
    const growth = growthPerFrame(BASE, start);
    expect(stopIndex).toBeGreaterThan(0);
    expect(rows[stopIndex].advance).toBeLessThanOrEqual(growth);
    for (const row of rows) {
      expect(row.display).toBeLessThanOrEqual(row.target);
      expect(row.display).toBeGreaterThanOrEqual(0n);
    }
  });

  it("显示值全程单调不减（真实值最后一帧只长了 9ms 也不倒退）", () => {
    for (let i = 1; i < rows.length; i += 1) expect(rows[i].display).toBeGreaterThanOrEqual(rows[i - 1].display);
  });

  it("滑停段（第二帧起）推进量单调不增：帧长一样，所以这等价于推进率单调不增", () => {
    const stopIndex = rows.findIndex((row, i) => i > 0 && row.target === rows[i - 1].target);
    const advances = rows.slice(stopIndex + 1, stopIndex + Math.ceil(GLIDE_MS / DT)).map((row) => row.advance);
    for (let i = 1; i < advances.length; i += 1) expect(advances[i]).toBeLessThanOrEqual(advances[i - 1]);
    expect(advances[0]).toBeGreaterThan(0n);
  });

  it("照样在 1.2 秒窗口内精确收敛（停顿点落在两帧之间也一样）", () => {
    const stopIndex = rows.findIndex((row, i) => i > 0 && row.target === rows[i - 1].target);
    const firstEqual = rows.findIndex((row, i) => i > stopIndex && row.gap === 0n);
    const stop = rows[stopIndex];
    expect(stop.gap).toBeGreaterThan(0n);
    expect(rows[firstEqual].nowMs - at(18, 0)).toBeLessThanOrEqual(GLIDE_MS + DT);
    for (const row of rows.slice(firstEqual)) expect(row.display).toBe(row.target);
  });
});

describe("slowStop：午休开始滑停，午休结束直接跟随", () => {
  const lunchStart = at(12, 0);
  const lunchEnd = at(13, 0);

  it("午休开始：滑停到真实值后精确停住（整个午休都是精确相等）", () => {
    const rows = run(BASE, lunchStart - 5_000, 1_600);
    const stopIndex = rows.findIndex((row, i) => i > 0 && row.target === rows[i - 1].target);
    expect(rows[stopIndex].target).toBe(targetAt(BASE, lunchStart));
    expect(rows[stopIndex].gap).toBeGreaterThan(0n);
    for (const row of rows.slice(stopIndex + Math.ceil(GLIDE_MS / DT) + 1)) {
      expect(row.display).toBe(row.target);
    }
  });

  it("午休结束：不需要额外动画，直接跟随（滞后回到 0）", () => {
    const rows = run(BASE, lunchEnd - 40, 60);
    const last = rows[rows.length - 1];
    expect(last.gap).toBe(0n);
    expect(last.display).toBe(last.target);
  });
});

describe("slowStop：真实值突然变大 / 变小（改设置、加班开关）", () => {
  const base = at(10, 0);

  it("突然变大：不倒退、不越过、不出现负值，静下来后精确相等", () => {
    const jumpAt = 40;
    const rows = run(BASE, base, 200, {
      target: (nowMs) => {
        const index = Math.round((nowMs - base) / DT);
        const target = targetAt(BASE, nowMs);
        return index < jumpAt ? target : target + 1_000n * 10n ** 18n; // +1000 元
      },
    });
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].display).toBeGreaterThanOrEqual(rows[i - 1].display);
      expect(rows[i].display).toBeLessThanOrEqual(rows[i].target);
      expect(rows[i].display).toBeGreaterThanOrEqual(0n);
    }
    expect(rows[jumpAt].display).toBeGreaterThan(rows[jumpAt - 1].display);
    expect(rows[rows.length - 1].gap).toBe(0n);
  });

  it("突然变小：一帧落到新的真实值，不来回抖、不出负数、不发散，之后精确跟随", () => {
    const jumpAt = 40;
    const rows = run(BASE, base, 400, {
      target: (nowMs) => {
        const index = Math.round((nowMs - base) / DT);
        const target = targetAt(BASE, nowMs);
        return index < jumpAt ? target + 1_000n * 10n ** 18n : target;
      },
    });
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].display).toBeLessThanOrEqual(rows[i].target); // 永远不超过真实值
      expect(rows[i].display).toBeGreaterThanOrEqual(0n);
    }
    // 掉下来是单向的：跳变那一帧往下，之后真实值涨它也涨，绝不来回抖。
    expect(rows[jumpAt].display).toBeLessThan(rows[jumpAt - 1].display);
    for (let i = jumpAt + 1; i < rows.length; i += 1) {
      expect(rows[i].gap).toBeLessThanOrEqual(rows[i - 1].gap);
      expect(rows[i].display).toBeGreaterThanOrEqual(rows[i - 1].display);
    }
    expect(rows[rows.length - 1].gap).toBe(0n);
  });

  it("滑停窗口里改设置（真实值跳一下）：不倒退、不发散，仍然精确收敛", () => {
    const start = at(17, 59, 55);
    const jumpAt = 200;
    const rows = run(BASE, start, 400, {
      target: (nowMs, ) => {
        const index = Math.round((nowMs - start) / DT);
        const target = targetAt(BASE, nowMs);
        return index < jumpAt ? target : target + 10n * 10n ** 18n;
      },
    });
    for (const row of rows) expect(row.display).toBeGreaterThanOrEqual(0n);
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].target >= rows[i - 1].target) expect(rows[i].display).toBeGreaterThanOrEqual(rows[i - 1].display);
    }
    expect(rows[rows.length - 1].gap).toBe(0n);
  });

  it("真实值归零（配置错误 / 跨天）：显示值收敛到 0，不会变成负数", () => {
    const rows = run(BASE, at(23, 59, 58), 400, {
      target: (nowMs) => (nowMs >= at(23, 59, 59) ? 0n : 1n * 10n ** 18n),
      deadline: () => null,
    });
    for (const row of rows) expect(row.display).toBeGreaterThanOrEqual(0n);
    expect(rows[rows.length - 1].display).toBe(0n);
  });
});

describe("slowStop：极端输入兜底", () => {
  const frame = (target: bigint, nowMs: number, deadlineMs: number | null = null) => ({ targetAtoms: target, nowMs, deadlineMs });

  it("target = 0：显示值恒为 0", () => {
    let state = createSlowStopState();
    for (let i = 0; i < 200; i += 1) {
      state = advanceSlowStop(state, frame(0n, at(3, 0) + i * DT));
      expect(state.display).toBe(0n);
    }
  });

  it("超大 atoms（10^30 元量级）：不溢出、不发散，停住后精确相等", () => {
    const huge = 10n ** 30n * 10n ** 18n;
    let state = createSlowStopState();
    for (let i = 0; i < 100; i += 1) {
      state = advanceSlowStop(state, frame(huge + BigInt(i) * 10n ** 20n, at(10, 0) + i * DT));
      expect(state.display).toBeLessThanOrEqual(huge + BigInt(i) * 10n ** 20n);
      expect(state.display).toBeGreaterThanOrEqual(0n);
    }
    const frozen = huge + 100n * 10n ** 20n;
    for (let i = 0; i < 200; i += 1) {
      state = advanceSlowStop(state, frame(frozen, at(10, 0) + (100 + i) * DT));
    }
    expect(state.display).toBe(frozen);
  });

  it("nowMs = NaN / Infinity：当帧直接落到真实值，不抛异常", () => {
    const target = 12_345n * 10n ** 18n;
    let state = createSlowStopState();
    state = advanceSlowStop(state, frame(target, at(10, 0)));
    const nan = advanceSlowStop(state, frame(target, Number.NaN));
    expect(nan.display).toBe(target);
    const inf = advanceSlowStop(state, frame(target, Number.POSITIVE_INFINITY));
    expect(inf.display).toBe(target);
  });

  it("deadlineMs = NaN：当成没有停顿点（退化成直接跟随）", () => {
    const state = advanceSlowStop(createSlowStopState(), frame(0n, at(17, 59, 59)));
    const next = advanceSlowStop(state, frame(10n ** 18n, at(17, 59, 59) + DT, Number.NaN));
    expect(next.display).toBeGreaterThanOrEqual(0n);
    expect(next.display).toBeLessThanOrEqual(10n ** 18n);
  });

  it("同一毫秒连来两帧（dt = 0）：不发散、不倒退", () => {
    const start = at(10, 0);
    let state = advanceSlowStop(createSlowStopState(), frame(targetAt(BASE, start), start));
    const before = state.display;
    state = advanceSlowStop(state, frame(targetAt(BASE, start), start));
    expect(state.display).toBe(before);
  });

  it("时间回拨（nowMs 变小）：不倒退、不出负数、下一帧照常收敛", () => {
    const start = at(10, 0);
    let state = advanceSlowStop(createSlowStopState(), frame(targetAt(BASE, start), start));
    for (let i = 1; i <= 10; i += 1) {
      state = advanceSlowStop(state, frame(targetAt(BASE, start + i * DT), start + i * DT));
    }
    const before = state.display;
    const back = advanceSlowStop(state, frame(targetAt(BASE, start + 10 * DT), start + 5 * DT));
    expect(back.display).toBeGreaterThanOrEqual(before);
    const forward = advanceSlowStop(back, frame(targetAt(BASE, start + 11 * DT), start + 11 * DT));
    expect(forward.display).toBeLessThanOrEqual(targetAt(BASE, start + 11 * DT));
  });

  it("帧率变化（1ms / 500ms 一帧）：不抛异常、不越过真实值、停住后精确相等", () => {
    for (const dt of [1, 500]) {
      const start = at(17, 59, 55);
      const rows = run(BASE, start, Math.ceil((SLOW_MS + GLIDE_MS + 2_000) / dt), { dt });
      for (const row of rows) {
        expect(row.display).toBeGreaterThanOrEqual(0n);
        expect(row.display).toBeLessThanOrEqual(row.target);
      }
      const last = rows[rows.length - 1];
      expect(last.display).toBe(last.target);
    }
  });
});

describe("slowStop：10 分钟 60fps 长跑不漂移", () => {
  it("跨过下班点后连跑 10 分钟，显示值与真实值之差恒为 0", () => {
    const start = at(17, 59, 0);
    const rows = run(BASE, start, 10 * 60 * 60); // 10 分钟 × 60fps
    const last = rows[rows.length - 1];
    expect(last.nowMs).toBeGreaterThan(at(18, 0) + GLIDE_MS);
    expect(last.gap).toBe(0n);
    expect(last.display).toBe(last.target);
    // 滑停窗口走完之后每一帧都精确相等（不是最后一帧才凑巧相等）。
    const settledAt = Math.ceil((at(18, 0) + GLIDE_MS - start) / DT) + 1;
    for (const row of rows.slice(settledAt)) expect(row.gap).toBe(0n);
  }, 30_000);
});

describe("slowStop：停顿点推算与引擎一致", () => {
  it("按班表给出下一个停顿点", () => {
    expect(stallDeadlineMs(BASE, at(8, 0))).toBe(at(9, 0));
    expect(stallDeadlineMs(BASE, at(9, 0))).toBe(at(12, 0));
    expect(stallDeadlineMs(BASE, at(10, 0))).toBe(at(12, 0));
    expect(stallDeadlineMs(BASE, at(12, 30))).toBe(at(13, 0));
    expect(stallDeadlineMs(BASE, at(14, 0))).toBe(at(18, 0));
    expect(stallDeadlineMs(BASE, at(18, 30))).toBeNull();
  });

  it("加班模式：下一个停顿点是次日 0 点（跨天金额归零）", () => {
    const overtime = { ...BASE, overtimeMode: true };
    expect(stallDeadlineMs(overtime, at(18, 30))).toBe(at(24, 0));
    expect(stallDeadlineMs(overtime, at(23, 0))).toBe(at(24, 0));
  });

  it("没有午休 / 午休配错：直接以下班点为停顿点", () => {
    const noLunch = { ...BASE, lunchStartMin: null, lunchEndMin: null };
    expect(stallDeadlineMs(noLunch, at(10, 0))).toBe(at(18, 0));
    const badLunch = { ...BASE, lunchStartMin: 13 * 60, lunchEndMin: 12 * 60 };
    expect(stallDeadlineMs(badLunch, at(10, 0))).toBe(at(18, 0));
  });

  it("配置错误（下班点 ≤ 上班点）：没有停顿点", () => {
    const broken = { ...BASE, workStartMin: 18 * 60, workEndMin: 9 * 60 };
    expect(stallDeadlineMs(broken, at(10, 0))).toBeNull();
  });

  it("时刻非法：没有停顿点（NaN 兜底）", () => {
    expect(stallDeadlineMs(BASE, Number.NaN)).toBeNull();
  });

  it("与引擎 phaseOf 的时段划分一致：停顿点前后跨过一个阶段边界", () => {
    for (const hour of [8, 9, 11, 12, 13, 17, 18, 20]) {
      const nowMs = at(hour, 30);
      const deadline = stallDeadlineMs(BASE, nowMs);
      if (deadline === null) continue;
      expect(phaseOf(BASE, deadline - 1)).not.toBe(phaseOf(BASE, deadline));
    }
  });
});

describe("slowStop：atomsOfMoney 还原 ticker 回调里的真实值", () => {
  it("18 位档就是引擎 atoms 原值（含千分位、前导零）", () => {
    const atoms = 1_234_567_890_123_456_789n;
    expect(atomsOfMoney(formatAtoms(atoms, 18), 18)).toBe(atoms);
    expect(atomsOfMoney({ int: "0", frac: "000000000000000001" }, 18)).toBe(1n);
    expect(atomsOfMoney({ int: "1,000", frac: "0" }, 18)).toBe(1_000n * 10n ** 18n);
  });

  it("12 / 6 位档：还原成该档分辨率上的值（显示层只在自己能显示的位数上工作）", () => {
    const atoms = 123_456_789_012_345_678_901n;
    expect(atomsOfMoney(formatAtoms(atoms, 12), 12)).toBe((atoms / 10n ** 6n) * 10n ** 6n);
    expect(atomsOfMoney(formatAtoms(atoms, 6), 6)).toBe((atoms / 10n ** 12n) * 10n ** 12n);
  });
});
