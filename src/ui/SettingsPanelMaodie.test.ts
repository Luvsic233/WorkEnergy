import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_INPUT, type RawInput } from "../core/settings";
import { BUILTIN_THEMES, MAODIE_THEME_ID } from "../theme/builtin";
import { SettingsPanel } from "./SettingsPanel";

const adapter = { load: async () => null, save: async () => undefined };

function render(themeId: string, initial: RawInput = DEFAULT_INPUT): string {
  return renderToStaticMarkup(
    createElement(SettingsPanel, {
      open: true,
      initial,
      adapter,
      onClose: () => undefined,
      onSaved: () => undefined,
      themes: BUILTIN_THEMES,
      themeId,
    }),
  );
}

/** 「窗口尺寸」那一整块（含着它自己的 div.settings-choice 开标签，便于断言置灰）。 */
function sizeChoice(html: string): string {
  const anchor = html.indexOf('aria-label="窗口尺寸"');
  expect(anchor).toBeGreaterThanOrEqual(0);
  const start = html.lastIndexOf('<div class="settings-choice', anchor);
  const end = html.indexOf('<div class="settings-themes"', anchor);
  return html.slice(start, end);
}

describe("SettingsPanel：耄耋猫的固定窗口尺寸", () => {
  it("greys out the three size tiers and says the size is fixed at 340x96", () => {
    const html = render(MAODIE_THEME_ID);
    const group = sizeChoice(html);

    expect((group.match(/<button[^>]*disabled/g) ?? []).length).toBe(3);
    // 组本身也标了 aria-disabled（3 个按钮 + 1 个组）
    expect((group.match(/aria-disabled="true"/g) ?? []).length).toBe(4);
    // 整块一起压暗
    expect(group).toContain('class="settings-choice is-disabled"');
    expect(html).toContain("该主题固定 340 × 96 逻辑像素");
    // 已存的档位照旧显示，切回别的主题时原选择还在
    expect(group).toMatch(/aria-pressed="true"[^>]*>紧凑</);
    expect(group).toContain(">紧凑<");
    expect(group).toContain(">标准<");
    expect(group).toContain(">宽松<");
  });

  it("keeps the tiers clickable for the default theme", () => {
    const html = render("default");
    const group = sizeChoice(html);

    expect(group).not.toContain("disabled");
    expect(group).not.toContain("aria-disabled");
    expect(html).not.toContain("该主题固定");
    expect(html).toContain("300 × 80 逻辑像素");
  });

  it("lists the maodie theme next to the other built-ins", () => {
    const html = render("default");
    expect(html).toContain("耄耋猫");
    expect(html).toContain("极简");
  });
});
