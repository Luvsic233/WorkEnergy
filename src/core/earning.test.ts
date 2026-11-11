import { describe, expect, it } from "vitest";
import {
  ATOMS_PER_YUAN,
  earnedAtoms,
  isMisconfigured,
  paidMsOf,
  parseClock,
  parseMicro,
  parseSettings,
  phaseOf,
} from "./earning";
import { formatAtoms } from "./format";

const MIN = 60_000;
const HOUR = 3_600_000;
const base = parseSettings({ salary: "10000" });

function at(hours: number, minutes = 0, seconds = 0, ms = 0): number {
  return new Date(2026, 0, 6, hours, minutes, seconds, ms).getTime();
}

function atomsToNumber(atoms: bigint): number {
  const negative = atoms < 0n;
  const abs = negative ? -atoms : atoms;
  const frac = (abs % ATOMS_PER_YUAN).toString().padStart(18, "0");
  return Number(`${negative ? "-" : ""}${abs / ATOMS_PER_YUAN}.${frac}`);
}

describe("config parsing (no parseFloat anywhere)", () => {
  it("turns decimal strings into micro integers", () => {
    expect(parseMicro("21.75")).toBe(21_750_000n);
    expect(parseMicro("8")).toBe(8_000_000n);
    expect(parseMicro("10000")).toBe(10_000_000_000n);
    expect(parseMicro("0.000001")).toBe(1n);
    expect(parseMicro("21.750000")).toBe(21_750_000n);
    expect(parseSettings({ salary: "10000" })).toMatchObject({
      salaryMicro: 10_000_000_000n,
      payDaysMicro: 21_750_000n,
      hoursMicro: 8_000_000n,
      workStartMin: 540,
      workEndMin: 1080,
      lunchStartMin: 720,
      lunchEndMin: 780,
      overtimeMode: false,
    });
  });

  it("rejects malformed decimals", () => {
    expect(() => parseMicro("1.2345678")).toThrow();
    expect(() => parseMicro("abc")).toThrow();
    expect(() => parseMicro("-5")).toThrow();
    expect(() => parseMicro("")).toThrow();
  });

  it("turns clock strings into minutes of day", () => {
    expect(parseClock("09:00")).toBe(540);
    expect(parseClock("18:05")).toBe(1085);
    expect(parseClock("00:00")).toBe(0);
    expect(() => parseClock("24:00")).toThrow();
  });
});

describe("paidMsOf", () => {
  it("is zero before the workday starts", () => {
    expect(paidMsOf(base, at(8, 59, 59, 999))).toBe(0);
    expect(paidMsOf(base, at(9, 0))).toBe(0);
  });

  it("counts elapsed work time", () => {
    expect(paidMsOf(base, at(9, 30))).toBe(30 * MIN);
    expect(paidMsOf(base, at(11, 0))).toBe(2 * HOUR);
  });

  it("deducts the lunch break", () => {
    expect(paidMsOf(base, at(12, 30))).toBe(3 * HOUR);
    expect(paidMsOf(base, at(13, 0))).toBe(3 * HOUR);
    expect(paidMsOf(base, at(13, 30))).toBe(3 * HOUR + 30 * MIN);
    expect(paidMsOf(base, at(15, 15))).toBe(5 * HOUR + 15 * MIN);
  });

  it("freezes at the end of the workday", () => {
    expect(paidMsOf(base, at(18, 0))).toBe(8 * HOUR);
    expect(paidMsOf(base, at(19, 0))).toBe(8 * HOUR);
    expect(paidMsOf(base, at(23, 59, 59, 999))).toBe(8 * HOUR);
  });

  it("keeps accruing after hours in overtime mode", () => {
    const overtime = { ...base, overtimeMode: true };
    expect(paidMsOf(overtime, at(18, 0))).toBe(8 * HOUR);
    expect(paidMsOf(overtime, at(19, 30))).toBe(8 * HOUR + 90 * MIN);
    expect(phaseOf(overtime, at(19, 30))).toBe("加班");
  });

  it("can disable the lunch break", () => {
    const noLunch = { ...base, lunchStartMin: null, lunchEndMin: null };
    expect(paidMsOf(noLunch, at(12, 30))).toBe(3 * HOUR + 30 * MIN);
    expect(paidMsOf(noLunch, at(18, 0))).toBe(9 * HOUR);
  });

  it("treats end <= start as a configuration error and pays zero", () => {
    const broken = { ...base, workStartMin: 18 * 60, workEndMin: 9 * 60 };
    expect(isMisconfigured(broken)).toBe(true);
    expect(paidMsOf(broken, at(12, 0))).toBe(0);
    expect(earnedAtoms(broken, 8 * HOUR)).toBe(0n);
    expect(phaseOf(broken, at(12, 0))).toBe("配置错误");
  });

  it("reports the current phase", () => {
    expect(phaseOf(base, at(8, 0))).toBe("未到上班时间");
    expect(phaseOf(base, at(10, 0))).toBe("在岗");
    expect(phaseOf(base, at(12, 10))).toBe("午休");
    expect(phaseOf(base, at(19, 0))).toBe("已下班");
  });
});

