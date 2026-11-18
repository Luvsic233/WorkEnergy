import type { Decimals, MoneyParts } from "../core/format";

/**
 * 显示层「减速滑停」：到点时让滚轮上的数字渐慢地停在真实值上，而不是一帧之内急刹车。
 *
 * 边界（这条线不能越）：真实值（引擎算出的 atoms）只作为输入进来，这里产出的只是「显示值」。
 * 引擎的数值一个字节都不会被改写，RollingDigit / ticker 的接口也没动 —— 它们的入参仍然是 atoms，
 * 只是这一份 atoms 换成了显示值（见 FloatingBar 的 ticker 回调）。
 *
 * 做法只有一句话：**显示值 = 真实值 − 滞后**，滞后是一个随时间走的整数函数：
 *
 * - 离下一个停顿点还远：滞后 = 0 ⇒ 显示值就是真实值本身（和改动前一模一样，紧跟、零滞后）。
 * - 最后 10 秒：滞后按 s² 从 0 长到 RESERVE_MS 的钱（s = 已进入减速窗口的毫秒数）。
 *   于是每帧推进量 = 真实值增量 − 滞后增量，而滞后增量随时间是线性变大的 ⇒
 *   **最后 10 秒里每帧推进量单调递减**，这就是「渐慢」的可测定义。
 * - 到点（真实值停住）：滞后按 (剩余窗口 / 1.2s)² 收回到 0 ⇒ 显示值继续往前滑，
 *   1.2 秒后滞后恰为 0，显示值**精确等于**真实值。窗口末尾滞后随时间的变化率与减速窗口
 *   末端刚好接上（RESERVE_MS 就是这个衔接点算出来的），所以到点那一刻没有任何一顿。
 *
 * 为什么用闭式解而不是逐帧累加：显示值只由这一帧的 (真实值, 时刻) 决定，误差不会带到下一帧，
 * 所以差值一定收敛到 0、长跑不漂移；而且全程 BigInt 整数运算，没有浮点累加。
 */

/** 最后 10 秒开始减速。 */
export const SLOW_MS = 10_000;

/** 到点后滑停窗口：1.2 秒内精确落到真实值。 */
export const GLIDE_MS = 1_200;

/**
 * 滑停要预留的那截距离（毫秒的钱）= SLOW·GLIDE / (2·(SLOW + GLIDE)) ≈ 536ms。
 * 这个数让两个窗口的推进量在到点那一刻相等（C¹ 连续）：减速窗口末端每帧少走
 * v·2·RESERVE/SLOW，滑停窗口第一帧走 v·2·RESERVE/GLIDE，两式相等即得。
 */
export const RESERVE_MS = Math.round((SLOW_MS * GLIDE_MS) / (2 * (SLOW_MS + GLIDE_MS)));

/**
 * 速度估计的更新门限（百分比）：引擎按毫秒取整，帧与帧之间的一阶差分会带百万分之一量级的抖动，
 * 直接拿它当速度会让滞后量跟着抖（可测的「单调」被噪声打断）。只有速度真的变了 1% 以上才更新。
 */
const RATE_JITTER_PCT = 1n;

const ATOMS_PER_YUAN = 10n ** 18n;
const MS_PER_MIN = 60_000;
const DAY_MS = 86_400_000;
const SLOW_BIG = BigInt(SLOW_MS);
const GLIDE_BIG = BigInt(GLIDE_MS);
const GLIDE_SQ = GLIDE_BIG * GLIDE_BIG;

/** 停顿点推算只用到这几个时间字段（与 core/earning.Settings 结构兼容，但不 import 引擎）。 */
export interface StallSettings {
  workStartMin: number;
  workEndMin: number;
  lunchStartMin: number | null;
  lunchEndMin: number | null;
  overtimeMode: boolean;
}

/** 当日的毫秒偏移（本地时区），与 core/earning 的 msOfDay 同规则。 */
function msOfDay(nowMs: number): number {
  const date = new Date(nowMs);
  return ((date.getHours() * 60 + date.getMinutes()) * 60 + date.getSeconds()) * 1000 + date.getMilliseconds();
}

/** 午休窗口（当日毫秒，按上下班时间裁剪）；没有午休 / 午休被配错时为 null。 */
function lunchWindow(settings: StallSettings): [number, number] | null {
  const { lunchStartMin, lunchEndMin } = settings;
  if (lunchStartMin === null || lunchEndMin === null) return null;
  const from = Math.max(settings.workStartMin * MS_PER_MIN, lunchStartMin * MS_PER_MIN);
  const to = Math.min(settings.workEndMin * MS_PER_MIN, lunchEndMin * MS_PER_MIN);
  return to > from ? [from, to] : null;
}

