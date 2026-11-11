import { describe, expect, it } from "vitest";
import { ATOMS_PER_YUAN, parseMicro } from "./earning";
import { formatAtoms, formatMicro } from "./format";

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
