import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PHRASES, counterLine } from "../theme/interaction";
import { BubbleChannel, ClickFeedback } from "./ClickFeedback";

/** SSR 冒烟：气泡是纯展示组件，静态渲染足够断言结构与文案（不跑 effect、不碰存储）。 */
function render(text: string): string {
  return renderToStaticMarkup(createElement(ClickFeedback, { text }));
}

describe("ClickFeedback：点击气泡", () => {
  it("renders the phrase as plain text inside its own layer", () => {
    const html = render(PHRASES[0]);

    expect(html).toContain('class="bar-bubble"');
    expect(html).toContain('class="bar-bubble-text"');
    expect(html).toContain(PHRASES[0]);
    // 纯文本：不加载任何图片 / 图标，也不参与交互（pointer-events: none 写在 styles.css）
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<svg");
    expect(html).toContain('aria-hidden="true"');
  });

  it("renders the counter line the same way", () => {
    expect(render(counterLine(5) ?? "")).toContain("今日第 5 次摸鱼");
  });

  it("keeps exactly one text element, so the bubble can never push the card open", () => {
    const html = render(PHRASES[2]);
    expect((html.match(/<span class="bar-bubble-text">/g) ?? []).length).toBe(1);
  });

  it("renders every built-in phrase without escaping surprises", () => {
    for (const phrase of PHRASES) {
      expect(render(phrase)).toContain(phrase);
    }
  });

  it("marks who is talking with data-kind, without changing the visuals", () => {
    expect(renderToStaticMarkup(createElement(ClickFeedback, { text: PHRASES[0], kind: "click" }))).toContain('data-kind="click"');
    // 不传 kind 时不多写任何属性（旧调用点渲染结果逐字节不变）
    expect(renderToStaticMarkup(createElement(ClickFeedback, { text: PHRASES[0] }))).not.toContain("data-kind");
  });
});

describe("BubbleChannel：点击吐槽与主动气泡共用唯一一个气泡槽", () => {
  it("renders one bubble for one message (either kind)", () => {
    const html = renderToStaticMarkup(
      createElement(BubbleChannel, { bubble: { token: 3, text: "还有十分钟就吃饭", kind: "proactive" } }),
    );

    expect(html).toContain('class="bar-bubble"');
    expect(html).toContain('data-kind="proactive"');
    expect(html).toContain("还有十分钟就吃饭");
    // 仍然只有一个文字节点：永远不会叠出第二条气泡
    expect((html.match(/<span class="bar-bubble-text">/g) ?? []).length).toBe(1);
    expect(html).not.toContain("<img");
  });

  it("renders nothing at all while the slot is empty", () => {
    expect(renderToStaticMarkup(createElement(BubbleChannel, { bubble: null }))).toBe("");
  });
});
