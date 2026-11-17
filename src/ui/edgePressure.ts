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

import { CLICK_MAX_DISTANCE_PX } from "../theme/interaction";

/** 进入边缘多少逻辑像素开始渐入。必须与 Rust 侧 edge_watch.rs 的 THRESHOLD_LOGICAL 一致。 */
export const EDGE_THRESHOLD = 24;

/** 被压轴的最大压缩比例（10%）。 */
export const MAX_SQUASH = 0.18;

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

/* ------------------------------------------------------------------ *
 * 屏幕边界：不许拖出工作区 + 松手弹走
 *
 * 这两组算术有**两份实现**，必须逐字对齐：
 * - 这里：规范 + 单测（逻辑像素、可读的整数）；
 * - src-tauri/src/edge_watch.rs：真正执行（物理像素）。Rust 侧常量
 *   BOUNCE_DISTANCE_LOGICAL / BOUNCE_MS 与下面的 BOUNCE_DISTANCE / BOUNCE_MS 一致，
 *   两端各有一份测试把这套数字钉死。
 * ------------------------------------------------------------------ */

/**
 * 松手弹走的物理参数：挤压量决定「踢」出去的初速度，摩擦决定它怎么滑停。
 * 距离与时长都不是手填的常量，而是从这两个数推出来（见 bounceDistance / bounceDurationMs）：
 * 压得越狠 → 初速度越快 → 滑得越远、也滑得越久。
 */
export const BOUNCE_KICK_SPEED = 3168;   // 满压缩时的初速度（逻辑像素/秒）
export const BOUNCE_FRICTION = 4.4;     // 指数摩擦系数（1/秒）
export const BOUNCE_SETTLE_PX = 0.5;    // 剩余不足半个像素就算停下

/** 满压缩时的滑行距离（逻辑像素）= 初速度 ÷ 摩擦。取整是为了让 50%/25% 压缩也是整数。 */
export const BOUNCE_DISTANCE = Math.round(BOUNCE_KICK_SPEED / BOUNCE_FRICTION);

/**
 * 弹走的缓动：ease-out expo（与 Rust 侧 bounce_ease 同一条曲线）。
 * 选它而不是 cubic，是因为「冰面滑行」要前段极快、后段长时间慢慢蹭：
 * 700ms 的第十成时间（前 70ms）就走掉约一半距离，剩下六成时间只走最后几个像素。
 */
export function bounceDistance(compression: number): number {
  if (!Number.isFinite(compression)) return 0;
  return BOUNCE_DISTANCE * clamp01(compression);
}

/**
 * 滑行时长：速度 v(t) = v0·e^(-k t)，走到剩余不足半个像素所需的时间。
 * 距离越远 → 时长越长（对数关系）；距离小于停止阈值 → 0。
 */
export function bounceDurationMs(distance: number): number {
  if (!Number.isFinite(distance) || distance <= BOUNCE_SETTLE_PX) return 0;
  return (Math.log(distance / BOUNCE_SETTLE_PX) / BOUNCE_FRICTION) * 1000;
}

export function bounceEase(t: number): number {
  const clamped = clamp01(t);
  // 归一化的 expo：除以 t=1 时的值，端点严格等于 1，末帧不会突然多跳一下。
  return (1 - Math.pow(2, -10 * clamped)) / (1 - Math.pow(2, -10));
}

/** 屏幕矩形：x/y 是左上角，y 向下；逻辑像素。工作区（rcWork）用同一个形状。 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clampAxis(start: number, size: number, areaStart: number, areaSize: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(areaStart)) return 0;
  const safeSize = Number.isFinite(size) ? Math.max(0, size) : 0;
  const safeArea = Number.isFinite(areaSize) ? Math.max(0, areaSize) : 0;
  // 比工作区还大：只能按左上角对齐，另一端允许超出（否则会把人逼到"永远有半个屏幕在屏幕外"）。
  if (safeSize >= safeArea) return areaStart;
  const maxStart = areaStart + safeArea - safeSize;
  if (start < areaStart) return areaStart;
  if (start > maxStart) return maxStart;
  return start;
}

/**
 * 把矩形夹进工作区。
 *
 * - 完全在里面：原样返回（同一个对象，调用方可以据此判断"没动"）；
 * - 越左/右/上/下：夹回对应边界；
 * - 比工作区还大：按左上角对齐，允许另一端超出（取舍：可见区域最大，且不会被反复推动）；
 * - 负坐标（副屏在主屏左边，工作区 x < 0）按普通算术处理，不做任何"不许为负"的假设。
 */
export function clampToWorkArea(rect: Rect, workArea: Rect): Rect {
  const x = clampAxis(rect.x, rect.width, workArea.x, workArea.width);
  const y = clampAxis(rect.y, rect.height, workArea.y, workArea.height);
  if (x === rect.x && y === rect.y) return rect;
  return { x, y, width: rect.width, height: rect.height };
}

