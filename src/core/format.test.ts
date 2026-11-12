import { describe, expect, it } from "vitest";
import { ATOMS_PER_YUAN, parseMicro } from "./earning";
import { digitColumns, formatAtoms, formatMicro } from "./format";

describe("formatMicro", () => {
  it("keeps significant fraction digits: 21750000 => 21.75", () => {
    expect(formatMicro(21_750_000n)).toBe("21.75");
  });

  it("drops trailing zeros for whole numbers: 8000000 => 8", () => {
    expect(formatMicro(8_000_000n)).toBe("8");
  });

  it("handles salaries above five digits: 10000000000 => 10000", () => {
    expect(formatMicro(10_000_000_000n)).toBe("10000");
  });

  it("keeps a single fraction digit: 8500000 => 8.5", () => {
    expect(formatMicro(8_500_000n)).toBe("8.5");
  });

  it("renders zero as 0", () => {
    expect(formatMicro(0n)).toBe("0");
  });

  it("does not pad the fraction: 1000000 => 1, 250000 => 0.25", () => {
    expect(formatMicro(1_000_000n)).toBe("1");
    expect(formatMicro(250_000n)).toBe("0.25");
  });

  it("round-trips the settings user input used by the hint", () => {
    expect(formatMicro(parseMicro("20000"))).toBe("20000");
    expect(formatMicro(parseMicro("21.75"))).toBe("21.75");
    expect(formatMicro(parseMicro("8"))).toBe("8");
  });
});

describe("formatAtoms decimals", () => {
  // 57.471264367816 元（10000 / 21.75 天 / 8 小时的时薪量级），低 6 位为 0。
  const atoms = 57_471_264_367_816_000_000n;

  it("keeps all 18 digits by default and accepts an explicit 18", () => {
    expect(formatAtoms(atoms)).toEqual({ int: "57", frac: "471264367816000000" });
    expect(formatAtoms(atoms, 18)).toEqual({ int: "57", frac: "471264367816000000" });
  });

  it("cuts the fraction to 12 digits for the 12-digit tier", () => {
    expect(formatAtoms(atoms, 12)).toEqual({ int: "57", frac: "471264367816" });
  });

  it("cuts the fraction to 6 digits for the 6-digit tier", () => {
    expect(formatAtoms(atoms, 6)).toEqual({ int: "57", frac: "471264" });
  });

  it("renders the native ceiling: 10^18 - 1 atoms is 0.999999999999999999", () => {
    const ceiling = ATOMS_PER_YUAN - 1n;
    const parts = formatAtoms(ceiling, 18);
    expect(parts).toEqual({ int: "0", frac: "999999999999999999" });
    expect(parts.frac).toHaveLength(18);
    expect(/^9{18}$/.test(parts.frac)).toBe(true);
  });

  it("truncates toward zero instead of rounding", () => {
    const nine = 1_234_999_999_999_999_999n; // 1.234999999999999999 元
    expect(formatAtoms(nine, 18)).toEqual({ int: "1", frac: "234999999999999999" });
    expect(formatAtoms(nine, 12)).toEqual({ int: "1", frac: "234999999999" });
    expect(formatAtoms(nine, 6)).toEqual({ int: "1", frac: "234999" });
  });

  it("pads every tier to its own width", () => {
    expect(formatAtoms(0n)).toEqual({ int: "0", frac: "000000000000000000" });
    expect(formatAtoms(0n, 12)).toEqual({ int: "0", frac: "000000000000" });
    expect(formatAtoms(0n, 6)).toEqual({ int: "0", frac: "000000" });
  });

  it("keeps the sign, the thousands separator and the fraction at every tier", () => {
    expect(formatAtoms(-1_500_000_000_000_000_000n, 18)).toEqual({ int: "-1", frac: "500000000000000000" });
    expect(formatAtoms(-1_500_000_000_000_000_000n, 12)).toEqual({ int: "-1", frac: "500000000000" });
    expect(formatAtoms(-1_500_000_000_000_000_000n, 6)).toEqual({ int: "-1", frac: "500000" });
    expect(formatAtoms(10_000n * ATOMS_PER_YUAN + 250_000_000_000_000_000n, 18)).toEqual({
      int: "10,000",
      frac: "250000000000000000",
    });
  });
});

