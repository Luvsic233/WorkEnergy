import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDGE_OPTIONS,
  EDGE_THRESHOLD,
  IDENTITY_TRANSFORM,
  MAX_SQUASH,
  MAX_STRETCH,
  REBOUND_MS,
  REBOUND_OFFSETS,
  REBOUND_OVERSHOOT,
  edgeCompression,
  edgesFromPayload,
  isIdentity,
  proximityOf,
  reboundFrames,
  transformCss,
  transformOriginCss,
  type EdgeDistances,
} from "./edgePressure";

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
    expect(transform.sx).toBeCloseTo(0.9, 10);
    // 垂直方向反向膨胀 4%（体积感），而不是整体等比缩小。
    expect(transform.sy).toBeCloseTo(1 + MAX_STRETCH, 10);
    expect(transform.sy).toBeGreaterThan(1);
    // 原点在最左边：左边界不动，只有右边界内缩。
    expect(transform.originX).toBe(0);
    expect(transform.originY).toBe(50);
  });

  it("mirrors the origin to the right edge when pressed against the right one", () => {
    const transform = edgeCompression({ left: 400, right: 0, top: 200, bottom: 200 });

    expect(transform.sx).toBeCloseTo(0.9, 10);
    expect(transform.originX).toBe(100);
    expect(transform.originY).toBe(50);
  });

  it("squashes the vertical axis when pressed against the top edge", () => {
    const transform = edgeCompression({ left: 400, right: 400, top: 0, bottom: 200 });

    expect(transform.sy).toBeCloseTo(0.9, 10);
    expect(transform.sx).toBeCloseTo(1.04, 10);
    expect(transform.originX).toBe(50);
    expect(transform.originY).toBe(0);
  });

  it("squashes the vertical axis downwards when pressed against the bottom edge", () => {
    const transform = edgeCompression({ left: 400, right: 400, top: 200, bottom: 0 });

    expect(transform.sy).toBeCloseTo(0.9, 10);
    expect(transform.originY).toBe(100);
  });
});

describe("edgePressure：角落两轴同时压", () => {
  it("squashes both axes and pins the origin to the top-right corner", () => {
    const transform = edgeCompression(TOP_RIGHT);

    expect(transform.sx).toBeLessThan(1);
    expect(transform.sy).toBeLessThan(1);
    expect(transform.sx).toBeCloseTo(0.9, 10);
    expect(transform.sy).toBeCloseTo(0.9, 10);
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
    expect(edgeCompression({ left: 0, right: 400, top: 200, bottom: 200 }).sx).toBeCloseTo(0.9, 10);
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
        expect(transform.sx).toBeGreaterThanOrEqual(0.9 - 1e-9);
        expect(transform.sx).toBeLessThanOrEqual(1.04 + 1e-9);
        expect(transform.sy).toBeGreaterThanOrEqual(0.9 - 1e-9);
        expect(transform.sy).toBeLessThanOrEqual(1.04 + 1e-9);
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
    expect(DEFAULT_EDGE_OPTIONS.maxSquash).toBeCloseTo(0.1, 10);
    expect(DEFAULT_EDGE_OPTIONS.maxStretch).toBeCloseTo(0.04, 10);
    expect(DEFAULT_EDGE_OPTIONS.scale).toBe(1);
  });
});

describe("edgePressure：DOM 字符串", () => {
  it("serialises the transform and the origin for inline style writes", () => {
    const transform = edgeCompression(TOP_RIGHT);
    expect(transformCss(transform)).toBe("scale(0.9000, 0.9000)");
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
    expect(edgeCompression(edges).sx).toBeCloseTo(0.9, 10);
  });

  it("falls back to the 0..1 proximity when the pixel fields are missing", () => {
    const edges = edgesFromPayload({ left: 1, right: 0, top: 0, bottom: 0 });
    expect(edges.left).toBe(0);
    expect(edges.right).toBe(EDGE_THRESHOLD);
    expect(edgeCompression(edges).sx).toBeCloseTo(0.9, 10);
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
      expect(frame.sx).toBeGreaterThan(0.9 - 1e-9);
      expect(frame.sx).toBeLessThan(1.04 + 1e-9);
      expect(frame.sy).toBeGreaterThan(0.9 - 1e-9);
      expect(frame.sy).toBeLessThan(1.04 + 1e-9);
    }
  });
});
