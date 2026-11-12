import { describe, expect, it } from "vitest";
import { createMemoryThemeIo } from "./io";
import { scanUserThemes } from "./load";
import { MAODIE_DIR, MAODIE_FILES, seedThemesIfEmpty } from "./seed";

const ROOT = "C:/Users/tester/AppData/Roaming/com.workenergy.shell/themes";

describe("首次启动的空壳（耄耋猫）", () => {
  it("writes theme.json and README.md when the theme root is empty", async () => {
    const io = createMemoryThemeIo();

    const result = await seedThemesIfEmpty(io, ROOT);

    expect(result.seeded).toBe(true);
    expect(io.writes.sort()).toEqual([`${MAODIE_DIR}/README.md`, `${MAODIE_DIR}/theme.json`]);
    expect(io.tree[`${MAODIE_DIR}/theme.json`]).toBe(MAODIE_FILES["theme.json"]);
    expect(io.tree[`${MAODIE_DIR}/README.md`]).toContain("本项目**不分发任何第三方表情包素材**");
  });

  it("ships no image files at all: no placeholder, only the manifest and the readme", () => {
    const files = Object.keys(MAODIE_FILES);
    expect(files).toEqual(["theme.json", "README.md"]);
    for (const file of files) expect(file).not.toMatch(/\.(?:webp|png|jpe?g|gif|avif|bmp)$/i);
  });

  it("writes a theme.json that its own scanner accepts, with the four mascot states", async () => {
    const io = createMemoryThemeIo();

    await seedThemesIfEmpty(io, ROOT);
    const scan = await scanUserThemes(io, ROOT);

    expect(scan.themes).toHaveLength(1);
    const theme = scan.themes[0];
    expect(theme?.name).toBe("耄耋猫");
    expect(theme?.dirName).toBe(MAODIE_DIR);
    expect(theme?.mascot).toEqual({
      idle: "kitty-idle.webp",
      offwork: "kitty-offwork.webp",
      overtime: "kitty-overtime.webp",
      milestone: "kitty-happy.webp",
    });
    expect(theme?.colors.int).toBe("#c2601f");
    expect(scan.logs).toEqual([]);
  });

  it("never touches a directory the user already filled", async () => {
    const io = createMemoryThemeIo({ "mine/theme.json": JSON.stringify({ name: "我的" }) });

    const result = await seedThemesIfEmpty(io, ROOT);

    expect(result.seeded).toBe(false);
    expect(io.writes).toEqual([]);
  });

  it("reports a failed write instead of throwing", async () => {
    const io = createMemoryThemeIo();
    io.writeText = async () => false;

    const result = await seedThemesIfEmpty(io, ROOT);

    expect(result.seeded).toBe(false);
    expect(result.logs).toHaveLength(2);
  });
});
