import { useImperativeHandle, useRef, type Ref } from "react";
import type { RefreshHz } from "../core/settings";

/**
 * 一格的步长（em），必须与 styles.css 里 .bar-value .digit / .digit-glyph 的 0.8em 一致。
 * 整数位的位移永远是 PITCH_EM 的整数倍再乘上滚到一半的进度——静止时是纯整数格。
 */
export const PITCH_EM = 0.8;

/** 进位滚动时长（ms）：只有这一位数字真的变了才滚，滚完立刻精确落在新整格上。 */
export const CARRY_MS = 260;

/**
 * 0–9，后面补一个重复的 0：9 进位到 0 时滚的是这一格，
 * 落地后位移归一回到 index 0，因为第 10 格与第 0 格字形完全相同，归一那一下看不出任何跳动。
 */
const STRIP = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

/** 9 进位到 0 时用的落地格号（重复的那个 0）。 */
const WRAP_INDEX = 10;

/** 一位整数数字的滚动状态：从 from 格滚到 to 格，startMs 是起点（挂钟 ms）。 */
export interface DigitMotion {
  from: number;
  to: number;
  startMs: number;
}

/**
 * 进位进度：0 = 还停在旧格，1 = 已经落到新格。线性 0→1 映射到 CARRY_MS，超时钉在 1。
 * 只服务动画，金额本身永不经过它。
 */
export function carryProgress(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= CARRY_MS) return 1;
  return elapsedMs / CARRY_MS;
}

/** 当前位移格号：静止时恒等于 digit，滚动时在 from 与 to 之间线性推进（只可能是整数格之间）。 */
export function motionIndexAt(motion: DigitMotion, nowMs: number): number {
  if (motion.from === motion.to) return motion.from;
  return motion.from + (motion.to - motion.from) * carryProgress(nowMs - motion.startMs);
}

/**
 * 相邻两次采样之间的位移格号是否已经落在整格上：任意时刻要么整格、要么正滚在相邻两格之间。
 * 正常态（from === to）永远为 true —— 这就是"不卡半格"的判据。
 */
export function isOnGrid(motion: DigitMotion, nowMs: number): boolean {
  return motionIndexAt(motion, nowMs) % 1 === 0;
}

/**
 * 一位整数位的状态机（纯函数，状态只由 {from, to, startMs} 描述，组件把它存在 ref 里，绝不进 React state）：
 * - 首次见到这一位：直接静止在新数字上（开机不做整排滚动的假动画）。
 * - 数字没变：沿用同一段状态，进度随时间推进，到 CARRY_MS 就钉在 1；9→0 的重复格在落地时归一回 index 0。
 * - 数字变了且正好是 +1（低位进位）：用 CARRY_MS 从旧格滚到新格（9→0 滚到重复格）。
 * - 数字变了但不是 +1（改设置、时钟跳变）：直接落位，不做多格糊成一片的滚动。
 */
export function motionAt(prev: DigitMotion | null, digit: number, nowMs: number): DigitMotion {
  if (prev === null) return { from: digit, to: digit, startMs: nowMs };

  const landed = prev.to === WRAP_INDEX ? 0 : prev.to;
  if (landed === digit) {
    // 还在滚：继续用同一段状态把进度推完。
    if (carryProgress(nowMs - prev.startMs) < 1) return prev;
    // 已经落地：把重复格归一，静止格号恒等于数字本身。
    return { from: digit, to: digit, startMs: nowMs };
  }

  const step = (digit - landed + 10) % 10;
  return step === 1
    ? { from: landed, to: landed + 1, startMs: nowMs }
    : { from: digit, to: digit, startMs: nowMs };
}

/* ---------------------------------------------------------------------------------------------
 * 小数位：与整数位同一套"一格窗口 + 一条滚条"的格子，区别只在滚动规则。
 * 小数位永远向上滚，滚过的格数就是数值差，所以滚条要覆盖一整圈：from ≤ 9 且 d ≤ 9 ⇒ 最大格号 18。
 * 节拍由 refreshHz 决定（每 1000/refreshHz 毫秒才检测一次变化），单段时长再按同一档位自适应，
 * 保证 10Hz 下 90ms 内滚完、跟得上 100ms 的下一拍。
 * 第 index 格的字形是 String(index % 10)，于是"落地格号 = from + d"与"新数字"天然同余，
 * 落地后归一回 (落点 % 10) 那一下字形完全相同，看不出任何跳动。
 * ------------------------------------------------------------------------------------------- */

/** 小数位滚条长度：0..18 共 19 格（第 10 格起是第二圈）。 */
const FRAC_GLYPHS = 19;

