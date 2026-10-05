import type { ReactNode } from 'react';

/** A borderless line of figures, each a condensed number with its muted label (as on Session). */
export function Ledger({ items }: { items: { value: ReactNode; label: string; title?: string; note?: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-1 font-num text-lg font-semibold tabular-nums">
      {items.map((i) => (
        <span key={i.label} title={i.title}>
          {i.value} <span className="font-sans text-sm font-medium text-muted">{i.label}</span>
          {i.note && <span className="ml-1.5 text-sm font-medium text-faint">{i.note}</span>}
        </span>
      ))}
    </div>
  );
}
