/*
 * 主动气泡：猫自己找时机说话（纯逻辑，不碰 DOM / 存储实现）。
 *
 * 三条纪律：
 * 1) 每一个"时刻"都从用户设置的 workStart / workEnd / lunchStart / lunchEnd 推算，
 *    代码里没有任何写死的钟点（09:00 只在默认设置里出现，不在这里）；
 * 2) 只在「应用运行期间跨过那个时刻」时触发：第一次判定只建立基线（checkedAt === null → 不发），
 *    于是启动时绝不会把今天已经过去的时刻补发一遍（prev <= moment <= now 才命中）；
 * 3) 每条消息每天最多一次，记在独立存储键 workenergy.notify.v1 里，跨天自动重置。
 *
 * 这里不读时间、不读 localStorage、不读随机数：输入全部由调用方注入，单测直接构造边界。
 */
import { isMisconfigured, type Phase, type Settings } from "../core/earning";

/** 主动消息的存储键：独立一份，绝不写进 workenergy.settings.v1 / workenergy.interactions.v1。 */
export const NOTIFY_KEY = "workenergy.notify.v1";

export const MINUTE_MS = 60_000;

/** 距上次互动多久算"你一个半小时没理我了"。 */
export const IDLE_INTERVAL_MS = 90 * MINUTE_MS;

/** 下班前多少分钟提醒（两条）。 */
export const WORK_END_WARN_MS = 10 * MINUTE_MS;
export const WORK_END_LAST_CALL_MS = MINUTE_MS;

/** 午休开始前 / 结束前的提醒提前量。 */
export const LUNCH_WARN_MS = 10 * MINUTE_MS;

/** 加班多久之后问一句"你确定？"。 */
export const OVERTIME_ASK_MS = 2 * 60 * MINUTE_MS;

/** 全部消息 id（白名单：存储里多出来的 id 一律忽略）。 */
export const PROACTIVE_IDS = [
  "offwork",
  "work-end-1",
  "work-end-10",
  "lunch-end-10",
  "lunch-before-10",
  "overtime-2h",
  "idle-90",
] as const;

export type ProactiveId = (typeof PROACTIVE_IDS)[number];

export interface ProactiveMessage {
  id: ProactiveId;
  text: string;
}

/** 判定所需的全部输入：时间、阶段、上次互动、今天发过的 id、上次判定时刻。 */
export interface ProactiveInput {
  settings: Settings;
  /** 判定时刻（毫秒时间戳，本地时区）。 */
  now: number;
  /** 该时刻的阶段（由 ticker 的 phaseOf 算出，与阶段文字同源）。 */
  phase: Phase;
  /** 上次互动（点击或上一次主动说话）的时刻；null = 还没有过互动。 */
  lastInteractionAt: number | null;
  /** 今天已经发过的消息 id（跨天的由调用方用 sentIdsOn 清掉）。 */
  sent: readonly string[];
  /** 上一次判定的时刻；null = 刚启动，这一轮只建立基线不发消息。 */
  checkedAt: number | null;
}

interface RuleContext {
  settings: Settings;
  now: number;
  dayStart: number;
  lastInteractionAt: number | null;
}

interface Rule {
  id: ProactiveId;
  text: string;
  /** 这句话在哪些阶段才讲得通（已下班了就不会再出现"还有十分钟"）。 */
  phases: readonly Phase[];
  /** 触发的绝对时刻；null = 这条此刻不成立（午休关掉 / 还没互动过）。 */
  moment(context: RuleContext): number | null;
}

function minuteAt(context: RuleContext, minute: number): number {
  return context.dayStart + minute * MINUTE_MS;
}

function lunchWindow(settings: Settings): [number, number] | null {
  const { lunchStartMin, lunchEndMin } = settings;
  if (lunchStartMin === null || lunchEndMin === null || lunchEndMin <= lunchStartMin) return null;
  return [lunchStartMin, lunchEndMin];
}

/*
 * 优先级 = 数组顺序：同一轮跨过多个时刻时只发最靠前、最贴当下的那条，
 * "刚下班那一刻（走啊）"排在最前，因为它是唯一一条过了就再无意义的话。
 */
const RULES: readonly Rule[] = [
  {
    id: "offwork",
    text: "走啊",
    phases: ["已下班"],
    // 阶段变成「已下班」的那一帧就是跨过 workEnd 的判定。
    moment: (context) => minuteAt(context, context.settings.workEndMin),
  },
  {
    id: "work-end-1",
    text: "要下班了",
    phases: ["在岗"],
    moment: (context) => minuteAt(context, context.settings.workEndMin) - WORK_END_LAST_CALL_MS,
  },
  {
    id: "work-end-10",
    text: "还有十分钟，稳住",
    phases: ["在岗"],
    moment: (context) => minuteAt(context, context.settings.workEndMin) - WORK_END_WARN_MS,
  },
  {
    id: "lunch-end-10",
    text: "该回去了",
    phases: ["午休"],
    moment: (context) => {
      const window = lunchWindow(context.settings);
      if (!window) return null;
      return minuteAt(context, window[1]) - LUNCH_WARN_MS;
    },
  },
  {
    id: "lunch-before-10",
    text: "还有十分钟就吃饭",
    phases: ["在岗"],
    moment: (context) => {
      const window = lunchWindow(context.settings);
      if (!window) return null;
      return minuteAt(context, window[0]) - LUNCH_WARN_MS;
    },
  },
  {
    id: "overtime-2h",
    text: "这个点了，你确定？",
    phases: ["加班"],
    moment: (context) => minuteAt(context, context.settings.workEndMin) + OVERTIME_ASK_MS,
  },
  {
    id: "idle-90",
    text: "你一个半小时没理我了",
    phases: ["在岗", "午休", "已下班", "加班"],
    moment: (context) =>
      context.lastInteractionAt === null ? null : context.lastInteractionAt + IDLE_INTERVAL_MS,
  },
];

