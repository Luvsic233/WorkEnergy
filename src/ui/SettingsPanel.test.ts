import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_INPUT, type RawInput } from "../core/settings";
import { CLASSIC_THEME_ID } from "../theme/builtin";
import { SettingsPanel } from "./SettingsPanel";

const adapter = { load: async () => null, save: async () => undefined };

/** 服务端渲染出面板的静态 HTML：面板本身是纯展示 + 草稿 state，不需要 DOM 环境。 */
function render(initial: RawInput = DEFAULT_INPUT): string {
  return renderToStaticMarkup(
    createElement(SettingsPanel, {
      open: true,
      initial,
      adapter,
      themeId: CLASSIC_THEME_ID,
      onClose: () => undefined,
      onSaved: () => undefined,
    }),
  );
}

/** 切出某一组档位按钮，避免被别的控件干扰。 */
function groupOf(html: string, label: string): string {
  const anchor = html.indexOf(`aria-label="${label}"`);
  expect(anchor).toBeGreaterThanOrEqual(0);
  return html.slice(anchor, html.indexOf("</div>", anchor));
}

/** 「跳动频率」那一组。 */
function refreshGroup(html: string): string {
  return groupOf(html, "跳动频率");
}

describe("SettingsPanel：跳动频率档位只服务跳跃模式", () => {
  it("disables all three tiers in roll mode: the fractional digits roll continuously anyway", () => {
    const html = render();
    const group = refreshGroup(html);

    for (const tier of ["60 Hz", "10 Hz", "1 Hz"]) expect(group).toContain(`>${tier}<`);
    // 三个按钮逐个带 disabled，组本身也标了 aria-disabled
    expect((group.match(/<button[^>]*disabled/g) ?? []).length).toBe(3);
    expect((group.match(/aria-disabled="true"/g) ?? []).length).toBe(4);
    // 整组一起压暗
    expect(html).toContain("settings-choice is-disabled");
  });

  it("keeps the stored tier marked active even while it is greyed out", () => {
    expect(refreshGroup(render())).toMatch(/aria-pressed="true"[^>]*>10 Hz</);
    expect(refreshGroup(render({ ...DEFAULT_INPUT, refreshHz: 60 }))).toMatch(/aria-pressed="true"[^>]*>60 Hz</);
    expect(refreshGroup(render({ ...DEFAULT_INPUT, refreshHz: 1 }))).toMatch(/aria-pressed="true"[^>]*>1 Hz</);
  });

  it("states exactly what the tier still does in roll mode", () => {
    const html = render();
    expect(html).toContain("滚动模式下小数连续滚动，频率档位只影响跳跃模式");
    // 旧的模糊说法不能再出现
    expect(html).not.toContain("机械滚动按每帧渲染");
    expect(html).not.toContain("滚动时长随频率自适应");
    expect(html).not.toContain("60 Hz 首尾相接连续流动");
  });

  it("re-enables the three tiers once jump is selected and explains the jump", () => {
    const html = render({ ...DEFAULT_INPUT, displayMode: "jump" });
    const group = refreshGroup(html);

    expect(group).not.toContain("disabled");
    expect(group).not.toContain("aria-disabled");
    expect(html).not.toContain("settings-choice is-disabled");
    expect(html).toContain("整串数字按此频率整片跳变，没有任何动画");
    expect(html).not.toContain("滚动模式下小数连续滚动，频率档位只影响跳跃模式");
  });
});

describe("SettingsPanel：显示相关三组控件", () => {
  it("keeps 10 Hz active by default while the display mode stays roll", () => {
    const html = render();
    expect(refreshGroup(html)).toMatch(/aria-pressed="true"[^>]*>10 Hz</);

    const modeAnchor = html.indexOf('aria-label="显示方式"');
    const modeGroup = html.slice(modeAnchor, html.indexOf("</div>", modeAnchor));
    expect(modeGroup).toMatch(/aria-pressed="true"[^>]*>机械滚动</);
  });

  it("shows a 窗口尺寸 group next to 小数位数 and 跳动频率, compact active by default", () => {
    const html = render();
    const group = groupOf(html, "窗口尺寸");

    expect(group).toContain(">紧凑<");
    expect(group).toContain(">标准<");
    expect(group).toContain(">宽松<");
    expect(group).toMatch(/aria-pressed="true"[^>]*>紧凑</);
    expect(group).not.toContain("disabled");
    // 四组控件确实排在显示相关区域的同一组里（显示方式 / 小数位数 / 跳动频率 / 窗口尺寸）
    const display = html.slice(html.indexOf('class="settings-display"'));
    for (const label of ["显示方式", "小数位数", "跳动频率", "窗口尺寸"]) {
      expect(display).toContain(`aria-label="${label}"`);
    }
    expect(display.indexOf("窗口尺寸")).toBeGreaterThan(display.indexOf("跳动频率"));
  });

  it("marks the stored size tier active and states its pixel size", () => {
    const standard = render({ ...DEFAULT_INPUT, sizePreset: "standard" });
    expect(standard).toMatch(/aria-pressed="true"[^>]*>标准</);
    expect(standard).toContain("360 × 96 逻辑像素");
    expect(standard).not.toMatch(/aria-pressed="true"[^>]*>紧凑</);

    const wide = render({ ...DEFAULT_INPUT, sizePreset: "wide" });
    expect(wide).toMatch(/aria-pressed="true"[^>]*>宽松</);
    expect(wide).toContain("400 × 120 逻辑像素");
  });

  it("keeps 小数位数 clickable in both display modes", () => {
    for (const displayMode of ["roll", "jump"] as const) {
      const html = render({ ...DEFAULT_INPUT, displayMode });
      const group = groupOf(html, "小数位数");
      expect(group).not.toContain("disabled");
      expect(group).toContain(">18 位<");
    }
  });
});

