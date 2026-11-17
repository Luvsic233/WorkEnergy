import { describe, expect, it } from "vitest";
import { isClickGesture } from "../theme/interaction";
import {
  BOUNCE_DISTANCE,
  DEFAULT_EDGE_OPTIONS,
  EDGE_THRESHOLD,
  IDENTITY_TRANSFORM,
  bounceDurationMs,
  MAX_SQUASH,
  MAX_STRETCH,
  REBOUND_MS,
  REBOUND_OFFSETS,
  REBOUND_OVERSHOOT,
  bounceAway,
  bounceEase,
  clampToWorkArea,
  edgeCompression,
  followTarget,
  isRightDragGesture,
  RIGHT_BUTTON,
  RIGHT_DRAG_THRESHOLD_PX,
  edgesFromPayload,
  isIdentity,
  proximityOf,
  reboundFrames,
  transformCss,
  transformOriginCss,
  type EdgeDistances,
} from "./edgePressure";

/** 期望值里到处要用 12：单独起个名字，读起来比裸数字清楚。 */
const BOUNCE = BOUNCE_DISTANCE;

/** 离得很远：四个方向都超阈值。 */
const FAR: EdgeDistances = { left: 400, right: 400, top: 200, bottom: 200 };
const LEFT_FLUSH: EdgeDistances = { left: 0, right: 400, top: 200, bottom: 200 };
const TOP_RIGHT: EdgeDistances = { left: 900, right: 0, top: 0, bottom: 200 };

describe("edgePressure：远离边缘", () => {
  it("returns the identity transform when nothing is within reach", () => {
    const transform = edgeCompression(FAR);
    expect(transform).toEqual(IDENTITY_TRANSFORM);
    expect(isIdentity(transform)).toBe(true);
  });

  it("treats anything beyond the threshold as identity", () => {
    for (const distance of [EDGE_THRESHOLD, EDGE_THRESHOLD + 0.5, 512, 5000]) {
      const transform = edgeCompression({ left: distance, right: distance, top: distance, bottom: distance });
      expect(isIdentity(transform)).toBe(true);
      expect(transform.originX).toBe(50);
      expect(transform.originY).toBe(50);
    }
  });

  it("keeps the identity when the intensity is zero (reduced-motion escape hatch)", () => {
    expect(isIdentity(edgeCompression(LEFT_FLUSH, { scale: 0 }))).toBe(true);
  });
});

describe("edgePressure：贴死单边", () => {
  it("squashes the horizontal axis to 0.90 with the origin on the left edge", () => {
    const transform = edgeCompression(LEFT_FLUSH);

    expect(transform.sx).toBeCloseTo(1 - MAX_SQUASH, 10);
    expect(transform.sx).toBeCloseTo(1 - MAX_SQUASH, 10);
    // 垂直方向反向膨胀 4%（体积感），而不是整体等比缩小。
    expect(transform.sy).toBeCloseTo(1 + MAX_STRETCH, 10);
    expect(transform.sy).toBeGreaterThan(1);
    // 原点在最左边：左边界不动，只有右边界内缩。
    expect(transform.originX).toBe(0);
    expect(transform.originY).toBe(50);
  });

  it("mirrors the origin to the right edge when pressed against the right one", () => {
    const transform = edgeCompression({ left: 400, right: 0, top: 200, bottom: 200 });

    expect(transform.sx).toBeCloseTo(1 - MAX_SQUASH, 10);
    expect(transform.originX).toBe(100);
    expect(transform.originY).toBe(50);
  });

  it("squashes the vertical axis when pressed against the top edge", () => {
    const transform = edgeCompression({ left: 400, right: 400, top: 0, bottom: 200 });

    expect(transform.sy).toBeCloseTo(1 - MAX_SQUASH, 10);
    expect(transform.sx).toBeCloseTo(1 + MAX_STRETCH, 10);
    expect(transform.originX).toBe(50);
    expect(transform.originY).toBe(0);
  });

  it("squashes the vertical axis downwards when pressed against the bottom edge", () => {
    const transform = edgeCompression({ left: 400, right: 400, top: 200, bottom: 0 });

    expect(transform.sy).toBeCloseTo(1 - MAX_SQUASH, 10);
    expect(transform.originY).toBe(100);
  });
});

