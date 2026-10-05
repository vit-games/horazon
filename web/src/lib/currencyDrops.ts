import currency from '../data/currency.json';
import { VALUABLE_CODES } from './itemStyle';
import { runeNumber } from './runes';
import type { TierInfo } from './tiers';
import type { Drop, Item } from './types';

/** Worldstone and Tainted Worldstone Shards: counted on their own (the overlay's shard counter). */
export const WORLDSTONE_CODES = new Set(['wss', 'cwss']);
const SHARD_CODES = new Set(Object.keys(currency.shards));

/** Stacked runes count as their rune. */
export const currencyCode = (item: Item) => item.base_code.replace(/^(r\d\d)s$/, '$1');

/** Extremely rare uber drops - Horadric Almanac and Navigator, Lilith's Mirror, Vial of Lightsong: items, not currency. */
const RARE_CODES = new Set(['rid', 'rtp', 'llmr', 'lsvl']);

/**
 * Currency: runes, gems, shards, uber keys/organs/essences and the like - not the rare uber
 * drops. Listed per day as one aggregated strip instead of a row per drop.
 */
export const isCurrency = (item: Item) =>
  !RARE_CODES.has(item.base_code) &&
  (runeNumber(item) !== null || /^r\d\ds?$/.test(item.base_code) || item.base?.type === 'Gem' || VALUABLE_CODES.has(item.base_code) || SHARD_CODES.has(item.base_code));

export interface CurrencyStack {
  code: string;
  /** One of the drops, for its art, name and tooltip. */
  item: Item;
  count: number;
  tier: TierInfo | null;
  drops: Drop[];
}

/** The currency among `drops`, one stack per kind: best tier first, then higher runes, then the most. */
export function stackCurrency(drops: Drop[], tierOf: (d: Drop) => TierInfo | null): CurrencyStack[] {
  const by = new Map<string, CurrencyStack>();
  for (const d of drops) {
    const code = currencyCode(d.item);
    const s = by.get(code) ?? { code, item: d.item, count: 0, tier: tierOf(d), drops: [] };
    s.count += d.quantity;
    s.drops.push(d);
    by.set(code, s);
  }
  return [...by.values()].sort(
    (a, b) =>
      (a.tier?.rank ?? 99) - (b.tier?.rank ?? 99) ||
      (runeNumber(b.item) ?? 0) - (runeNumber(a.item) ?? 0) ||
      b.count - a.count ||
      a.item.name.localeCompare(b.item.name),
  );
}

/** "Ber" for runes, the item name otherwise. */
export const currencyLabel = (item: Item) => item.name.replace(/ Rune$/, '');
