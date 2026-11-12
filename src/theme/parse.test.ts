import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES, BUILTIN_THEME_SOURCES, DEFAULT_THEME_ID, builtinTheme } from "./builtin";
import { DEFAULT_COLORS, DEFAULT_FONT, isSafeColor, isSafeImageFile, parseTheme } from "./parse";

const META = { id: "user:maodie", source: "user" as const, dirName: "maodie", baseDir: "C:/themes/maodie" };

describe("theme.json 校验：合法的主题", () => {
  it("reads name / colors / font / mascot into a Theme", () => {
    const { theme, issues } = parseTheme(
      {
        name: "耄耋猫",
        colors: { bar: "#f7f0e3", int: "#c2601f", frac: "rgb(217, 138, 63)" },
        font: '"Segoe UI", system-ui, sans-serif',
        mascot: { idle: "kitty-idle.webp", milestone: "kitty-happy.webp" },
      },
      META,
    );

    expect(issues).toEqual([]);
    expect(theme?.name).toBe("耄耋猫");
    expect(theme?.colors.bar).toBe("#f7f0e3");
    expect(theme?.colors.int).toBe("#c2601f");
    expect(theme?.colors.frac).toBe("rgb(217, 138, 63)");
    // 没写的颜色键仍然是默认值（九项永不缺席）
    expect(theme?.colors.hint).toBe(DEFAULT_COLORS.hint);
    expect(theme?.font).toBe('"Segoe UI", system-ui, sans-serif');
    expect(theme?.mascot).toEqual({ idle: "kitty-idle.webp", milestone: "kitty-happy.webp" });
    expect(theme?.source).toBe("user");
    expect(theme?.dirName).toBe("maodie");
    expect(theme?.baseDir).toBe("C:/themes/maodie");
  });

  it("accepts a theme that only has a name: every other field falls back", () => {
    const { theme, issues } = parseTheme({ name: "只有名字" }, META);

    expect(issues).toEqual([]);
    expect(theme?.colors).toEqual(DEFAULT_COLORS);
    expect(theme?.font).toBe(DEFAULT_FONT);
    expect(theme?.mascot).toBeNull();
  });

  it("accepts these color spellings", () => {
    for (const value of ["#fff", "#ffff", "#ffffff", "#ffffffff", "rgb(1, 2, 3)", "rgba(1,2,3,0.5)", "hsl(1 2% 3%)", "transparent", "white"]) {
      expect(isSafeColor(value)).toBe(true);
    }
  });
});

describe("theme.json 校验：坏字段只回退那一项", () => {
  it("falls back per colour and records one issue per bad value", () => {
    const { theme, issues } = parseTheme(
      { name: "坏颜色", colors: { bar: "not-a-color", int: 42, frac: "url(http://x/y.png)", phase: "#000" } },
      META,
    );

    expect(theme?.colors.bar).toBe(DEFAULT_COLORS.bar);
    expect(theme?.colors.int).toBe(DEFAULT_COLORS.int);
    expect(theme?.colors.frac).toBe(DEFAULT_COLORS.frac);
    // 合法的那一项照旧生效
    expect(theme?.colors.phase).toBe("#000");
    expect(issues.filter((line) => line.includes("回退默认"))).toHaveLength(3);
  });

  it("rejects unsafe colour values outright", () => {
    for (const value of ["", "  ", "url(a)", "expression(1)", "javascript:alert(1)", "1", "#12345", "#1234567"]) {
      expect(isSafeColor(value)).toBe(false);
    }
  });

  it("ignores a non-object colors block and keeps defaults", () => {
    const { theme, issues } = parseTheme({ name: "颜色不是对象", colors: ["#fff"] }, META);

    expect(theme?.colors).toEqual(DEFAULT_COLORS);
    expect(issues.join()).toContain("colors 不是对象");
  });

  it("ignores unknown colour keys instead of failing", () => {
    const { theme, issues } = parseTheme({ name: "多了一个键", colors: { bar: "#111", glow: "#222" } }, META);

    expect(theme?.colors.bar).toBe("#111");
    expect(issues.join()).toContain("忽略未知颜色 glow");
  });

  it("falls back a dangerous font value", () => {
    const { theme, issues } = parseTheme({ name: "坏字体", font: "serif; } body { display:none }" }, META);

    expect(theme?.font).toBe(DEFAULT_FONT);
    expect(issues.join()).toContain("font 非法");
  });
});

describe("theme.json 校验：吉祥物状态", () => {
  it("drops unknown states and keeps the four known ones", () => {
    const { theme, issues } = parseTheme(
      { name: "未知状态", mascot: { idle: "a.webp", sleeping: "b.webp", offwork: "c.png" } },
      META,
    );

    expect(theme?.mascot).toEqual({ idle: "a.webp", offwork: "c.png" });
    expect(issues.join()).toContain("忽略未知吉祥物状态 sleeping");
  });

  it("refuses path-ish file names so a theme can only point inside its own directory", () => {
    for (const value of ["../x.webp", "sub/x.webp", "C:/x.webp", ".hidden.webp", "x.txt", ""]) {
      expect(isSafeImageFile(value)).toBe(false);
    }
    const { theme } = parseTheme({ name: "穿越", mascot: { idle: "../evil.webp", overtime: "ok.webp" } }, META);
    expect(theme?.mascot).toEqual({ overtime: "ok.webp" });
  });

  it("treats a mascot block with no usable entry as no mascot", () => {
    const { theme } = parseTheme({ name: "空吉祥物", mascot: { idle: "x.exe" } }, META);
    expect(theme?.mascot).toBeNull();
  });
});

describe("theme.json 校验：非法主题被忽略且不抛错", () => {
  it("returns null for anything that is not a JSON object", () => {
    for (const value of [null, undefined, "name", 42, ["name"], true]) {
      const { theme, issues } = parseTheme(value, META);
      expect(theme).toBeNull();
      expect(issues.length).toBeGreaterThan(0);
    }
  });

  it("returns null when name is missing, blank or not a string", () => {
    for (const value of [{}, { name: "" }, { name: "   " }, { name: 42 }, { colors: { bar: "#fff" } }]) {
      const { theme, issues } = parseTheme(value, META);
      expect(theme).toBeNull();
      expect(issues.join()).toContain("name");
    }
  });
});

describe("内置主题解析", () => {
  it("parses both built-in sources through the same parser", () => {
    expect(BUILTIN_THEME_SOURCES).toHaveLength(2);
    expect(BUILTIN_THEMES).toHaveLength(2);
    for (const [index, source] of BUILTIN_THEME_SOURCES.entries()) {
      expect(BUILTIN_THEMES[index]?.id).toBe(source.id);
      expect(BUILTIN_THEMES[index]?.source).toBe("builtin");
      expect(BUILTIN_THEMES[index]?.baseDir).toBeNull();
    }
  });

  it("keeps the default theme identical to the shipped dark look", () => {
    const dark = builtinTheme(DEFAULT_THEME_ID);
    expect(dark?.colors).toEqual(DEFAULT_COLORS);
    expect(dark?.mascot).toBeNull();
  });

  it("ships a minimal theme that is light and has no mascot", () => {
    const minimal = builtinTheme("minimal");
    expect(minimal?.name).toBe("极简");
    expect(minimal?.mascot).toBeNull();
    expect(minimal?.colors.bar).toBe("#f7f7f8");
    expect(minimal?.colors.int).toBe("#111827");
    expect(minimal?.colors.bar).not.toBe(DEFAULT_COLORS.bar);
  });
});