describe("edgePressure：角落两轴同时压", () => {
  it("squashes both axes and pins the origin to the top-right corner", () => {
    const transform = edgeCompression(TOP_RIGHT);

    expect(transform.sx).toBeLessThan(1);
    expect(transform.sy).toBeLessThan(1);
    expect(transform.sx).toBeCloseTo(1 - MAX_SQUASH, 10);
    expect(transform.sy).toBeCloseTo(1 - MAX_SQUASH, 10);
    expect(transform.originX).toBe(100);
    expect(transform.originY).toBe(0);
    // 角落不再有体积膨胀的余量：两轴同时被压，乘积明显小于 1。
    expect(transform.sx * transform.sy).toBeLessThan(0.9);
  });

  it("pins every corner to its own corner", () => {
    const corners: Array<[EdgeDistances, number, number]> = [
      [{ left: 0, right: 400, top: 0, bottom: 200 }, 0, 0],
      [{ left: 400, right: 0, top: 0, bottom: 200 }, 100, 0],
      [{ left: 0, right: 400, top: 200, bottom: 0 }, 0, 100],
      [{ left: 400, right: 0, top: 200, bottom: 0 }, 100, 100],
    ];
    for (const [edges, originX, originY] of corners) {
      const transform = edgeCompression(edges);
      expect(transform.originX).toBe(originX);
      expect(transform.originY).toBe(originY);
      expect(transform.sx).toBeLessThan(1);
      expect(transform.sy).toBeLessThan(1);
    }
  });
});

describe("edgePressure：边界值与非法输入", () => {
  it("maps exactly the threshold to identity and exactly zero to full squash", () => {
    expect(proximityOf(EDGE_THRESHOLD)).toBe(0);
    expect(isIdentity(edgeCompression({ left: EDGE_THRESHOLD, right: 400, top: 200, bottom: 200 }))).toBe(true);

    expect(proximityOf(0)).toBe(1);
    expect(edgeCompression({ left: 0, right: 400, top: 200, bottom: 200 }).sx).toBeCloseTo(1 - MAX_SQUASH, 10);
  });

  it("clamps negative distances (the window pushed past the edge) to full squash", () => {
    const pressed = edgeCompression({ left: 0, right: 400, top: 200, bottom: 200 });
    for (const overshoot of [-0.001, -1, -24, -500]) {
      const transform = edgeCompression({ left: overshoot, right: 400, top: 200, bottom: 200 });
      expect(transform.sx).toBeCloseTo(pressed.sx, 10);
      expect(transform.sy).toBeCloseTo(pressed.sy, 10);
      expect(transform.originX).toBe(0);
    }
    expect(proximityOf(-30)).toBe(1);
  });

  it("interpolates linearly in between (halfway in, half the squash)", () => {
    expect(proximityOf(EDGE_THRESHOLD / 2)).toBeCloseTo(0.5, 10);

    const transform = edgeCompression({ left: EDGE_THRESHOLD / 2, right: 400, top: 200, bottom: 200 });
    expect(transform.sx).toBeCloseTo(1 - MAX_SQUASH * 0.5, 10);
    expect(transform.sy).toBeCloseTo(1 + MAX_STRETCH * 0.5, 10);
  });

  it("never leaves the 0.90..1.04 envelope for any input", () => {
    const values = [-500, -24, -1, 0, 6, 12, 23.99, 24, 200, 5000];
    for (const left of values) {
      for (const top of values) {
        const transform = edgeCompression({ left, right: 400, top, bottom: 400 });
        expect(transform.sx).toBeGreaterThanOrEqual(1 - MAX_SQUASH - 1e-9);
        expect(transform.sx).toBeLessThanOrEqual(1 + MAX_STRETCH + 1e-9);
        expect(transform.sy).toBeGreaterThanOrEqual(1 - MAX_SQUASH - 1e-9);
        expect(transform.sy).toBeLessThanOrEqual(1 + MAX_STRETCH + 1e-9);
      }
    }
  });

  it("falls back to identity for NaN / Infinity distances", () => {
    const nan = edgeCompression({ left: Number.NaN, right: Number.NaN, top: Number.NaN, bottom: Number.NaN });
    expect(isIdentity(nan)).toBe(true);

    // 非有限值一律当"没贴着"：宁可不变形，也不要在一次坏数据上把卡片压歪。
    const inf = edgeCompression({
      left: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      top: 200,
      bottom: 200,
    });
    expect(isIdentity(inf)).toBe(true);
  });

  it("honours a custom threshold and a partial intensity", () => {
    // 阈值翻倍：同样 24px 只算走到一半。
    const half = edgeCompression({ left: 24, right: 400, top: 200, bottom: 200 }, { threshold: 48 });
    expect(half.sx).toBeCloseTo(1 - MAX_SQUASH / 2, 10);

    const soft = edgeCompression({ left: 0, right: 400, top: 200, bottom: 200 }, { scale: 0.5 });
    expect(soft.sx).toBeCloseTo(1 - MAX_SQUASH / 2, 10);
  });

  it("keeps the documented defaults", () => {
    expect(DEFAULT_EDGE_OPTIONS.threshold).toBe(24);
    expect(DEFAULT_EDGE_OPTIONS.maxSquash).toBeCloseTo(MAX_SQUASH, 10);
    expect(DEFAULT_EDGE_OPTIONS.maxStretch).toBeCloseTo(0.04, 10);
    expect(DEFAULT_EDGE_OPTIONS.scale).toBe(1);
  });
});

