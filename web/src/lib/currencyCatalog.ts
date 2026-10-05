import currency from '../data/currency.json';
import { RUNE_NAMES } from './runes';
import type { Item } from './types';

export interface CurrencyEntry {
  code: string;
  name: string;
  group: 'Runes' | 'Uber, keys & more' | 'Shards';
}

/** Everything sellable as currency: runes (high first), the valuable currency list, shards. */
export const CURRENCY_CATALOG: CurrencyEntry[] = [
  ...RUNE_NAMES.map((n, i) => ({ code: `r${String(i + 1).padStart(2, '0')}`, name: `${n} Rune`, group: 'Runes' as const })).reverse(),
  ...Object.entries(currency.valuable as Record<string, string>).map(([code, name]) => ({ code, name, group: 'Uber, keys & more' as const })),
  ...Object.entries(currency.shards as Record<string, string>).map(([code, name]) => ({ code, name, group: 'Shards' as const })),
];
export const CURRENCY_BY_CODE = new Map(CURRENCY_CATALOG.map((c) => [c.code, c]));

/** A minimal item for rendering a currency's icon. */
export const currencyItem = (code: string): Item => {
  const rune = /^r\d\d$/.test(code);
  return {
    id: 0,
    name: CURRENCY_BY_CODE.get(code)?.name ?? code,
    base_code: code,
    quality: { id: 2, name: 'Normal' },
    base: { id: code, name: '', category: 'misc', type: rune ? 'Rune' : 'Misc', type_code: rune ? 'rune' : '', size: { width: 1, height: 1 } },
    is_identified: true,
    is_ethereal: false,
    is_simple: true,
    is_runeword: false,
    corrupted: false,
    socket_count: 0,
    graphic_id: false,
    modifiers: [],
  } as Item;
};