/**
 * 下一个「金额停止增长」的时刻（当日绝对 ms；null = 今天不会再停）。
 * 规则与 core/earning 的 phaseOf / paidMsOf 一一对应：
 * - 未到上班时间 → 上班点（之后开始增长，此刻速度还是 0，减速窗口不起作用）；
 * - 在岗 → 午休开始（没有午休就是下班点）；
 * - 午休 → 午休结束（恢复增长，跟随即可，不需要动画）；
 * - 已下班 → null（已经停了，滑停窗口接管）；
 * - 加班 → 次日 0 点（跨天金额归零）；
 * - 配置错误（下班点 ≤ 上班点）→ null。
 */
export function stallDeadlineMs(settings: StallSettings, nowMs: number): number | null {
  if (!Number.isFinite(nowMs)) return null;
  const now = msOfDay(nowMs);
  const day = nowMs - now;
  const start = settings.workStartMin * MS_PER_MIN;
  const end = settings.workEndMin * MS_PER_MIN;
  if (end <= start) return null;
  if (now < start) return day + start;
  if (now >= end) return settings.overtimeMode ? day + DAY_MS : null;
  const window = lunchWindow(settings);
  if (window === null) return day + end;
  if (now < window[0]) return day + window[0];
  if (now < window[1]) return day + window[1];
  return day + end;
}

/**
 * ticker 回调手里只有格式化好的 money（接口不许改），这里把它还原成 BigInt。
 * 分辨率和显示层一致：decimals=18 时就是引擎 atoms 原值；12 / 6 位档就是引擎值在该档上的截断
 * —— 滚轮本来也只有这么多位，显示层只在自己能显示的分辨率上工作。
 */
export function atomsOfMoney(money: MoneyParts, decimals: Decimals): bigint {
  const int = BigInt(money.int.replace(/[^0-9]/g, "") || "0");
  const frac = BigInt(money.frac.padStart(decimals, "0") || "0");
  return int * ATOMS_PER_YUAN + frac * 10n ** BigInt(18 - decimals);
}

/** 速度变化是否真的超过门限（整数百分比比较，不经过浮点）。 */
function rateChanged(prev: bigint, next: bigint): boolean {
  const hundred = 100n;
  return next * hundred > prev * (hundred + RATE_JITTER_PCT) || next * hundred < prev * (hundred - RATE_JITTER_PCT);
}

/**
 * 距离某个停顿点还剩 ms 时的滞后量：还没进减速窗口 → 0；进了 → 按 s² 长到满额；
 * 已经过点 → 钉在满额（真实值在停顿点上还会再长最后一帧，那一帧必须沿用满额滞后，
 * 否则显示值会被一把推到真实值 —— 那就是改动前的急刹车）。
 * NaN / 速度非正 → 0。
 */
function reserveAtoms(rate: bigint, deadlineMs: number | null, nowMs: number): bigint {
  if (deadlineMs === null || rate <= 0n) return 0n;
  const toStop = deadlineMs - nowMs;
  // 写成 !(toStop < SLOW_MS) 是为了让 NaN 落到 0 这一支。
  if (!(toStop < SLOW_MS)) return 0n;
  const s = toStop <= 0 ? SLOW_BIG : BigInt(Math.round(SLOW_MS - toStop));
  return (rate * BigInt(RESERVE_MS) * s * s) / (SLOW_BIG * SLOW_BIG);
}

export interface SlowStopFrame {
  /** 引擎算出的真实值（atoms）：只读输入，绝不改写。 */
  targetAtoms: bigint;
  /** 这一帧的时刻（ms）。 */
  nowMs: number;
  /** 下一个停顿点（见 stallDeadlineMs）；null = 没有。 */
  deadlineMs: number | null;
}

export interface SlowStopState {
  /** 上一帧的显示值（atoms）。 */
  display: bigint;
  /** 上一帧的真实值：用来判断「这一帧真实值动没动」。 */
  lastTargetAtoms: bigint;
  /** 上一帧的时刻；null = 还没画过第一帧。 */
  lastNowMs: number | null;
  /** 真实值最后一次移动的时刻（滑停窗口的起点）；null = 还没有过。 */
  movedAtMs: number | null;
  /** 真实值移动那一帧的滞后量：滑停窗口从这里开始收。 */
  lagAtoms: bigint;
  /** 真实值的生长速度（atoms/ms，整数除法）：滞后量按它算。 */
  ratePerMs: bigint;
  /** 上一次看到真实值移动时的停顿点：过点那一帧要沿用它。 */
  deadlineMs: number | null;
}

export function createSlowStopState(): SlowStopState {
  return {
    display: 0n,
    lastTargetAtoms: 0n,
    lastNowMs: null,
    movedAtMs: null,
    lagAtoms: 0n,
    ratePerMs: 0n,
    deadlineMs: null,
  };
}

