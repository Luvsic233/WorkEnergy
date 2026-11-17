import { describe, expect, it } from "vitest";
import { parseSettings, type Settings } from "../core/earning";
import { lunchRatiosOf, timelineGeometry } from "./timeline";

/** 本地时区的某一天某个钟点（时间轴读的是本地挂钟）。 */
function at(hours: number, minutes: number, seconds = 0): number {
  return new Date(2024, 4, 20, hours, minutes, seconds, 0).getTime();
}

const base = parseSettings({ salary: "10000" });

describe("timelineGeometry：左端 workStart，右端 workEnd", () => {
  it("sits at 0 and reports before when the shift has not started", () => {
    // 午休缺口是"今天这条轴"的一部分，还没上班时也照样画出来。
    expect(timelineGeometry(base, at(8, 30))).toMatchObject({ progress: 0, state: "before" });
    expect(timelineGeometry(base, at(8, 30)).lunchStartRatio).toBeCloseTo(1 / 3, 6);
  });

  it("sits at exactly 0 on the first working second", () => {
    const geometry = timelineGeometry(base, at(9, 0));
    expect(geometry.state).toBe("working");
    expect(geometry.progress).toBe(0);
  });

  it("walks the middle of the track while working", () => {
    // 09:00–18:00 共 9 小时，13:30 是 4.5 小时 → 50%
    const geometry = timelineGeometry(base, at(13, 30));
    expect(geometry.state).toBe("working");
    expect(geometry.progress).toBeCloseTo(0.5, 6);
  });

  it("stops at 1 and reports after exactly at workEnd", () => {
    const geometry = timelineGeometry(base, at(18, 0));
    expect(geometry.state).toBe("after");
    expect(geometry.progress).toBe(1);
  });

  it("stays at 1 after work (and while on overtime)", () => {
    expect(timelineGeometry(base, at(23, 30))).toMatchObject({ progress: 1, state: "after" });
    const overtime: Settings = { ...base, overtimeMode: true };
    expect(timelineGeometry(overtime, at(20, 0))).toMatchObject({ progress: 1, state: "after" });
  });

  it("reports lunch and keeps the dot inside the lunch gap", () => {
    const geometry = timelineGeometry(base, at(12, 30));
    expect(geometry.state).toBe("lunch");
    // 12:00 → 1/3，13:00 → 4/9，12:30 正好在缺口之间
    expect(geometry.lunchStartRatio).toBeCloseTo(1 / 3, 6);
    expect(geometry.lunchEndRatio).toBeCloseTo(4 / 9, 6);
    expect(geometry.progress).toBeGreaterThan(geometry.lunchStartRatio as number);
    expect(geometry.progress).toBeLessThan(geometry.lunchEndRatio as number);
  });

  it("still reports lunch at the first lunch second, and working one second before", () => {
    expect(timelineGeometry(base, at(11, 59, 59)).state).toBe("working");
    expect(timelineGeometry(base, at(12, 0, 0)).state).toBe("lunch");
  });
});

describe("timelineGeometry：午休缺口", () => {
  it("has no gap when lunch is turned off", () => {
    const noLunch: Settings = { ...base, lunchStartMin: null, lunchEndMin: null };
    const geometry = timelineGeometry(noLunch, at(12, 30));
    expect(geometry.lunchStartRatio).toBeNull();
    expect(geometry.lunchEndRatio).toBeNull();
    // 没有午休窗口，12:30 就是普通在岗
    expect(geometry.state).toBe("working");
  });

  it("has no gap when the lunch window is inside out", () => {
    const broken: Settings = { ...base, lunchStartMin: 13 * 60, lunchEndMin: 12 * 60 };
    expect(lunchRatiosOf(broken)).toBeNull();
  });

  it("clamps a lunch window that falls outside the shift", () => {
    // 上班 09:00 / 下班 18:00，午休 07:00–08:00 完全在班前 → 缺口钳在 0，宽度为 0 于是不画
    const early: Settings = { ...base, lunchStartMin: 7 * 60, lunchEndMin: 8 * 60 };
    expect(lunchRatiosOf(early)).toBeNull();
    // 午休 17:00–20:00 跨过下班：缺口从 8/9 到 1
    const late: Settings = { ...base, lunchStartMin: 17 * 60, lunchEndMin: 20 * 60 };
    expect(lunchRatiosOf(late)).toEqual({ from: 8 / 9, to: 1 });
  });
});

describe("timelineGeometry：坏输入一律兜底，绝不产生 NaN", () => {
  it("returns the resting geometry for contradictory settings", () => {
    const broken: Settings = { ...base, workEndMin: 9 * 60 };
    expect(timelineGeometry(broken, at(12, 0))).toEqual({
      progress: 0,
      lunchStartRatio: null,
      lunchEndRatio: null,
      state: "before",
    });
  });

  it("returns the resting geometry for an invalid timestamp", () => {
    expect(timelineGeometry(base, Number.NaN)).toMatchObject({ progress: 0, state: "before" });
  });
});
