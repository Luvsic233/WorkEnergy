import { describe, expect, it } from "vitest";
import { parseMicro } from "./earning";
import { formatMicro } from "./format";

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
