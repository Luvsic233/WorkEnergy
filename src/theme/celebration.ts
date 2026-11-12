/*
 * 庆祝弹窗的纯逻辑（单测直接覆盖）。
 *
 * 金额纪律与吉祥物完全一致：只看整数元的 BigInt 比较，浮点一律不参与。
 * 台阶是"每跨过一个 20 元整数倍"：floor(元 / 20) 变大才算跨过，
 * 一帧跨多个台阶也只算一次（弹一次窗），金额变小 / 变负都不触发。
 */

/** 庆祝台阶（元）：固定 20，不做设置项。 */
export const CELEBRATION_STEP = 20;

/** 弹窗露出时长（毫秒）：前端定时器与 Rust 侧兜底的唯一口径，改这里就够。 */
export const CELEBRATION_VISIBLE_MS = 4000;

/**
 * 数学意义上的 floor(a / b)。
 * BigInt 的 `/` 是向零截断（-1n / 20n === 0n），负数直接用会算错台阶，所以自己修。
 */
export function floorDiv(value: bigint, step: bigint): bigint {
  const quotient = value / step;
  const remainder = value % step;
  if (remainder !== 0n && (remainder < 0n) !== (step < 0n)) return quotient - 1n;
  return quotient;
}

/**
 * 这一帧是否跨过了某个整数倍台阶。
 *
 * - previous === null（第一帧）：只建立基线，不触发 —— 否则一打开应用就弹一次。
 * - step 非正 / 非有限：没有台阶可言，一律不触发。
 * - 语义：floor(current / step) > floor(previous / step)。
 */
export function crossedMultiple(previous: bigint | null, current: bigint, step: number): boolean {
  if (previous === null) return false;
  if (!Number.isFinite(step) || step <= 0) return false;
  const stepBig = BigInt(Math.trunc(step));
  if (stepBig <= 0n) return false;
  return floorDiv(current, stepBig) > floorDiv(previous, stepBig);
}

export interface CelebrationTimerHost {
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

const systemTimerHost: CelebrationTimerHost = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms) as unknown as number,
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

export interface CelebrationTimer {
  /**
   * 从"现在"重新计时：已经排着的那一发先取消。
   * 露出期间又被触发一次（4 秒没到又跨过台阶）就重新数 4 秒，不提前收、不叠第二个定时器。
   */
  arm(): void;
  /** 卸载时清干净（组件消失不该再留一个到点会 invoke 的定时器）。 */
  disarm(): void;
}

/**
 * 可注入时钟的到点收窗计时器（单测用假时钟直接断言"重新计时"）。
 * hide 只会在到点后调一次；arm 多少次都只有一个待发的定时器。
 */
export function createCelebrationTimer(
  hide: () => void,
  visibleMs: number = CELEBRATION_VISIBLE_MS,
  host: CelebrationTimerHost = systemTimerHost,
): CelebrationTimer {
  let handle: number | null = null;
  const clear = () => {
    if (handle !== null) {
      host.clearTimeout(handle);
      handle = null;
    }
  };
  return {
    arm() {
      clear();
      handle = host.setTimeout(() => {
        handle = null;
        hide();
      }, visibleMs);
    },
    disarm: clear,
  };
}
