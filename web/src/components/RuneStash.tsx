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

// As the game's rune stash: El first, 11 to a row, the high runes along the bottom.
const ORDER = Array.from({ length: 33 }, (_, i) => i + 1);

/**
 * The runes you own now, on every character and the shared stash: the count that holds, as runes
 * get used in runewords and traded in. Every rune has its place; the ones you have none of stay
 * empty. A rune picks the lowest tracked rune.
 */
export function RuneStash({ track, onTrack }: { track: number; onTrack: (n: number) => void }) {
  const [owned, setOwned] = useState<Record<string, number> | null>(null);
  const version = useChanges('sources');
  useEffect(() => {
    fetchHoldings().then(setOwned, () => {});
  }, [version]);
  if (!owned) return null;

  const count = (n: number) => owned[`r${String(n).padStart(2, '0')}`] ?? 0;
  const total = ORDER.reduce((s, n) => s + count(n), 0);
  if (!total) return null;
  const high = ORDER.filter((n) => n >= TIER_RANGE.High[0]).reduce((s, n) => s + count(n), 0);

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg text-text">
          Runes{' '}
          <span className="ml-1 font-sans text-sm font-normal text-muted">
            <span className="font-num font-semibold text-text tabular-nums">{total}</span> owned
            {high > 0 && (
              <>
                {' '}
                · <span className="font-num font-semibold text-text tabular-nums">{high}</span> high
              </>
            )}
          </span>
        </h2>
        <span className="text-xs text-muted">On every character and the shared stash now. Pick a rune to track it and higher.</span>
      </header>
      <div className="grid w-fit grid-cols-11 gap-1 rounded-sm border border-line bg-rail p-2">
        {ORDER.map((n) => {
          const c = count(n);
          const name = RUNE_NAMES[n - 1];
          return (
            <button
              key={n}
              type="button"
              onClick={() => onTrack(n)}
              aria-pressed={n === track}
              aria-label={`${name}: ${c} owned. Track ${name} and higher`}
              title={`${name} Rune: ${c} owned`}
              className={`relative flex w-[4.25rem] flex-col items-center gap-0.5 rounded-sm border px-1 pt-1.5 pb-1 hover:border-accent/60 focus-visible:outline focus-visible:outline-accent ${
                n >= track ? 'border-accent/30 bg-accent/10' : 'border-line/60 bg-panel'
              }`}
            >
              <span className={c ? '' : 'opacity-25 grayscale'}>
                <ItemIcon item={runeItem(n)} box={28} />
              </span>
              <span className={`text-xs ${c ? `text-q-crafted ${n >= TIER_RANGE.High[0] ? 'font-semibold' : ''}` : 'text-faint'}`}>{name}</span>
              {c > 0 && <span className="absolute top-0.5 right-1 font-num text-sm font-semibold text-text tabular-nums">{c}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
