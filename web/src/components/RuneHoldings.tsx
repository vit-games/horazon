import { useEffect, useState } from 'react';
import { ItemIcon } from './ItemIcon';
import { fetchHoldings } from '../lib/api';
import { useChanges } from '../lib/live';
import { RUNE_NAMES, TIER_RANGE } from '../lib/runes';
import type { Item } from '../lib/types';

const runeItem = (n: number): Item => ({
  id: 0,
  name: `${RUNE_NAMES[n - 1]} Rune`,
  base_code: `r${String(n).padStart(2, '0')}`,
  quality: { id: 2, name: 'Normal' },
  base: { id: '', name: '', category: 'misc', type: 'Rune', type_code: 'rune', size: { width: 1, height: 1 } },
  is_identified: true,
  is_ethereal: false,
  is_simple: true,
  is_runeword: false,
  corrupted: false,
  socket_count: 0,
  graphic_id: false,
  modifiers: [],
});

/** Runes currently owned across all polled sources (characters + shared stash). */
export function RuneHoldings() {
  const [holdings, setHoldings] = useState<Record<string, number>>({});
  const version = useChanges('sources');

  useEffect(() => {
    fetchHoldings().then(setHoldings, () => {});
  }, [version]);

  const runes = Object.entries(holdings)
    .map(([code, count]) => ({ n: Number(/^r(\d\d)$/.exec(code)?.[1] ?? 0), code, count }))
    .filter((r) => r.n > 0 && r.count > 0)
    .sort((a, b) => b.n - a.n);
  if (!runes.length) return null;

  const total = runes.reduce((n, r) => n + r.count, 0);
  const high = runes.filter((r) => r.n >= TIER_RANGE.High[0]).reduce((n, r) => n + r.count, 0);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg text-text">
        Runes owned now{' '}
        <span className="font-sans text-sm font-normal text-muted">
          <span className="font-num font-semibold text-text tabular-nums">{total}</span>
          {high > 0 && (
            <>
              {' '}
              · <span className="font-num font-semibold text-text tabular-nums">{high}</span> high
            </>
          )}{' '}
          · characters and shared stash, latest snapshot
        </span>
      </h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {runes.map((r) => (
          <span key={r.code} className="flex items-center gap-1">
            <ItemIcon item={runeItem(r.n)} box={22} />
            <span className={`text-q-crafted ${r.n >= TIER_RANGE.High[0] ? 'font-semibold' : ''}`}>{RUNE_NAMES[r.n - 1]}</span>
            <span className="text-muted tabular-nums">×{r.count}</span>
          </span>
        ))}
      </div>
    </section>
  );
}