describe("edgePressure：DOM 字符串", () => {
  it("serialises the transform and the origin for inline style writes", () => {
    const transform = edgeCompression(TOP_RIGHT);
    expect(transformCss(transform)).toBe("scale(0.8200, 0.8200)");
    expect(transformOriginCss(transform)).toBe("100% 0%");

    expect(transformCss(IDENTITY_TRANSFORM)).toBe("scale(1.0000, 1.0000)");
    expect(transformOriginCss(IDENTITY_TRANSFORM)).toBe("50% 50%");
  });
});

describe("edgePressure：事件 payload", () => {
  it("prefers the raw logical pixels (they still describe an overhang)", () => {
    const edges = edgesFromPayload({ pxLeft: -6, pxRight: 400, pxTop: 200, pxBottom: 200, left: 1, right: 0 });
    expect(edges.left).toBe(-6);
    expect(edges.right).toBe(400);
    expect(edgeCompression(edges).sx).toBeCloseTo(1 - MAX_SQUASH, 10);
  });

  it("falls back to the 0..1 proximity when the pixel fields are missing", () => {
    const edges = edgesFromPayload({ left: 1, right: 0, top: 0, bottom: 0 });
    expect(edges.left).toBe(0);
    expect(edges.right).toBe(EDGE_THRESHOLD);
    expect(edgeCompression(edges).sx).toBeCloseTo(1 - MAX_SQUASH, 10);
  });

  it("treats an empty payload as 'far from every edge'", () => {
    expect(isIdentity(edgeCompression(edgesFromPayload(undefined)))).toBe(true);
    expect(isIdentity(edgeCompression(edgesFromPayload(null)))).toBe(true);
    expect(isIdentity(edgeCompression(edgesFromPayload({})))).toBe(true);
  });
});

