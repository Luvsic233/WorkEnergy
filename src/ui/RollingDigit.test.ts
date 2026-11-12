import { describe, expect, it } from "vitest";
import { digitColumnAt, digitColumns } from "../core/format";
import {
  CARRY_MS,
  PITCH_EM,
  carryProgress,
  fracIndex,
  fracOffsetEm,
  isOnGrid,
  motionAt,
  motionIndexAt,
} from "./RollingDigit";

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

describe("小数位：位移就是 digit + progress", () => {
  // 覆盖两端与乱位：0、最小单位、整十年、一个"什么位都非零"的随机值。
  const samples = [
    0n,
    1n,
    9n,
    12_345n,
    250_000_000_000_000_000n,
    1_000_000_000_000_000_000n,
    12_345_678_901_234_567_890n,
  ];

  it("matches digit + progress for every fractional position, straight from the atoms", () => {
    for (const abs of samples) {
      for (let d = 1; d <= 18; d += 1) {
        const exponent = 18 - d;
        const unit = 10n ** BigInt(exponent);
        const column = digitColumnAt(abs, exponent);

        expect(column.digit).toBe(Number((abs / unit) % 10n));
        expect(column.progress).toBeCloseTo(Number(((abs % unit) * 1_000_000n) / unit) / 1_000_000, 12);
        expect(column.progress).toBeGreaterThanOrEqual(0);
        expect(column.progress).toBeLessThan(1);

        // 位移 = -(digit + progress) × PITCH_EM，progress ∈ [0,1) 保证它永远在两格之间
        expect(fracIndex(column)).toBeCloseTo(column.digit + column.progress, 12);
        expect(fracIndex(column)).toBeGreaterThanOrEqual(column.digit);
        expect(fracIndex(column)).toBeLessThan(column.digit + 1);
        expect(fracOffsetEm(column)).toBeCloseTo(-(column.digit + column.progress) * PITCH_EM, 12);
      }
    }
  });

  it("never leaves the 19-glyph strip: the offset stays inside [-10, 0) 格", () => {
    for (const abs of samples) {
      for (let d = 1; d <= 18; d += 1) {
        const offset = fracOffsetEm(digitColumnAt(abs, 18 - d));
        expect(offset).toBeLessThanOrEqual(0);
        expect(offset).toBeGreaterThan(-10 * PITCH_EM);
      }
    }
  });

  it("advances monotonically with a constant step while the atoms grow inside one decade", () => {
    const unit = 10n ** 17n; // 十分位的一格
    const base = 5n * unit; // 恰好停在数字 5 上，progress = 0
    const stepSize = unit / 50n; // 每次前进 0.02 格

    let previous = fracOffsetEm(digitColumnAt(base, 17));
    expect(previous).toBeCloseTo(-5 * PITCH_EM, 12);

    const deltas: number[] = [];
    for (let step = 1; step <= 40; step += 1) {
      const offset = fracOffsetEm(digitColumnAt(base + BigInt(step) * stepSize, 17));
      expect(offset).toBeLessThan(previous); // 每步都在动，永不停住
      deltas.push(offset - previous);
      previous = offset;
    }

    const mean = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
    expect(mean).toBeCloseTo(-0.02 * PITCH_EM, 9);
    // 步长恒定：不会出现"一段快滚 + 一段完全不变"的节拍
    const variance = deltas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / deltas.length;
    expect(variance).toBeLessThan(1e-12);
  });

  it("sits exactly on a grid only when the atoms are a whole multiple of that unit", () => {
    const unit = 10n ** 15n;
    expect(fracIndex(digitColumnAt(3n * unit, 15))).toBe(3); // 整格
    // progress 只保留 6 位，所以对比 1/1000 格的偏移（1 个 atom 落在 1e-15 格的量化精度之下）
    expect(Number.isInteger(fracIndex(digitColumnAt(3n * unit + unit / 1_000n, 15)))).toBe(false);
  });

  it("ignores the sign of the amount: the positions are split from |atoms|", () => {
    const positive = digitColumns(12_345_678_901n, 18).frac.map((column) => fracOffsetEm(column));
    const negative = digitColumns(-12_345_678_901n, 18).frac.map((column) => fracOffsetEm(column));
    expect(negative).toEqual(positive);
  });

  it("has no sub-progress on the last decimal place: its unit is the atom itself", () => {
    for (const abs of samples) {
      expect(digitColumnAt(abs, 0).progress).toBe(0);
      expect(digitColumnAt(abs, 0).digit).toBe(Number(abs % 10n));
    }
  });
});
