import { describe, expect, it } from "vitest";
import { parseSettings, type Settings } from "../core/earning";
import {
  IDLE_INTERVAL_MS,
  NOTIFY_KEY,
  PROACTIVE_IDS,
  emptyNotifyState,
  markInteraction,
  markSent,
  parseNotifyState,
  pickProactiveMessage,
  readNotifyState,
  sentIdsOn,
  writeNotifyState,
  type NotifyStore,
  type ProactiveInput,
} from "./proactive";

/** 固定某一天（本地时区）的某个钟点：设置里的钟点是本地挂钟，所以测试也按本地时间构造。 */
function at(hours: number, minutes: number, seconds = 0): number {
  return new Date(2024, 4, 20, hours, minutes, seconds, 0).getTime();
}

const base = parseSettings({ salary: "10000" });

function input(patch: Partial<ProactiveInput> = {}): ProactiveInput {
  return {
    settings: base,
    now: at(11, 50, 10),
    phase: "在岗",
    lastInteractionAt: null,
    sent: [],
    checkedAt: at(11, 49, 50),
    ...patch,
  };
}

describe("pickProactiveMessage：每个时机都在用户设置的钟点上", () => {
  it("fires 十分钟就吃饭 when the clock crosses lunchStart - 10min", () => {
    expect(pickProactiveMessage(input())).toEqual({ id: "lunch-before-10", text: "还有十分钟就吃饭" });
  });

  it("does not fire one minute early (the moment has not been crossed yet)", () => {
    const early = input({ now: at(11, 49, 10), checkedAt: at(11, 48, 50) });
    expect(pickProactiveMessage(early)).toBeNull();
  });

  it("fires 该回去了 when the clock crosses lunchEnd - 10min, only while on lunch", () => {
    const crossing = input({ now: at(12, 50, 10), checkedAt: at(12, 49, 50), phase: "午休" });
    expect(pickProactiveMessage(crossing)).toEqual({ id: "lunch-end-10", text: "该回去了" });
  });

  it("fires 还有十分钟，稳住 ten minutes before workEnd", () => {
    const crossing = input({ now: at(17, 50, 10), checkedAt: at(17, 49, 50) });
    expect(pickProactiveMessage(crossing)).toEqual({ id: "work-end-10", text: "还有十分钟，稳住" });
  });

  it("fires 要下班了 one minute before workEnd", () => {
    const crossing = input({ now: at(17, 59, 10), checkedAt: at(17, 58, 50) });
    expect(pickProactiveMessage(crossing)).toEqual({ id: "work-end-1", text: "要下班了" });
  });

  it("fires 走啊 on the first frame whose phase is 已下班", () => {
    const crossing = input({ now: at(18, 0, 10), checkedAt: at(17, 59, 50), phase: "已下班" });
    expect(pickProactiveMessage(crossing)).toEqual({ id: "offwork", text: "走啊" });
  });

  it("fires 这个点了，你确定？ two hours into overtime", () => {
    const settings: Settings = { ...base, overtimeMode: true };
    const crossing = input({
      settings,
      phase: "加班",
      now: at(20, 0, 10),
      checkedAt: at(19, 59, 50),
    });
    expect(pickProactiveMessage(crossing)).toEqual({ id: "overtime-2h", text: "这个点了，你确定？" });
  });

  it("fires 你一个半小时没理我了 ninety minutes after the last interaction", () => {
    const last = at(10, 0, 0);
    const crossing = input({ lastInteractionAt: last, now: last + IDLE_INTERVAL_MS + 5_000, checkedAt: last + IDLE_INTERVAL_MS - 5_000 });
    expect(pickProactiveMessage(crossing)).toEqual({ id: "idle-90", text: "你一个半小时没理我了" });
  });

  it("never nags about idling when there was no interaction at all", () => {
    const quiet = input({ lastInteractionAt: null, now: at(15, 0, 0), checkedAt: at(14, 0, 0) });
    expect(pickProactiveMessage(quiet)).toBeNull();
  });
});

describe("pickProactiveMessage：每条每天最多一次", () => {
  it("stays silent when the id was already sent today", () => {
    expect(pickProactiveMessage(input({ sent: ["lunch-before-10"] }))).toBeNull();
  });

  it("still fires the other moments of the same day", () => {
    const crossing = input({ sent: ["lunch-before-10"], now: at(17, 50, 10), checkedAt: at(17, 49, 50) });
    expect(pickProactiveMessage(crossing)?.id).toBe("work-end-10");
  });

  it("keeps 走啊 ahead of the other rules when one tick crosses several moments", () => {
    // 时钟被挂起一小时后恢复：走啊 与 idle-90 同时跨过，先说话的那条必须是"走啊"。
    const crossing = input({
      now: at(18, 30, 0),
      checkedAt: at(16, 0, 0),
      phase: "已下班",
      lastInteractionAt: at(16, 30, 0),
    });
    expect(pickProactiveMessage(crossing)?.id).toBe("offwork");
  });
});

