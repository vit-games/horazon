import { VALUABLE_CODES } from './itemStyle';
import type { TierInfo } from './tiers';
import { runeNumber, runeTier } from './runes';
import type { Drop } from './types';

/**
 * The one meaning of "notable", everywhere drops are counted or listed: anything in your tier
 * list, runes at or above `minRune` (Pul by default), valuable currency, and crafts you kept.
 * Untiered uniques and sets are not; a first-time grail find is marked separately (the sparkle).
 */
export function isNotable(d: Drop, minRune: number, tier: TierInfo | null): boolean {
  if (tier) return true;
  if (d.source === 'craft') return !!d.kept;
  const rune = runeNumber(d.item);
  if (rune !== null) return rune >= minRune;
  return VALUABLE_CODES.has(d.item.base_code);
}

/** A craft still waiting for Keep or Discard. */
export const awaitsDecision = (d: Drop, tier: TierInfo | null) => d.source === 'craft' && !d.kept && !d.ignored && !tier;

/**
 * Rank without market prices: tiered items first (best tier, then higher rune),
 * then high runes, new grail finds, other uniques/sets, mid runes.
 */
export function rankScore(d: Drop, newFinds: Set<number>, tier: TierInfo | null): number {
  const rune = runeNumber(d.item);
  if (tier) return 10000 - tier.rank * 100 + (rune ?? 0);
  if (rune === null) return newFinds.has(d.id) ? 60 : 50;
  return runeTier(rune) === 'High' ? 100 + rune : rune;
}
