/*
 * 底部时间轴（纯几何，不碰 DOM）。
 *
 * 一条细线的坐标系：左端 = workStart，右端 = workEnd，午休区间在轨道上留一段缺口，
 * 当前位置是一个圆点。横轴是挂钟线性映射（午休那一段也占时间），所以圆点在午休里
 * 正好落在缺口中间、在岗时匀速右移、下班（含加班）后停在右端。
 *
 * 只有两种"不画"的情况：设置本身矛盾（workEnd <= workStart，阶段是「配置错误」）
 * 或时间戳非法 —— 这时返回左端静止的兜底几何，绝不抛错、也绝不画出 NaN%。
 */
import { isMisconfigured, type Settings } from "../core/earning";

export const MINUTE_MS = 60_000;

/** 时间轴上的四个区间：未上班 / 在岗 / 午休中 / 下班后（加班也归在 after，见 FloatingBar 的 overtime 标记）。 */
export type TimelineState = "before" | "working" | "lunch" | "after";

export interface TimelineGeometry {
  /** 圆点位置 0..1（0 = workStart，1 = workEnd）。 */
  progress: number;
  /** 午休缺口在轨道上的起止比例；午休关闭 / 非法时为 null（一条实线）。 */
  lunchStartRatio: number | null;
  lunchEndRatio: number | null;
  state: TimelineState;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** 当天本地挂钟的毫秒数（与 earning.ts 的 msOfDay 同一套算法，先兜住非法时间戳）。 */
function msOfDay(nowMs: number): number {
  const date = new Date(nowMs);
  if (Number.isNaN(date.getTime())) return Number.NaN;
  return ((date.getHours() * 60 + date.getMinutes()) * 60 + date.getSeconds()) * 1000 + date.getMilliseconds();
}

/**
 * 午休缺口在轨道上的比例（0..1），午休关闭 / 起止颠倒 / 工作时段非法时返回 null。
 * 缺口钳在 0..1 之内：午休设在上班前或下班后也不会把圆点挤出轨道。
 */
export function lunchRatiosOf(settings: Settings): { from: number; to: number } | null {
  const { lunchStartMin, lunchEndMin, workStartMin, workEndMin } = settings;
  if (lunchStartMin === null || lunchEndMin === null || lunchEndMin <= lunchStartMin) return null;
  if (workEndMin <= workStartMin) return null;
  const span = workEndMin - workStartMin;
  const from = clamp01((lunchStartMin - workStartMin) / span);
  const to = clamp01((lunchEndMin - workStartMin) / span);
  return to > from ? { from, to } : null;
}

/** 这一刻的时间轴几何：圆点位置 + 午休缺口 + 所处区间。 */
export function timelineGeometry(settings: Settings, now: number): TimelineGeometry {
  const idle: TimelineGeometry = { progress: 0, lunchStartRatio: null, lunchEndRatio: null, state: "before" };
  if (isMisconfigured(settings)) return idle;

  const nowMs = msOfDay(now);
  if (!Number.isFinite(nowMs)) return idle;

  const lunch = lunchRatiosOf(settings);
  const lunchStartRatio = lunch === null ? null : lunch.from;
  const lunchEndRatio = lunch === null ? null : lunch.to;

  const startMs = settings.workStartMin * MINUTE_MS;
  const endMs = settings.workEndMin * MINUTE_MS;
  const progress = clamp01((nowMs - startMs) / (endMs - startMs));

  if (nowMs < startMs) return { progress: 0, lunchStartRatio, lunchEndRatio, state: "before" };
  if (nowMs >= endMs) return { progress: 1, lunchStartRatio, lunchEndRatio, state: "after" };
  const inLunch =
    lunch !== null &&
    nowMs >= (settings.lunchStartMin as number) * MINUTE_MS &&
    nowMs < (settings.lunchEndMin as number) * MINUTE_MS;
  if (inLunch) return { progress, lunchStartRatio, lunchEndRatio, state: "lunch" };
  return { progress, lunchStartRatio, lunchEndRatio, state: "working" };
}

/**
 * 阶段文字后面那截「剩 3:12」：时间轴只有一条线，光看几何不容易懂，
 * 这行字把它解释清楚。只在「还没下班」（在岗 / 午休）时给，其余返回 null。
 */
export function remainingLabel(settings: Settings, now: number): string | null {
  const geometry = timelineGeometry(settings, now);
  if (geometry.state !== "working" && geometry.state !== "lunch") return null;
  const nowMs = msOfDay(now);
  if (!Number.isFinite(nowMs)) return null;
  const leftMs = settings.workEndMin * MINUTE_MS - nowMs;
  if (!Number.isFinite(leftMs) || leftMs <= 0) return null;
  const totalMinutes = Math.ceil(leftMs / MINUTE_MS);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `剩 ${minutes} 分`;
  return `剩 ${hours}:${String(minutes).padStart(2, "0")}`;
}
