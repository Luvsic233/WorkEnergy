import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_INPUT } from "../core/settings";
import { BUILTIN_THEMES } from "../theme/builtin";
import type { Theme } from "../theme/types";
import { SettingsPanel } from "./SettingsPanel";

const adapter = { load: async () => null, save: async () => undefined };

function render(extra: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(SettingsPanel, {
      open: true,
      initial: DEFAULT_INPUT,
      adapter,
      onClose: () => undefined,
      onSaved: () => undefined,
      ...extra,
    }),
  );
}

/** 「外观主题」那一组的 HTML 片段。 */
function themeBlock(html: string): string {
  const anchor = html.indexOf('aria-label="外观主题"');
  expect(anchor).toBeGreaterThanOrEqual(0);
  return html.slice(anchor, html.indexOf("</section>", anchor));
}

describe("设置面板：外观主题", () => {
  it("lists the built-in themes when no theme service is wired in", () => {
    const block = themeBlock(render());

    expect(block).toContain("深色（默认）");
    expect(block).toContain("极简");
    // 每条主题都标了来源
    expect((block.match(/>内置</g) ?? []).length).toBe(BUILTIN_THEMES.length);
  });

  it("marks the active theme and lists user themes next to the built-in ones", () => {
    const user: Theme = {
      ...BUILTIN_THEMES[0],
      id: "user:maodie",
      name: "耄耋猫",
      source: "user",
      dirName: "maodie",
      baseDir: "C:/themes/maodie",
    };
    const block = themeBlock(render({ themes: [...BUILTIN_THEMES, user], themeId: user.id }));

    expect(block).toContain("耄耋猫");
    expect(block).toContain(">用户目录<");
    expect(block).toMatch(/aria-checked="true"[^>]*>[\s\S]{0,200}?耄耋猫/);
    expect((block.match(/aria-checked="true"/g) ?? []).length).toBe(1);
    expect(block).not.toMatch(/aria-checked="true"[^>]*>[\s\S]{0,200}?深色（默认）/);
  });

  it("offers the open-folder button, which is a no-op in the browser", () => {
    const calls: string[] = [];
    const block = themeBlock(render({ onOpenThemeFolder: () => calls.push("open") }));

    expect(block).toContain("打开主题文件夹");
    // SSR 只渲染，点击行为交给浏览器；这里断言按钮存在且带上了回调路径
    expect(block).toContain("settings-theme-open");
  });
});
