import { describe, expect, it } from "vitest";
import {
  PHOTO_THEME_DIR,
  isPhotoFile,
  photoCandidateFiles,
  photoDirOf,
  pickPhotoFile,
} from "./photoLeft";

describe("photo-left：状态 → 候选文件名", () => {
  it("lists the state file first (png before webp), then the idle files", () => {
    expect(photoCandidateFiles("overtime")).toEqual([
      "kitty-overtime.png",
      "kitty-overtime.webp",
      "kitty-idle.png",
      "kitty-idle.webp",
    ]);
    expect(photoCandidateFiles("offwork")).toEqual([
      "kitty-offwork.png",
      "kitty-offwork.webp",
      "kitty-idle.png",
      "kitty-idle.webp",
    ]);
    // milestone 沿用吉祥物映射：kitty-happy
    expect(photoCandidateFiles("milestone")).toEqual([
      "kitty-happy.png",
      "kitty-happy.webp",
      "kitty-idle.png",
      "kitty-idle.webp",
    ]);
  });

  it("has no idle duplicate when the state already is idle", () => {
    expect(photoCandidateFiles("idle")).toEqual(["kitty-idle.png", "kitty-idle.webp"]);
  });

  it("points at the folder the user actually drops images in", () => {
    expect(PHOTO_THEME_DIR).toBe("maodie");
    expect(photoDirOf("C:/AppData/com.workenergy.shell")).toBe(
      "C:/AppData/com.workenergy.shell/themes/maodie",
    );
    expect(photoDirOf("C:\\AppData\\com.workenergy.shell")).toBe(
      "C:\\AppData\\com.workenergy.shell\\themes\\maodie",
    );
  });
});

describe("photo-left：挑图（含兜底）", () => {
  it("prefers the png of the current state over its webp", () => {
    expect(pickPhotoFile(["kitty-idle.webp", "kitty-idle.png"], "idle")).toBe("kitty-idle.png");
  });

  it("accepts webp when the png is missing", () => {
    expect(pickPhotoFile(["kitty-idle.webp"], "idle")).toBe("kitty-idle.webp");
  });

  it("falls back to the idle file when the current state has no file", () => {
    expect(pickPhotoFile(["kitty-idle.png", "kitty-happy.png"], "overtime")).toBe("kitty-idle.png");
  });

  it("matches file names case-insensitively and returns the real name on disk", () => {
    expect(pickPhotoFile(["KITTY-IDLE.PNG"], "idle")).toBe("KITTY-IDLE.PNG");
  });

  it("falls back to the first image by file name when no state file exists", () => {
    // 用户真实目录里放的是 "R-C (1).png"：带空格与括号，任何状态名都匹配不上
    expect(pickPhotoFile(["zebra.png", "R-C (1).png", "README.md"], "milestone")).toBe("R-C (1).png");
    // 排序是 code unit 升序（与 ReadDir 的枚举顺序无关）
    expect(pickPhotoFile(["b.webp", "B.png", "a.jpg"], "overtime")).toBe("B.png");
  });

  it("ignores anything that is not an image", () => {
    expect(pickPhotoFile(["README.md", "theme.json"], "idle")).toBeNull();
    expect(pickPhotoFile([], "idle")).toBeNull();
  });

  it("returns null instead of throwing for odd listings", () => {
    expect(pickPhotoFile(["", "   "], "idle")).toBeNull();
    expect(pickPhotoFile([".png"], "idle")).toBeNull();
  });

  it("classifies image extensions without touching the file system", () => {
    expect(isPhotoFile("R-C (1).png")).toBe(true);
    expect(isPhotoFile("kitty-idle.WEBP")).toBe(true);
    expect(isPhotoFile("README.md")).toBe(false);
    expect(isPhotoFile("kitty-idle")).toBe(false);
  });
});
