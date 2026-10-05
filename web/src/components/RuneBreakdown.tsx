import { ItemIcon } from './ItemIcon';
import { RUNE_NAMES, runeTier } from '../lib/runes';
import type { Drop } from '../lib/types';

/** The runes found, highest first, as one line: icon, name and count (high runes in bold). */
export function RuneBreakdown({ runes }: { runes: Map<number, { count: number; sample: Drop }> }) {
  if (runes.size === 0) return null;
  const sorted = [...runes].sort(([a], [b]) => b - a);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="text-muted">Runes</span>
      {sorted.map(([n, { count, sample }]) => (
        <span key={n} title={`${RUNE_NAMES[n - 1]} Rune (#${n}, ${runeTier(n).toLowerCase()} rune)`} className="flex items-center gap-1">
          <ItemIcon item={sample.item} box={24} />
          <span className={`text-q-crafted ${runeTier(n) === 'High' ? 'font-semibold' : ''}`}>{RUNE_NAMES[n - 1]}</span>
          <span className="text-muted tabular-nums">×{count}</span>
        </span>
      ))}
    </div>
  );
}
