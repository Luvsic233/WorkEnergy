import { describe, expect, it } from "vitest";
import {
  ATOMS_PER_YUAN,
  DEFAULT_OVERTIME_PAY,
  earnedAtoms,
  fixedTotalDue,
  isMisconfigured,
  normalPaidMsCap,
  overtimePayOf,
  paidMsOf,
  parseClock,
  parseMicro,
  parseSettings,
  phaseOf,
  splitPaidMs,
  type OvertimePay,
  type Settings,
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


/* ────────────────────────── 加班计薪三种方式 ────────────────────────── */

/** 三种方式的构造器：数值一律微单位（1_500_000 = 1.5 倍 / 60 元 / 200 元）。 */
const MULT = (valueMicro: bigint): OvertimePay => ({ mode: "multiplier", valueMicro });
const HOURLY = (valueMicro: bigint): OvertimePay => ({ mode: "fixedHourly", valueMicro });
const TOTAL = (valueMicro: bigint): OvertimePay => ({ mode: "fixedTotal", valueMicro });

const MULT_15 = MULT(1_500_000n);
const MULT_10 = MULT(1_000_000n);
const MULT_50 = MULT(5_000_000n);
const HOURLY_60 = HOURLY(60_000_000n);
const TOTAL_200 = TOTAL(200_000_000n);

const BONUS_200 = 200n * ATOMS_PER_YUAN;

/** 勾上加班的 settings（工资口径沿用 base：10000 / 21.75 天 / 8 小时 / 09:00–18:00 / 午休一小时）。 */
function withOvertime(pay: OvertimePay, over: Partial<Settings> = {}): Settings {
  return { ...base, overtimeMode: true, overtime: pay, ...over };
}

function earnedNow(settings: Settings, clock: number): bigint {
  return earnedAtoms(settings, paidMsOf(settings, clock));
}

describe("加班计薪：同一时刻三种方式的金额", () => {
  it("prices 8h + 1h overtime at 19:00 three different ways", () => {
    const clock = at(19, 0);
    // 正常 8 小时 459.770114942528735632 元，加班 1 小时：
    //   ×1.5 → 86.206896551724137931 元；固定 60 元/小时 → 60 元；固定总额 → 200 元一次性
    expect(earnedNow(withOvertime(MULT_15), clock)).toBe(545_977_011_494_252_873_563n);
    expect(earnedNow(withOvertime(HOURLY_60), clock)).toBe(519_770_114_942_528_735_632n);
    expect(earnedNow(withOvertime(TOTAL_200), clock)).toBe(717_241_379_310_344_827_586n);
  });

  it("splits the very same paid milliseconds into 8h normal + 1h overtime for all three modes", () => {
    for (const pay of [MULT_15, HOURLY_60, TOTAL_200]) {
      const settings = withOvertime(pay);
      const paidMs = paidMsOf(settings, at(19, 0));
      expect(paidMs).toBe(9 * HOUR);
      expect(normalPaidMsCap(settings)).toBe(8 * HOUR);
      expect(splitPaidMs(settings, paidMs)).toEqual({ normalMs: 8 * HOUR, overtimeMs: HOUR });
    }
  });

  it("does one division over accumulated integer milliseconds (no float accumulation)", () => {
    // 独立复算：正常 8 小时 + 加班 1 小时 ×1.5，分子写成 10000 * 8 / 174 与 10000 * 3 / (174 * 2)
    const normal8h = (10_000n * 8n * ATOMS_PER_YUAN) / 174n;
    const overtime1h = (10_000n * 3n * ATOMS_PER_YUAN) / (174n * 2n);
    expect(earnedAtoms(withOvertime(MULT_15), 9 * HOUR)).toBe(normal8h + overtime1h);
    // 逐毫秒累加一定小于「一处整除」（这正是「先累加毫秒再除」的证据）
    let summed = 0n;
    for (let tick = 0; tick < 1000; tick += 1) summed += earnedAtoms(withOvertime(MULT_15), 1);
    expect(summed).not.toBe(earnedAtoms(withOvertime(MULT_15), 1000));
  });
});

describe("加班计薪：边界", () => {
  it("treats multiplier 1.0 as exactly the normal rate", () => {
    // 8h 正常 + 1h 加班各按正常时薪：与「没有加班加成」的时段金额一致
    expect(earnedNow(withOvertime(MULT_10), at(19, 0))).toBe(517_241_379_310_344_827_586n);
    // 固定总额的时段部分就是 1.0 倍，两者之间只差那一次性的一笔
    expect(earnedNow(withOvertime(TOTAL_200), at(19, 0)) - earnedNow(withOvertime(MULT_10), at(19, 0))).toBe(
      BONUS_200,
    );
  });

  it("accepts multiplier 5.0 as the top of the range and grows strictly from 1.0 / 1.5", () => {
    const five = earnedNow(withOvertime(MULT_50), at(19, 0));
    expect(five).toBe(747_126_436_781_609_195_402n);
    expect(five).toBeGreaterThan(earnedNow(withOvertime(MULT_15), at(19, 0)));
    expect(earnedNow(withOvertime(MULT_15), at(19, 0))).toBeGreaterThan(earnedNow(withOvertime(MULT_10), at(19, 0)));
  });

  it("falls back to the default 1.5x instead of paying zero or a negative rate", () => {
    const broken: OvertimePay[] = [
      MULT(0n),
      MULT(-1n),
      HOURLY(0n),
      TOTAL(0n),
      MULT(9_000_000n),
      { mode: "percent", valueMicro: 1_500_000n } as unknown as OvertimePay,
    ];
    for (const pay of broken) {
      const settings = withOvertime(pay);
      expect(overtimePayOf(settings)).toEqual(DEFAULT_OVERTIME_PAY);
      expect(earnedNow(settings, at(19, 0))).toBe(545_977_011_494_252_873_563n);
    }
  });

  it("pays all three modes exactly the same before the workday ends", () => {
    const before = at(17, 0);
    for (const pay of [MULT_15, MULT_10, MULT_50, HOURLY_60, TOTAL_200]) {
      expect(earnedNow(withOvertime(pay), before)).toBe(402_298_850_574_712_643_678n);
    }
    // 连「没勾加班模式」也是同一个数：加班计薪只在下班之后才存在
    expect(earnedNow({ ...base, overtime: MULT_15 }, before)).toBe(402_298_850_574_712_643_678n);
  });
});

describe("固定总额：下班那一刻一次性到账", () => {
  it("adds the bonus exactly at the end-of-workday instant, not one millisecond earlier", () => {
    const total = withOvertime(TOTAL_200);
    const baseline = withOvertime(MULT_10);
    expect(earnedNow(total, at(17, 59, 59, 999)) - earnedNow(baseline, at(17, 59, 59, 999))).toBe(0n);
    expect(fixedTotalDue(total, paidMsOf(total, at(17, 59, 59, 999)))).toBe(false);
    expect(fixedTotalDue(total, paidMsOf(total, at(18, 0)))).toBe(true);
  });

  it("keeps the bonus a constant one-off on every later instant (never doubled)", () => {
    const total = withOvertime(TOTAL_200);
    const baseline = withOvertime(MULT_10);
    for (const clock of [at(18, 0), at(18, 0, 0, 1), at(18, 30), at(19, 0), at(23, 59, 59, 999)]) {
      expect(earnedNow(total, clock) - earnedNow(baseline, clock)).toBe(BONUS_200);
    }
  });

  it("keeps growing at the normal rate after the bonus landed", () => {
    const total = withOvertime(TOTAL_200);
    // 18:00 → 18:30 只多了半小时正常时薪，没有再蹦一笔 200
    expect(earnedNow(total, at(18, 30)) - earnedNow(total, at(18, 0))).toBe(28_735_632_183_908_045_977n);
  });

  it("is idempotent: the same instant recomputed any number of times pays the same", () => {
    const total = withOvertime(TOTAL_200);
    const paidMs = paidMsOf(total, at(19, 0));
    for (let round = 0; round < 1000; round += 1) {
      expect(earnedAtoms(total, paidMs)).toBe(717_241_379_310_344_827_586n);
    }
    // 跨天：同一时刻的下一天是同一个纯函数值，没有任何跨天累加状态
    expect(earnedNow(total, new Date(2026, 0, 7, 19, 0, 0, 0).getTime())).toBe(717_241_379_310_344_827_586n);
  });

  it("stays off while the overtime switch is off", () => {
    const off: Settings = { ...base, overtime: TOTAL_200 };
    expect(fixedTotalDue(off, 8 * HOUR)).toBe(false);
    expect(earnedNow(off, at(19, 0))).toBe(459_770_114_942_528_735_632n);
  });
});

describe("阶段语义不因计薪方式改变", () => {
  it("keeps 在岗 / 午休 / 加班 / 已下班 identical across the three modes", () => {
    for (const pay of [MULT_15, HOURLY_60, TOTAL_200]) {
      const settings = withOvertime(pay);
      expect(phaseOf(settings, at(8, 0))).toBe("未到上班时间");
      expect(phaseOf(settings, at(10, 0))).toBe("在岗");
      expect(phaseOf(settings, at(12, 30))).toBe("午休");
      expect(phaseOf(settings, at(19, 0))).toBe("加班");
      expect(phaseOf({ ...settings, overtimeMode: false }, at(19, 0))).toBe("已下班");
    }
  });

  it("parses the pay settings out of the plain input contract", () => {
    expect(parseSettings({ salary: "10000" }).overtime).toEqual(DEFAULT_OVERTIME_PAY);
    expect(
      parseSettings({ salary: "10000", overtimePayMode: "fixedHourly", overtimeValue: "60" }).overtime,
    ).toEqual({ mode: "fixedHourly", valueMicro: 60_000_000n });
  });
});