describe("edgePressure：松手回弹关键帧", () => {
  it("uses the documented 500ms / 4% language", () => {
    expect(REBOUND_MS).toBe(500);
    expect(REBOUND_OVERSHOOT).toBeCloseTo(0.04, 10);
    expect(REBOUND_OFFSETS[0]).toBe(0);
    expect(REBOUND_OFFSETS[REBOUND_OFFSETS.length - 1]).toBe(1);
  });

  it("starts at the pressed state, overshoots past 1, and lands on the identity", () => {
    const pressed = edgeCompression(LEFT_FLUSH);
    const frames = reboundFrames(pressed);

    expect(frames.length).toBe(REBOUND_OFFSETS.length);
    expect(frames[0].sx).toBeCloseTo(pressed.sx, 10);
    expect(frames[0].sy).toBeCloseTo(pressed.sy, 10);

    // 被压的轴过冲到 1 以上（约 4%），被撑的轴反向过冲到 1 以下。
    expect(frames[1].sx).toBeGreaterThan(1);
    expect(frames[1].sx).toBeCloseTo(1 + REBOUND_OVERSHOOT, 10);
    expect(frames[1].sy).toBeLessThan(1);

    const last = frames[frames.length - 1];
    expect(last.sx).toBe(1);
    expect(last.sy).toBe(1);
  });

  it("keeps the offsets strictly increasing", () => {
    const offsets = reboundFrames(edgeCompression(TOP_RIGHT)).map((frame) => frame.offset);
    for (let index = 1; index < offsets.length; index += 1) {
      expect(offsets[index]).toBeGreaterThan(offsets[index - 1]);
    }
  });

  it("never overshoots an already-identity axis", () => {
    for (const frame of reboundFrames(IDENTITY_TRANSFORM)) {
      expect(frame.sx).toBe(1);
      expect(frame.sy).toBe(1);
    }
  });

  it("stays inside the 0.90..1.04 envelope for a corner compression", () => {
    for (const frame of reboundFrames(edgeCompression(TOP_RIGHT))) {
      expect(frame.sx).toBeGreaterThan(1 - MAX_SQUASH - 1e-9);
      expect(frame.sx).toBeLessThan(1 + MAX_STRETCH + 1e-9);
      expect(frame.sy).toBeGreaterThan(1 - MAX_SQUASH - 1e-9);
      expect(frame.sy).toBeLessThan(1 + MAX_STRETCH + 1e-9);
    }
  });
});
describe("clampToWorkArea：不许拖出工作区", () => {
  // 主屏工作区（任务栏已排除：1920x1032）。
  const WORK = { x: 0, y: 0, width: 1920, height: 1032 };
  const CARD = { width: 320, height: 96 };

  it("returns the very same rect when it is already inside", () => {
    const inside = { x: 640, y: 400, ...CARD };
    expect(clampToWorkArea(inside, WORK)).toBe(inside);
  });

  it("keeps a rect that sits flush against each edge (0px overhang stays 0)", () => {
    for (const rect of [
      { x: 0, y: 400, ...CARD },
      { x: WORK.width - CARD.width, y: 400, ...CARD },
      { x: 640, y: 0, ...CARD },
      { x: 640, y: WORK.height - CARD.height, ...CARD },
    ]) {
      expect(clampToWorkArea(rect, WORK)).toBe(rect);
    }
  });

  it("pulls an overhanging rect back to the left / right / top / bottom edge", () => {
    expect(clampToWorkArea({ x: -6, y: 400, ...CARD }, WORK)).toEqual({ x: 0, y: 400, ...CARD });
    expect(clampToWorkArea({ x: WORK.width - CARD.width + 6, y: 400, ...CARD }, WORK)).toEqual({
      x: WORK.width - CARD.width,
      y: 400,
      ...CARD,
    });
    expect(clampToWorkArea({ x: 640, y: -6, ...CARD }, WORK)).toEqual({ x: 640, y: 0, ...CARD });
    expect(clampToWorkArea({ x: 640, y: WORK.height - CARD.height + 6, ...CARD }, WORK)).toEqual({
      x: 640,
      y: WORK.height - CARD.height,
      ...CARD,
    });
  });

  it("pulls a corner back on both axes at once", () => {
    expect(clampToWorkArea({ x: -400, y: -400, ...CARD }, WORK)).toEqual({ x: 0, y: 0, ...CARD });
    expect(clampToWorkArea({ x: 9000, y: 9000, ...CARD }, WORK)).toEqual({
      x: WORK.width - CARD.width,
      y: WORK.height - CARD.height,
      ...CARD,
    });
  });

  it("aligns a rect bigger than the work area to its top-left and lets the far side overflow", () => {
    expect(clampToWorkArea({ x: -50, y: -50, width: 2400, height: 1400 }, WORK)).toEqual({
      x: 0,
      y: 0,
      width: 2400,
      height: 1400,
    });
    // 刚好一样大：只有左上对齐这一个合法位置。
    expect(clampToWorkArea({ x: 123, y: 456, width: 1920, height: 1032 }, WORK)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1032,
    });
  });

  it("handles a monitor to the left of the primary one (negative work area)", () => {
    const secondary = { x: -1920, y: -200, width: 1920, height: 1080 };
    const inside = { x: -1700, y: 0, ...CARD };
    expect(clampToWorkArea(inside, secondary)).toBe(inside);

    // 只是越左：y 本来就落在工作区内，不该被动。
    expect(clampToWorkArea({ x: -2000, y: 0, ...CARD }, secondary)).toEqual({
      x: -1920,
      y: 0,
      ...CARD,
    });
    // 越右（已经跑到主屏去了）：夹回 -320，y 同样不动。
    expect(clampToWorkArea({ x: 100, y: 0, ...CARD }, secondary)).toEqual({
      x: -320,
      y: 0,
      ...CARD,
    });
    expect(clampToWorkArea({ x: -1000, y: -900, ...CARD }, secondary)).toEqual({
      x: -1000,
      y: -200,
      ...CARD,
    });
  });

  it("survives NaN / Infinity without producing NaN coordinates", () => {
    const clamped = clampToWorkArea({ x: Number.NaN, y: Number.POSITIVE_INFINITY, ...CARD }, WORK);
    expect(Number.isFinite(clamped.x)).toBe(true);
    expect(Number.isFinite(clamped.y)).toBe(true);
  });
});

