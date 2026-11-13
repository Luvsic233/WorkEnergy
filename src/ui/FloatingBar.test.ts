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

  it("wraps the bar in the gesture host without a native drag region", () => {
    const html = render(classic);
    expect(html).toContain('class="bar-host"');
    expect(html).not.toContain("data-tauri-drag-region");
    // 首帧没有气泡 / 没有动画标记：互动只发生在点击之后
    expect(html).not.toContain("bar-bubble");
    expect(html).not.toContain("data-fx");
  });
});

describe("FloatingBar：photo-left 版式（内置耄耋猫）", () => {
  it("switches the bar to the photo-left tree", () => {
    const html = render(maodie, 18);

    expect(html).toContain('data-layout="photo-left"');
    // 包里内置了 kitty-idle，所以 SSR 就能渲染出 <img>（浏览器里没有磁盘也照样有图）
    expect(html).toContain('class="bar-photo-art" data-photo="image"');
    expect(html).toContain("bar-photo-img");
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

  it("falls back to the bundled idle image even without any disk access", () => {
    // node 里没有磁盘 / asset 协议：此时必须用打进包里的内置图，而不是纯色块。
    const html = render(maodie, 18);
    expect(html).toContain('data-photo="image"');
    expect(html).toMatch(/class="bar-photo-img"[^>]*src="[^"]*kitty-idle/);
    expect(html).toContain('draggable="false"');
  });

  it("keeps the hide-to-tray button", () => {
    expect(render(maodie, 18)).toContain('class="bar-close"');
  });

  /*
   * 有意去掉 data-tauri-drag-region：真机实测它在 mousedown 当场就把控制权交给 OS 的窗口移动循环，
   * webview 之后连 pointerup / mouseup / click 都收不到（一次真实点击只到 pointerdown + mousedown），
   * 于是"按下→松开算点击"根本无从判定。拖动改成手势里按 4px 阈值主动 startDragging()。
   */
  it("no longer uses the native drag region: click vs drag is decided by the gesture handlers", () => {
    const html = render(maodie, 18);
    expect(html).not.toContain("data-tauri-drag-region");
    // 手势锚点（整块卡片 + 透明边距）在，卡片本体原样在里面
    expect(html).toContain('class="bar-host"');
    expect(html).toContain('data-layout="photo-left"');
  });

  it("renders no bubble and no fx marker before the first click", () => {
    const html = render(maodie, 18);
    expect(html).not.toContain("bar-bubble");
    expect(html).not.toContain("data-fx");
  });
});