describe("digitColumns: 每一位的 {digit, progress}", () => {
  // 10000 元 / 21.75 天 / 8 小时 → 每秒入账 0.015964 元 = 15_964_000_000_000 atoms。
  const perSecond = 15_964_000_000_000_000n;

  it("splits zero into one integer digit and a full width of zero fraction digits", () => {
    const { int, frac } = digitColumns(0n, 18);
    expect(int).toEqual([{ digit: 0, progress: 0 }]);
    expect(frac).toHaveLength(18);
    expect(frac.every((column) => column.digit === 0)).toBe(true);
  });

  it("renders the native ceiling 10^18 - 1 as all nines about to carry", () => {
    const { int, frac } = digitColumns(ATOMS_PER_YUAN - 1n, 18);
    expect(int).toEqual([{ digit: 0, progress: 0.999999 }]);
    expect(frac.map((column) => column.digit)).toEqual(Array(18).fill(9));
    // 每一位都正好停在自己那一格的尽头：unit = 10^(18-d)，余数 = unit - 1
    for (let d = 1; d <= 17; d += 1) {
      const unit = 10n ** BigInt(18 - d);
      expect(frac[d - 1].progress).toBe(Number(((unit - 1n) * 1_000_000n) / unit) / 1_000_000);
    }
    // 第 18 位的 unit 就是 1 atom，内部没有可滚的余量，progress 恒为 0
    expect(frac[17]).toEqual({ digit: 9, progress: 0 });
  });

  it("derives digit and progress from BigInt, never from a float", () => {
    // 57.471264367816091954 元
    const atoms = 57_471_264_367_816_091_954n;
    const { int, frac } = digitColumns(atoms, 18);

    // 整数第 k 位：unit = 10^(18+k)，十位是 5 且已走向 6 的 74%，个位是 7 且已走向 8 的 47%
    expect(int).toEqual([
      { digit: 5, progress: 0.747126 },
      { digit: 7, progress: 0.471264 },
    ]);
    // 小数第 1 位 = 4，已走向 5 的 71%
    expect(frac[0]).toEqual({ digit: 4, progress: 0.712643 });

    // 每一位的 digit 与 formatAtoms 的字符串严格一致（前导零在此已被裁掉）
    expect(int.map((column) => column.digit).join("")).toBe("57");
    expect(frac.map((column) => column.digit).join("")).toBe("471264367816091954");
  });

  it("keeps progress inside [0, 1) for every digit of many amounts", () => {
    const samples = [0n, 1n, 9n, perSecond, ATOMS_PER_YUAN - 1n, ATOMS_PER_YUAN, 9_999_999n * ATOMS_PER_YUAN + 1n];
    for (const atoms of samples) {
      const { int, frac } = digitColumns(atoms, 18);
      for (const column of [...int, ...frac]) {
        expect(column.progress).toBeGreaterThanOrEqual(0);
        expect(column.progress).toBeLessThan(1);
        expect(Number.isInteger(column.digit)).toBe(true);
        expect(column.digit).toBeGreaterThanOrEqual(0);
        expect(column.digit).toBeLessThanOrEqual(9);
      }
    }
  });

  it("crawls on the high digits while the low digits blur past", () => {
    const before = digitColumns(0n, 18);
    const after = digitColumns(perSecond, 18);

    // 第 1 位小数（0.1 元一格）一秒只爬 16% 格：这是"看得出在慢慢累加"的那一位
    expect(after.frac[0].progress).toBeCloseTo(0.15964, 5);
    expect(after.frac[0].digit).toBe(before.frac[0].digit);

    // 第 3 位小数（1e-3 元一格）一秒跨过 15 格：只可能是流动的尾巴
    expect(after.frac[2].digit).not.toBe(before.frac[2].digit);
  });

  it("rolls the ones digit with the fraction of the current yuan", () => {
    const { int } = digitColumns(57n * ATOMS_PER_YUAN + ATOMS_PER_YUAN / 2n, 18);
    // int 数组从最高位排到个位：57.5 元 → 十位 5（已走向 6 的 75%）、个位 7（已走向 8 的 50%）
    expect(int).toEqual([
      { digit: 5, progress: 0.75 },
      { digit: 7, progress: 0.5 },
    ]);
  });

  it("grows the integer digits with the amount and drops the leading zeros", () => {
    expect(digitColumns(5n * ATOMS_PER_YUAN, 18).int).toEqual([{ digit: 5, progress: 0 }]);
    expect(digitColumns(10n * ATOMS_PER_YUAN, 18).int).toEqual([
      { digit: 1, progress: 0 },
      { digit: 0, progress: 0 },
    ]);

    // 9999999 元 + 0.5 元：7 位整数，最高位已贴住进位
    const seven = 9_999_999n * ATOMS_PER_YUAN + ATOMS_PER_YUAN / 2n;
    const { int } = digitColumns(seven, 18);
    expect(int.map((column) => column.digit)).toEqual([9, 9, 9, 9, 9, 9, 9]);
    expect(int).toHaveLength(7);
  });

  it("truncates the fraction to the chosen tier", () => {
    const atoms = 57_471_264_367_816_091_954n;
    for (const decimals of [18, 12, 6] as const) {
      const { frac } = digitColumns(atoms, decimals);
      expect(frac.map((column) => column.digit).join("")).toBe(formatAtoms(atoms, decimals).frac);
    }
  });
});

describe("digitColumns: 渲染契约（整数位只认 digit）", () => {
  it("keeps the {digit, progress} shape and the leading-zero rule unchanged", () => {
    const atoms = 57_471_264_367_816_091_954n;
    const { int, frac } = digitColumns(atoms, 18);
    expect(Object.keys(int[0]).sort()).toEqual(["digit", "progress"]);
    expect(int.map((column) => column.digit).join("")).toBe("57");
    expect(frac).toHaveLength(18);
    expect(digitColumns(0n, 18).int).toEqual([{ digit: 0, progress: 0 }]);
  });

  it("shows why the integer digits are static: one yuan takes about 62 seconds", () => {
    // 10000 元 / 21.75 天 / 8 小时 → 每秒 0.015964 元
    const perSecond = 15_964_000_000_000_000n;
    const onesAt = (seconds: number) =>
      digitColumns((perSecond * BigInt(Math.round(seconds * 1000))) / 1000n, 18).int.at(-1)!;

    expect(onesAt(1).digit).toBe(0);
    expect(onesAt(31).digit).toBe(0); // 半分钟还没走到一半
    expect(onesAt(62).digit).toBe(0);
    expect(onesAt(63).digit).toBe(1); // 约 62.6 秒才进一格

    // 一格整元的耗时落在 62–63 秒之间：这段时间里个位一位都不变，画面是静止的
    let crossing = 0;
    while (onesAt(crossing).digit === 0) crossing += 1;
    expect(crossing).toBeGreaterThanOrEqual(62);
    expect(crossing).toBeLessThanOrEqual(63);
  });
});