/** 本地时区的当天零点：设置里的钟点是本地挂钟分钟数，换算成时间戳必须先取当天零点。 */
export function startOfDay(ms: number): number {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return Number.NaN;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * 这一刻该不该主动说一句：返回要说的那条，或 null。
 *
 * 命中条件全部成立才返回：阶段允许 + 该条今天没发过 + 这个时刻已经到（now >= moment）
 * + 它是**这一轮**才跨过的（prev <= moment）。prev 取上次判定时刻与 now 的较小者，
 * 于是系统对时把钟往后拨也不会把同一个时刻再触发一遍。
 */
export function pickProactiveMessage(input: ProactiveInput): ProactiveMessage | null {
  const { settings, now, phase, lastInteractionAt, sent, checkedAt } = input;
  // 第一次判定只建立基线：启动时不补发今天已经过去的时刻。
  if (checkedAt === null) return null;
  if (!Number.isFinite(now) || !Number.isFinite(checkedAt)) return null;
  if (isMisconfigured(settings)) return null;
  const dayStart = startOfDay(now);
  if (!Number.isFinite(dayStart)) return null;

  const previous = Math.min(checkedAt, now);
  const done = new Set<string>(sent);
  const context: RuleContext = { settings, now, dayStart, lastInteractionAt };

  for (const rule of RULES) {
    if (done.has(rule.id)) continue;
    if (!rule.phases.includes(phase)) continue;
    const moment = rule.moment(context);
    if (moment === null || !Number.isFinite(moment)) continue;
    if (now < moment) continue; // 还没到那一刻
    if (previous > moment) continue; // 早就跨过了，不是在应用运行期间跨过的
    return { id: rule.id, text: rule.text };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 每天一次：workenergy.notify.v1（独立存储键，与 settings / interactions 互不影响）
 * ------------------------------------------------------------------ */

export interface NotifyState {
  /** 已发记录所属的日键（本地时区 YYYY-MM-DD）；与今天不同 = 新的一天，记录整组作废。 */
  day: string;
  /** 今天已经发过的消息 id（只保留白名单里的）。 */
  ids: ProactiveId[];
  /** 上次互动（点击 / 上次主动说话）的时刻。 */
  lastInteractionAt: number | null;
}

/** 适配器依赖的最小存储能力（测试用内存实现替身）。 */
export interface NotifyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function emptyNotifyState(day = ""): NotifyState {
  return { day, ids: [], lastInteractionAt: null };
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 坏数据 / 缺字段 / 类型不对一律回落空状态：存储写坏了也不该让悬浮条炸掉。 */
export function parseNotifyState(raw: string | null): NotifyState {
  if (raw === null) return emptyNotifyState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyNotifyState();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return emptyNotifyState();
  const record = parsed as Record<string, unknown>;
  const rawIds = Array.isArray(record.ids) ? record.ids : [];
  return {
    day: typeof record.day === "string" ? record.day : "",
    // 只认白名单里的 id：老版本 / 手改存储里多出来的字符串不参与判定。
    ids: PROACTIVE_IDS.filter((id) => rawIds.includes(id)),
    lastInteractionAt: finiteOrNull(record.lastInteractionAt),
  };
}

export function readNotifyState(store: NotifyStore | null): NotifyState {
  if (!store) return emptyNotifyState();
  try {
    return parseNotifyState(store.getItem(NOTIFY_KEY));
  } catch {
    return emptyNotifyState();
  }
}

/** 写一份状态：失败静默（配额满 / 被禁），本次消息照常显示，只是下次启动可能重发一次。 */
export function writeNotifyState(store: NotifyStore | null, state: NotifyState): void {
  if (!store) return;
  try {
    store.setItem(NOTIFY_KEY, JSON.stringify(state));
  } catch {
    // 见上：存储失败不打扰用户。
  }
}

/** 今天的已发 id：记录的日键不是今天 → 一条都不算（跨天重置的唯一实现点）。 */
export function sentIdsOn(state: NotifyState, day: string): ProactiveId[] {
  return state.day === day ? state.ids : [];
}

/** 记一条"今天已经发过"：跨天时先清空记录，同时把上次互动时刻推到这一条的时间。 */
export function markSent(state: NotifyState, day: string, id: ProactiveId, at: number): NotifyState {
  const ids = sentIdsOn(state, day);
  return {
    day,
    ids: ids.includes(id) ? ids : [...ids, id],
    lastInteractionAt: Number.isFinite(at) ? at : state.lastInteractionAt,
  };
}

/** 记一次点击（点击也算互动：重置"一个半小时没理我"的计时）。 */
export function markInteraction(state: NotifyState, at: number): NotifyState {
  return { ...state, lastInteractionAt: Number.isFinite(at) ? at : state.lastInteractionAt };
}

/** 浏览器里那份存储（SSR / 测试里没有 localStorage 时返回 null，读写都退化成空操作）。 */
export function defaultNotifyStore(): NotifyStore | null {
  return (globalThis as { localStorage?: NotifyStore }).localStorage ?? null;
}
