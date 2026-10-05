import type { Item } from './types';

/** Rune names in order; index + 1 is the rune number (base code r01..r33). */
export const RUNE_NAMES = [
  'El', 'Eld', 'Tir', 'Nef', 'Eth', 'Ith', 'Tal', 'Ral', 'Ort', 'Thul', 'Amn',
  'Sol', 'Shael', 'Dol', 'Hel', 'Io', 'Lum', 'Ko', 'Fal', 'Lem', 'Pul', 'Um',
  'Mal', 'Ist', 'Gul', 'Vex', 'Ohm', 'Lo', 'Sur', 'Ber', 'Jah', 'Cham', 'Zod',
] as const;

export const PUL = 21;

/** Tiers as defined on the PD2 wiki: low El–Dol, mid Hel–Gul, high Vex–Zod. */
export type RuneTier = 'High' | 'Mid' | 'Low';
export const TIER_RANGE: Record<RuneTier, [number, number]> = { Low: [1, 14], Mid: [15, 25], High: [26, 33] };

export function runeNumber(item: Item): number | null {
  if (item.base?.type_code !== 'rune') return null;
  const m = /^r(\d\d)$/.exec(item.base_code);
  return m ? Number(m[1]) : null;
}

export function runeTier(n: number): RuneTier {
  if (n >= TIER_RANGE.High[0]) return 'High';
  if (n >= TIER_RANGE.Mid[0]) return 'Mid';
  return 'Low';
}