describe("bounceAway：松手弹走", () => {
  const WORK = { x: 0, y: 0, width: 1920, height: 1032 };
  const CARD = { width: 320, height: 96 };
  const FAR = { left: 400, right: 400, top: 200, bottom: 200 };
  const FLUSH_LEFT = { x: 0, y: 400, ...CARD };
  const FLUSH_RIGHT = { x: WORK.width - CARD.width, y: 400, ...CARD };
  const FLUSH_TOP = { x: 640, y: 0, ...CARD };
  const FLUSH_BOTTOM = { x: 640, y: WORK.height - CARD.height, ...CARD };

  it("uses the documented bounce distance / duration", () => {
    expect(BOUNCE_DISTANCE).toBe(720);
    expect(bounceDurationMs(BOUNCE_DISTANCE)).toBeCloseTo(1653, 0);
    expect(bounceDurationMs(BOUNCE_DISTANCE / 2)).toBeCloseTo(1495, 0);
    expect(BOUNCE_DISTANCE).toBeGreaterThanOrEqual(8);
    expect(BOUNCE_DISTANCE).toBeLessThanOrEqual(2000);
    expect(bounceDurationMs(BOUNCE_DISTANCE)).toBeLessThanOrEqual(4000);
  });

  it("pushes a left-pressed card inwards by +x and lands BOUNCE_DISTANCE from the left edge", () => {
    const target = bounceAway(FLUSH_LEFT, { left: 0, right: 400, top: 200, bottom: 200 }, WORK);
    expect(target).toEqual({ x: BOUNCE, y: 400, ...CARD });
    expect(target.x).toBe(BOUNCE_DISTANCE);
  });

  it("mirrors every direction along the normal of the pressed edge", () => {
    expect(bounceAway(FLUSH_RIGHT, { left: 400, right: 0, top: 200, bottom: 200 }, WORK).x).toBe(
      WORK.width - CARD.width - BOUNCE,
    );
    expect(bounceAway(FLUSH_TOP, { left: 400, right: 400, top: 0, bottom: 200 }, WORK).y).toBe(BOUNCE);
    expect(bounceAway(FLUSH_BOTTOM, { left: 400, right: 400, top: 200, bottom: 0 }, WORK).y).toBe(
      WORK.height - CARD.height - BOUNCE,
    );
  });

  it("composes both directions when a corner is pressed", () => {
    const target = bounceAway({ x: 0, y: 0, ...CARD }, { left: 0, right: 400, top: 0, bottom: 200 }, WORK);
    expect(target).toEqual({ x: BOUNCE, y: BOUNCE, ...CARD });
  });

  it("scales the distance with the compression (50% -> 6px, 25% -> 3px)", () => {
    const half = bounceAway(FLUSH_LEFT, { left: 12, right: 400, top: 200, bottom: 200 }, WORK);
    expect(half.x).toBe(BOUNCE_DISTANCE / 2);
    const quarter = bounceAway(FLUSH_LEFT, { left: 18, right: 400, top: 200, bottom: 200 }, WORK);
    expect(quarter.x).toBe(BOUNCE_DISTANCE / 4);
  });

  it("does not bounce at all when nothing is compressed (returns the same rect)", () => {
    const far = { x: 640, y: 400, ...CARD };
    expect(bounceAway(far, FAR, WORK)).toBe(far);
    // 恰好等于阈值也算"没被压"。
    expect(bounceAway(far, { left: EDGE_THRESHOLD, right: 400, top: 200, bottom: 200 }, WORK)).toBe(far);
    expect(bounceAway(FLUSH_LEFT, { left: 0, right: 400, top: 200, bottom: 200 }, WORK, { distance: 0 })).toBe(
      FLUSH_LEFT,
    );
  });

  it("never bounces out of the work area on the opposite side (nearly full-width card)", () => {
    const tight = { x: 0, y: 0, width: 1915, height: 96 };
    const target = bounceAway(tight, { left: 0, right: 400, top: 200, bottom: 200 }, WORK);
    expect(target.x).toBe(WORK.width - tight.width);
    expect(target.x + target.width).toBeLessThanOrEqual(WORK.width);
  });

  it("stays inside a negative-coordinate work area (secondary monitor on the left)", () => {
    const area = { x: -1920, y: -200, width: 1920, height: 1080 };
    const pressed = { x: -1920, y: 0, ...CARD };
    expect(bounceAway(pressed, { left: 0, right: 400, top: 200, bottom: 200 }, area).x).toBe(-1920 + BOUNCE);

    const flushRight = { x: -CARD.width, y: 0, ...CARD };
    const inward = bounceAway(flushRight, { left: 400, right: 0, top: 200, bottom: 200 }, area);
    expect(inward.x).toBe(-CARD.width - BOUNCE);
    expect(inward.x).toBeGreaterThanOrEqual(area.x);
  });

  it("moves monotonically inwards and every intermediate point is inside the work area", () => {
    const pressed = { x: 0, y: 400, ...CARD };
    const target = bounceAway(pressed, { left: 0, right: 400, top: 200, bottom: 200 }, WORK);
    let previous = pressed.x;
    for (let step = 1; step <= 14; step += 1) {
      const x = Math.round(pressed.x + (target.x - pressed.x) * bounceEase(step / 14));
      expect(x).toBeGreaterThanOrEqual(previous);
      expect(x).toBeLessThanOrEqual(target.x);
      previous = x;
    }
    expect(previous).toBe(BOUNCE);
  });

  it("eases out like ice: most of the distance in the first fraction of time", () => {
    expect(bounceEase(0)).toBe(0);
    expect(bounceEase(1)).toBe(1);
    // 冰面滑行的手感用行为断言钉住，而不是钉死某条曲线的具体数值：
    // 前 10% 时间要走掉 40% 以上，后 10% 时间几乎不动。
    expect(bounceEase(0.1)).toBeGreaterThan(0.4);
    expect(bounceEase(0.5)).toBeGreaterThan(0.8);
    expect(1 - bounceEase(0.9)).toBeLessThan(0.02);
    // 单调 + 收敛：越靠后每帧的位移越小。
    let lastStep = 1;
    for (let step = 1; step <= 14; step += 1) {
      const delta = bounceEase(step / 14) - bounceEase((step - 1) / 14);
      expect(delta).toBeGreaterThan(0);
      expect(delta).toBeLessThanOrEqual(lastStep + 1e-12);
      lastStep = delta;
    }
  });
});

