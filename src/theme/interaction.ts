/*
 * 左键点击互动：全部纯逻辑（单测直接覆盖，不碰 DOM / 存储实现）。
 *
 * 纪律与 ticker / 吉祥物一致：判定与计数都是同步纯函数，React 那边一次点击只 setState 一次，
 * 动画一律交给 CSS；这里的函数不读时间、不读随机数、不读 localStorage —— 全部由调用方注入。
 */

/** 点击计数与里程碑的存储键：独立一份，绝不写进 workenergy.settings.v1。 */
export const INTERACTION_KEY = "workenergy.interactions.v1";

/** 点击的最大位移（css px，欧氏距离）：恰好 4px 算"拖动"，不算点击。 */
export const CLICK_MAX_DISTANCE_PX = 4;

/** 点击的最大时长（毫秒）：按住超过 500ms 不算点击（长按不产生效果）。 */
export const CLICK_MAX_DURATION_MS = 500;

/** 点击里程碑：累计点击数到达这些值时弹一次现有的庆祝窗（每个只弹一次）。 */
export const MILESTONES: readonly number[] = [10, 50, 100, 200, 500];

/** 每隔多少次点击，把计数写进气泡（"今日第 N 次摸鱼"）。 */
export const COUNTER_EVERY = 5;

/** 一次按下 / 松开的时间地点（注入式，方便单测直接构造边界）。 */
export interface PointerMoment {
  x: number;
  y: number;
  t: number;
}

/**
 * 按下 → 松开 是否算一次点击。
 *
 * 边界是有意写成闭区间的反面：位移恰好 4px、时长恰好 500ms 都**不算**点击，
 * 于是"阈值两侧"没有歧义（< 4px 且 < 500ms 才触发效果）。
 * 非有限数值（NaN / Infinity）一律判否，绝不因为一次坏事件触发效果。
 */
export function isClickGesture(down: PointerMoment, up: PointerMoment): boolean {
  const numbers = [down.x, down.y, down.t, up.x, up.y, up.t];
  if (!numbers.every((value) => Number.isFinite(value))) return false;
  const dx = up.x - down.x;
  const dy = up.y - down.y;
  if (dx * dx + dy * dy >= CLICK_MAX_DISTANCE_PX * CLICK_MAX_DISTANCE_PX) return false;
  const elapsed = up.t - down.t;
  return elapsed >= 0 && elapsed < CLICK_MAX_DURATION_MS;
}

/**
 * 吐槽短句（8 条，全部 8 字以内，贴合这只猫的调性：视奸 / 无奈 / 立刻开哈）。
 * 纯文本，不含任何图片或图标 —— 零素材体积。
 */
export const PHRASES: readonly string[] = [
  "别视奸了",
  "再看就哈气",
  "立刻开哈",
  "你就摸吧",
  "猫在替你打工",
  "别打扰猫",
  "再点就咬你",
  "工资在跑",
];

/**
 * 按注入的随机数挑一句（0 <= random < 1 覆盖全部短句；越界 / 非有限值收敛到合法区间）。
 * 单测直接喂固定数字就能确定性地断言，不需要 mock Math.random。
 */
export function pickPhrase(random: number): string {
  if (!Number.isFinite(random)) return PHRASES[0];
  const index = Math.floor(random * PHRASES.length);
  return PHRASES[Math.min(PHRASES.length - 1, Math.max(0, index))];
}

/**
 * 这一次点击数是否刚好该弹里程碑：返回"该弹的那一个"，不该弹返回 null。
 *
 * - count 已到达某档、且该档没触发过 → 返回其中最高的那一档（一次点击最多弹一次）。
 * - 已经触发过的档不会重复返回（重启应用也不会再弹）。
 * - 计数一次跨过多档（预置 / 手改存储）时只弹最高的那一档，低档由 firedMilestones 一并记账。
 */
export function milestoneReached(count: number, fired: readonly number[]): number | null {
  if (!Number.isFinite(count)) return null;
  const done = new Set(fired);
  let hit: number | null = null;
  for (const milestone of MILESTONES) {
    if (count >= milestone && !done.has(milestone)) hit = milestone;
  }
  return hit;
}

