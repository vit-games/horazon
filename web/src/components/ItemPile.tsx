import { useState } from 'react';
import { Floating, type Anchor } from './Floating';
import { ItemIcon } from './ItemIcon';
import gameData from '../data/game-data.json';
import { asItem, baseName, HIGH_RUNE } from '../lib/capture';

const bases = gameData.bases as Record<string, { type?: string }>;

/** Up to this many kinds of item show inline; more collapse into one chip with the list on hover. */
const INLINE_KINDS = 3;

const runeNumber = (c: string) => Number(/^r(\d\d)s?$/.exec(c)?.[1] ?? 0);

/** Runes highest first, then the rest by count. */
function order([a, n]: [string, number], [b, m]: [string, number]) {
  return runeNumber(b) - runeNumber(a) || m - n || baseName(a).localeCompare(baseName(b));
}

/** Groups in the hover list, in this order: runes by tier (Hel and Vex start mid and high), map orbs (infused or not), maps. */
const GROUPS = ['High runes', 'Mid runes', 'Low runes', 'Map orbs', 'Maps', 'Other'] as const;
function groupOf(code: string): (typeof GROUPS)[number] {
  const rune = runeNumber(code);
  if (rune) return rune >= HIGH_RUNE ? 'High runes' : rune >= 15 ? 'Mid runes' : 'Low runes';
  const type = bases[code]?.type ?? '';
  if (/^(Imbue|Upgrade|Scour|RerollRare|Dungeon Scarab|Fortify)/.test(type)) return 'Map orbs'; // incl. infused ("... Ready")
  if (/^Map T\d/.test(type)) return 'Maps';
  return 'Other';
}

/**
 * Counted items (an event's rewards...): a few inline as icon, name and count; many as
 * one chip - a fan of icons and the total - listing them all on hover, so a big haul
 * doesn't take over the row. The default for any such list.
 */
export function ItemPile({ counts, noun, shortName = baseName }: { counts: Record<string, number>; noun: string; shortName?: (code: string) => string }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const items = Object.entries(counts).sort(order);
  if (items.length <= INLINE_KINDS) {
    return (
      <>
        {items.map(([code, n]) => (
          <span key={code} className="flex items-center gap-1 text-xs text-text" title={baseName(code)}>
            <ItemIcon item={asItem({ code, quality: null, uid: null })} box={18} />
            <span>{shortName(code)}</span>
            <span className="text-muted tabular-nums">×{n}</span>
          </span>
        ))}
      </>
    );
  }
  const total = items.reduce((sum, [, n]) => sum + n, 0);
  return (
    <span
      className="flex cursor-help items-center gap-1.5 text-xs underline decoration-line decoration-dotted underline-offset-4"
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setAnchor({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
      }}
      onMouseLeave={() => setAnchor(null)}
    >
      <span className="flex">
        {items.slice(0, 4).map(([code], i) => (
          <span key={code} className={i ? '-ml-2' : ''}>
            <ItemIcon item={asItem({ code, quality: null, uid: null })} box={18} />
          </span>
        ))}
      </span>
      <span className="text-text tabular-nums">{total}</span>
      <span className="text-muted">{noun}</span>
      {anchor && (
        <Floating anchor={anchor} width={240}>
          <div className="flex flex-col gap-2">
            {GROUPS.map((group) => {
              const list = items.filter(([code]) => groupOf(code) === group);
              if (!list.length) return null;
              return (
                <div key={group}>
                  <div className="mb-0.5 flex justify-between border-b border-line/60 pb-0.5 text-xs text-muted">
                    <span>{group}</span>
                    <span className="tabular-nums">{list.reduce((sum, [, n]) => sum + n, 0)}</span>
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {list.map(([code, n]) => (
                      <li key={code} className="flex items-center gap-1.5">
                        <ItemIcon item={asItem({ code, quality: null, uid: null })} box={18} />
                        <span className="flex-1 truncate text-text">{baseName(code)}</span>
                        <span className="text-muted tabular-nums">×{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </Floating>
      )}
    </span>
  );
}
