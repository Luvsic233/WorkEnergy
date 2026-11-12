import { describe, expect, it } from "vitest";
import { SIZE_PRESETS, type SizePreset } from "../core/settings";
import { MAODIE_THEME_ID, builtinTheme } from "./builtin";
import { FIXED_THEME_SCALE, applyStartupThemeWindowSize, applyThemeWindowSize, windowSpecOf } from "./windowSize";
import type { Theme } from "./types";

const userTheme: Theme = {
  id: "user:maodie",
  name: "耄耋猫（用户目录）",
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
  mascot: null,
};

describe("窗口尺寸：主题固定尺寸 vs 用户预设", () => {
  it("pins the maodie theme to 340x96 whatever preset is stored", () => {
    const theme = builtinTheme(MAODIE_THEME_ID) ?? null;
    for (const preset of ["compact", "standard", "wide"] as const) {
      expect(windowSpecOf(theme, preset)).toEqual({ width: 340, height: 96, scale: FIXED_THEME_SCALE });
    }
    expect(FIXED_THEME_SCALE).toBe(1);
  });

  it("falls back to the stored preset for default / minimal / user themes", () => {
    const presets: SizePreset[] = ["compact", "standard", "wide"];
    for (const preset of presets) {
      const spec = SIZE_PRESETS[preset];
      for (const theme of [builtinTheme("default") ?? null, builtinTheme("minimal") ?? null, userTheme, null]) {
        expect(windowSpecOf(theme, preset)).toEqual({
          width: spec.width,
          height: spec.height,
          scale: spec.scale,
        });
      }
    }
    expect(windowSpecOf(null, "wide")).toEqual({ width: 400, height: 120, scale: 1 });
    expect(windowSpecOf(null, "compact")).toEqual({ width: 300, height: 80, scale: 0.75 });
  });

  it("switches back to the preset size when the fixed-size theme is left", () => {
    const maodie = builtinTheme(MAODIE_THEME_ID) ?? null;
    const fallback = builtinTheme("default") ?? null;
    expect(windowSpecOf(maodie, "wide").width).toBe(340);
    expect(windowSpecOf(fallback, "wide").width).toBe(400);
    expect(windowSpecOf(maodie, "compact").height).toBe(96);
    expect(windowSpecOf(fallback, "compact").height).toBe(80);
  });

  it("is a no-op outside the shell instead of throwing", () => {
    // 单测跑在 node 里：没有 document / 没有 __TAURI__，两条路径都必须安静返回
    const theme = builtinTheme(MAODIE_THEME_ID) ?? null;
    expect(() => applyThemeWindowSize(theme, "compact")).not.toThrow();
    expect(() => applyThemeWindowSize(builtinTheme("default") ?? null, "wide")).not.toThrow();
    expect(() => applyThemeWindowSize(null, "standard")).not.toThrow();
    expect(() => applyStartupThemeWindowSize(theme, "compact")).not.toThrow();
    expect(() => applyStartupThemeWindowSize(null, "compact")).not.toThrow();
  });
});