/* ------------------------------------------------------------------ *
 * 右键拖动 = 精确摆放（不挤压、不弹走、不许出界）
 *
 * 手势区分的分界线与左键点击共用同一个 4px 阈值：左键走 isClickGesture（< 4px 才算点击），
 * 右键走 isRightDragGesture（>= 4px 才算拖动）。两条判定互补、互不干扰：
 * 同一次手势不可能既是右键拖动又是左键点击（按钮不同），位移也不可能同时 < 4px 且 >= 4px。
 * ------------------------------------------------------------------ */

/** 右键拖动的最小位移（css px，欧氏距离）：与点击阈值同源，恰好 4px 起算拖动。 */
export const RIGHT_DRAG_THRESHOLD_PX = CLICK_MAX_DISTANCE_PX;

/** 右键在 pointerdown / pointermove 的 button / buttons 位上的值。 */
export const RIGHT_BUTTON = 2;

/** pointerdown 记下的起点（右键）。 */
export interface RightDragStart {
  x: number;
  y: number;
  /** pointerdown 的 button：给了就必须是 2（右键），否则这次手势与右键无关。 */
  button?: number;
  t?: number;
}

/** pointermove 的当前位置。 */
export interface RightDragMove {
  x: number;
  y: number;
  /** pointermove 的 buttons 位：给了就必须仍含右键（2），松手后不该再判成拖动。 */
  buttons?: number;
}

/**
 * 按下 → 移动 是否已经构成「右键拖动」。
 *
 * 三条兜底都是为了"一次坏事件绝不启动一条跟手线程"：
 * - 任一坐标不是有限值 → false（NaN / Infinity）；
 * - down.button 给了但不是 2 → false；
 * - move.buttons 给了但不含右键 → false（松开事件丢了时也不许继续拖）。
 * 位移用欧氏距离的平方比较，与 isClickGesture 的边界严丝合缝：恰好 4px 算拖动、不算点击。
 */
export function isRightDragGesture(down: RightDragStart, move: RightDragMove): boolean {
  const numbers = [down.x, down.y, move.x, move.y];
  if (!numbers.every((value) => Number.isFinite(value))) return false;
  if (typeof down.button === "number" && down.button !== RIGHT_BUTTON) return false;
  if (typeof move.buttons === "number" && (move.buttons & RIGHT_BUTTON) === 0) return false;
  const dx = move.x - down.x;
  const dy = move.y - down.y;
  return dx * dx + dy * dy >= RIGHT_DRAG_THRESHOLD_PX * RIGHT_DRAG_THRESHOLD_PX;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * 右键跟手的目标位置：光标 − 起始偏移，再夹进工作区。
 *
 * 与 Rust 侧 follow_cursor 同一条算术（那里是物理像素 + clamp_rect，这里是逻辑像素 + clampToWorkArea），
 * 两份实现用同一批用例钉住：完全在屏内原样返回、四个方向越界夹回边界、
 * 窗口比工作区还大时按左上角对齐、负坐标副屏按普通算术处理。
 */
export function followTarget(cursor: Point, offset: Point, workArea: Rect, size: Size): Point {
  const rect = clampToWorkArea(
    {
      x: cursor.x - offset.x,
      y: cursor.y - offset.y,
      width: size.width,
      height: size.height,
    },
    workArea,
  );
  return { x: rect.x, y: rect.y };
}

export interface BounceOptions {
  /** 满压缩时的位移（逻辑像素），默认 BOUNCE_DISTANCE。 */
  distance?: number;
  /** 判定"被压住"的阈值，默认 EDGE_THRESHOLD。 */
  threshold?: number;
}

/**
 * 松手弹走后的目标矩形。
 *
 * 方向沿被压那条边的**法线朝屏幕内部**：贴左 +x、贴右 -x、贴上 +y、贴下 -y；
 * 角落两轴同时被压，两个方向自然合成（对角外弹）。
 * 距离按压缩量等比缩放（压缩 50% 就弹 6px），满压缩 = distance。
 * 压缩量为 0 时原样返回（不弹）；终点最后再走一次 clampToWorkArea，绝不从一边弹到越界。
 */
export function bounceAway(
  rect: Rect,
  edges: EdgeDistances,
  workArea: Rect,
  options: BounceOptions = {},
): Rect {
  const distance = Number.isFinite(options.distance) ? (options.distance as number) : BOUNCE_DISTANCE;
  if (distance <= 0) return rect;
  const threshold = options.threshold ?? EDGE_THRESHOLD;

  const left = proximityOf(edges.left, threshold);
  const right = proximityOf(edges.right, threshold);
  const top = proximityOf(edges.top, threshold);
  const bottom = proximityOf(edges.bottom, threshold);

  const dx = distance * (left - right);
  const dy = distance * (top - bottom);
  if (dx === 0 && dy === 0) return rect;

  return clampToWorkArea(
    {
      x: Math.round(rect.x + dx),
      y: Math.round(rect.y + dy),
      width: rect.width,
      height: rect.height,
    },
    workArea,
  );
}
