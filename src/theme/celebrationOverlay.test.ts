import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// 两个图源模块换成可控的假数据（与 PhotoArtFallback.test.tsx 同一套做法）。
const sources = vi.hoisted(() => ({ gif: null as string | null, bundled: null as string | null }));

vi.mock("./celebrationAsset", () => ({
  celebrationGifUrl: () => sources.gif,
}));

vi.mock("./bundledPhotos", () => ({
  bundledPhotoUrl: () => sources.bundled,
  bundledPhotoStates: () => [],
}));

import { CelebrationOverlay } from "./CelebrationOverlay";

function render(): string {
  return renderToStaticMarkup(createElement(CelebrationOverlay));
}

describe("CelebrationOverlay：静态渲染", () => {
  it("仓库里有 celebrate.gif 时用它", () => {
    sources.gif = "/assets/celebrate.gif";
    sources.bundled = "/assets/kitty-idle.png";
    const html = render();
    expect(html).toContain('data-celebrate="image"');
    expect(html).toContain('src="/assets/celebrate.gif"');
    expect(html).not.toContain("kitty-idle");
  });

  it("没有 GIF 时回退到内置静态猫图", () => {
    sources.gif = null;
    sources.bundled = "/assets/kitty-idle.png";
    const html = render();
    expect(html).toContain('data-celebrate="image"');
    expect(html).toContain('src="/assets/kitty-idle.png"');
  });

  it("连静态猫图都没有时整块不渲染 <img>，也不报错", () => {
    sources.gif = null;
    sources.bundled = null;
    const html = render();
    expect(html).toContain('data-celebrate="none"');
    expect(html).not.toContain("<img");
  });
});
