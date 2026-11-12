import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// 把内置图置空：模拟"一张图都没有"的极端情况，验证组件退化成纯色块而不是破图。
vi.mock("./bundledPhotos", () => ({
  bundledPhotoUrl: () => null,
  bundledPhotoStates: () => [],
}));

import { PhotoArt } from "./PhotoArt";

describe("PhotoArt：连内置图都没有时", () => {
  it("renders the solid colour block and no <img>", () => {
    const html = renderToStaticMarkup(<PhotoArt state="idle" />);
    expect(html).toContain('data-photo="fallback"');
    expect(html).not.toContain("bar-photo-img");
  });
});