/**
 * 推进一帧：纯函数（上一帧状态 + 这一帧的真实值与时刻 → 新状态），没有任何副作用。
 *
 * 不变量：
 * - 0 ≤ 显示值 ≤ 真实值；真实值不减时显示值不减；
 * - 真实值停住后，滞后单调收敛到 0，GLIDE_MS 之后显示值与真实值精确相等。
 */
export function advanceSlowStop(state: SlowStopState, frame: SlowStopFrame): SlowStopState {
  const target = frame.targetAtoms > 0n ? frame.targetAtoms : 0n;
  const nowMs = Number.isFinite(frame.nowMs) ? Math.round(frame.nowMs) : null;

  // 第一帧（或时刻坏掉）：直接落到真实值 —— 开机不做假动画，也不留一个来历不明的差值。
  if (state.lastNowMs === null || nowMs === null) {
    return {
      display: target,
      lastTargetAtoms: target,
      lastNowMs: nowMs ?? state.lastNowMs,
      movedAtMs: nowMs,
      lagAtoms: 0n,
      ratePerMs: state.ratePerMs,
      deadlineMs: frame.deadlineMs,
    };
  }

  const dt = nowMs - state.lastNowMs;
  const delta = target - state.lastTargetAtoms;

  if (delta !== 0n) {
    // 真实值在动：更新生长速度（只在真的长大的帧更新，掉下来时沿用上一次的正速度）。
    const sample = delta > 0n && dt > 0 ? delta / BigInt(dt) : 0n;
    let rate = state.ratePerMs;
    if (sample > 0n && (rate === 0n || rateChanged(rate, sample))) rate = sample;
    // 「真实值上一帧也在动」= 连续增长。它的意义只有一处：真实值停住前的最后一帧
    // （它落在停顿点上，此刻的停顿点已经翻到下一时段了）必须沿用上一帧的满额滞后。
    const continuous = state.movedAtMs !== null && state.movedAtMs === state.lastNowMs;
    const carried = continuous && state.deadlineMs !== null && state.deadlineMs <= nowMs
      ? reserveAtoms(rate, state.deadlineMs, nowMs)
      : 0n;
    const live = reserveAtoms(rate, frame.deadlineMs, nowMs);
    let lag = live > carried ? live : carried;
    // 减速窗口里（以及真实值停住的那一帧）滞后只许变大、不许变小：速度估计偶尔会被
    // 引擎的取整晃一下（金额停住前那半帧尤其明显），滞后跟着缩水就会让显示值往前一跳。
    if ((live > 0n || carried > 0n) && lag < state.lagAtoms) lag = state.lagAtoms;
    const planned = target - (lag < target ? lag : target);
    // 不倒退：真实值没掉（delta > 0）时显示值绝不许往回走。开机正好落在减速窗口里、
    // 或速度估计刚从 0 跳上来时，滞后量会一步到位——那时候宁可原地等真实值追上来。
    const next = delta > 0n && planned < state.display ? state.display : planned;
    return {
      display: next,
      lastTargetAtoms: target,
      lastNowMs: nowMs,
      movedAtMs: nowMs,
      // 记的是「实际留下的差值」而不是算出来的滞后量：滑停窗口从真正的差值开始收，
      // 于是到点后也不会倒退，而且窗口结束时一定精确落在真实值上。
      lagAtoms: target - next,
      ratePerMs: rate,
      // 记住最近一次看到的停顿点（包括刚刚过去的那个）：真实值停住前那一帧常常已经翻到
      // 下一时段（deadline 变 null），滑停窗口要靠它认出「真实值是几点停下的」。
      deadlineMs: frame.deadlineMs ?? state.deadlineMs,
    };
  }

  // 真实值停住了：滑停。窗口起点钉在「真实值真正停下的那一刻」：
  // 停顿点常常落在两帧之间（例如 18:00:00.000 而这一帧是 18:00:00.008），用停顿点而不是
  // 上一帧的时刻，滑停的第一帧就正好接上真实值最后一帧的推进量，中间不会有半帧的顿挫。
  const movedAtMs = state.deadlineMs !== null && state.deadlineMs > state.lastNowMs && state.deadlineMs <= nowMs
    ? state.deadlineMs
    : state.movedAtMs ?? nowMs;
  const elapsed = nowMs - movedAtMs;
  const left = elapsed >= GLIDE_MS ? 0 : elapsed > 0 ? GLIDE_MS - elapsed : GLIDE_MS;
  const leftBig = BigInt(left);
  const remaining = (state.lagAtoms * leftBig * leftBig) / GLIDE_SQ;
  const display = target - (remaining < target ? remaining : target);
  return {
    display: display > 0n ? display : 0n,
    lastTargetAtoms: target,
    lastNowMs: nowMs,
    movedAtMs,
    lagAtoms: state.lagAtoms,
    ratePerMs: state.ratePerMs,
    deadlineMs: state.deadlineMs,
  };
}
