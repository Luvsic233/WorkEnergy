import { useImperativeHandle, useRef, type Ref } from "react";
import type { DigitColumn } from "../core/format";

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
 * 小数位：连续滚动。位移不是"滚一段、停一拍、再滚一段"，而是每一帧都直接由 atoms 的连续进度
 * 算出来，没有 CARRY、没有距离、没有时长，也没有任何节拍门限：
 *   小数第 d 位：unit = 10^(18-d)，digit = (abs / unit) % 10，progress = (abs % unit) / unit
 *   位移 = -(digit + progress) × PITCH_EM，progress ∈ [0, 1) 随挂钟单调推进
 * 于是每一位小数的位移只会一直往下匀着走，人眼看到的是一条连续流动的尾巴。
 * 19 格滚条保留：digit ≤ 9 且 progress < 1，位移格号永远落在第 0 格与第 10 格之间，不会越界。
 * ------------------------------------------------------------------------------------------- */

/** 小数位滚条长度：0..18 共 19 格（第 10 格起是第二圈）。 */
const FRAC_GLYPHS = 19;

const FRAC_STRIP = Array.from({ length: FRAC_GLYPHS }, (_, index) => String(index % 10));

/**
 * 连续位移格号：本位当前数字 + 它向下一格滚进的进度。
 * progress ∈ [0, 1)，所以结果恒在 [digit, digit + 1) 之内，永远在两格之间而不越界。
 */
export function fracIndex(column: DigitColumn): number {
  return column.digit + column.progress;
}

/** 连续位移（em）：小数位每帧都在两格之间，滚动模式下不存在"停在整格"这件事。 */
export function fracOffsetEm(column: DigitColumn): number {
  return -fracIndex(column) * PITCH_EM;
}

export interface DigitCellHandle {
  /** 把这一位推到 digit：变了就滚一格（CARRY_MS），没变就纹丝不动地停在整格上。 */
  paint(digit: number, nowMs: number, visible: boolean): void;
}

export interface FracCellHandle {
  /**
   * 把这一位推到它的连续位置：位移只由 {digit, progress} 决定，每一帧都算一次。
   * 没有"到期的帧"这回事——位移没变才不写。
   */
  paint(column: DigitColumn, visible: boolean): void;
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
  ref?: Ref<FracCellHandle>;
}

/**
 * 一位小数数字：与整数位同一套滚条格子，位移换成"digit + progress"的连续值，每一帧都推进。
 * 不存在"滚到哪儿停下"的分段状态：状态只有上一次写入的位移字符串，用来短路没变化的帧。
 * 同样没有 useState/setState：每帧最多写一次 transform。
 */
export function FracCell({ fpos, ref }: FracCellProps) {
  const cellRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const shownRef = useRef(true);
  const lastOffsetRef = useRef("");

  useImperativeHandle(
    ref,
    () => ({
      paint(column, visible) {
        if (visible !== shownRef.current) {
          shownRef.current = visible;
          if (cellRef.current) cellRef.current.style.display = visible ? "" : "none";
        }
        if (!visible) return;

        const offset = fracOffsetEm(column).toFixed(5);
        if (offset === lastOffsetRef.current) return;
        lastOffsetRef.current = offset;
        if (trackRef.current) trackRef.current.style.transform = `translate3d(0, ${offset}em, 0)`;
      },
    }),
    [],
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
