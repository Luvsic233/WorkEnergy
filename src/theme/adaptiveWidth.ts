/*
 * photo-left 版式（内置「耄耋猫」主题）的自适应窗口宽度。
 *
 * 为什么需要它：窗口宽度原来写死 340，而金额通常只有 2-3 位整数 + 18 位小数，
 * 右侧会空出一大块奶油色。这里改成「窗口宽度跟着内容走」：
 *   - 只在**整数位数变化**时才考虑改尺寸（位数按当前薪资约 200 秒才进一位，不会抖）
 *   - 连续 SETTLE_FRAMES 帧位数一致才真正下发（进位边界上来回跳时不抽搐）
 *   - 实际宽度由 DOM 实测得出（.bar-value 的每个子元素宽度求和），不靠字体度量估算
 *
 * 纯逻辑（digitCountOf / clampCardWidth / createSettleTracker）与 DOM 测量分开，
 * 前者可在 node 环境直接单测。
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { applyFixedWindowSize } from "./windowSize";

/** 窗口宽度的上下限：窄到 250 还能放下滚轮，宽到 520 足够 8 位整数 + 18 位小数。 */
export const MIN_CARD_WIDTH = 250;
export const MAX_CARD_WIDTH = 520;

/** 高度固定：版式按 96px 写死，跟随主题的 windowSize。 */
export const PHOTO_CARD_HEIGHT = 96;

/** 连续多少帧位数一致才下发尺寸。 */
export const SETTLE_FRAMES = 3;

/** 右侧呼吸空间：内容紧贴窗口边缘会显得拥挤，加一点余量。 */
export const CARD_WIDTH_SLACK = 10;

/** 与已生效宽度差小于这个值就不折腾窗口（避免 1-2px 抖动）。 */
export const RESIZE_THRESHOLD_PX = 6;

/** 限流窗口：这段时间内最多发起 RESIZE_BUDGET 次窗口尺寸变更。 */
export const RESIZE_WINDOW_MS = 5000;

/** 限流预算：即使出现意料之外的反馈回路，也不会把主线程淹掉。 */
export const RESIZE_BUDGET = 6;

/** 整数部分的位数（忽略千分位分隔符等非数字字符），至少 1 位。 */
export function digitCountOf(intText: string): number {
  const digits = intText.replace(/\D/g, "");
  return Math.max(1, digits.length);
}

/** 把实测需要的宽度钳到 [MIN, MAX]，非有限值回落到最小档。 */
export function clampCardWidth(width: number): number {
  // NaN 通常是测量失败（元素还没布局）：落到最小档不会更糟；
  // ±Infinity 才代表"需要无限宽"，交给上下钳制取到对应端点。
  if (Number.isNaN(width)) return MIN_CARD_WIDTH;
  return Math.min(MAX_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, Math.round(width)));
}

/**
 * 稳定计数器：同一个 key 连续推入 frames 次时返回一次 true（同一 key 只触发一次）。
 * key 一变就清零重数，所以进位边界上的来回跳不会触发。
 */
export function createSettleTracker(frames: number = SETTLE_FRAMES) {
  let lastKey: string | number | null = null;
  let streak = 0;
  let firedFor: string | number | null = null;
  return {
    push(key: string | number): boolean {
      if (key === lastKey) {
        streak += 1;
      } else {
        lastKey = key;
        streak = 1;
        firedFor = null;
      }
      if (streak >= frames && firedFor !== key) {
        firedFor = key;
        return true;
      }
      return false;
    },
    reset(): void {
      lastKey = null;
      streak = 0;
      firedFor = null;
    },
  };
}

/**
 * 实测当前内容需要多宽。
 * 宽度 = 左图实测宽 + 图像与右栏间的实际间隔 + 右栏内容宽（标签与金额取较大者）+ 各级内边距。
 */
/**
 * 实测右侧内容需要多宽。
 *
 * 不能把 .bar-value 的子元素宽度直接相加：那里是 flex 容器，子项会被拉伸，
 * 相加结果会明显高估（实测把 340 高估成 372）。所以这里克隆一份右栏到屏幕外，
 * 用 width: max-content 让它按内在宽度撑开，量完立刻移除——只在整数位数变化时发生，
 * 频率极低（按默认薪资约 200 秒一次）。
 */
