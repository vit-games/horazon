import type { ReactNode } from 'react';

export type Figure = { label: string; value: ReactNode | null; hint: string; className?: string };

/**
 * Record figures in Session's number style: what it is, the number large, when below. A record not
 * set yet shows its hint where the figure goes, never a dash.
 */
export function Figures({ items }: { items: Figure[] }) {
  return (
    <dl className="grid grid-cols-2 rounded-sm border border-line bg-panel">
      {items.map((r, i) => (
        <div key={r.label} className={`flex min-w-0 flex-col gap-1 border-line/60 px-4 py-3 ${i % 2 ? 'border-l' : ''} ${i > 1 ? 'border-t' : ''}`}>
          <dt className="text-xs text-muted">{r.label}</dt>
          {r.value === null ? (
            <dd className="text-sm text-faint">{r.hint}</dd>
          ) : (
            <>
              <dd className={`truncate font-num leading-tight font-semibold tabular-nums ${r.className ?? 'text-[28px] text-text'}`}>{r.value}</dd>
              <dd className="text-xs text-muted">{r.hint}</dd>
            </>
          )}
        </div>
      ))}
    </dl>
  );
}