describe("earnedAtoms precision", () => {
  it("matches the 1 hour vector: 10000 / 21.75 / 8 => 10000 / 174", () => {
    const atoms = earnedAtoms(base, HOUR);
    expect(atoms).toBe((10_000n * ATOMS_PER_YUAN) / 174n);
    expect(Math.abs(atomsToNumber(atoms) - 10000 / 174)).toBeLessThan(1e-15);
    expect(formatAtoms(atoms)).toEqual({ int: "57", frac: "471264367816091954" });
  });

  it("does not drift: 3600 one-second ticks equal one 3600 second jump", () => {
    const start = at(9, 0);
    let paidMs = 0;
    for (let tick = 1; tick <= 3600; tick += 1) {
      paidMs = paidMsOf(base, start + tick * 1000);
    }
    expect(paidMs).toBe(HOUR);
    expect(earnedAtoms(base, paidMs)).toBe(earnedAtoms(base, HOUR));
    expect(formatAtoms(earnedAtoms(base, paidMs))).toEqual(formatAtoms(earnedAtoms(base, HOUR)));
  });

  it("shows why atoms are derived from integer paidMs instead of summed per tick", () => {
    const perTick = earnedAtoms(base, 1000);
    let summed = 0n;
    for (let tick = 0; tick < 3600; tick += 1) summed += perTick;
    expect(summed).not.toBe(earnedAtoms(base, HOUR));
  });

  it("keeps the full workday exact to the closed form", () => {
    expect(earnedAtoms(base, 0)).toBe(0n);
    expect(earnedAtoms(base, -5)).toBe(0n);
    expect(earnedAtoms(base, 8 * HOUR)).toBe((10_000n * 8n * ATOMS_PER_YUAN) / 174n);
    expect(formatAtoms(earnedAtoms(base, 8 * HOUR))).toEqual({ int: "459", frac: "770114942528735632" });
  });
});

describe("formatAtoms", () => {
  it("prints eighteen decimals from BigInt without touching Number", () => {
    expect(formatAtoms(0n)).toEqual({ int: "0", frac: "000000000000000000" });
    expect(formatAtoms(1n)).toEqual({ int: "0", frac: "000000000000000001" });
    expect(formatAtoms(1_000_000n)).toEqual({ int: "0", frac: "000000000001000000" });
    expect(formatAtoms(ATOMS_PER_YUAN)).toEqual({ int: "1", frac: "000000000000000000" });
    expect(formatAtoms(123_456_789_012_345_678_901n)).toEqual({ int: "123", frac: "456789012345678901" });
    expect(formatAtoms(1_234_567_890n * ATOMS_PER_YUAN)).toEqual({ int: "1,234,567,890", frac: "000000000000000000" });
    // 1e-18 元是本机芯的最小单位，所以 18 位就是上限：再多的原子也只是整数部分的进位。
    expect(formatAtoms(ATOMS_PER_YUAN - 1n)).toEqual({ int: "0", frac: "999999999999999999" });
  });
});