export function measureContentWidth(main: HTMLElement): number {
  const host = main.parentElement;
  if (!host) return main.scrollWidth;
  const clone = main.cloneNode(true) as HTMLElement;
  clone.style.position = "absolute";
  clone.style.left = "-10000px";
  clone.style.top = "0";
  clone.style.width = "max-content";
  clone.style.visibility = "hidden";
  clone.style.pointerEvents = "none";
  host.appendChild(clone);
  const width = clone.getBoundingClientRect().width;
  clone.remove();
  return width;
}

/** 整条卡片需要的宽度 = 左图实测宽 + 实际间隔 + 右栏内在宽 + 左右内边距。 */
export function measureNeededWidth(
  bar: HTMLElement,
  main: HTMLElement,
  photo: HTMLElement | null,
): number {
  const barStyle = getComputedStyle(bar);
  const barPad = (parseFloat(barStyle.paddingLeft) || 0) + (parseFloat(barStyle.paddingRight) || 0);
  const photoRect = photo ? photo.getBoundingClientRect() : null;
  const photoWidth = photoRect ? photoRect.width : 0;
  const mainRect = main.getBoundingClientRect();
  const gap = photoRect ? Math.max(0, mainRect.left - photoRect.right) : 0;
  const contentWidth = measureContentWidth(main);
  return Math.ceil(photoWidth + gap + contentWidth + barPad + CARD_WIDTH_SLACK);
}

interface AdaptiveRefs {
  bar: RefObject<HTMLDivElement | null>;
  main: RefObject<HTMLDivElement | null>;
}

/**
 * photo-left 版式的窗口宽度自适应。非 photo-left 版式传 enabled = false 时整条链路空转。
 * 返回的 note(intText) 每帧调用一次即可——它只做位数比较，不测 DOM。
 * note 用 useCallback 固定（依赖只有 enabled），否则 ticker 会每帧重启。
 */
export function useAdaptiveCardWidth(enabled: boolean, refs: AdaptiveRefs) {
  const tracker = useRef(createSettleTracker());
  const appliedWidth = useRef(0);
  const pending = useRef(false);
  const recentResizes = useRef<number[]>([]);

  const measureAndApply = useCallback(() => {
    pending.current = false;
    const bar = refs.bar.current;
    const main = refs.main.current;
    if (!bar || !main) return;
    const photo = bar.querySelector<HTMLElement>(".bar-photo-art");
    const desired = clampCardWidth(measureNeededWidth(bar, main, photo));
    if (Math.abs(desired - appliedWidth.current) < RESIZE_THRESHOLD_PX) return;
    // 限流：窗口尺寸变更是最贵的操作（跨进程 IPC + 重排），绝不能允许它成风暴。
    const nowMs = Date.now();
    const recent = recentResizes.current.filter((at) => nowMs - at < RESIZE_WINDOW_MS);
    if (recent.length >= RESIZE_BUDGET) {
      console.warn("[adaptive-width] 触发限流，跳过本次窗口尺寸变更", { desired });
      return;
    }
    recent.push(nowMs);
    recentResizes.current = recent;
    appliedWidth.current = desired;
    applyFixedWindowSize(desired, PHOTO_CARD_HEIGHT);
  }, [refs.bar, refs.main]);

  const schedule = useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    // 等两帧：这一帧刚写完 textContent / transform，下一帧布局才稳定。
    requestAnimationFrame(() => requestAnimationFrame(measureAndApply));
  }, [measureAndApply]);

  const note = useCallback(
    (intText: string) => {
      if (!enabled) return;
      if (tracker.current.push(digitCountOf(intText))) schedule();
    },
    [enabled, schedule],
  );

  useEffect(() => {
    if (!enabled) return;
    // 进入 photo-left 版式时把「上次生效的宽度」作废：
    // 主题窗口尺寸（340x96）刚被设过，缓存里还存着上一次的 283，
    // 差值小于阈值就会让自适应提前放弃，于是窗口停在 340 —— 这就是「换回耄耋尺寸不对」。
    appliedWidth.current = 0;
    recentResizes.current = [];
    tracker.current.reset();
    schedule();
    return () => {
      pending.current = false;
    };
  }, [enabled, schedule]);

  return { note };
}
