import { Fragment } from 'react';

/** Page buttons: first, last and a few around the current one. */
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const near = [...new Set([0, page - 1, page, page + 1, pages - 1])].filter((p) => p >= 0 && p < pages).sort((a, b) => a - b);
  const btn = 'min-w-7 rounded-sm border border-line px-1.5 py-0.5 tabular-nums hover:text-text disabled:opacity-40 disabled:hover:text-muted';
  return (
    <span className="flex items-center gap-1">
      <button className={btn} disabled={page === 0} onClick={() => onPage(page - 1)} title="Newer page">
        ‹
      </button>
      {near.map((p, i) => (
        <Fragment key={p}>
          {i > 0 && p - near[i - 1] > 1 && <span>…</span>}
          <button className={`${btn} ${p === page ? 'border-accent/70 text-text' : ''}`} onClick={() => onPage(p)}>
            {p + 1}
          </button>
        </Fragment>
      ))}
      <button className={btn} disabled={page === pages - 1} onClick={() => onPage(page + 1)} title="Next page">
        ›
      </button>
    </span>
  );
}