const FRAC_STRIP = Array.from({ length: FRAC_GLYPHS }, (_, index) => String(index % 10));

/** 小数位滚动的固定开销（ms）。 */
export const FRAC_BASE_MS = 200;

/** 每多滚一格的追加时长（ms）。 */
export const FRAC_STEP_MS = 15;

/** 单段滚动时长上限的下界（ms）：60Hz 档按 1000/60 的 90% 只有 15ms，会退化成瞬移，钳在 60ms。 */
export const FRAC_MIN_CAP_MS = 60;

/** 一位小数数字的滚动状态：与整数位同构，只是 to 可以超过 10（滚条上的重复格）。 */
export interface FracMotion {
  from: number;
  to: number;
  startMs: number;
}

/** 向上滚动的格数：d = (新 - 旧 + 10) % 10，9→0 也是 1 格，永远向上。 */
export function fracDistance(fromDigit: number, toDigit: number): number {
  return (((toDigit - fromDigit) % 10) + 10) % 10;
}

/**
 * 单段滚动的时长上限（ms）：按本档位的到期间隔 1000/refreshHz 的 90% 给预算，让一段滚动赶在下一拍之前落地。
 * 1Hz → 900ms（比 200 + 15d 的自然上限还大，等于不设限）、10Hz → 90ms、60Hz → 60ms（下界兜底）。
 */
export function fracCapMs(refreshHz: RefreshHz): number {
  return Math.max(FRAC_MIN_CAP_MS, Math.floor((1000 * 0.9) / refreshHz));
}

/** 滚动时长：min(200ms + 15ms × 格数, 本档位上限)。1Hz 下就是原来的 215–335ms。 */
export function fracDurationMs(distance: number, refreshHz: RefreshHz): number {
  return Math.min(FRAC_BASE_MS + FRAC_STEP_MS * distance, fracCapMs(refreshHz));
}

/** 静止态：这一位就停在自己的整格上。 */
function settledAt(digit: number, nowMs: number): FracMotion {
  return { from: digit, to: digit, startMs: nowMs };
}

/** 滚动进度：0 = 还停在起点格，1 = 已经落到落点格；静止态恒为 1。只服务动画，金额不经浮点。 */
export function fracProgress(motion: FracMotion, nowMs: number, refreshHz: RefreshHz): number {
  if (motion.to === motion.from) return 1;
  const span = fracDurationMs(motion.to - motion.from, refreshHz);
  const elapsed = nowMs - motion.startMs;
  if (elapsed <= 0) return 0;
  return elapsed >= span ? 1 : elapsed / span;
}

/** 当前位移格号：静止时是整数格，滚动时在 from 与 to 之间线性推进，到点精确等于 to。 */
export function fracIndexAt(motion: FracMotion, nowMs: number, refreshHz: RefreshHz): number {
  return motion.from + (motion.to - motion.from) * fracProgress(motion, nowMs, refreshHz);
}

/**
 * 一位小数的状态机（纯函数，状态存在 ref 里，绝不进 React state）：
 * - due 为 false（不是 refreshHz 到期的帧）：只推进已经开始的滚动，不检测数值变化。
 * - 首次见到这一位：直接静止在新数字上。
 * - 滚动未完成：不被打断，继续把这一段推完（任何模式下都不会跳到"半途"的另一段）。
 * - 滚动完成：先归一回 (落点 % 10)；同一帧如果到期且数字变了，再从这里向上滚 d 格。
 * - d = 0：不动画，保持原地。
 * refreshHz 只参与"这一段该滚多久"：1Hz 用 200 + 15d 的原值，10Hz / 60Hz 收窄到档位上限。
 */
export function fracFrame(
  prev: FracMotion | null,
  digit: number,
  nowMs: number,
  due: boolean,
  refreshHz: RefreshHz,
): FracMotion {
  if (prev === null) return settledAt(digit, nowMs);
  // 还在滚：不打断，进度继续推进。
  if (fracProgress(prev, nowMs, refreshHz) < 1) return prev;

  const base = prev.to % 10;
  const settled = prev.from === base && prev.to === base;
  if (!due) return settled ? prev : settledAt(base, nowMs);
  if (settled && base === digit) return prev;

  const distance = fracDistance(base, digit);
  return distance === 0 ? settledAt(base, nowMs) : { from: base, to: base + distance, startMs: nowMs };
}

export interface DigitCellHandle {
  /** 把这一位推到 digit：变了就滚一格（CARRY_MS），没变就纹丝不动地停在整格上。 */
  paint(digit: number, nowMs: number, visible: boolean): void;
}

