import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseSettings } from "../core/earning";
import { builtinTheme, MAODIE_THEME_ID } from "../theme/builtin";
import type { Theme } from "../theme/types";
import { FloatingBar } from "./FloatingBar";

const settings = parseSettings({ salary: "10000" });

/** 服务端渲染：悬浮条本身是纯展示 + ref 逐帧绘制，SSR 足够断言 DOM 结构（effect 不跑）。 */
function render(theme: Theme | null, decimals: 18 | 12 | 6 = 18): string {
  return renderToStaticMarkup(createElement(FloatingBar, { settings, decimals, theme }));
}

const maodie = builtinTheme(MAODIE_THEME_ID) ?? null;
const classic = builtinTheme("default") ?? null;

describe("FloatingBar：默认主题的扁横条一个字都没变", () => {
  it("keeps the classic structure and has no photo-left markup at all", () => {
    const html = render(classic);

    expect(html).toContain('class="bar"');
    expect(html).not.toContain("data-layout");
    expect(html).not.toContain("bar-photo-art");
    expect(html).not.toContain("bar-photo-main");
    // 标签 + 数字 + 脚注（阶段 + 薪资 hint）都在
    expect(html).toContain("今日实时工资");
    expect(html).toContain('data-decimals="18"');
    expect(html).toContain('class="bar-foot"');
    expect(html).toContain("元 / 21.75 天 / 8 小时");
  });

  it("has no fixed layout for a null theme either", () => {
    expect(render(null)).not.toContain("data-layout");
  });
});

describe("FloatingBar：photo-left 版式（内置耄耋猫）", () => {
  it("switches the bar to the photo-left tree", () => {
    const html = render(maodie, 18);

    expect(html).toContain('data-layout="photo-left"');
    expect(html).toContain('class="bar-photo-art" data-photo="fallback"');
    expect(html).toContain('class="bar-photo-main"');
    // 右侧三块：标签 / 数字区 / 阶段
    expect(html).toContain("今日实时工资");
    expect(html).toContain('data-decimals="18"');
    expect(html).toContain('class="phase"');
    // photo-left 版式里没有薪资 hint（右侧只放标签 + 金额 + 阶段）
    expect(html).not.toContain("21.75 天");
    expect(html).not.toContain("bar-foot-meta");
  });

  it("reuses the rolling digits: 12 integer cells and 18 fractional cells", () => {
    const html = render(maodie, 18);
    const intCells = (html.match(/class="digit" data-pos=/g) ?? []).length;
    const fracCells = (html.match(/class="digit frac-digit" data-fpos=/g) ?? []).length;

    expect(intCells).toBe(12);
    expect(fracCells).toBe(18);
    // 滚轮结构（格子窗口 + 滚条 + 字形）原样复用
    expect(html).toContain('class="digit-track"');
    expect(html).toContain('class="digit-glyph"');
    expect(html).toContain('class="frac-group"');
    expect(html).toContain('class="int-group"');
  });

  it("keeps the fractional cell count in step with the decimals tier", () => {
    expect((render(maodie, 6).match(/frac-digit/g) ?? []).length).toBe(6);
    expect((render(maodie, 12).match(/frac-digit/g) ?? []).length).toBe(12);
  });

  it("renders the solid colour block instead of an <img> when no photo can be resolved", () => {
    // node 里没有磁盘 / asset 协议：必须退化成纯色块，绝不能抛错或渲染破图
    const html = render(maodie, 18);
    expect(html).toContain('data-photo="fallback"');
    expect(html).not.toContain("bar-photo-img");
  });

  it("keeps the drag region and the hide-to-tray button", () => {
    const html = render(maodie, 18);
    expect(html).toContain('data-tauri-drag-region="deep"');
    expect(html).toContain('class="bar-close"');
  });
});