/** 把"已经到达过的档"全部记成已触发（一次跨多档时低档不会再补弹）。 */
export function firedMilestones(count: number, fired: readonly number[]): number[] {
  const done = new Set(fired);
  for (const milestone of MILESTONES) {
    if (count >= milestone) done.add(milestone);
  }
  return MILESTONES.filter((milestone) => done.has(milestone));
}

/** 一次点击的持久化状态：累计次数（里程碑）+ 当日次数（气泡文案）+ 已弹过的里程碑。 */
export interface InteractionState {
  /** 累计点击次数：只增不减，里程碑看它。 */
  total: number;
  /** 当日点击次数：跨天自动归零。 */
  today: number;
  /** 当日键（本地时区的 YYYY-MM-DD）；与今天不同 = 新的一天。 */
  day: string;
  /** 已经弹过庆祝窗的里程碑。 */
  milestones: number[];
}

/** 适配器依赖的最小存储能力（测试用内存实现替身）。 */
export interface InteractionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 本地时区的日键：不用 toISOString（那是 UTC，会把早上 8 点前算成昨天）。 */
export function dayKey(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function emptyInteractionState(day: string): InteractionState {
  return { total: 0, today: 0, day, milestones: [] };
}

function countOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/** 坏数据 / 缺字段 / 类型不对一律回落空状态：存储写坏了也不该让悬浮条炸掉。 */
export function parseInteractionState(raw: string | null): InteractionState {
  const empty = emptyInteractionState("");
  if (raw === null) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return empty;
  const record = parsed as Record<string, unknown>;
  const rawMilestones = Array.isArray(record.milestones) ? record.milestones : [];
  return {
    total: countOf(record.total),
    today: countOf(record.today),
    day: typeof record.day === "string" ? record.day : "",
    // 只认 MILESTONES 里的档位：老版本 / 手改存储里多出来的数字不参与判定。
    milestones: MILESTONES.filter((milestone) => rawMilestones.includes(milestone)),
  };
}

/** 读一份状态（没有存储能力 / 读失败都给空状态）。 */
export function readInteractionState(store: InteractionStore | null): InteractionState {
  if (!store) return emptyInteractionState("");
  try {
    return parseInteractionState(store.getItem(INTERACTION_KEY));
  } catch {
    return emptyInteractionState("");
  }
}

/** 写一份状态：失败静默（配额满 / 被禁），本次效果照常，只是下次启动计数从头数。 */
export function writeInteractionState(store: InteractionStore | null, state: InteractionState): void {
  if (!store) return;
  try {
    store.setItem(INTERACTION_KEY, JSON.stringify(state));
  } catch {
    // 见上：存储失败不打扰用户。
  }
}

/**
 * 记一次点击（纯函数：入参是上一次的状态 + 今天的日键）。
 *
 * 跨天时 today 归零重数，total 继续累加 —— 里程碑是"累计"，气泡里是"今日"。
 * 返回该弹的里程碑（null = 不弹），由调用方 invoke 一次 show_celebration。
 */
export function registerClick(
  previous: InteractionState,
  day: string,
): { state: InteractionState; milestone: number | null } {
  const total = previous.total + 1;
  const today = (previous.day === day ? previous.today : 0) + 1;
  const milestone = milestoneReached(total, previous.milestones);
  return {
    state: { total, today, day, milestones: firedMilestones(total, previous.milestones) },
    milestone,
  };
}

/** 偶尔把计数写进气泡（每 COUNTER_EVERY 次一条），其余次数返回 null = 只冒吐槽。 */
export function counterLine(today: number): string | null {
  if (!Number.isFinite(today) || today <= 0) return null;
  const rounded = Math.floor(today);
  return rounded % COUNTER_EVERY === 0 ? `今日第 ${rounded} 次摸鱼` : null;
}

/** 浏览器里的那份存储（SSR / 测试里没有 localStorage 时返回 null，读写都退化成空操作）。 */
export function defaultInteractionStore(): InteractionStore | null {
  return (globalThis as { localStorage?: InteractionStore }).localStorage ?? null;
}
