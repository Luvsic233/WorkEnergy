import { describe, expect, it } from "vitest";
import {
  MAX_CARD_WIDTH,
  MIN_CARD_WIDTH,
  SETTLE_FRAMES,
  clampCardWidth,
  createSettleTracker,
  digitCountOf,
} from "./adaptiveWidth";

describe("digitCountOf", () => {
  it("counts plain integer digits", () => {
    expect(digitCountOf("86")).toBe(2);
    expect(digitCountOf("5002933")).toBe(7);
  });

  it("ignores thousands separators and other non-digits", () => {
    expect(digitCountOf("1,234")).toBe(4);
    expect(digitCountOf(" 42 ")).toBe(2);
  });

  it("never returns less than one digit", () => {
    expect(digitCountOf("")).toBe(1);
    expect(digitCountOf("abc")).toBe(1);
  });
});

describe("clampCardWidth", () => {
  it("keeps a width inside the range", () => {
    expect(clampCardWidth(300)).toBe(300);
  });

  it("clamps to the min and max bounds", () => {
    expect(clampCardWidth(10)).toBe(MIN_CARD_WIDTH);
    expect(clampCardWidth(9999)).toBe(MAX_CARD_WIDTH);
  });

  it("falls back to the min for non-finite input and rounds fractions", () => {
    expect(clampCardWidth(Number.NaN)).toBe(MIN_CARD_WIDTH);
    expect(clampCardWidth(Number.POSITIVE_INFINITY)).toBe(MAX_CARD_WIDTH);
    expect(clampCardWidth(287.6)).toBe(288);
  });
});

describe("createSettleTracker", () => {
  it("fires once after the same key settles for SETTLE_FRAMES frames", () => {
    const tracker = createSettleTracker();
    const results: boolean[] = [];
    for (let frame = 0; frame < SETTLE_FRAMES; frame += 1) results.push(tracker.push(2));
    expect(results.slice(0, SETTLE_FRAMES - 1).every((value) => value === false)).toBe(true);
    expect(results[SETTLE_FRAMES - 1]).toBe(true);
  });

  it("does not fire again for the same key", () => {
    const tracker = createSettleTracker();
    for (let frame = 0; frame < SETTLE_FRAMES; frame += 1) tracker.push(2);
    for (let frame = 0; frame < SETTLE_FRAMES * 2; frame += 1) {
      expect(tracker.push(2)).toBe(false);
    }
  });

  it("resets the streak when the key flips (carry boundary) and fires again for the new key", () => {
    const tracker = createSettleTracker();
    expect(tracker.push(3)).toBe(false);
    expect(tracker.push(3)).toBe(false);
    expect(tracker.push(4)).toBe(false);
    expect(tracker.push(4)).toBe(false);
    expect(tracker.push(4)).toBe(true);
  });

  it("reset() clears the streak", () => {
    const tracker = createSettleTracker();
    tracker.push(5);
    tracker.reset();
    expect(tracker.push(5)).toBe(false);
  });
});
