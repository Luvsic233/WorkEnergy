import { describe, expect, it } from "vitest";
import {
  CARRY_MS,
  PITCH_EM,
  carryProgress,
  fracDistance,
  fracDurationMs,
  fracFrame,
  fracIndexAt,
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

describe("fracDistance / fracDurationMs", () => {
  it("derives d = (new - old + 10) % 10 for every pair of digits", () => {
    for (let from = 0; from <= 9; from += 1) {
      for (let to = 0; to <= 9; to += 1) {
        expect(fracDistance(from, to)).toBe((to - from + 10) % 10);
      }
    }
    // 定几个"人眼可查"的点：永远向上，9→0 只滚一格，0→9 滚满九格
    expect(fracDistance(3, 5)).toBe(2);
    expect(fracDistance(9, 0)).toBe(1);
    expect(fracDistance(0, 9)).toBe(9);
    expect(fracDistance(5, 4)).toBe(9);
    expect(fracDistance(7, 7)).toBe(0);
  });

  it("spends 200ms + 15ms per grid, capped at 340ms", () => {
    expect(fracDurationMs(1)).toBe(215); // 9→0
    expect(fracDurationMs(2)).toBe(230);
    expect(fracDurationMs(5)).toBe(275);
    expect(fracDurationMs(9)).toBe(335); // 最长的一次向上滚
    expect(fracDurationMs(0)).toBe(200);
    // 上限只兜底：d = 10 起（正常状态机不会产生）被钳在 340
    expect(fracDurationMs(10)).toBe(340);
    expect(fracDurationMs(50)).toBe(340);
    for (let d = 0; d <= 9; d += 1) {
      expect(fracDurationMs(d)).toBeLessThanOrEqual(340);
      expect(fracDurationMs(d)).toBeGreaterThanOrEqual(200);
    }
  });
});

describe("fracFrame: 小数位向上滚动", () => {
  it("writes nothing and starts no animation while the digit stays put", () => {
    let motion = fracFrame(null, 7, 0, true);
    expect(motion).toEqual({ from: 7, to: 7, startMs: 0 });
    // 连续 20 次到期帧：d = 0，永远不启动动画，永远精确停在整格
    for (let index = 1; index <= 20; index += 1) {
      const nowMs = index * 1_000;
      const next = fracFrame(motion, 7, nowMs, true);
      expect(next).toEqual({ from: 7, to: 7, startMs: 0 }); // 连 startMs 都不动，没有新一段
      motion = next;
      expect(fracIndexAt(motion, nowMs)).toBe(7);
      expect(-fracIndexAt(motion, nowMs) * PITCH_EM).toBeCloseTo(-7 * PITCH_EM, 12);
    }
  });

  it("rolls upward onto the repeated 0 when 9 carries to 0 and then normalizes", () => {
    const start = 4_000;
    let motion = fracFrame(null, 9, 0, true);
    motion = fracFrame(motion, 0, start, true);
    expect(motion).toEqual({ from: 9, to: 10, startMs: start }); // 向上滚一格到重复的 0

    // 起点在旧格，中途连续推进，终点精确落在重复格 10 上
    expect(fracIndexAt(motion, start)).toBe(9);
    const span = fracDurationMs(1);
    expect(span).toBe(215);
    expect(fracIndexAt(motion, start + span / 2)).toBeCloseTo(9.5, 10);
    expect(fracIndexAt(motion, start + span * 0.25)).toBeCloseTo(9.25, 10);
    expect(fracIndexAt(motion, start + span * 0.75)).toBeCloseTo(9.75, 10);
    expect(fracIndexAt(motion, start + span)).toBe(10);
    expect(-fracIndexAt(motion, start + span) * PITCH_EM).toBeCloseTo(-10 * PITCH_EM, 12);

    // 落地那一刻的下一帧归一：位移回到 -digit × PITCH_EM，不是 -10 × PITCH_EM
    const settled = fracFrame(motion, 0, start + span, true);
    expect(settled).toEqual({ from: 0, to: 0, startMs: start + span });
    expect(Math.abs(-fracIndexAt(settled, start + span) * PITCH_EM)).toBe(0);
  });

  it("rolls d grids for a longer jump and lands exactly on the new grid", () => {
    const start = 10_000;
    let motion = fracFrame(null, 5, 0, true);
    motion = fracFrame(motion, 4, start, true); // d = 9：5 → 4，永远向上绕一圈

    expect(motion).toEqual({ from: 5, to: 14, startMs: start });
    const span = fracDurationMs(9);
    expect(span).toBe(335);
    expect(fracIndexAt(motion, start)).toBe(5);
    expect(fracIndexAt(motion, start + span / 2)).toBeCloseTo(9.5, 10);
    expect(fracIndexAt(motion, start + span)).toBe(14);
    // 落在 14 格，字形 String(14 % 10) === "4"，就是新数字
    expect(String(14 % 10)).toBe("4");
    const settled = fracFrame(motion, 4, start + span, true);
    expect(settled).toEqual({ from: 4, to: 4, startMs: start + span });
    expect(-fracIndexAt(settled, start + span) * PITCH_EM).toBeCloseTo(-4 * PITCH_EM, 12);
  });

  it("never re-targets mid-roll: a change during the animation waits for the landing", () => {
    const start = 1_000;
    let motion = fracFrame(null, 1, 0, true);
    motion = fracFrame(motion, 2, start, true);
    const running = motion;
    // 滚到一半时数字又变了：这一段不被打断（不会跳到半途的另一段）
    const mid = fracFrame(motion, 8, start + 100, true);
    expect(mid).toBe(running);
    // 滚完之后才在下一个到期帧从落点继续向上滚
    const span = fracDurationMs(1);
    const after = fracFrame(motion, 8, start + span, true);
    expect(after).toEqual({ from: 2, to: 8, startMs: start + span });
    expect(fracDurationMs(6)).toBe(290);
  });

  it("holds the roll while a frame is not due and only detects changes on due frames", () => {
    const start = 2_000;
    let motion = fracFrame(null, 3, 0, true);
    // 非到期帧：数字变了也不启动
    for (let index = 1; index <= 10; index += 1) {
      motion = fracFrame(motion, 5, start + index * 16, false);
      expect(motion).toEqual({ from: 3, to: 3, startMs: 0 });
    }
    // 到期帧才启动
    const due = fracFrame(motion, 5, start + 1_000, true);
    expect(due).toEqual({ from: 3, to: 5, startMs: start + 1_000 });
  });

  it("snaps on the very first paint instead of rolling from 0", () => {
    const motion = fracFrame(null, 6, 500, true);
    expect(motion).toEqual({ from: 6, to: 6, startMs: 500 });
    expect(fracIndexAt(motion, 500)).toBe(6);
  });

  it("stays on an exact integer grid at every steady instant, for every digit", () => {
    for (let digit = 0; digit <= 9; digit += 1) {
      const motion = fracFrame(null, digit, 0, true);
      for (let nowMs = 0; nowMs <= 1_000; nowMs += 97) {
        expect(fracIndexAt(motion, nowMs)).toBe(digit);
      }
    }
  });
});