/* ------------------------------------------------------------------ *
 * 右键拖动 = 精确摆放：手势判定 + 跟手目标位置
 * ------------------------------------------------------------------ */

/** 右键拖动的起点。 */
const DOWN = { x: 100, y: 100, button: RIGHT_BUTTON };

describe("edgePressure：右键拖动的手势判定", () => {
  it("uses the same 4px line as the click gesture, and the line itself counts as a drag", () => {
    expect(RIGHT_DRAG_THRESHOLD_PX).toBe(4);
    // 不到 4px：还是"右键单击"，菜单照旧。
    expect(isRightDragGesture(DOWN, { x: 103.5, y: 100, buttons: RIGHT_BUTTON })).toBe(false);
    expect(isRightDragGesture(DOWN, { x: 100, y: 96.5, buttons: RIGHT_BUTTON })).toBe(false);
    // 恰好 4px：算拖动（与 isClickGesture 的 < 4px 严丝合缝，中间不留缝）。
    expect(isRightDragGesture(DOWN, { x: 104, y: 100, buttons: RIGHT_BUTTON })).toBe(true);
    expect(isRightDragGesture(DOWN, { x: 100, y: 96, buttons: RIGHT_BUTTON })).toBe(true);
    // 斜着走：3px+3px 的欧氏距离已经是 4.24px，早该算拖动。
    expect(isRightDragGesture(DOWN, { x: 103, y: 103, buttons: RIGHT_BUTTON })).toBe(true);
    expect(isRightDragGesture(DOWN, { x: 102, y: 102, buttons: RIGHT_BUTTON })).toBe(false);
  });

  it("only reacts to the right button", () => {
    // 起点就是左键：与右键拖动无关。
    expect(isRightDragGesture({ x: 100, y: 100, button: 0 }, { x: 200, y: 100, buttons: RIGHT_BUTTON })).toBe(false);
    // 移动过程中右键已经松开（或压根是左键）：不判拖动。
    expect(isRightDragGesture(DOWN, { x: 200, y: 100, buttons: 1 })).toBe(false);
    expect(isRightDragGesture(DOWN, { x: 200, y: 100, buttons: 0 })).toBe(false);
    // 左右键同时按着：右键还在，照样拖动。
    expect(isRightDragGesture(DOWN, { x: 200, y: 100, buttons: 3 })).toBe(true);
    // 只给坐标（测试里手写的简化事件）：不因为"没给按钮"就一律判否。
    expect(isRightDragGesture({ x: 0, y: 0 }, { x: 40, y: 0 })).toBe(true);
  });

  it("never fires on non-finite coordinates", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(isRightDragGesture({ x: bad, y: 0, button: RIGHT_BUTTON }, { x: 50, y: 0, buttons: RIGHT_BUTTON })).toBe(false);
      expect(isRightDragGesture(DOWN, { x: bad, y: 0, buttons: RIGHT_BUTTON })).toBe(false);
      expect(isRightDragGesture(DOWN, { x: 0, y: bad, buttons: RIGHT_BUTTON })).toBe(false);
    }
  });

  it("is the exact complement of the click gesture (both can never be true at once)", () => {
    const offsets = [-9, -5, -4.5, -4, -3.999, -2, 0, 2, 3.999, 4, 4.5, 5, 9];
    for (const dx of offsets) {
      for (const dy of offsets) {
        const down = { x: 50, y: 50, t: 1000 };
        const up = { x: 50 + dx, y: 50 + dy, t: 1000 };
        const click = isClickGesture(down, up);
        const drag = isRightDragGesture({ ...down, button: RIGHT_BUTTON }, { x: up.x, y: up.y, buttons: RIGHT_BUTTON });
        expect(click && drag).toBe(false);
        expect(click || drag).toBe(true);
        expect(drag).toBe(!click);
      }
    }
  });
});