describe("SettingsPanel：加班计薪三选一 + 一个数值", () => {
  it("offers the three modes in one group with multiplier active by default", () => {
    const group = groupOf(render(), "加班计薪");
    expect(group).toContain(">倍数<");
    expect(group).toContain(">固定时薪<");
    expect(group).toContain(">固定总额<");
    expect(group).toMatch(/aria-pressed="true"[^>]*>倍数</);
  });

  it("marks whichever mode is stored as the active one", () => {
    expect(groupOf(render({ ...DEFAULT_INPUT, overtimePayMode: "fixedHourly" }), "加班计薪")).toMatch(
      /aria-pressed="true"[^>]*>固定时薪</,
    );
    expect(groupOf(render({ ...DEFAULT_INPUT, overtimePayMode: "fixedTotal" }), "加班计薪")).toMatch(
      /aria-pressed="true"[^>]*>固定总额</,
    );
  });

  it("relabels the single number input with the active mode's unit", () => {
    expect(render()).toContain('settings-field-label">倍数<');
    expect(render({ ...DEFAULT_INPUT, overtimePayMode: "fixedHourly" })).toContain('settings-field-label">元每小时<');
    expect(render({ ...DEFAULT_INPUT, overtimePayMode: "fixedTotal" })).toContain('settings-field-label">元每次<');
  });

  it("shows the number that belongs to the active mode, not the other two", () => {
    const html = render({ ...DEFAULT_INPUT, overtimePayMode: "fixedTotal", overtimeFixedTotal: "888" });
    expect(html).toContain('value="888"');
    expect(html).toContain('settings-field-label">元每次<');
    // 倍数制下的 1.5 不会跑到固定总额的输入框里
    expect(html).not.toContain('value="1.5"');
  });

  it("stays editable while the overtime switch is off, and says it does not bite yet", () => {
    const off = render();
    expect(groupOf(off, "加班计薪")).not.toContain("disabled");
    expect(off).toContain("（加班模式未开启，这一档暂不生效）");

    const on = render({ ...DEFAULT_INPUT, overtimeMode: true });
    expect(on).not.toContain("（加班模式未开启，这一档暂不生效）");
    expect(on).toContain("加班时薪 = 正常时薪 × 倍数（1.0–5.0，步长 0.1）；1.0 等于完全不加成。");
  });

  it("explains each mode in place", () => {
    expect(render({ ...DEFAULT_INPUT, overtimeMode: true, overtimePayMode: "fixedHourly" })).toContain(
      "加班时段每小时固定这么多钱，与月薪无关；正常工作时段仍按上面的月薪换算。",
    );
    expect(render({ ...DEFAULT_INPUT, overtimeMode: true, overtimePayMode: "fixedTotal" })).toContain(
      "下班那一刻一次性到账这个金额（与加班多久无关），之后的加班时段仍按正常时薪继续累计。",
    );
  });

  it("flags a bad number in place, right next to the input", () => {
    const outOfStep = render({ ...DEFAULT_INPUT, overtimeMultiplier: "1.55" });
    expect(outOfStep).toContain("倍数步长为 0.1（例如 1.5）");
    expect(outOfStep).toContain("settings-input is-invalid");

    expect(render({ ...DEFAULT_INPUT, overtimeMultiplier: "9" })).toContain("倍数必须在 1.0–5.0 之间");
    expect(render({ ...DEFAULT_INPUT, overtimePayMode: "fixedHourly", overtimeFixedHourly: "0" })).toContain(
      "元每小时必须大于 0",
    );
    expect(render({ ...DEFAULT_INPUT, overtimePayMode: "fixedTotal", overtimeFixedTotal: "-1" })).toContain(
      "元每次必须是数字（最多 12 位整数、6 位小数）",
    );
  });
});