export interface FracCellHandle {
  /**
   * 把这一位推到 digit。只有 due（refreshHz 到期的帧）才检测数值变化并启动一次向上的滚动；
   * 其余帧只推进已经开始的动画，静止态一次 style 都不写。
   */
  paint(digit: number, nowMs: number, visible: boolean, due: boolean): void;
}

interface DigitCellProps {
  /** 这一位是 10^pos（0 = 个位），只作为 DOM 上的 data-pos 标记，方便定位与取证。 */
  pos: number;
  ref?: Ref<DigitCellHandle>;
}

/**
 * 一位整数数字：永远是"一格窗口 + 一条 0–9 滚条"，位移恒为 -(digit × PITCH_EM)（整数格）。
 * 常态精确停在该位的整格上，绝不长时间停在两格之间；只有这一位的数值变化时用 CARRY_MS 滚过一格，
 * 结束立刻钳到新整格。全组件没有 useState/setState：状态在 ref 里，每帧最多写一次 transform。
 */
export function DigitCell({ pos, ref }: DigitCellProps) {
  const cellRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const motionRef = useRef<DigitMotion | null>(null);
  const shownRef = useRef(true);
  const lastOffsetRef = useRef("");

  useImperativeHandle(
    ref,
    () => ({
      paint(digit, nowMs, visible) {
        if (visible !== shownRef.current) {
          shownRef.current = visible;
          if (cellRef.current) cellRef.current.style.display = visible ? "" : "none";
          // 从隐藏变可见（金额位数变长）：直接静止在新数字上，不补一次假进位。
          if (visible) motionRef.current = null;
        }
        if (!visible) return;

        const motion = motionAt(motionRef.current, digit, nowMs);
        motionRef.current = motion;
        // 位移只写一次、且只在真的变了的时候写：静止态下这一行每帧都是空操作，不触发样式重算。
        const offset = (-motionIndexAt(motion, nowMs) * PITCH_EM).toFixed(5);
        if (offset === lastOffsetRef.current) return;
        lastOffsetRef.current = offset;
        if (trackRef.current) trackRef.current.style.transform = `translate3d(0, ${offset}em, 0)`;
      },
    }),
    [],
  );

  return (
    <span className="digit" ref={cellRef} data-pos={pos} aria-hidden="true">
      <span className="digit-track" ref={trackRef}>
        {STRIP.map((glyph, index) => (
          <span className="digit-glyph" key={index}>
            {glyph}
          </span>
        ))}
      </span>
    </span>
  );
}

interface FracCellProps {
  /** 小数第 fpos 位（1 = 十分位），只作为 DOM 上的 data-fpos 标记。 */
  fpos: number;
  /** 这一位所在的跳动频率档位：决定单段滚动的时长上限（1000/refreshHz 的 90%）。 */
  refreshHz: RefreshHz;
  ref?: Ref<FracCellHandle>;
}

/**
 * 一位小数数字：与整数位同一套滚条格子，规则换成"向上滚 d 格、时长 min(200 + 15d, 本档位上限)"。
 * 1Hz 上限 900ms（等于不设限，仍是 215–335ms）；10Hz 上限 90ms；60Hz 下限兜到 60ms。
 * 静止时精确停在本位的整格上；滚动结束精确落在新整格并归一，无残差。
 * 同样没有 useState/setState：状态机在 ref 里，每帧最多写一次 transform。
 */
export function FracCell({ fpos, refreshHz, ref }: FracCellProps) {
  const cellRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const motionRef = useRef<FracMotion | null>(null);
  const shownRef = useRef(true);
  const lastOffsetRef = useRef("");

  useImperativeHandle(
    ref,
    () => ({
      paint(digit, nowMs, visible, due) {
        if (visible !== shownRef.current) {
          shownRef.current = visible;
          if (cellRef.current) cellRef.current.style.display = visible ? "" : "none";
          if (visible) motionRef.current = null;
        }
        if (!visible) return;

        const motion = fracFrame(motionRef.current, digit, nowMs, due, refreshHz);
        motionRef.current = motion;
        const offset = (-fracIndexAt(motion, nowMs, refreshHz) * PITCH_EM).toFixed(5);
        if (offset === lastOffsetRef.current) return;
        lastOffsetRef.current = offset;
        if (trackRef.current) trackRef.current.style.transform = `translate3d(0, ${offset}em, 0)`;
      },
    }),
    [refreshHz],
  );

  return (
    <span className="digit frac-digit" ref={cellRef} data-fpos={fpos} aria-hidden="true">
      <span className="digit-track" ref={trackRef}>
        {FRAC_STRIP.map((glyph, index) => (
          <span className="digit-glyph" key={index}>
            {glyph}
          </span>
        ))}
      </span>
    </span>
  );
}