describe("edgePressure：右键跟手的目标位置", () => {
  const WORK = { x: 0, y: 0, width: 1920, height: 1032 };
  const CARD = { width: 280, height: 96 };
  // 抓在卡片正中间：偏移 (140, 48)，于是光标在哪窗口左上角就在"光标 − (140, 48)"。
  const OFFSET = { x: 140, y: 48 };

  it("follows the cursor exactly while everything is on screen", () => {
    const target = followTarget({ x: 1000, y: 500 }, OFFSET, WORK, CARD);
    expect(target).toEqual({ x: 860, y: 452 });
    // 偏移不参与"夹取"以外任何折算：再挪一格，位移与光标位移一比一。
    expect(followTarget({ x: 1001, y: 501 }, OFFSET, WORK, CARD)).toEqual({ x: 861, y: 453 });
  });

  it("clamps back on all four edges", () => {
    // 左 / 上：光标越出工作区，窗口左上角停在 (0, 0) —— 这就是"能贴住边缘不弹走"的位置。
    expect(followTarget({ x: -500, y: -500 }, OFFSET, WORK, CARD)).toEqual({ x: 0, y: 0 });
    // 右：右边界正好压在 1920 上。
    expect(followTarget({ x: 5000, y: 500 }, OFFSET, WORK, CARD)).toEqual({ x: WORK.width - CARD.width, y: 452 });
    // 下：下边界正好压在 1032 上。
    expect(followTarget({ x: 1000, y: 5000 }, OFFSET, WORK, CARD)).toEqual({ x: 860, y: WORK.height - CARD.height });
    // 右下角：两轴同时夹住，窗口整个还在工作区里。
    const corner = followTarget({ x: 9999, y: 9999 }, OFFSET, WORK, CARD);
    expect(corner).toEqual({ x: WORK.width - CARD.width, y: WORK.height - CARD.height });
  });

  it("puts a window bigger than the work area at its top-left corner", () => {
    const huge = { width: 4000, height: 3000 };
    expect(followTarget({ x: 800, y: 600 }, OFFSET, WORK, huge)).toEqual({ x: 0, y: 0 });
    expect(followTarget({ x: -800, y: -600 }, OFFSET, WORK, huge)).toEqual({ x: 0, y: 0 });
  });

  it("handles a negative-coordinate work area (secondary monitor on the left)", () => {
    const area = { x: -1920, y: -200, width: 1920, height: 1080 };
    // 屏内：照常跟手。
    expect(followTarget({ x: -1000, y: 400 }, OFFSET, area, CARD)).toEqual({ x: -1140, y: 352 });
    // 越到主屏那一侧（x > 0）：夹回副屏右边界。
    expect(followTarget({ x: 500, y: 400 }, OFFSET, area, CARD)).toEqual({ x: -CARD.width, y: 352 });
    // 越过副屏左边：夹回 x = -1920。
    expect(followTarget({ x: -9000, y: 400 }, OFFSET, area, CARD)).toEqual({ x: area.x, y: 352 });
    // 上边界是 -200：光标再往上也不许出界。
    expect(followTarget({ x: -1000, y: -9000 }, OFFSET, area, CARD)).toEqual({ x: -1140, y: area.y });
  });

  it("treats broken numbers as 'clamp to the top-left corner', never as NaN", () => {
    const broken = followTarget({ x: NaN, y: Infinity }, OFFSET, WORK, CARD);
    expect(Number.isFinite(broken.x)).toBe(true);
    expect(Number.isFinite(broken.y)).toBe(true);
    expect(broken).toEqual({ x: 0, y: 0 });
  });
});
