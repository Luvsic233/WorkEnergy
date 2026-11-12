import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES, DEFAULT_THEME_ID, builtinTheme } from "./builtin";
import { THEME_VARIABLES, applyTheme, themeCssVariables, type StyleTarget } from "./css";
import { DEFAULT_COLORS } from "./parse";
import type { Theme } from "./types";

/** 假的 documentElement.style：单测不碰 DOM，只断言"写了哪些变量、值是多少"。 */
function fakeStyle(): StyleTarget & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    setProperty(name, value) {
      values.set(name, value);
    },
    removeProperty(name) {
      values.delete(name);
    },
  };
}

function themeOf(id: string): Theme {
  const theme = builtinTheme(id);
  if (!theme) throw new Error(`missing builtin theme ${id}`);
  return theme;
}

describe("主题 → CSS 变量", () => {
  it("maps every colour key plus the font to a --theme-* variable", () => {
    const variables = themeCssVariables(themeOf(DEFAULT_THEME_ID));

    expect(Object.keys(variables)).toEqual([...THEME_VARIABLES]);
    expect(variables["--theme-bar-bg"]).toBe(DEFAULT_COLORS.bar);
    expect(variables["--theme-int"]).toBe(DEFAULT_COLORS.int);
    expect(variables["--theme-frac"]).toBe(DEFAULT_COLORS.frac);
    expect(variables["--theme-phase"]).toBe(DEFAULT_COLORS.phase);
    expect(variables["--theme-hint"]).toBe(DEFAULT_COLORS.hint);
    expect(variables["--theme-font"]).toBe(themeOf(DEFAULT_THEME_ID).font);
  });

  it("writes the minimal values after switching, then restores the default ones", () => {
    const style = fakeStyle();
    const minimal = builtinTheme("minimal");
    expect(minimal).toBeDefined();

    applyTheme(minimal as Theme, style);
    expect(style.values.get("--theme-bar-bg")).toBe("#f7f7f8");
    expect(style.values.get("--theme-int")).toBe("#111827");
    expect(style.values.get("--theme-frac")).toBe("#6b7280");

    applyTheme(themeOf(DEFAULT_THEME_ID), style);
    expect(style.values.get("--theme-bar-bg")).toBe(DEFAULT_COLORS.bar);
    expect(style.values.get("--theme-int")).toBe(DEFAULT_COLORS.int);
  });

  it("covers all built-in themes with the same variable names", () => {
    const style = fakeStyle();
    for (const theme of BUILTIN_THEMES) {
      applyTheme(theme, style);
      for (const name of THEME_VARIABLES) expect(style.values.get(name)).toBeTruthy();
    }
    expect(THEME_VARIABLES).toHaveLength(10);
  });
});
