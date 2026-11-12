import { ATOMS_PER_YUAN } from "./earning";

/**
 * 小数位数档位：18 位是默认档，也是本机芯的原生上限——金额最小单位是 1e-18 元（atoms），
 * 18 位正好用尽全部精度；另有 12 位 / 6 位两档降噪用。
 */
export type Decimals = 18 | 12 | 6;

export const DEFAULT_DECIMALS: Decimals = 18;

export interface MoneyParts {
  int: string;
  frac: string;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 每个档位对应的原子除数 10^(18 - decimals)：整数直除即向下截断，全程 BigInt；18 位档除数为 1，即完整余数。 */
function atomScale(decimals: Decimals): bigint {
  return 10n ** BigInt(18 - decimals);
}

export function formatAtoms(atoms: bigint, decimals: Decimals = DEFAULT_DECIMALS): MoneyParts {
  const negative = atoms < 0n;
  const abs = negative ? -atoms : atoms;
  const int = abs / ATOMS_PER_YUAN;
  const frac = (abs % ATOMS_PER_YUAN) / atomScale(decimals);
  return {
    int: (negative ? "-" : "") + groupThousands(int.toString()),
    frac: frac.toString().padStart(decimals, "0"),
  };
}

/** 一位数字的滚动状态：digit 是这一位当前的数字，progress 是它向下一数字滚进的进度（只用于动画，永不进金额）。 */
export interface DigitColumn {
  digit: number;
  progress: number;
}

/** 金额拆分出的滚条列：整数最高位在前，小数第 1 位在前；整数部分至少一位（0 也保留一个 0）。 */
export interface DigitColumns {
  int: DigitColumn[];
  frac: DigitColumn[];
}

const PROGRESS_SCALE = 1_000_000n;

/**
 * 第 exponent 位（unit = 10^exponent，18 为个位）的滚动状态，全程 BigInt：
 * digit = (atoms / unit) % 10，progress = (atoms % unit) / unit ∈ [0, 1)。
 * progress 只取 6 位小数（微单位），既够 60fps 的位移精度，又保证 Number 转换精确无损；
 * 它是"这一位滚到下一数字的进度"，只有动画用它，金额本身从不经过浮点。
 */
function columnAt(abs: bigint, exponent: number): DigitColumn {
  const unit = 10n ** BigInt(exponent);
  return {
    digit: Number((abs / unit) % 10n),
    progress: Number(((abs % unit) * PROGRESS_SCALE) / unit) / 1_000_000,
  };
}

/**
 * 把 atoms 拆成每一位的 {digit, progress}，供机械计数器滚条渲染。
 * 小数第 d 位（d 从 1 起）= 10^(18-d) 位；整数第 k 位（k 从 0 起，0 为个位）= 10^(18+k) 位。
 * 于是高位（整数、小数前几位）的 progress 每秒只前进极小一点，低位 progress 每秒刷新上百次成流动尾巴。
 * 前导零不显示：整数部分只保留到最高有效位，但至少留一位。
 */
export function digitColumns(atoms: bigint, decimals: Decimals = DEFAULT_DECIMALS): DigitColumns {
  const abs = atoms < 0n ? -atoms : atoms;
  const intCount = Math.max(1, (abs / ATOMS_PER_YUAN).toString().length);

  const int: DigitColumn[] = [];
  for (let k = intCount - 1; k >= 0; k -= 1) int.push(columnAt(abs, 18 + k));

  const frac: DigitColumn[] = [];
  for (let d = 1; d <= decimals; d += 1) frac.push(columnAt(abs, 18 - d));

  return { int, frac };
}

const MICRO_SCALE = 1_000_000n;

/** 微单位（1e-6）BigInt → 人类可读十进制字符串，去掉小数尾零；全程整数，不经过 Number。 */
export function formatMicro(micro: bigint): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const frac = (abs % MICRO_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return (negative ? "-" : "") + (abs / MICRO_SCALE).toString() + (frac ? `.${frac}` : "");
}
