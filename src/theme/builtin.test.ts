import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES, MAODIE_THEME_ID, MAODIE_WINDOW, builtinTheme } from "./builtin";
import { layoutOf, windowSizeOf } from "./layout";
import { parseTheme } from "./parse";
import type { Theme } from "./types";

describe("内置主题清单", () => {
  it("ships three built-ins in a stable order: default, minimal, maodie", () => {
    expect(BUILTIN_THEMES.map((theme) => theme.id)).toEqual(["default", "minimal", MAODIE_THEME_ID]);
    expect(BUILTIN_THEMES.map((theme) => theme.name)).toEqual(["深色（默认）", "极简", "耄耋猫"]);
  });

  it("resolves the maodie built-in with its display name", () => {
    const theme = builtinTheme(MAODIE_THEME_ID);
    expect(theme?.name).toBe("耄耋猫");
    expect(theme?.source).toBe("builtin");
    // 内置主题没有自己的目录：图片一律取自用户目录 themes/maodie/（见 photoLeft.ts）
    expect(theme?.baseDir).toBeNull();
    expect(builtinTheme("nope")).toBeUndefined();
  });

  it("keeps the agreed cream / orange palette of the maodie theme.json", () => {
    const colors = builtinTheme(MAODIE_THEME_ID)?.colors;
    expect(colors?.bar).toBe("rgba(247, 240, 227, 0.92)");
    expect(colors?.int).toBe("#c2601f");
    expect(colors?.label).toBe("rgba(138, 107, 79, 0.9)");
    expect(colors?.phase).toBe("rgba(122, 91, 63, 0.85)");
    expect(colors?.hint).toBe("rgba(160, 132, 100, 0.8)");
  });

  it("gives maodie the photo-left layout and the fixed 340x96 window", () => {
    const theme = builtinTheme(MAODIE_THEME_ID) ?? null;
    expect(layoutOf(theme)).toBe("photo-left");
    expect(windowSizeOf(theme)).toEqual({ width: 340, height: 96 });
    expect(MAODIE_WINDOW).toEqual({ width: 340, height: 96 });
  });

  it("leaves default / minimal on the classic layout with no fixed window", () => {
    for (const id of ["default", "minimal"]) {
      const theme = builtinTheme(id) ?? null;
      expect(layoutOf(theme)).toBe("classic");
      expect(windowSizeOf(theme)).toBeNull();
    }
    // 首帧还没有主题时也一样是经典版式 + 跟随档位
    expect(layoutOf(null)).toBe("classic");
    expect(windowSizeOf(null)).toBeNull();
  });

  it("needs a mascot mapping on maodie so the state machine runs, but never builds asset urls", () => {
    // 状态机（useMascot）靠 theme.mascot 非空来判断"要不要推状态"，photo-left 的左图跟着它换图
    expect(builtinTheme(MAODIE_THEME_ID)?.mascot).not.toBeNull();
    // 内置主题 baseDir 为 null，所以同一个 mascot 映射不会拼出任何 asset 地址
    const theme = builtinTheme(MAODIE_THEME_ID) ?? null;
    expect(theme?.baseDir).toBeNull();
  });
});

describe("layout / windowSize 只属于内置主题", () => {
  it("never lets a user theme.json declare layout or windowSize", () => {
    // 这两个键不属于 theme.json 的 schema：解析器只认 name / colors / font / mascot
    const { theme } = parseTheme(
      { name: "假的耄耋猫", layout: "photo-left", windowSize: { width: 340, height: 96 } },
      { id: "user:x", source: "user", dirName: "x", baseDir: "C:/themes/x" },
    );
    expect(theme).not.toBeNull();
    expect((theme as Theme).layout).toBeUndefined();
    expect((theme as Theme).windowSize).toBeUndefined();
    expect(layoutOf(theme)).toBe("classic");
    expect(windowSizeOf(theme)).toBeNull();
  });
});
