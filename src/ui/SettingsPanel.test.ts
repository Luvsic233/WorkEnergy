import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_INPUT, type RawInput } from "../core/settings";
import { SettingsPanel } from "./SettingsPanel";

const adapter = { load: async () => null, save: async () => undefined };

/** 服务端渲染出面板的静态 HTML：面板本身是纯展示 + 草稿 state，不需要 DOM 环境。 */
function render(initial: RawInput = DEFAULT_INPUT): string {
  return renderToStaticMarkup(
    createElement(SettingsPanel, {
      open: true,
      initial,
      adapter,
      onClose: () => undefined,
      onSaved: () => undefined,
    }),
  );
}

/** 切出「跳动频率」那一组按钮，避免被别的控件干扰。 */
function refreshGroup(html: string): string {
  const anchor = html.indexOf('aria-label="跳动频率"');
  expect(anchor).toBeGreaterThanOrEqual(0);
  return html.slice(anchor, html.indexOf("</div>", anchor));
}

describe("SettingsPanel：跳动频率三档在滚动模式下也可用", () => {
  it("renders all three tiers enabled, with not a single disabled control on the panel", () => {
    const html = render();
    const group = refreshGroup(html);

    expect(group).toContain(">60 Hz<");
    expect(group).toContain(">10 Hz<");
    expect(group).toContain(">1 Hz<");
    expect(group).not.toContain("disabled");
    expect(group).not.toContain("aria-disabled");
    // 整块面板都没有 disabled：档位不再被"机械滚动"锁死
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("is-disabled");
  });

  it("keeps 10 Hz active by default while the display mode stays roll", () => {
    const html = render();
    expect(refreshGroup(html)).toMatch(/aria-pressed="true"[^>]*>10 Hz</);

    const modeAnchor = html.indexOf('aria-label="显示方式"');
    const modeGroup = html.slice(modeAnchor, html.indexOf("</div>", modeAnchor));
    expect(modeGroup).toMatch(/aria-pressed="true"[^>]*>机械滚动</);
  });

  it("lets the user pick 60 Hz or 1 Hz instead of locking them out", () => {
    expect(refreshGroup(render({ ...DEFAULT_INPUT, refreshHz: 60 }))).toMatch(/aria-pressed="true"[^>]*>60 Hz</);
    expect(refreshGroup(render({ ...DEFAULT_INPUT, refreshHz: 1 }))).toMatch(/aria-pressed="true"[^>]*>1 Hz</);
    expect(refreshGroup(render({ ...DEFAULT_INPUT, refreshHz: 60 }))).not.toContain("disabled");
  });

  it("drops the stale 'renders every frame' hint for the adaptive-duration one", () => {
    const html = render();
    expect(html).not.toContain("机械滚动按每帧渲染");
    expect(html).not.toContain("频率档位只在整串跳动时生效");
    expect(html).toContain("滚动时长随频率自适应");
    expect(html).toContain("10 Hz 每 100 ms 一段");
    expect(html).toContain("60 Hz 首尾相接连续流动");
  });

  it("explains the jump tier instead of the roll tier once jump is selected", () => {
    const html = render({ ...DEFAULT_INPUT, displayMode: "jump" });
    expect(html).toContain("整串数字按此频率整片跳变，没有任何动画");
    expect(html).not.toContain("滚动时长随频率自适应");
    expect(refreshGroup(html)).not.toContain("disabled");
  });
});
