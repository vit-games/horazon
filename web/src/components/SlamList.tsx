import { useState } from 'react';
import { ItemIcon } from './ItemIcon';
import { FloatingTooltip } from './ItemTooltip';
import type { SlamEntry } from '../lib/api';
import { corruption } from '../lib/corruption';
import { itemKind, nameColor } from '../lib/itemStyle';
import type { Item } from '../lib/types';

const lineKey = (m: { name: string; values?: number[] }) => `${m.name}:${(m.values ?? []).join(',')}`;
/** The after item with the lines the slam added or changed marked (red in its tooltip). */
function markSlammed(before: Item, after: Item): Item {
  const had = new Set((before.modifiers ?? []).map(lineKey));
  return {
    ...after,
    modifiers: (after.modifiers ?? []).map((m) => (m.name === 'corrupted' || m.name === 'item_corrupted' || had.has(lineKey(m)) ? m : { ...m, corrupted: true })),
    // A socket slam adds no line, only sockets.
    socket_count: after.socket_count || 0,
  };
}

const timeFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Every slam of the period, on any item - your finds or not: the item before and after (hover
 * either for its tooltip), bricks in clay.
 */
export function SlamList({ slams }: { slams: SlamEntry[] }) {
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);
  const [bricksOnly, setBricksOnly] = useState(false);
  const shown = bricksOnly ? slams.filter((s) => s.bricked) : slams;

  const side = (item: Item | null, extra?: string) =>
    item ? (
      <span
        className="flex min-w-0 cursor-default items-center gap-2"
        onMouseMove={(e) => setHover({ item, x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHover(null)}
      >
        <ItemIcon item={item} box={32} />
        <span className="min-w-0">
          <span className={`block truncate text-sm font-semibold ${nameColor(item)}`}>{item.name}</span>
          <span className="block truncate text-xs text-muted">{[itemKind(item), extra].filter(Boolean).join(' · ')}</span>
        </span>
      </span>
    ) : (
      <span className="text-xs text-muted">—</span>
    );

  return (
    <section className="border-t border-line">
      <div className="flex items-center justify-end border-b border-line/60 px-4 py-1.5">
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" className="accent-accent" checked={bricksOnly} onChange={(e) => setBricksOnly(e.target.checked)} />
          Bricks only
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">{bricksOnly ? 'No bricks in this period.' : 'No slams in this period.'}</p>
      ) : (
        <ul className="max-h-[420px] overflow-y-auto" onMouseLeave={() => setHover(null)}>
          {shown.map((s) => {
            const after = s.after_item && s.before_item && !s.bricked ? markSlammed(s.before_item, s.after_item) : s.after_item;
            const outcome = after ? corruption(after) : null;
            return (
              <li key={s.id} className={`${s.bricked ? 'bg-brick/10' : ''} grid grid-cols-[6.5rem_minmax(0,1fr)_1.5rem_minmax(0,1fr)_5rem] items-center gap-3 border-b border-line/50 px-4 py-1.5 last:border-0`}>
                <span className="text-xs text-muted tabular-nums">{timeFmt.format(new Date(s.at))}</span>
                {side(s.before_item)}
                <span className="text-center text-muted">→</span>
                {s.bricked || !after ? (
                  side(after)
                ) : (
                  // The same item: only what the slam gave, as the drop list and overlay put it.
                  <span
                    className="cursor-default truncate text-sm font-semibold text-q-red"
                    onMouseMove={(e) => setHover({ item: after, x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setHover(null)}
                  >
                    {outcome || 'Corrupted'}
                  </span>
                )}
                <span className="text-right text-xs">
                  {s.bricked && (
                    <span className="rounded-sm bg-brick px-1.5 py-0.5 text-xs font-bold tracking-[0.1em] text-[#1a0d08] uppercase">Bricked</span>
                  )}
                  <span className="block text-muted">{s.drop_id ? 'your find' : 'not a find'}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {hover && <FloatingTooltip {...hover} />}
    </section>
  );
}
