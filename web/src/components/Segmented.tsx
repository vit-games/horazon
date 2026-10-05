import type { ReactNode } from 'react';
import { segGroup, segItem } from '../lib/ui';

export interface SegOption<K extends string> {
  key: K;
  label: ReactNode;
  count?: number;
  /** Label colour (e.g. a quality or tier colour); zero counts fall back to faint. */
  className?: string;
}

/**
 * One segmented filter line: "All" plus a segment per option, each with its count. Segments
 * toggle (several can be on); "All" clears. The active segment carries a glyph-blue underline.
 */
export function Segmented<K extends string>({
  options,
  active,
  onToggle,
  onClear,
  total,
  label,
}: {
  options: SegOption<K>[];
  active: K[];
  onToggle: (key: K) => void;
  onClear: () => void;
  total?: number;
  /** Accessible name of the group. */
  label: string;
}) {
  return (
    <div className={segGroup} role="group" aria-label={label}>
      <button className={segItem(active.length === 0)} onClick={onClear} aria-pressed={active.length === 0} aria-label={total !== undefined ? `All, ${total}` : 'All'}>
        <span className="text-sm text-muted">All</span>
        {total !== undefined && <span className="font-num text-base font-semibold tabular-nums">{total}</span>}
      </button>
      {options.map((o) => {
        const zero = o.count === 0;
        return (
          <button key={o.key} className={segItem(active.includes(o.key))} onClick={() => onToggle(o.key)} aria-pressed={active.includes(o.key)} aria-label={typeof o.label === 'string' && o.count !== undefined ? `${o.label}, ${o.count}` : undefined}>
            <span className={`text-sm whitespace-nowrap ${zero ? 'text-faint' : o.className ?? 'text-text'}`}>{o.label}</span>
            {o.count !== undefined && <span className={`font-num text-base font-semibold tabular-nums ${zero ? 'text-faint' : ''}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
