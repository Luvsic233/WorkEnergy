import { describe, expect, it } from "vitest";
import {
  CLICK_MAX_DISTANCE_PX,
  CLICK_MAX_DURATION_MS,
  INTERACTION_KEY,
  MILESTONES,
  PHRASES,
  counterLine,
  dayKey,
  defaultInteractionStore,
  firedMilestones,
  isClickGesture,
  milestoneReached,
  parseInteractionState,
  pickPhrase,
  readInteractionState,
  registerClick,
  writeInteractionState,
  type InteractionStore,
} from "./interaction";

/** 内存存储：与 settings/storage.ts 的单测同一个套路（可注入、可观察写入）。 */
function memoryStore(seed: Record<string, string> = {}): InteractionStore & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("isClickGesture：位移 4px / 时长 500ms 的边界两侧", () => {
  const down = { x: 100, y: 40, t: 1_000 };

  it("accepts a still, short press", () => {
    expect(isClickGesture(down, { x: 100, y: 40, t: 1_000 })).toBe(true);
  });

  it("accepts 3.9px of travel but rejects exactly 4px", () => {
    expect(isClickGesture(down, { x: 103.9, y: 40, t: 1_050 })).toBe(true);
    expect(isClickGesture(down, { x: 104, y: 40, t: 1_050 })).toBe(false);
  });

  it("measures the euclidean distance, not each axis separately", () => {
    // 3px + 2px = 3.6px 的斜向位移仍算点击
    expect(isClickGesture(down, { x: 103, y: 42, t: 1_050 })).toBe(true);
    // 3px + 3px = 4.24px 已经越界
    expect(isClickGesture(down, { x: 103, y: 43, t: 1_050 })).toBe(false);
  });

  it("accepts 499ms but rejects 500ms and anything longer", () => {
    expect(isClickGesture(down, { x: 101, y: 40, t: 1_000 + CLICK_MAX_DURATION_MS - 1 })).toBe(true);
    expect(isClickGesture(down, { x: 101, y: 40, t: 1_000 + CLICK_MAX_DURATION_MS })).toBe(false);
    expect(isClickGesture(down, { x: 101, y: 40, t: 9_000 })).toBe(false);
  });

  it("rejects a negative duration and any non-finite number", () => {
    expect(isClickGesture(down, { x: 100, y: 40, t: 900 })).toBe(false);
    expect(isClickGesture(down, { x: Number.NaN, y: 40, t: 1_100 })).toBe(false);
    expect(isClickGesture(down, { x: 100, y: 40, t: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("keeps the published thresholds", () => {
    expect(CLICK_MAX_DISTANCE_PX).toBe(4);
    expect(CLICK_MAX_DURATION_MS).toBe(500);
  });
});

describe("pickPhrase：注入随机数就是确定性的", () => {
  it("maps 0..1 onto the whole phrase table in order", () => {
    expect(pickPhrase(0)).toBe(PHRASES[0]);
    expect(pickPhrase(1 / PHRASES.length)).toBe(PHRASES[1]);
    expect(pickPhrase(0.5)).toBe(PHRASES[Math.floor(0.5 * PHRASES.length)]);
    expect(pickPhrase(0.999999)).toBe(PHRASES[PHRASES.length - 1]);
  });

  it("is stable: the same random always yields the same phrase", () => {
    for (const random of [0, 0.13, 0.42, 0.87]) {
      expect(pickPhrase(random)).toBe(pickPhrase(random));
    }
  });

  it("converges out-of-range and non-finite randoms into the table", () => {
    expect(pickPhrase(-1)).toBe(PHRASES[0]);
    expect(pickPhrase(2)).toBe(PHRASES[PHRASES.length - 1]);
    expect(pickPhrase(Number.NaN)).toBe(PHRASES[0]);
  });

  it("ships 6-8 short phrases, each at most 8 characters, all plain text", () => {
    expect(PHRASES.length).toBeGreaterThanOrEqual(6);
    expect(PHRASES.length).toBeLessThanOrEqual(8);
    for (const phrase of PHRASES) {
      expect(phrase.length).toBeGreaterThan(0);
      expect(phrase.length).toBeLessThanOrEqual(8);
      // 零素材纪律：短句里不许出现任何标签 / 图片 / emoji 代理对
      expect(phrase).not.toMatch(/[<>\u{1F300}-\u{1FAFF}]/u);
    }
    expect(new Set(PHRASES).size).toBe(PHRASES.length);
  });
});

describe("milestoneReached：命中 / 未命中 / 已触发过不重复", () => {
  it("hits exactly on the milestone", () => {
    expect(milestoneReached(10, [])).toBe(10);
    expect(milestoneReached(500, [])).toBe(500);
  });

  it("misses below the first milestone and between milestones", () => {
    expect(milestoneReached(0, [])).toBeNull();
    expect(milestoneReached(9, [])).toBeNull();
    expect(milestoneReached(49, [10])).toBeNull();
  });

  it("never repeats an already fired milestone", () => {
    expect(milestoneReached(10, [10])).toBeNull();
    expect(milestoneReached(60, [10, 50])).toBeNull();
  });

  it("returns the highest pending milestone when several are due at once", () => {
    expect(milestoneReached(60, [])).toBe(50);
    expect(milestoneReached(1_000, [10, 50])).toBe(500);
  });

  it("ignores non-finite counts", () => {
    expect(milestoneReached(Number.NaN, [])).toBeNull();
  });

  it("records every reached milestone so a jump never back-fires", () => {
    expect(firedMilestones(60, [])).toEqual([10, 50]);
    expect(firedMilestones(9, [])).toEqual([]);
    expect(firedMilestones(1_000, [10])).toEqual([10, 50, 100, 200, 500]);
    // 已经弹过的档位永远不会被"取消记录"（哪怕当前计数还没到那一档）
    expect(firedMilestones(10, [10, 50])).toEqual([10, 50]);
  });
});

describe("点击计数持久化：往返 / 坏数据 / 存储不可用", () => {
  it("round-trips through an injected store", () => {
    const store = memoryStore();
    const state = { total: 12, today: 3, day: "2026-11-12", milestones: [10] };
    writeInteractionState(store, state);
    expect(readInteractionState(store)).toEqual(state);
    expect(store.data[INTERACTION_KEY]).toContain('"total":12');
  });

  it("falls back to an empty state for missing / broken payloads", () => {
    expect(readInteractionState(null).total).toBe(0);
    expect(readInteractionState(memoryStore()).total).toBe(0);
    expect(readInteractionState(memoryStore({ [INTERACTION_KEY]: "{not json" })).total).toBe(0);
    expect(readInteractionState(memoryStore({ [INTERACTION_KEY]: "[]" })).total).toBe(0);
    expect(parseInteractionState('{"total":-5,"today":"9","milestones":[10,"50",999]}')).toEqual({
      total: 0,
      today: 0,
      day: "",
      milestones: [10],
    });
  });

  it("survives a store that throws on read or write", () => {
    const throwing: InteractionStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(readInteractionState(throwing).total).toBe(0);
    expect(() => writeInteractionState(throwing, { total: 1, today: 1, day: "d", milestones: [] })).not.toThrow();
  });

  it("returns no store outside a browser", () => {
    expect(defaultInteractionStore()).toBeNull();
  });

  it("registers a click: total grows, today grows, milestone fires once", () => {
    const store = memoryStore();
    const day = "2026-11-12";
    let state = readInteractionState(store);
    const milestones: number[] = [];
    for (let click = 1; click <= 11; click += 1) {
      const next = registerClick(state, day);
      state = next.state;
      writeInteractionState(store, state);
      if (next.milestone !== null) milestones.push(next.milestone);
    }
    expect(state.total).toBe(11);
    expect(state.today).toBe(11);
    expect(milestones).toEqual([10]);
    expect(readInteractionState(store)).toEqual(state);
  });

  it("resets the daily counter across days but keeps the cumulative one", () => {
    const first = registerClick({ total: 41, today: 7, day: "2026-11-11", milestones: [10] }, "2026-11-12");
    expect(first.state).toEqual({ total: 42, today: 1, day: "2026-11-12", milestones: [10] });
  });

  it("keeps exactly one celebration per milestone forever", () => {
    const fired = [10];
    const next = registerClick({ total: 10, today: 1, day: "d", milestones: fired }, "d");
    expect(next.milestone).toBeNull();
    expect(next.state.milestones).toEqual([10]);
  });
});

describe("dayKey / counterLine", () => {
  it("formats a local day key", () => {
    const ms = new Date(2026, 10, 12, 9, 30).getTime();
    expect(dayKey(ms)).toBe("2026-11-12");
    expect(dayKey(Number.NaN)).toBe("");
  });

  it("shows the counter only every COUNTER_EVERY clicks", () => {
    expect(counterLine(0)).toBeNull();
    expect(counterLine(1)).toBeNull();
    expect(counterLine(5)).toBe("今日第 5 次摸鱼");
    expect(counterLine(12)).toBeNull();
    expect(counterLine(20)).toBe("今日第 20 次摸鱼");
  });
});

describe("里程碑表", () => {
  it("stays sorted and unique", () => {
    expect([...MILESTONES]).toEqual([...MILESTONES].sort((a, b) => a - b));
    expect(new Set(MILESTONES).size).toBe(MILESTONES.length);
  });
});
