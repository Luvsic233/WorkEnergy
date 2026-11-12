import { describe, expect, it } from "vitest";
import { celebrationGifUrl, celebrationGifUrls, pickCelebrationUrl } from "./celebrationAsset";

describe("庆祝动图资产", () => {
  it("打包目录里至少有一张庆祝动图，且都不重复", () => {
    const urls = celebrationGifUrls();
    expect(urls.length).toBeGreaterThan(0);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("按注入的随机数确定性抽取", () => {
    const urls = celebrationGifUrls();
    expect(pickCelebrationUrl(() => 0)).toBe(urls[0]);
    if (urls.length > 1) {
      expect(pickCelebrationUrl(() => 0.9999)).toBe(urls[urls.length - 1]);
    }
  });

  it("随机值越界时钳到有效范围，不会返回 undefined", () => {
    const urls = celebrationGifUrls();
    expect(pickCelebrationUrl(() => 1)).toBe(urls[urls.length - 1]);
    expect(pickCelebrationUrl(() => -1)).toBe(urls[0]);
  });

  it("celebrationGifUrl 返回第一张", () => {
    expect(celebrationGifUrl()).toBe(celebrationGifUrls()[0]);
  });
});
