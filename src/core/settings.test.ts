import { describe, expect, it } from "vitest";
import { ATOMS_PER_YUAN, earnedAtoms, parseSettings } from "./earning";
import { formatAtoms, type Decimals } from "./format";
import {
  DECIMALS_OPTIONS,
  DEFAULT_INPUT,
  hourlyAtoms,
  ONE_HOUR_MS,
  REFRESH_HZ_OPTIONS,
  toSettings,
  validateInput,
  type RawInput,
  type RefreshHz,
} from "./settings";

describe("DEFAULT_INPUT", () => {
  it("keeps the daily entry to a single monthly salary and tucks the rest away", () => {
    expect(DEFAULT_INPUT).toEqual({
      salary: "10000",
      payDays: "21.75",
      hours: "8",
      workStart: "09:00",
      workEnd: "18:00",
      lunchEnabled: true,
      lunchStart: "12:00",
      lunchEnd: "13:00",
      overtimeMode: false,
      decimals: 18,
      refreshHz: 1,
    });
  });

  it("is valid and maps onto the earning contract defaults", () => {
    const result = validateInput(DEFAULT_INPUT);
    expect(result.errors).toEqual({});
    expect(result.settings).toEqual(parseSettings({ salary: "10000" }));
  });
});

describe("toSettings: string -> BigInt micro, no float", () => {
  it("turns the decimal strings into micro integers", () => {
    const settings = toSettings(DEFAULT_INPUT);
    expect(settings.salaryMicro).toBe(10_000_000_000n);
    expect(settings.payDaysMicro).toBe(21_750_000n);
    expect(settings.hoursMicro).toBe(8_000_000n);
    expect(settings.workStartMin).toBe(540);
    expect(settings.workEndMin).toBe(1080);
    expect(settings.lunchStartMin).toBe(720);
    expect(settings.lunchEndMin).toBe(780);
    expect(settings.overtimeMode).toBe(false);
  });

  it("maps a fractional salary exactly instead of rounding a float", () => {
    const settings = toSettings({ ...DEFAULT_INPUT, salary: "23456.78", payDays: "21.75", hours: "7.5" });
    expect(settings.salaryMicro).toBe(23_456_780_000n);
    expect(settings.payDaysMicro).toBe(21_750_000n);
    expect(settings.hoursMicro).toBe(7_500_000n);
  });

  it("drops the lunch window when the lunch switch is off", () => {
    const off = { ...DEFAULT_INPUT, lunchEnabled: false, lunchStart: "", lunchEnd: "" };
    const settings = toSettings(off);
    expect(settings.lunchStartMin).toBeNull();
    expect(settings.lunchEndMin).toBeNull();
    expect(validateInput(off).errors).toEqual({});
  });
});

describe("validateInput", () => {
  it("rejects a missing salary", () => {
    for (const empty of ["", "   "]) {
      const result = validateInput({ ...DEFAULT_INPUT, salary: empty });
      expect(result.errors.salary).toBe("月薪不能为空");
      expect(result.settings).toBeNull();
    }
  });

  it("rejects a malformed salary", () => {
    for (const bad of ["abc", "1e5", "10,000", "-1", "1.2345678", "12.3.4", "1234567890123"]) {
      const result = validateInput({ ...DEFAULT_INPUT, salary: bad });
      expect(result.errors.salary).toBe("月薪必须是数字（最多 12 位整数、6 位小数）");
      expect(result.settings).toBeNull();
    }
  });

  it("rejects a zero salary", () => {
    for (const zero of ["0", "0.000000", "0.0"]) {
      const result = validateInput({ ...DEFAULT_INPUT, salary: zero });
      expect(result.errors.salary).toBe("月薪必须大于 0");
      expect(result.settings).toBeNull();
    }
  });

  it("requires payDays and hours to be greater than zero", () => {
    expect(validateInput({ ...DEFAULT_INPUT, payDays: "0" }).errors.payDays).toBe("计薪天数必须大于 0");
    expect(validateInput({ ...DEFAULT_INPUT, hours: "0" }).errors.hours).toBe("日工时必须大于 0");
    expect(validateInput({ ...DEFAULT_INPUT, payDays: "abc" }).errors.payDays).toBe(
      "计薪天数必须是数字（最多 12 位整数、6 位小数）",
    );
    expect(validateInput({ ...DEFAULT_INPUT, hours: "" }).errors.hours).toBe("日工时不能为空");
  });

  it("rejects an end-of-workday that is not later than the start (no overnight shift)", () => {
    for (const end of ["09:00", "08:00", "00:30"]) {
      const result = validateInput({ ...DEFAULT_INPUT, workStart: "09:00", workEnd: end });
      expect(result.errors.workEnd).toBe("下班时间必须晚于上班时间（本版不支持跨夜班）");
      expect(result.settings).toBeNull();
    }
  });

  it("rejects malformed clock strings", () => {
    expect(validateInput({ ...DEFAULT_INPUT, workStart: "9点" }).errors.workStart).toBe(
      "上班时间格式应为 HH:MM（00:00–23:59）",
    );
    expect(validateInput({ ...DEFAULT_INPUT, workStart: "" }).errors.workStart).toBe("上班时间不能为空");
    expect(validateInput({ ...DEFAULT_INPUT, workEnd: "24:00" }).errors.workEnd).toBe(
      "下班时间格式应为 HH:MM（00:00–23:59）",
    );
    expect(validateInput({ ...DEFAULT_INPUT, workStart: "9:5" }).errors.workStart).toBe(
      "上班时间格式应为 HH:MM（00:00–23:59）",
    );
  });

  it("rejects a lunch window whose end is not later than its start", () => {
    for (const end of ["12:00", "11:00"]) {
      const result = validateInput({ ...DEFAULT_INPUT, lunchStart: "12:00", lunchEnd: end });
      expect(result.errors.lunchEnd).toBe("午休结束必须晚于午休开始");
      expect(result.settings).toBeNull();
    }
    expect(validateInput({ ...DEFAULT_INPUT, lunchStart: "12:00", lunchEnd: "nope" }).errors.lunchEnd).toBe(
      "午休结束格式应为 HH:MM（00:00–23:59）",
    );
  });

  it("ignores the lunch fields while the lunch switch is off", () => {
    const off = { ...DEFAULT_INPUT, lunchEnabled: false, lunchStart: "", lunchEnd: "nope" };
    const result = validateInput(off);
    expect(result.errors).toEqual({});
    expect(result.settings?.lunchStartMin).toBeNull();
  });

  it("reports every broken field at once so the panel can pin all of them", () => {
    const result = validateInput({ ...DEFAULT_INPUT, salary: "0", payDays: "0", hours: "0", workEnd: "08:00" });
    expect(Object.keys(result.errors).sort()).toEqual(["hours", "payDays", "salary", "workEnd"]);
    expect(result.settings).toBeNull();
  });
});

