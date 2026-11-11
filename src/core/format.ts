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

const MICRO_SCALE = 1_000_000n;

/** 微单位（1e-6）BigInt → 人类可读十进制字符串，去掉小数尾零；全程整数，不经过 Number。 */
export function formatMicro(micro: bigint): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const frac = (abs % MICRO_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return (negative ? "-" : "") + (abs / MICRO_SCALE).toString() + (frac ? `.${frac}` : "");
}