describe("pickProactiveMessage：语义筛选（不出现自相矛盾的话）", () => {
  it("never says 还有十分钟 once the phase is already 已下班", () => {
    const crossing = input({ phase: "已下班", now: at(17, 50, 10), checkedAt: at(17, 49, 50) });
    expect(pickProactiveMessage(crossing)).toBeNull();
  });

  it("never says 要下班了 while on lunch", () => {
    const crossing = input({ phase: "午休", now: at(17, 50, 10), checkedAt: at(17, 49, 50) });
    expect(pickProactiveMessage(crossing)).toBeNull();
  });

  it("says nothing at all when the settings are contradictory", () => {
    const broken: Settings = { ...base, workEndMin: 9 * 60 };
    expect(pickProactiveMessage(input({ settings: broken, phase: "配置错误" }))).toBeNull();
  });

  it("says nothing before work starts", () => {
    const crossing = input({ phase: "未到上班时间", now: at(8, 50, 10), checkedAt: at(8, 49, 50) });
    expect(pickProactiveMessage(crossing)).toBeNull();
  });

  it("skips both lunch messages when lunch is turned off", () => {
    const noLunch: Settings = { ...base, lunchStartMin: null, lunchEndMin: null };
    expect(pickProactiveMessage(input({ settings: noLunch }))).toBeNull();
    expect(
      pickProactiveMessage(input({ settings: noLunch, now: at(12, 50, 10), checkedAt: at(12, 49, 50), phase: "午休" })),
    ).toBeNull();
  });
});

describe("pickProactiveMessage：只补「运行期间跨过」的时刻", () => {
  it("uses the first check as a baseline and never sends backlog", () => {
    expect(pickProactiveMessage(input({ checkedAt: null }))).toBeNull();
  });

  it("does not fire a moment that was already in the past when the app started", () => {
    // 启动基线已经是 11:55（早过了 11:50），不该立刻补发"还有十分钟就吃饭"。
    const startedLate = input({ now: at(11, 55, 30), checkedAt: at(11, 55, 0) });
    expect(pickProactiveMessage(startedLate)).toBeNull();
  });

  it("does not fire twice when the system clock is rolled back", () => {
    // checkedAt 比 now 还晚（对时回拨）：基线取 min，于是不重复触发。
    const rolledBack = input({ now: at(11, 50, 10), checkedAt: at(11, 51, 40) });
    expect(pickProactiveMessage(rolledBack)).toBeNull();
  });
});

describe("notify 存储：每天一次 + 跨天重置", () => {
  it("treats yesterday's ids as empty (cross-day reset)", () => {
    const yesterday = { day: "2024-05-19", ids: ["lunch-before-10"] as const, lastInteractionAt: null };
    expect(sentIdsOn({ ...yesterday, ids: [...yesterday.ids] }, "2024-05-20")).toEqual([]);
    expect(sentIdsOn({ day: "2024-05-20", ids: ["offwork"], lastInteractionAt: null }, "2024-05-20")).toEqual(["offwork"]);
  });

  it("resets the record when a new day is marked", () => {
    const state = markSent({ day: "2024-05-19", ids: ["offwork"], lastInteractionAt: null }, "2024-05-20", "lunch-before-10", at(11, 50));
    expect(state).toEqual({ day: "2024-05-20", ids: ["lunch-before-10"], lastInteractionAt: at(11, 50) });
  });

  it("does not duplicate an id that is already recorded", () => {
    const once = markSent(emptyNotifyState("2024-05-20"), "2024-05-20", "offwork", at(18, 0));
    const twice = markSent(once, "2024-05-20", "offwork", at(18, 2));
    expect(twice.ids).toEqual(["offwork"]);
    expect(twice.lastInteractionAt).toBe(at(18, 2));
  });

  it("keeps the ids when a click refreshes lastInteractionAt", () => {
    const sent = markSent(emptyNotifyState("2024-05-20"), "2024-05-20", "work-end-10", at(17, 50));
    expect(markInteraction(sent, at(17, 55))).toEqual({
      day: "2024-05-20",
      ids: ["work-end-10"],
      lastInteractionAt: at(17, 55),
    });
  });

  it("survives corrupt json and unknown ids", () => {
    expect(parseNotifyState("{oops")).toEqual(emptyNotifyState());
    expect(parseNotifyState("null")).toEqual(emptyNotifyState());
    expect(parseNotifyState(JSON.stringify({ day: "2024-05-20", ids: ["offwork", "不是消息", 42] }))).toEqual({
      day: "2024-05-20",
      ids: ["offwork"],
      lastInteractionAt: null,
    });
    // 白名单就是 PROACTIVE_IDS：多一条少一条都说明有人绕过它写存储
    expect(PROACTIVE_IDS).toContain("lunch-before-10");
  });

  it("round-trips through a store and stays silent without one", () => {
    const memory = new Map<string, string>();
    const store: NotifyStore = {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
    };
    expect(readNotifyState(store)).toEqual(emptyNotifyState());
    writeNotifyState(store, markSent(emptyNotifyState("2024-05-20"), "2024-05-20", "offwork", at(18, 0)));
    expect(memory.get(NOTIFY_KEY)).toContain("offwork");
    expect(readNotifyState(store).ids).toEqual(["offwork"]);

    // 没有 localStorage（SSR / 隐私模式）：读写都是空操作，不抛错
    expect(readNotifyState(null)).toEqual(emptyNotifyState());
    expect(() => writeNotifyState(null, emptyNotifyState("2024-05-20"))).not.toThrow();
  });

  it("does not touch the settings or interactions keys", () => {
    expect(NOTIFY_KEY).toBe("workenergy.notify.v1");
    expect(NOTIFY_KEY).not.toContain("settings");
    expect(NOTIFY_KEY).not.toContain("interactions");
  });
});
