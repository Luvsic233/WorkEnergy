/**
 * 拖动贴边的纯函数层（无 DOM、无 IPC，全部可单测）。
 *
 * 模型：卡片被窗口边缘"压住"时才变形。
 * - 距离：窗口矩形到工作区四条边的剩余逻辑像素（0 = 贴死，负数 = 已越过边缘）；
 * - 贴近度：距离按 24 逻辑像素线性折算成 0..1（越界夹到 1）；
 * - 压缩：被压的那个轴最多 10%，另一个轴最多反向膨胀 4%（体积感）；
 *   角落两轴同时被压，此时膨胀量互相抵消，结果是两轴都 < 1；
 * - 形变原点：跟着被压的那条边 / 那个角落走，所以贴左时左边界纹丝不动、右边界内缩。
 *
 * 松手回弹是同一套"果冻语言"：从当前压缩量出发，先过冲 4% 再回正，500ms。
 */

/** 进入边缘多少逻辑像素开始渐入。必须与 Rust 侧 edge_watch.rs 的 THRESHOLD_LOGICAL 一致。 */
export const EDGE_THRESHOLD = 24;

/** 被压轴的最大压缩比例（10%）。 */
export const MAX_SQUASH = 0.1;

/** 另一轴的最大反向膨胀比例（4%，体积感）。 */
export const MAX_STRETCH = 0.04;

/** 松手回弹时长。 */
export const REBOUND_MS = 500;

/** 回弹的过冲幅度（4%，与点击果冻同一套数字）。 */
export const REBOUND_OVERSHOOT = 0.04;

/** 回弹关键帧的时间轴（0..1）：起 -> 过冲 -> 阻尼回摆 -> 归位。 */
export const REBOUND_OFFSETS = [0, 0.45, 0.72, 1];

/** 四条边的剩余距离（逻辑像素）。 */
export interface EdgeDistances {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 换算参数：阈值 / 最大压缩 / 最大膨胀 / 整体强度（1 = 正常，0 = 关掉）。 */
export interface EdgeOptions {
  threshold: number;
  maxSquash: number;
  maxStretch: number;
  scale: number;
}

export interface EdgeTransform {
  sx: number;
  sy: number;
  /** 形变原点（百分比）：0 = 左/上，50 = 居中，100 = 右/下。 */
  originX: number;
  originY: number;
}

export const DEFAULT_EDGE_OPTIONS: EdgeOptions = {
  threshold: EDGE_THRESHOLD,
  maxSquash: MAX_SQUASH,
  maxStretch: MAX_STRETCH,
  scale: 1,
};

export const IDENTITY_TRANSFORM: EdgeTransform = { sx: 1, sy: 1, originX: 50, originY: 50 };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/** 距离 -> 贴近度：0px 是 1，24px 是 0，负数（越界）也是 1，NaN 当"没贴着"。 */
export function proximityOf(distance: number, threshold: number = EDGE_THRESHOLD): number {
  if (!Number.isFinite(distance)) return 0;
  if (!Number.isFinite(threshold) || threshold <= 0) return distance <= 0 ? 1 : 0;
  return clamp01(1 - distance / threshold);
}

/** 贴近度（0..1）-> 压缩量。四条边都给 0 时返回恒等变换。 */
export function edgeCompression(
  edges: EdgeDistances,
  options: Partial<EdgeOptions> = {},
): EdgeTransform {
  const merged: EdgeOptions = { ...DEFAULT_EDGE_OPTIONS, ...options };
  const intensity = clamp01(merged.scale);

  const left = proximityOf(edges.left, merged.threshold) * intensity;
  const right = proximityOf(edges.right, merged.threshold) * intensity;
  const top = proximityOf(edges.top, merged.threshold) * intensity;
  const bottom = proximityOf(edges.bottom, merged.threshold) * intensity;

  const horizontal = Math.max(left, right);
  const vertical = Math.max(top, bottom);

  // 压一个轴的同时另一个轴反向膨胀，但只按"另一轴没在压"的剩余量膨胀：
  // 角落里两轴同时被压，膨胀自然抵消，得到两轴都 < 1 的体积压缩。
  const sx = (1 - merged.maxSquash * horizontal) * (1 + merged.maxStretch * vertical * (1 - horizontal));
  const sy = (1 - merged.maxSquash * vertical) * (1 + merged.maxStretch * horizontal * (1 - vertical));

  return {
    sx,
    sy,
    // 原点跟着被压的边/角落走；两边一样近时取左/上（确定性优先）。
    originX: horizontal === 0 ? 50 : left >= right ? 0 : 100,
    originY: vertical === 0 ? 50 : top >= bottom ? 0 : 100,
  };
}

/** 是否等于恒等变换（可以据此跳过 DOM 写入 / 不播回弹）。 */
export function isIdentity(transform: EdgeTransform): boolean {
  return Math.abs(transform.sx - 1) < 1e-9 && Math.abs(transform.sy - 1) < 1e-9;
}

/** DOM 写入用的两个字符串（只写 style，绝不 setState）。 */
export function transformCss(transform: EdgeTransform): string {
  return "scale(" + transform.sx.toFixed(4) + ", " + transform.sy.toFixed(4) + ")";
}

export function transformOriginCss(transform: EdgeTransform): string {
  return transform.originX + "% " + transform.originY + "%";
}

/** Rust 侧 bar:edge 的 payload（扁平数值表）。 */
export interface EdgeEventPayload {
  /** 贴近度 0..1（四个边）。 */
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  /** 同一份距离的逻辑像素值（前端算压缩量用这一层，越界也能表达）。 */
  pxLeft?: number;
  pxRight?: number;
  pxTop?: number;
  pxBottom?: number;
  scaleFactor?: number;
}

function distanceOf(pxValue: number | undefined, proximity: number | undefined): number {
  if (typeof pxValue === "number" && Number.isFinite(pxValue)) return pxValue;
  // 老/精简 payload 只有贴近度：按阈值反推一个等价距离（贴近度已经被夹在 1，只能代表"贴死"）。
  if (typeof proximity === "number" && Number.isFinite(proximity)) {
    return (1 - clamp01(proximity)) * EDGE_THRESHOLD;
  }
  return EDGE_THRESHOLD;
}

/** payload -> 四条边距离。两条通道同一份来源，px 优先。 */
export function edgesFromPayload(payload: EdgeEventPayload | null | undefined): EdgeDistances {
  const source = payload ?? {};
  return {
    left: distanceOf(source.pxLeft, source.left),
    right: distanceOf(source.pxRight, source.right),
    top: distanceOf(source.pxTop, source.top),
    bottom: distanceOf(source.pxBottom, source.bottom),
  };
}

export interface ReboundFrame {
  offset: number;
  sx: number;
  sy: number;
}

/** 单轴的回弹曲线：从 from 出发，过冲 4%，阻尼回摆到 1。 */
function reboundAxis(from: number): number[] {
  const direction = from > 1 ? -1 : from < 1 ? 1 : 0;
  return [
    from,
    1 + direction * REBOUND_OVERSHOOT,
    1 - direction * REBOUND_OVERSHOOT * 0.35,
    1,
  ];
}

/** 松手回弹的关键帧：第一个是当前（被压）状态，最后一个是恒等变换。 */
export function reboundFrames(from: EdgeTransform): ReboundFrame[] {
  const xs = reboundAxis(from.sx);
  const ys = reboundAxis(from.sy);
  return REBOUND_OFFSETS.map((offset, index) => ({ offset, sx: xs[index], sy: ys[index] }));
}
