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
