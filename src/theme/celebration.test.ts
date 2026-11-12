import { describe, expect, it, vi } from "vitest";
import {
  CELEBRATION_STEP,
  CELEBRATION_VISIBLE_MS,
  createCelebrationTimer,
  crossedMultiple,
  floorDiv,
} from "./celebration";

describe("crossedMultiple：20 元台阶的跨越判定", () => {
  it("第一帧只建立基线，不触发", () => {
    expect(crossedMultiple(null, 0n, CELEBRATION_STEP)).toBe(false);
    expect(crossedMultiple(null, 999n, CELEBRATION_STEP)).toBe(false);
  });

  it("跨过 1 个 20 元台阶就触发一次（19 → 20）", () => {
    expect(crossedMultiple(19n, 20n, CELEBRATION_STEP)).toBe(true);
    expect(crossedMultiple(0n, 20n, CELEBRATION_STEP)).toBe(true);
  });

  it("一帧跨过多个台阶同样只算一次（5 → 65）", () => {
    expect(crossedMultiple(5n, 65n, CELEBRATION_STEP)).toBe(true);
    expect(crossedMultiple(0n, 200n, CELEBRATION_STEP)).toBe(true);
  });

  it("没有跨过台阶不触发（同台阶内 / 停在同一倍 / 变小）", () => {
    expect(crossedMultiple(20n, 21n, CELEBRATION_STEP)).toBe(false);
    expect(crossedMultiple(39n, 39n, CELEBRATION_STEP)).toBe(false);
    expect(crossedMultiple(40n, 39n, CELEBRATION_STEP)).toBe(false);
    expect(crossedMultiple(45n, 44n, CELEBRATION_STEP)).toBe(false);
    expect(crossedMultiple(0n, 0n, CELEBRATION_STEP)).toBe(false);
  });

  it("金额变成负数（重置 / 倒扣）时按数学 floor 判定，不误触发", () => {
    // floor(-30/20) = -2 → floor(-10/20) = -1：确实跨过了一个台阶。
    expect(crossedMultiple(-30n, -10n, CELEBRATION_STEP)).toBe(true);
    // -5 → -10：都落在 -1 这一格里，不算跨过。
    expect(crossedMultiple(-5n, -10n, CELEBRATION_STEP)).toBe(false);
    // 从负数回到 0：跨过 0 这一道台阶。
    expect(crossedMultiple(-1n, 0n, CELEBRATION_STEP)).toBe(true);
    // 正数掉回负数：台阶变小，不触发。
    expect(crossedMultiple(10n, -10n, CELEBRATION_STEP)).toBe(false);
  });

  it("台阶非法（0 / 负数 / 非有限）时一律不触发", () => {
    expect(crossedMultiple(0n, 100n, 0)).toBe(false);
    expect(crossedMultiple(0n, 100n, -20)).toBe(false);
    expect(crossedMultiple(0n, 100n, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("floorDiv 是数学 floor，不是 BigInt 的向零截断", () => {
    expect(floorDiv(-30n, 20n)).toBe(-2n);
    expect(floorDiv(-10n, 20n)).toBe(-1n);
    expect(floorDiv(-20n, 20n)).toBe(-1n);
    expect(floorDiv(39n, 20n)).toBe(1n);
    expect(floorDiv(40n, 20n)).toBe(2n);
  });

  it("露出时长是 4000ms（具名常量，不散落字面量）", () => {
    expect(CELEBRATION_VISIBLE_MS).toBe(4000);
  });
});

describe("createCelebrationTimer：重新计时而不是提前收", () => {
  it("到点只收一次", () => {
    vi.useFakeTimers();
    const hide = vi.fn();
    const timer = createCelebrationTimer(hide);
    timer.arm();
    vi.advanceTimersByTime(CELEBRATION_VISIBLE_MS - 1);
    expect(hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hide).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CELEBRATION_VISIBLE_MS * 3);
    expect(hide).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("露出期间再触发一次（第 2 秒）→ 重新计时，第 4 秒不收，第 6 秒才收", () => {
    vi.useFakeTimers();
    const hide = vi.fn();
    const timer = createCelebrationTimer(hide);
    timer.arm(); // t=0
    vi.advanceTimersByTime(2000);
    timer.arm(); // t=2000：重新数 4000ms
    vi.advanceTimersByTime(2000); // t=4000：原本到点，现在不收
    expect(hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1999); // t=5999
    expect(hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); // t=6000
    expect(hide).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("disarm 之后到点也不收（组件卸载不留残余定时器）", () => {
    vi.useFakeTimers();
    const hide = vi.fn();
    const timer = createCelebrationTimer(hide);
    timer.arm();
    timer.disarm();
    vi.advanceTimersByTime(CELEBRATION_VISIBLE_MS + 1000);
    expect(hide).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
