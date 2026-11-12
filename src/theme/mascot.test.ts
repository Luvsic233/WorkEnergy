import { describe, expect, it } from "vitest";
import { builtinTheme } from "./builtin";
import { crossedYuan, integerYuanOf, mascotFileOf, mascotStateOf, mascotUrlOf } from "./mascot";
import type { Theme } from "./types";

const CAT: Theme = {
  id: "user:maodie",
  name: "耄耋猫",
  source: "user",
  dirName: "maodie",
  baseDir: "C:/themes/maodie",
  colors: {
    bar: "#fff",
    border: "#eee",
    label: "#ccc",
    int: "#000",
    frac: "#333",
    unit: "#666",
    dot: "#000",
    phase: "#444",
    hint: "#555",
  },
  font: "system-ui",
  mascot: { idle: "kitty-idle.webp", milestone: "kitty-happy.webp" },
};

describe("整数元解析（全程 BigInt，浮点不参与）", () => {
  it("parses the grouped integer text into BigInt", () => {
    expect(integerYuanOf("0")).toBe(0n);
    expect(integerYuanOf("1,234")).toBe(1234n);
    expect(integerYuanOf("-8")).toBe(-8n);
  });

  it("returns null for anything that is not an integer", () => {
    for (const value of ["", "1.5", "abc", "1e3", "1 234"]) expect(integerYuanOf(value)).toBeNull();
  });
});

describe("milestone：金额跨过整数元", () => {
  it("does not fire on the first frame, which only sets the baseline", () => {
    expect(crossedYuan(null, 12n)).toBe(false);
  });

  it("fires when the integer yuan grows by exactly one", () => {
    expect(crossedYuan(4n, 5n)).toBe(true);
  });

  it("fires once when a single tick jumps several yuan", () => {
    expect(crossedYuan(3n, 9n)).toBe(true);
  });

  it("does not fire while the integer part stays the same or goes back", () => {
    expect(crossedYuan(7n, 7n)).toBe(false);
    expect(crossedYuan(7n, 6n)).toBe(false);
    expect(crossedYuan(0n, 0n)).toBe(false);
  });

  it("drives a full sequence: baseline, no-op frames, one crossing", () => {
    const seen: boolean[] = [];
    let previous: bigint | null = null;
    for (const text of ["0", "0", "0", "1", "1", "4"]) {
      const yuan = integerYuanOf(text) as bigint;
      seen.push(crossedYuan(previous, yuan));
      previous = yuan;
    }
    expect(seen).toEqual([false, false, false, true, false, true]);
  });
});

describe("阶段 → 吉祥物状态", () => {
  it("freezes on offwork, hops on overtime, idles otherwise", () => {
    expect(mascotStateOf("已下班")).toBe("offwork");
    expect(mascotStateOf("加班")).toBe("overtime");
    for (const phase of ["在岗", "午休", "未到上班时间", "配置错误"] as const) {
      expect(mascotStateOf(phase)).toBe("idle");
    }
  });
});

describe("素材解析", () => {
  it("falls back to idle when the current state has no file", () => {
    expect(mascotFileOf(CAT, "overtime")).toBe("kitty-idle.webp");
    expect(mascotFileOf(CAT, "milestone")).toBe("kitty-happy.webp");
  });

  it("has no file for built-in themes and themes without a mascot", () => {
    expect(mascotFileOf(builtinTheme("default") ?? null, "idle")).toBeNull();
    expect(mascotFileOf(null, "idle")).toBeNull();
  });

  it("yields no url outside Tauri: the mascot block simply does not render", () => {
    expect(mascotUrlOf(CAT, "idle")).toBeNull();
    expect(mascotUrlOf(builtinTheme("default") ?? null, "idle")).toBeNull();
  });
});
