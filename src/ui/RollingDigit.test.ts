import { describe, expect, it } from "vitest";
import { CARRY_MS, PITCH_EM, carryProgress, isOnGrid, motionAt, motionIndexAt } from "./RollingDigit";

/** 位移（em）：静止时必须等于 -digit × PITCH_EM，也就是恰好一格都不差。 */
function offsetEm(motion: { from: number; to: number; startMs: number }, nowMs: number): number {
  return -motionIndexAt(motion, nowMs) * PITCH_EM;
}

describe("carryProgress", () => {
  it("maps 0 → 1 across CARRY_MS and clamps on both ends", () => {
    expect(carryProgress(0)).toBe(0);
    expect(carryProgress(CARRY_MS / 2)).toBe(0.5);
    expect(carryProgress(CARRY_MS)).toBe(1);
    expect(carryProgress(CARRY_MS * 10)).toBe(1);
    expect(carryProgress(-5)).toBe(0);
  });

  it("keeps the carry inside 260±80ms", () => {
    expect(CARRY_MS).toBeGreaterThanOrEqual(180);
    expect(CARRY_MS).toBeLessThanOrEqual(340);
  });
});

describe("motionAt: 整数位精确落位", () => {
  it("lands straight on the digit grid on the very first paint", () => {
    const motion = motionAt(null, 7, 0);
    expect(motion).toEqual({ from: 7, to: 7, startMs: 0 });
    expect(offsetEm(motion, 0)).toBeCloseTo(-7 * PITCH_EM, 10);
  });

  it("never sits between two grids while the digit stays put", () => {
    let motion = motionAt(null, 4, 1_000);
    // 稳态连续采样 20 次：每次位移都必须精确等于 -digit × PITCH_EM
    for (let index = 1; index <= 20; index += 1) {
      const nowMs = 1_000 + index * 16;
      motion = motionAt(motion, 4, nowMs);
      expect(isOnGrid(motion, nowMs)).toBe(true);
      expect(offsetEm(motion, nowMs)).toBeCloseTo(-4 * PITCH_EM, 10);
    }
  });

  it("rolls exactly one grid when the digit carries by one, then clamps onto the new grid", () => {
    let motion = motionAt(null, 3, 0);
    motion = motionAt(motion, 4, 100); // 低位进位：3 → 4
    expect(motion.from).toBe(3);
    expect(motion.to).toBe(4);

    // 起点在旧格
    expect(motionIndexAt(motion, 100)).toBe(3);
    // 中间连续推进（不是阶跃、也不是停在半格上不动）
    expect(motionIndexAt(motion, 100 + CARRY_MS / 4)).toBeCloseTo(3.25, 10);
    expect(motionIndexAt(motion, 100 + CARRY_MS / 2)).toBeCloseTo(3.5, 10);
    expect(motionIndexAt(motion, 100 + (CARRY_MS * 3) / 4)).toBeCloseTo(3.75, 10);
    // 到点精确落在新整格，之后一直停在整格上
    expect(motionIndexAt(motion, 100 + CARRY_MS)).toBe(4);
    expect(motionIndexAt(motion, 100 + CARRY_MS + 5_000)).toBe(4);
    expect(offsetEm(motion, 100 + CARRY_MS)).toBeCloseTo(-4 * PITCH_EM, 10);

    // 状态机落地后归一成静止态，下一帧不再写新的位移
    const settled = motionAt(motion, 4, 100 + CARRY_MS + 16);
    expect(settled).toEqual({ from: 4, to: 4, startMs: 100 + CARRY_MS + 16 });
    expect(isOnGrid(settled, 100 + CARRY_MS + 16)).toBe(true);
  });

  it("rolls forward onto the repeated 0 when 9 carries to 0", () => {
    let motion = motionAt(null, 9, 0);
    motion = motionAt(motion, 0, 10);
    expect(motion.from).toBe(9);
    expect(motion.to).toBe(10); // 滚条末尾那个重复的 0
    expect(motionIndexAt(motion, 10 + CARRY_MS / 2)).toBeCloseTo(9.5, 10);
    expect(motionIndexAt(motion, 10 + CARRY_MS)).toBe(10);

    // 落地后归一回到 index 0：第 10 格与第 0 格字形相同，看不出跳动
    const settled = motionAt(motion, 0, 10 + CARRY_MS + 16);
    expect(settled).toEqual({ from: 0, to: 0, startMs: 10 + CARRY_MS + 16 });
    expect(Math.abs(offsetEm(settled, 10 + CARRY_MS + 16))).toBe(0);
    expect(isOnGrid(settled, 10 + CARRY_MS + 16)).toBe(true);
  });

  it("snaps instead of rolling when the digit jumps by more than one", () => {
    const motion = motionAt(motionAt(null, 3, 0), 7, 16);
    // 改设置 / 时钟跳变：直接落位，不做多格糊成一片的滚动
    expect(motion).toEqual({ from: 7, to: 7, startMs: 16 });
    expect(motionIndexAt(motion, 16)).toBe(7);
    expect(offsetEm(motion, 16)).toBeCloseTo(-7 * PITCH_EM, 10);
  });

  it("stays on an integer grid for every digit at every steady instant", () => {
    for (let digit = 0; digit <= 9; digit += 1) {
      const motion = motionAt(null, digit, 0);
      for (let nowMs = 0; nowMs <= 1_000; nowMs += 97) {
        expect(motionIndexAt(motion, nowMs)).toBe(digit);
      }
    }
  });
});