describe("hourlyAtoms", () => {
  it("converts 10000 / 21.75 days / 8 hours into 10000/174 yuan per hour", () => {
    const atoms = hourlyAtoms(toSettings(DEFAULT_INPUT));
    expect(atoms).toBe((10_000n * ATOMS_PER_YUAN) / 174n);
    expect(formatAtoms(atoms)).toEqual({ int: "57", frac: "471264367816091954" });
  });

  it("lands exactly on a round number when the divisors divide cleanly", () => {
    const settings = toSettings({ ...DEFAULT_INPUT, salary: "17400" });
    expect(formatAtoms(hourlyAtoms(settings))).toEqual({ int: "100", frac: "000000000000000000" });
  });

  it("agrees with one hour of earnings from the frozen engine", () => {
    const settings = toSettings({ ...DEFAULT_INPUT, salary: "23456.78", payDays: "22", hours: "7.5" });
    expect(hourlyAtoms(settings)).toBe(
      (23_456_780_000n * 1_000_000n * ATOMS_PER_YUAN) / (22_000_000n * 7_500_000n),
    );
    expect(ONE_HOUR_MS).toBe(3_600_000);
    expect(hourlyAtoms(settings)).toBe(earnedAtoms(settings, ONE_HOUR_MS));
  });

  it("is zero when the engine cannot pay (misconfigured guard stays in one place)", () => {
    const broken = { ...toSettings(DEFAULT_INPUT), workEndMin: 60 };
    expect(hourlyAtoms(broken)).toBe(0n);
  });
});

describe("display tiers: decimals + refreshHz", () => {
  it("defaults to 18 digits at 1Hz and offers the tiers in panel order", () => {
    expect(DEFAULT_INPUT.decimals).toBe(18);
    expect(DEFAULT_INPUT.refreshHz).toBe(1);
    expect(DECIMALS_OPTIONS).toEqual([18, 12, 6]);
    expect(REFRESH_HZ_OPTIONS).toEqual([60, 10, 1]);
  });

  it("accepts every offered tier and leaves the earning contract untouched", () => {
    for (const decimals of DECIMALS_OPTIONS) {
      for (const refreshHz of REFRESH_HZ_OPTIONS) {
        const result = validateInput({ ...DEFAULT_INPUT, decimals, refreshHz });
        expect(result.errors).toEqual({});
        expect(result.settings).toEqual(toSettings(DEFAULT_INPUT));
      }
    }
  });

  it("rejects a decimal tier outside 18 / 12 / 6", () => {
    for (const decimals of [0, 3, 5, 9, 13]) {
      const result = validateInput({ ...DEFAULT_INPUT, decimals: decimals as unknown as Decimals });
      expect(result.errors.decimals).toBe("小数位数只能是 18 / 12 / 6");
      expect(result.settings).toBeNull();
    }
  });

  it("rejects a refresh rate outside 60 / 10 / 1", () => {
    for (const refreshHz of [0, 30, 120, -10]) {
      const result = validateInput({ ...DEFAULT_INPUT, refreshHz: refreshHz as unknown as RefreshHz });
      expect(result.errors.refreshHz).toBe("跳动频率只能是 60 / 10 / 1");
      expect(result.settings).toBeNull();
    }
  });

  it("reports a broken display tier next to the other broken fields", () => {
    const broken: RawInput = { ...DEFAULT_INPUT, salary: "0", decimals: 9 as unknown as Decimals, refreshHz: 30 as unknown as RefreshHz };
    const result = validateInput(broken);
    expect(Object.keys(result.errors).sort()).toEqual(["decimals", "refreshHz", "salary"]);
    expect(result.settings).toBeNull();
  });

  it("keeps the display tiers out of the frozen Settings contract", () => {
    const settings = toSettings({ ...DEFAULT_INPUT, decimals: 6, refreshHz: 1 });
    expect(Object.keys(settings).sort()).toEqual([
      "hoursMicro",
      "lunchEndMin",
      "lunchStartMin",
      "overtimeMode",
      "payDaysMicro",
      "salaryMicro",
      "workEndMin",
      "workStartMin",
    ]);
  });
});
