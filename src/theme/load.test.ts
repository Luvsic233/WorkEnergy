import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog";
import { createMemoryThemeIo } from "./io";
import { loadThemeCatalog, scanUserThemes, userThemeId } from "./load";

/** 假路径：单测绝不碰真实 %APPDATA%，主题根目录一律由这个常量注入。 */
const ROOT = "E:/fake-appdata/com.workenergy.shell/themes";

function themeJson(name: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ name, colors: { bar: "#101010" }, ...extra });
}

describe("扫描用户主题目录（根目录由参数注入）", () => {
  it("parses every <dir>/theme.json and computes its base dir", async () => {
    const io = createMemoryThemeIo({
      "cat/theme.json": themeJson("猫"),
      "plain/theme.json": themeJson("朴素"),
    });

    const scan = await scanUserThemes(io, ROOT);

    expect(scan.themes.map((theme) => theme.name)).toEqual(["猫", "朴素"]);
    expect(scan.themes.map((theme) => theme.id)).toEqual([userThemeId("cat"), userThemeId("plain")]);
    expect(scan.themes[0]?.baseDir).toBe("E:/fake-appdata/com.workenergy.shell/themes/cat");
    expect(scan.themes[0]?.source).toBe("user");
    expect(scan.logs).toEqual([]);
  });

  it("sorts by directory name, so catalog priority does not depend on filesystem order", async () => {
    const io = createMemoryThemeIo({
      "zeta/theme.json": themeJson("同名"),
      "alpha/theme.json": themeJson("同名"),
      "beta/theme.json": themeJson("别的"),
    });

    const scan = await scanUserThemes(io, ROOT);

    expect(scan.themes.map((theme) => theme.dirName)).toEqual(["alpha", "beta", "zeta"]);
  });

  it("ignores a theme with broken JSON and keeps scanning without throwing", async () => {
    const io = createMemoryThemeIo({
      "broken/theme.json": "{ name: 猫, }",
      "good/theme.json": themeJson("好的"),
    });

    const scan = await scanUserThemes(io, ROOT);

    expect(scan.themes.map((theme) => theme.dirName)).toEqual(["good"]);
    expect(scan.logs.join()).toContain("跳过 broken：theme.json 不是合法 JSON");
  });

  it("ignores a theme without theme.json and a theme without a name", async () => {
    const io = createMemoryThemeIo({
      "readme-only/README.md": "no theme here",
      "nameless/theme.json": JSON.stringify({ colors: { bar: "#fff" } }),
      "ok/theme.json": themeJson("正常"),
    });

    const scan = await scanUserThemes(io, ROOT);

    expect(scan.themes.map((theme) => theme.dirName)).toEqual(["ok"]);
    expect(scan.logs.join()).toContain("跳过 readme-only");
    expect(scan.logs.join()).toContain("跳过 nameless：缺少 name");
  });

  it("returns built-ins when the root is empty or the IO blows up", async () => {
    const empty = await loadThemeCatalog(createMemoryThemeIo({}), ROOT);
    expect(empty.themes.map((theme) => theme.id)).toEqual(["default", "minimal"]);

    const failing = {
      listDirs: async () => {
        throw new Error("no fs");
      },
      readText: async () => null,
      writeText: async () => false,
    };
    const scan = await scanUserThemes(failing, ROOT);
    expect(scan.themes).toEqual([]);
    expect(scan.logs.join()).toContain("列出主题目录失败");
  });

  it("reports a fallback issue line for a theme with bad colours but keeps the theme", async () => {
    const io = createMemoryThemeIo({ "kitty/theme.json": themeJson("猫", { colors: { bar: "url(nope.png)" } }) });

    const scan = await scanUserThemes(io, ROOT);

    expect(scan.themes).toHaveLength(1);
    expect(scan.logs.join()).toContain("颜色 bar 非法");
  });
});

describe("重名优先级", () => {
  it("lets built-in names win over user themes with the same display name", async () => {
    const io = createMemoryThemeIo({ "fake-minimal/theme.json": themeJson("极简") });

    const catalog = await loadThemeCatalog(io, ROOT);

    expect(catalog.themes.map((theme) => theme.id)).toEqual(["default", "minimal"]);
    expect(catalog.logs.join()).toContain("跳过 fake-minimal：显示名与已有主题重名");
  });

  it("keeps the first directory name when two user themes collide", async () => {
    const io = createMemoryThemeIo({
      "b/theme.json": themeJson("重名"),
      "a/theme.json": themeJson("重名"),
    });

    const catalog = await loadThemeCatalog(io, ROOT);

    const user = catalog.themes.filter((theme) => theme.source === "user");
    expect(user.map((theme) => theme.dirName)).toEqual(["a"]);
    expect(catalog.dropped).toEqual(["b"]);
  });

  it("keeps the built-ins first and appends user themes in directory order", () => {
    const user = [
      { id: userThemeId("a"), name: "甲", dirName: "a" },
      { id: userThemeId("b"), name: "乙", dirName: "b" },
    ] as unknown as Parameters<typeof buildCatalog>[0];

    const catalog = buildCatalog(user);

    expect(catalog.themes.map((theme) => theme.id)).toEqual(["default", "minimal", "user:a", "user:b"]);
    expect(catalog.dropped).toEqual([]);
  });
});
