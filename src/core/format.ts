import { ATOMS_PER_YUAN } from "./earning";

const FRAC_SCALE = 10n ** 6n;
const FRAC_DIGITS = 12;

export interface MoneyParts {
  int: string;
  frac: string;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatAtoms(atoms: bigint): MoneyParts {
  const negative = atoms < 0n;
  const abs = negative ? -atoms : atoms;
  const int = abs / ATOMS_PER_YUAN;
  const frac = (abs % ATOMS_PER_YUAN) / FRAC_SCALE;
  return {
    int: (negative ? "-" : "") + groupThousands(int.toString()),
    frac: frac.toString().padStart(FRAC_DIGITS, "0"),
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
